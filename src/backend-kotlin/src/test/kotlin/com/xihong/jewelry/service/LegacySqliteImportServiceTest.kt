package com.xihong.jewelry.service

import com.xihong.jewelry.config.AppProperties
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.SingleConnectionDataSource
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

    private fun properties() = AppProperties(
        publicBaseUrl = "https://example.invalid",
        uploadsDir = "/tmp",
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
