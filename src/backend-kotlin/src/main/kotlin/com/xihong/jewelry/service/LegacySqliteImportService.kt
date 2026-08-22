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

/**
 * One-time, idempotent migration from the legacy FastAPI SQLite volume.
 *
 * The importer runs only while PostgreSQL is empty. It preserves primary keys and business order numbers,
 * copies every compatible column dynamically, and then advances PostgreSQL identity sequences. This lets the
 * production compose stack mount the previous backend_data volume read-only without ever overwriting it.
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
        if ((jdbc.queryForObject("SELECT COUNT(*) FROM users", Long::class.java) ?: 0L) > 0L) {
            log.info("Legacy SQLite import skipped because PostgreSQL already contains users")
            return
        }
        Class.forName("org.sqlite.JDBC")
        DriverManager.getConnection("jdbc:sqlite:$pathText").use { sqlite ->
            sqlite.createStatement().use { it.execute("PRAGMA query_only = ON") }
            var total = 0
            TABLES.forEach { mapping -> total += copyTable(sqlite, mapping) }
            // Legacy refunds have already applied their stock/coupon/points compensation. Mark them so a
            // later WeChat platform sync cannot apply the same business effects a second time.
            jdbc.update(
                "UPDATE refunds SET business_applied_at = updated_at " +
                    "WHERE lower(status) = 'success' AND business_applied_at IS NULL",
            )
            TABLES.map(TableMapping::target).distinct().forEach(::advanceSequence)
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
            TableMapping("order", "orders", mapOf("completed_at" to "received_at")),
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
