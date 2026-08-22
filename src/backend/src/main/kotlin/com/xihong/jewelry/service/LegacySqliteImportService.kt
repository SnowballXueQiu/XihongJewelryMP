package com.xihong.jewelry.service

import com.xihong.jewelry.config.AppProperties
import org.slf4j.LoggerFactory
import org.springframework.boot.ApplicationArguments
import org.springframework.boot.ApplicationRunner
import org.springframework.core.annotation.Order
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.ConnectionCallback
import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Transactional
import java.nio.file.Files
import java.nio.file.Path
import java.sql.DriverManager
import java.sql.ResultSet
import java.sql.Timestamp
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.Locale

/**
 * One-time, idempotent migration from the legacy FastAPI SQLite volume.
 *
 * The core importer runs only while PostgreSQL is empty. Supplementary archive migrations are independently
 * idempotent so a newly introduced archive can safely backfill an already-migrated database. Primary keys and
 * business order numbers are preserved and PostgreSQL identity sequences are advanced. This lets production
 * mount the previous backend_data volume read-only without ever overwriting it.
 */
@Component
@Order(0)
class LegacySqliteImportService(
    private val properties: AppProperties,
    private val jdbc: JdbcTemplate,
) : ApplicationRunner {
    private val log = LoggerFactory.getLogger(javaClass)

    @Transactional
    override fun run(args: ApplicationArguments) {
        val pathText = properties.legacySqlitePath.trim()
        if (pathText.isBlank() || !Files.isRegularFile(Path.of(pathText))) return
        val existingUsers = jdbc.queryForObject("SELECT COUNT(*) FROM users", Long::class.java) ?: 0L
        Class.forName("org.sqlite.JDBC")
        DriverManager.getConnection("jdbc:sqlite:$pathText").use { sqlite ->
            sqlite.createStatement().use { it.execute("PRAGMA query_only = ON") }
            // V6 was introduced after the first production cold import. Title backfill therefore has
            // its own idempotent gate and must run even when the original users gate is already closed.
            if (existingUsers > 0L) {
                val titles = importLegacyInvoiceTitles(sqlite)
                advanceSequence(LegacyInvoiceTitleCompatibility.TARGET)
                val reminders = backfillConfirmReceiveReminderAudits(sqlite)
                log.info(
                    "Legacy core import skipped because PostgreSQL already contains users; " +
                        "supplemented {} invoice title archive rows and {} confirmation reminder events",
                    titles,
                    reminders,
                )
                return
            }
            var total = 0
            TABLES.forEach { mapping ->
                total += copyTable(sqlite, mapping)
                if (mapping.target == "users") total += importLegacyInvoiceTitles(sqlite)
            }
            // Legacy refunds have already applied their stock/coupon/points compensation. Mark them so a
            // later WeChat platform sync cannot apply the same business effects a second time.
            jdbc.update(
                "UPDATE refunds SET business_applied_at = updated_at " +
                    "WHERE lower(status) = 'success' AND business_applied_at IS NULL",
            )
            (TABLES.map(TableMapping::target) + LegacyInvoiceTitleCompatibility.TARGET)
                .distinct()
                .forEach(::advanceSequence)
            val reminderAudits = backfillConfirmReceiveReminderAudits(sqlite)
            if (reminderAudits > 0) {
                log.info("Backfilled {} legacy confirmation reminder markers as audit events", reminderAudits)
            }
            log.info("Imported {} legacy rows from {} into PostgreSQL", total, pathText)
        }
    }

    private fun copyTable(sqlite: java.sql.Connection, mapping: TableMapping): Int {
        if (!sourceTableExists(sqlite, mapping.source)) return 0
        val sourceColumns = sourceColumns(sqlite, mapping.source)
        val targetColumns = targetColumns(mapping.target)
        val selected = sourceColumns.mapNotNull { source ->
            val target = mapping.rename[source] ?: source
            target.takeIf(targetColumns::containsKey)?.let { Column(source, it, targetColumns.getValue(it)) }
        }
        if (selected.isEmpty()) return 0
        val selectSql = "SELECT ${selected.joinToString(",") { quoteSqlite(it.source) }} FROM ${quoteSqlite(mapping.source)}"
        val insertSql = "INSERT INTO ${quotePostgres(mapping.target)} (${selected.joinToString(",") { quotePostgres(it.target) }}) VALUES (${selected.joinToString(",") { "?" }})"
        var count = 0
        sqlite.createStatement().use { statement ->
            statement.executeQuery(selectSql).use { rows ->
                jdbc.execute(ConnectionCallback<Void?> { targetConnection ->
                    targetConnection.prepareStatement(insertSql).use { insert ->
                        while (rows.next()) {
                            selected.forEachIndexed { index, column ->
                                insert.setObject(index + 1, normalize(mapping, column, rows, index + 1))
                            }
                            insert.addBatch()
                            count += 1
                        }
                        if (count > 0) insert.executeBatch()
                    }
                    null
                })
            }
        }
        log.info("Imported {} rows: {} -> {}", count, mapping.source, mapping.target)
        return count
    }

    private fun convert(rows: ResultSet, index: Int, dataType: String): Any? {
        val value = rows.getObject(index) ?: return null
        return when (dataType) {
            "boolean" -> when (value) {
                is Boolean -> value
                is Number -> value.toInt() != 0
                else -> value.toString().equals("true", true) || value.toString() == "1"
            }
            "timestamp with time zone", "timestamp without time zone" -> parseTimestamp(value.toString())
            else -> value
        }
    }

    private fun normalize(mapping: TableMapping, column: Column, rows: ResultSet, index: Int): Any? {
        if (mapping.target == "orders" && column.target == LegacyOrderCompatibility.TEST_ORDER_TARGET) {
            return LegacyOrderCompatibility.isTestOrder(rows.getObject(index))
        }
        val converted = convert(rows, index, column.dataType)
        if (mapping.target == "orders" && column.target == "order_no" && converted?.toString().isNullOrBlank()) {
            return legacyOrderNo(rows.getLong("id"))
        }
        if (mapping.target == "payment_intents" && column.target == "out_trade_no" && converted?.toString().isNullOrBlank()) {
            return legacyOrderNo(rows.getLong("order_id"))
        }
        if (column.target == "updated_at" && converted == null) {
            return parseTimestamp(rows.getString("created_at"))
        }
        return converted
    }

    private fun legacyOrderNo(orderId: Long): String = "LEGACY${orderId.toString().padStart(14, '0')}"

    private fun parseTimestamp(value: String): Timestamp = Timestamp.from(
        runCatching { Instant.parse(value) }.getOrElse {
            runCatching { OffsetDateTime.parse(value).toInstant() }.getOrElse {
                LocalDateTime.parse(value.replace(' ', 'T')).toInstant(ZoneOffset.UTC)
            }
        },
    )

    private fun sourceTableExists(connection: java.sql.Connection, table: String): Boolean = connection.prepareStatement(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
    ).use { statement -> statement.setString(1, table); statement.executeQuery().use(ResultSet::next) }

    private fun sourceColumns(connection: java.sql.Connection, table: String): List<String> = connection.createStatement().use { statement ->
        statement.executeQuery("PRAGMA table_info(${quoteSqlite(table)})").use { rows ->
            buildList { while (rows.next()) add(rows.getString("name")) }
        }
    }

    private fun targetColumns(table: String): Map<String, String> = jdbc.query(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=?",
        { rows, _ -> rows.getString(1) to rows.getString(2) },
        table,
    ).toMap()

    private fun advanceSequence(table: String) {
        jdbc.execute(
            "SELECT setval(pg_get_serial_sequence('${table.replace("'", "''")}', 'id'), " +
                "COALESCE((SELECT MAX(id) FROM ${quotePostgres(table)}), 1), " +
                "EXISTS(SELECT 1 FROM ${quotePostgres(table)}))",
        )
    }

    /**
     * The Kotlin admin service uses audit events, rather than an order column, as the durable
     * duplicate-reminder guard. Most legacy reminders already have a matching audit row, which is
     * copied normally; this backfill preserves older markers that predate that audit write.
     */
    internal fun backfillConfirmReceiveReminderAudits(sqlite: java.sql.Connection): Int {
        if (!sourceTableExists(sqlite, "order") ||
            "platform_confirm_receive_reminded_at" !in sourceColumns(sqlite, "order")) return 0

        var inserted = 0
        sqlite.createStatement().use { statement ->
            statement.executeQuery(
                "SELECT [id], [platform_confirm_receive_reminded_at] FROM [order] " +
                    "WHERE [platform_confirm_receive_reminded_at] IS NOT NULL " +
                    "AND trim(CAST([platform_confirm_receive_reminded_at] AS TEXT)) <> ''",
            ).use { rows ->
                while (rows.next()) {
                    val orderId = rows.getLong("id").toString()
                    val exists = jdbc.queryForObject(
                        "SELECT EXISTS(SELECT 1 FROM audit_logs WHERE action=? AND entity=? AND entity_id=?)",
                        Boolean::class.java,
                        "confirm_receive_reminder",
                        "order",
                        orderId,
                    ) == true
                    if (!exists) {
                        jdbc.update(
                            "INSERT INTO audit_logs(admin_id, action, entity, entity_id, detail, created_at) " +
                                "VALUES (NULL, ?, ?, ?, ?, ?)",
                            "confirm_receive_reminder",
                            "order",
                            orderId,
                            "由旧版确认收货提醒标记迁移",
                            parseTimestamp(rows.getObject("platform_confirm_receive_reminded_at").toString()),
                        )
                        inserted += 1
                    }
                }
            }
        }
        return inserted
    }

    /**
     * Imports the retired title book independently from the one-shot core migration.
     *
     * It preserves raw source values, links a user only when a non-secret identity value matches,
     * and treats an identical primary-key row as an idempotent replay. A different row at the same
     * ID is a migration conflict and aborts without logging personal data.
     */
    internal fun importLegacyInvoiceTitles(sqlite: java.sql.Connection): Int {
        if (!sourceTableExists(sqlite, "invoicetitle")) return 0
        val columns = sourceColumns(sqlite, "invoicetitle").toSet()
        if ("id" !in columns || "user_id" !in columns) {
            throw IllegalStateException("Legacy invoicetitle is missing its identity columns")
        }
        val linkedUsers = matchingLegacyUsers(sqlite)
        val projection = LegacyInvoiceTitleCompatibility.sourceColumns.joinToString(",") { name ->
            if (name in columns) "${quoteSqlite(name)} AS ${quoteSqlite(name)}"
            else "NULL AS ${quoteSqlite(name)}"
        }
        val insertSql = """
            INSERT INTO legacy_invoice_titles(
              id, source_user_id, user_id, source_invoice_type, buyer_type, buyer_name,
              buyer_taxpayer_id, contact_email, source_is_default, is_default,
              source_created_at_raw, source_updated_at_raw, source_created_at, source_updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO NOTHING
        """.trimIndent()
        val existingSql = """
            SELECT source_user_id, user_id, source_invoice_type, buyer_type, buyer_name,
              buyer_taxpayer_id, contact_email, source_is_default, is_default,
              source_created_at_raw, source_updated_at_raw
            FROM legacy_invoice_titles WHERE id=?
        """.trimIndent()
        var inserted = 0
        var unchanged = 0
        var unlinked = 0
        sqlite.createStatement().use { statement ->
            statement.executeQuery("SELECT $projection FROM ${quoteSqlite("invoicetitle")}").use { rows ->
                jdbc.execute(ConnectionCallback<Void?> { target ->
                    target.prepareStatement(insertSql).use { insert ->
                        target.prepareStatement(existingSql).use { existing ->
                            while (rows.next()) {
                                val row = LegacyInvoiceTitleCompatibility.from(rows, linkedUsers)
                                if (row.userId == null) unlinked += 1
                                row.bind(insert)
                                if (insert.executeUpdate() == 1) {
                                    inserted += 1
                                } else {
                                    existing.setLong(1, row.id)
                                    existing.executeQuery().use { archived ->
                                        check(archived.next() && row.matches(archived)) {
                                            "Legacy invoice title archive conflict for id=${row.id}"
                                        }
                                    }
                                    unchanged += 1
                                }
                            }
                        }
                    }
                    null
                })
            }
        }
        log.info(
            "Imported {} legacy invoice titles ({} unchanged, {} conservatively unlinked)",
            inserted,
            unchanged,
            unlinked,
        )
        return inserted
    }

    private fun matchingLegacyUsers(sqlite: java.sql.Connection): Map<Long, Long> {
        if (!sourceTableExists(sqlite, "user")) return emptyMap()
        val columns = sourceColumns(sqlite, "user").toSet()
        if ("id" !in columns) return emptyMap()
        fun optional(name: String) = if (name in columns) quoteSqlite(name) else "NULL"
        val sourceUsers = sqlite.createStatement().use { statement ->
            statement.executeQuery(
                "SELECT ${quoteSqlite("id")}, ${optional("wechat_openid")}, ${optional("phone")} " +
                    "FROM ${quoteSqlite("user")}",
            ).use { rows ->
                buildMap {
                    while (rows.next()) {
                        put(
                            rows.getLong(1),
                            LegacyUserIdentity(rows.getString(2).orEmpty().trim(), rows.getString(3).orEmpty().trim()),
                        )
                    }
                }
            }
        }
        val targetUsers = jdbc.query(
            "SELECT id, wechat_openid, phone FROM users",
        ) { rows, _ ->
            rows.getLong("id") to LegacyUserIdentity(
                rows.getString("wechat_openid").orEmpty().trim(),
                rows.getString("phone").orEmpty().trim(),
            )
        }.toMap()
        return sourceUsers.mapNotNull { (id, source) ->
            val target = targetUsers[id] ?: return@mapNotNull null
            val matches =
                (source.openid.isNotBlank() && source.openid == target.openid) ||
                    (source.phone.isNotBlank() && source.phone == target.phone)
            id.takeIf { matches }?.let { it to it }
        }.toMap()
    }

    private fun quoteSqlite(value: String) = "[${value.replace("]", "]]" )}]"
    private fun quotePostgres(value: String) = "\"${value.replace("\"", "\"\"")}\""

    private data class Column(val source: String, val target: String, val dataType: String)
    private data class TableMapping(val source: String, val target: String, val rename: Map<String, String> = emptyMap())

    companion object {
        private val TABLES = listOf(
            TableMapping("user", "users"),
            TableMapping("category", "categories"),
            TableMapping("product", "products"),
            TableMapping("coupon", "coupons"),
            TableMapping("order", "orders", LegacyOrderCompatibility.renames),
            TableMapping("address", "addresses"),
            TableMapping("cartitem", "cart_items"),
            TableMapping("favorite", "favorites"),
            TableMapping("usercoupon", "user_coupons"),
            TableMapping("orderitem", "order_items"),
            TableMapping("paymentintent", "payment_intents", mapOf("package" to "package_value")),
            TableMapping("refund", "refunds"),
            TableMapping("petprofile", "pet_profiles"),
            TableMapping("pointledger", "point_ledgers"),
            TableMapping("adminuser", "admin_users"),
            TableMapping("banner", "banners"),
            TableMapping("asset", "assets"),
            TableMapping("sitesetting", "site_settings", mapOf("group" to "setting_group")),
            TableMapping("auditlog", "audit_logs"),
        )
    }
}

/**
 * The retired local title book has no order ID, so assigning it to an order would be incorrect.
 * It is imported into a private archive instead and never used in place of a title returned by
 * WeChat. The type normalization only translates the two value domains accepted by the old API;
 * unexpected values remain visibly non-authoritative rather than being guessed as a legal type.
 */
internal object LegacyInvoiceTitleCompatibility {
    const val TARGET = "legacy_invoice_titles"

    val renames = mapOf(
        "invoice_type" to listOf("source_invoice_type", "buyer_type"),
        "title" to listOf("buyer_name"),
        "tax_number" to listOf("buyer_taxpayer_id"),
        "email" to listOf("contact_email"),
        "is_default" to listOf("source_is_default", "is_default"),
        "created_at" to listOf("source_created_at_raw", "source_created_at"),
        "updated_at" to listOf("source_updated_at_raw", "source_updated_at"),
    )

    val sourceColumns = listOf(
        "id",
        "user_id",
        "invoice_type",
        "title",
        "tax_number",
        "email",
        "is_default",
        "created_at",
        "updated_at",
    )

    fun normalizeBuyerType(value: Any?): String {
        val raw = value?.toString()?.trim().orEmpty()
        return when (raw.lowercase(Locale.ROOT)) {
            "personal", "individual" -> "INDIVIDUAL"
            "company", "organization" -> "ORGANIZATION"
            else -> "UNKNOWN"
        }
    }

    fun normalizeDefault(value: Any?): Boolean = when (value) {
        is Boolean -> value
        is Number -> value.toInt() != 0
        else -> value?.toString()?.trim()?.lowercase(Locale.ROOT) in setOf("1", "true", "yes", "on")
    }

    fun from(rows: ResultSet, linkedUsers: Map<Long, Long>): LegacyInvoiceTitleRow {
        val sourceUserId = rows.getLong("user_id")
        val rawType = rows.getObject("invoice_type")?.toString().orEmpty()
        val rawDefault = rows.getObject("is_default")?.toString().orEmpty()
        val rawCreatedAt = rows.getObject("created_at")?.toString().orEmpty()
        val rawUpdatedAt = rows.getObject("updated_at")?.toString().orEmpty()
        return LegacyInvoiceTitleRow(
            id = rows.getLong("id"),
            sourceUserId = sourceUserId,
            userId = linkedUsers[sourceUserId],
            sourceInvoiceType = rawType,
            buyerType = normalizeBuyerType(rawType),
            buyerName = rows.getObject("title")?.toString().orEmpty(),
            buyerTaxpayerId = rows.getObject("tax_number")?.toString().orEmpty(),
            contactEmail = rows.getObject("email")?.toString().orEmpty(),
            sourceIsDefault = rawDefault,
            isDefault = normalizeDefault(rows.getObject("is_default")),
            sourceCreatedAtRaw = rawCreatedAt,
            sourceUpdatedAtRaw = rawUpdatedAt,
            sourceCreatedAt = parseLegacyArchiveTimestamp(rawCreatedAt),
            sourceUpdatedAt = parseLegacyArchiveTimestamp(rawUpdatedAt),
        )
    }

    private fun parseLegacyArchiveTimestamp(value: String): Timestamp? {
        if (value.isBlank()) return null
        return runCatching {
            Timestamp.from(
                runCatching { Instant.parse(value) }.getOrElse {
                    runCatching { OffsetDateTime.parse(value).toInstant() }.getOrElse {
                        LocalDateTime.parse(value.replace(' ', 'T')).toInstant(ZoneOffset.UTC)
                    }
                },
            )
        }.getOrNull()
    }
}

private data class LegacyUserIdentity(val openid: String, val phone: String)

internal data class LegacyInvoiceTitleRow(
    val id: Long,
    val sourceUserId: Long,
    val userId: Long?,
    val sourceInvoiceType: String,
    val buyerType: String,
    val buyerName: String,
    val buyerTaxpayerId: String,
    val contactEmail: String,
    val sourceIsDefault: String,
    val isDefault: Boolean,
    val sourceCreatedAtRaw: String,
    val sourceUpdatedAtRaw: String,
    val sourceCreatedAt: Timestamp?,
    val sourceUpdatedAt: Timestamp?,
) {
    fun bind(statement: java.sql.PreparedStatement) {
        statement.setLong(1, id)
        statement.setLong(2, sourceUserId)
        statement.setObject(3, userId)
        statement.setString(4, sourceInvoiceType)
        statement.setString(5, buyerType)
        statement.setString(6, buyerName)
        statement.setString(7, buyerTaxpayerId)
        statement.setString(8, contactEmail)
        statement.setString(9, sourceIsDefault)
        statement.setBoolean(10, isDefault)
        statement.setString(11, sourceCreatedAtRaw)
        statement.setString(12, sourceUpdatedAtRaw)
        statement.setObject(13, sourceCreatedAt)
        statement.setObject(14, sourceUpdatedAt)
    }

    fun matches(rows: ResultSet): Boolean =
        sourceUserId == rows.getLong("source_user_id") &&
            sourceInvoiceType == rows.getString("source_invoice_type") &&
            buyerType == rows.getString("buyer_type") &&
            buyerName == rows.getString("buyer_name") &&
            buyerTaxpayerId == rows.getString("buyer_taxpayer_id") &&
            contactEmail == rows.getString("contact_email") &&
            sourceIsDefault == rows.getString("source_is_default") &&
            isDefault == LegacyInvoiceTitleCompatibility.normalizeDefault(rows.getObject("is_default")) &&
            sourceCreatedAtRaw == rows.getString("source_created_at_raw") &&
            sourceUpdatedAtRaw == rows.getString("source_updated_at_raw")
}

/**
 * Semantic compatibility for legacy order columns whose names or value domains changed.
 *
 * The old platform_special_order_type used 1 for presale orders and 2 for test orders. The new
 * model deliberately persists only the test-order distinction, so a generic numeric-to-boolean
 * conversion would be unsafe: it would incorrectly turn presale value 1 into test_order=true.
 * Legacy logistics_company is not copied to WeChat's carrier ID/name fields because a free-form
 * label cannot establish an official carrier identity; the new workflow resolves it from WeChat.
 * Presale delay metadata likewise has no equivalent in the new model and remains authoritative in
 * the already-uploaded WeChat order rather than being reinterpreted locally.
 */
internal object LegacyOrderCompatibility {
    const val TEST_ORDER_TARGET = "test_order"

    val renames = mapOf(
        "completed_at" to "received_at",
        "platform_special_order_type" to TEST_ORDER_TARGET,
    )

    fun isTestOrder(value: Any?): Boolean = when (value) {
        is Number -> value.toInt() == 2
        else -> value?.toString()?.trim()?.toIntOrNull() == 2
    }
}
