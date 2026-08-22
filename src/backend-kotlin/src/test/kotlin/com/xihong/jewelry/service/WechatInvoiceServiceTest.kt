package com.xihong.jewelry.service

import com.fasterxml.jackson.databind.ObjectMapper
import com.xihong.jewelry.config.AppProperties
import com.xihong.jewelry.repository.CallbackEventRepository
import org.junit.jupiter.api.Assertions.assertDoesNotThrow
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.springframework.beans.factory.ObjectProvider
import java.time.OffsetDateTime
import java.time.ZoneOffset

class WechatInvoiceServiceTest {
    private val properties = AppProperties(
        publicBaseUrl = "https://example.test",
        uploadsDir = "build/test-uploads",
        allowMockUser = true,
        userTokenSecret = "u".repeat(32),
        adminTokenSecret = "a".repeat(32),
        adminBootstrapEmail = "admin@example.test",
        adminBootstrapPassword = "test-password",
        adminBootstrapName = "Admin",
        companyNameZh = "天津玺鸿珠宝贸易有限公司",
        companyNameEn = "Xihong Jewelry",
        shippingFeeCents = 0,
        freeShippingThresholdCents = 0,
        wechat = AppProperties.Wechat(),
        pay = AppProperties.Pay(mock = true),
    )
    @Suppress("UNCHECKED_CAST")
    private val lifecycle = mock(ObjectProvider::class.java) as ObjectProvider<InvoiceLifecycle>
    private val service = WechatInvoiceService(
        properties,
        WechatPayClientProvider(properties),
        ObjectMapper().findAndRegisterModules(),
        WechatCallbackInboxService(mock(CallbackEventRepository::class.java)),
        lifecycle,
    )

    @Test
    fun `ordinary merchant card fields follow the official strict lengths`() {
        val command = validCommand()
        assertDoesNotThrow { service.validateDelivery(command, pdf()) }

        assertThrows(IllegalArgumentException::class.java) {
            service.validateDelivery(command.copy(card = command.card.copy(fapiaoNumber = "123456789")), pdf())
        }
        assertThrows(IllegalArgumentException::class.java) {
            service.validateDelivery(command.copy(card = command.card.copy(fapiaoCode = "")), pdf())
        }
        assertThrows(IllegalArgumentException::class.java) {
            service.validateDelivery(command.copy(card = command.card.copy(checkCode = "")), pdf())
        }
        assertThrows(IllegalArgumentException::class.java) {
            service.validateDelivery(command.copy(card = command.card.copy(password = "")), pdf())
        }
    }

    private fun validCommand() = InvoiceDeliveryCommand(
        fapiaoApplyId = "XH26082200000061",
        scene = InvoiceScene.WITHOUT_WECHATPAY,
        buyer = InvoiceBuyerInformation(type = "INDIVIDUAL", name = "测试用户"),
        card = InvoiceCardInformation(
            fapiaoNumber = "12345678",
            fapiaoCode = "123456789012",
            fapiaoTime = OffsetDateTime.of(2026, 8, 22, 20, 0, 0, 0, ZoneOffset.ofHours(8)),
            checkCode = "12345678901234567890",
            password = "password-area",
            totalAmount = 10_000,
            taxAmount = 100,
            amount = 9_900,
            seller = InvoiceSellerInformation("天津玺鸿珠宝贸易有限公司", "91120000TEST"),
            extra = InvoiceExtraInformation("开票员"),
        ),
    )

    private fun pdf() = "%PDF-1.7\ninvoice".toByteArray()
}
