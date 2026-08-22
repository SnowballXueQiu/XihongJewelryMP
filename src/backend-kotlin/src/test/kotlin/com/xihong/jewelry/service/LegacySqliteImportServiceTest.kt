package com.xihong.jewelry.service

import com.xihong.jewelry.config.AppProperties
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.sqlite.Function
import org.springframework.boot.DefaultApplicationArguments
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.SingleConnectionDataSource
import java.nio.file.Files
import java.sql.DriverManager

class LegacySqliteImportServiceTest {
    @Test
    fun `legacy special order type two alone migrates as a test order`() {
        assertEquals("test_order", LegacyOrderCompatibility.renames["platform_special_order_type"])

        DriverManager.getConnection("jdbc:sqlite::memory:").use { connection ->
            connection.createStatement().use { statement ->
                statement.execute("CREATE TABLE legacy_order (platform_special_order_type INTEGER)")
                statement.execute("INSERT INTO legacy_order VALUES (2), (1), (0), (NULL)")
                statement.executeQuery("SELECT platform_special_order_type FROM legacy_order ORDER BY rowid").use { rows ->
                    val migrated = buildList {
                        while (rows.next()) add(LegacyOrderCompatibility.isTestOrder(rows.getObject(1)))
                    }
                    assertEquals(listOf(true, false, false, false), migrated)
                }
            }
        }
    }

    @Test
    fun `legacy special order normalization rejects non numeric and non test values`() {
        assertTrue(LegacyOrderCompatibility.isTestOrder("2"))
        assertFalse(LegacyOrderCompatibility.isTestOrder(true))
        assertFalse(LegacyOrderCompatibility.isTestOrder("presale"))
        assertFalse(LegacyOrderCompatibility.isTestOrder(3))
    }

    @Test
    fun `legacy reminder marker backfills the new audit guard idempotently`() {
        DriverManager.getConnection("jdbc:sqlite::memory:").use { source ->
            DriverManager.getConnection("jdbc:sqlite::memory:").use { target ->
                source.createStatement().use { statement ->
                    statement.execute(
                        "CREATE TABLE [order] (id INTEGER PRIMARY KEY, platform_confirm_receive_reminded_at TEXT)",
                    )
                    statement.execute(
                        "INSERT INTO [order] VALUES " +
                            "(10, '2026-08-22T10:00:00Z'), (11, '2026-08-22T11:00:00Z'), (12, NULL)",
                    )
                }
                target.createStatement().use { statement ->
                    statement.execute(
                        "CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER, " +
                            "action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT NOT NULL, " +
                            "detail TEXT NOT NULL, created_at TIMESTAMP NOT NULL)",
                    )
                    statement.execute(
                        "INSERT INTO audit_logs(admin_id, action, entity, entity_id, detail, created_at) " +
                            "VALUES (NULL, 'confirm_receive_reminder', 'order', '10', 'already imported', " +
                            "'2026-08-22T10:00:00Z')",
                    )
                }
                val jdbc = JdbcTemplate(SingleConnectionDataSource(target, true))
                val importer = LegacySqliteImportService(properties(), jdbc)

                assertEquals(1, importer.backfillConfirmReceiveReminderAudits(source))
                assertEquals(0, importer.backfillConfirmReceiveReminderAudits(source))
                assertEquals(
                    listOf("10", "11"),
                    jdbc.queryForList(
                        "SELECT entity_id FROM audit_logs WHERE action='confirm_receive_reminder' ORDER BY entity_id",
                        String::class.java,
                    ),
                )
            }
        }
    }

    @Test
    fun `already migrated users still receive the missing private invoice title archive idempotently`() {
        assertEquals(
            listOf("source_invoice_type", "buyer_type"),
            LegacyInvoiceTitleCompatibility.renames["invoice_type"],
        )
        assertEquals(listOf("buyer_name"), LegacyInvoiceTitleCompatibility.renames["title"])
        assertEquals(listOf("buyer_taxpayer_id"), LegacyInvoiceTitleCompatibility.renames["tax_number"])

        DriverManager.getConnection("jdbc:sqlite::memory:").use { source ->
            DriverManager.getConnection("jdbc:sqlite::memory:").use { target ->
                source.createStatement().use { statement ->
                    statement.execute("CREATE TABLE user (id INTEGER PRIMARY KEY, wechat_openid TEXT, phone TEXT)")
                    statement.execute("INSERT INTO user VALUES (3, '', '13000000003'), (4, '', '13000000004')")
                    statement.execute(
                        "CREATE TABLE invoicetitle (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, " +
                            "invoice_type TEXT, title TEXT, tax_number TEXT, email TEXT, is_default, " +
                            "created_at TEXT, updated_at TEXT)",
                    )
                    statement.execute(
                        "INSERT INTO invoicetitle VALUES " +
                            "(7, 3, 'personal', '测试个人', '', 'person@example.invalid', 1, " +
                            "'2026-08-20T10:00:00Z', '2026-08-21T10:00:00Z'), " +
                            "(8, 3, 'company', '测试企业', 'TEST-TAX-ID', '', 0, " +
                            "'2026-08-20T11:00:00Z', '2026-08-21T11:00:00Z'), " +
                            "(9, 4, 'legacy-type', '', '', '', 'unexpected', 'invalid-created-at', NULL)",
                    )
                }
                target.createStatement().use { statement ->
                    statement.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, wechat_openid TEXT, phone TEXT)")
                    // Core rows already exist, which is exactly the production supplement scenario.
                    statement.execute(
                        "INSERT INTO users VALUES (3, '', '13000000003'), (4, '', 'DIFFERENT-PHONE')",
                    )
                    statement.execute(
                        "CREATE TABLE legacy_invoice_titles (id INTEGER PRIMARY KEY, source_user_id INTEGER NOT NULL, " +
                            "user_id INTEGER, source_invoice_type TEXT NOT NULL, buyer_type TEXT NOT NULL, " +
                            "buyer_name TEXT NOT NULL, buyer_taxpayer_id TEXT NOT NULL, contact_email TEXT NOT NULL, " +
                            "source_is_default TEXT NOT NULL, is_default BOOLEAN NOT NULL, " +
                            "source_created_at_raw TEXT NOT NULL, source_updated_at_raw TEXT NOT NULL, " +
                            "source_created_at TIMESTAMP, source_updated_at TIMESTAMP)",
                    )
                }
                val jdbc = JdbcTemplate(SingleConnectionDataSource(target, true))
                val importer = LegacySqliteImportService(properties(), jdbc)

                assertEquals(3, importer.importLegacyInvoiceTitles(source))
                assertEquals(0, importer.importLegacyInvoiceTitles(source))
                assertEquals(
                    listOf("INDIVIDUAL", "ORGANIZATION", "UNKNOWN"),
                    jdbc.queryForList("SELECT buyer_type FROM legacy_invoice_titles ORDER BY id", String::class.java),
                )
                assertEquals(1, jdbc.queryForObject("SELECT is_default FROM legacy_invoice_titles WHERE id=7", Int::class.java))
                assertEquals(3L, jdbc.queryForObject("SELECT user_id FROM legacy_invoice_titles WHERE id=7", Long::class.java))
                assertNull(jdbc.queryForObject("SELECT user_id FROM legacy_invoice_titles WHERE id=9", Long::class.java))
                assertEquals(
                    "invalid-created-at",
                    jdbc.queryForObject(
                        "SELECT source_created_at_raw FROM legacy_invoice_titles WHERE id=9",
                        String::class.java,
                    ),
                )
                assertNull(
                    jdbc.queryForObject(
                        "SELECT source_created_at FROM legacy_invoice_titles WHERE id=9",
                        String::class.java,
                    ),
                )
                assertEquals(3, jdbc.queryForObject("SELECT COUNT(*) FROM legacy_invoice_titles", Int::class.java))

                jdbc.update("UPDATE legacy_invoice_titles SET buyer_name='conflicting value' WHERE id=8")
                assertThrows(IllegalStateException::class.java) {
                    importer.importLegacyInvoiceTitles(source)
                }
            }
        }
    }

    @Test
    fun `legacy invoice type normalization does not guess unrecognized values`() {
        assertEquals("INDIVIDUAL", LegacyInvoiceTitleCompatibility.normalizeBuyerType("personal"))
        assertEquals("ORGANIZATION", LegacyInvoiceTitleCompatibility.normalizeBuyerType("company"))
        assertEquals("UNKNOWN", LegacyInvoiceTitleCompatibility.normalizeBuyerType(null))
        assertEquals("UNKNOWN", LegacyInvoiceTitleCompatibility.normalizeBuyerType("legacy-type"))
        assertTrue(LegacyInvoiceTitleCompatibility.normalizeDefault("YES"))
        assertFalse(LegacyInvoiceTitleCompatibility.normalizeDefault("unexpected"))
    }

    @Test
    fun `runner supplements invoice titles after the core user import has already completed`() {
        val legacyFile = Files.createTempFile("legacy-title-supplement-", ".sqlite3")
        try {
            DriverManager.getConnection("jdbc:sqlite:$legacyFile").use { source ->
                source.createStatement().use { statement ->
                    statement.execute("CREATE TABLE user (id INTEGER PRIMARY KEY, wechat_openid TEXT, phone TEXT)")
                    statement.execute("INSERT INTO user VALUES (3, '', '13000000003')")
                    statement.execute(
                        "CREATE TABLE invoicetitle (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, " +
                            "invoice_type TEXT, title TEXT, tax_number TEXT, email TEXT, is_default, " +
                            "created_at TEXT, updated_at TEXT)",
                    )
                    statement.execute(
                        "INSERT INTO invoicetitle VALUES " +
                            "(7, 3, 'personal', '测试个人', '', '', 1, " +
                            "'2026-08-20T10:00:00Z', '2026-08-21T10:00:00Z')",
                    )
                }
            }
            DriverManager.getConnection("jdbc:sqlite::memory:").use { target ->
                target.createStatement().use { statement ->
                    statement.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, wechat_openid TEXT, phone TEXT)")
                    statement.execute("INSERT INTO users VALUES (3, '', '13000000003')")
                    createArchiveTargetTable(statement)
                }
                // The runner uses PostgreSQL sequence helpers after a supplement. No-op equivalents let
                // this test exercise the real users>0 branch while retaining a real SQLite target.
                Function.create(target, "pg_get_serial_sequence", object : Function() {
                    override fun xFunc() = result("legacy_invoice_titles_id_seq")
                })
                Function.create(target, "setval", object : Function() {
                    override fun xFunc() = result(1)
                })
                val jdbc = JdbcTemplate(SingleConnectionDataSource(target, true))
                val importer = LegacySqliteImportService(properties(legacyFile.toString()), jdbc)

                importer.run(DefaultApplicationArguments())
                importer.run(DefaultApplicationArguments())

                assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM legacy_invoice_titles", Int::class.java))
            }
        } finally {
            Files.deleteIfExists(legacyFile)
        }
    }

    private fun createArchiveTargetTable(statement: java.sql.Statement) {
        statement.execute(
            "CREATE TABLE legacy_invoice_titles (id INTEGER PRIMARY KEY, source_user_id INTEGER NOT NULL, " +
                "user_id INTEGER, source_invoice_type TEXT NOT NULL, buyer_type TEXT NOT NULL, " +
                "buyer_name TEXT NOT NULL, buyer_taxpayer_id TEXT NOT NULL, contact_email TEXT NOT NULL, " +
                "source_is_default TEXT NOT NULL, is_default BOOLEAN NOT NULL, " +
                "source_created_at_raw TEXT NOT NULL, source_updated_at_raw TEXT NOT NULL, " +
                "source_created_at TIMESTAMP, source_updated_at TIMESTAMP)",
        )
    }

    private fun properties(legacySqlitePath: String = "") = AppProperties(
        publicBaseUrl = "https://example.invalid",
        uploadsDir = "/tmp",
        legacySqlitePath = legacySqlitePath,
        allowMockUser = false,
        userTokenSecret = "user-secret-user-secret-user-secret-1",
        adminTokenSecret = "admin-secret-admin-secret-admin-sec-2",
        adminBootstrapEmail = "admin@example.invalid",
        adminBootstrapPassword = "password-1234",
        adminBootstrapName = "admin",
        companyNameZh = "测试珠宝",
        companyNameEn = "Test Jewelry",
        shippingFeeCents = 0,
        freeShippingThresholdCents = 0,
        wechat = AppProperties.Wechat(),
        pay = AppProperties.Pay(),
    )
}
