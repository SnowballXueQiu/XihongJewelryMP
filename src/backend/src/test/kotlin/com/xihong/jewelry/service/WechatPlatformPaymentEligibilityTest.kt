package com.xihong.jewelry.service

import com.fasterxml.jackson.databind.ObjectMapper
import com.xihong.jewelry.config.AppProperties
import com.xihong.jewelry.domain.OrderEntity
import com.xihong.jewelry.domain.PaymentIntentEntity
import com.xihong.jewelry.repository.OrderItemRepository
import com.xihong.jewelry.repository.OrderRepository
import com.xihong.jewelry.repository.PaymentIntentRepository
import com.xihong.jewelry.repository.UserRepository
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.mockito.Mockito.verifyNoInteractions
import org.mockito.Mockito.`when`
import org.springframework.transaction.PlatformTransactionManager

class WechatPlatformPaymentEligibilityTest {
    private val tokens = mock(WechatAccessTokenService::class.java)
    private val payments = mock(PaymentIntentRepository::class.java)
    private val service = WechatPlatformService(
        tokens = tokens,
        properties = properties(),
        mapper = ObjectMapper(),
        users = mock(UserRepository::class.java),
        orderItems = mock(OrderItemRepository::class.java),
        payments = payments,
        orders = mock(OrderRepository::class.java),
        transactionManager = mock(PlatformTransactionManager::class.java),
    )

    @Test
    fun `mock and free ledgers are never treated as WeChat managed orders`() {
        val order = OrderEntity(id = 1, orderNo = "XH26082200000001", status = "paid", totalCents = 1)
        val mockPayment = PaymentIntentEntity(
            id = 1, orderId = 1, provider = "wechat_pay", status = "succeeded",
            outTradeNo = order.orderNo, transactionId = "mock_${order.orderNo}",
        )
        val freePayment = PaymentIntentEntity(
            id = 2, orderId = 1, provider = "free_order", status = "succeeded",
            outTradeNo = "free_${order.orderNo}", transactionId = "",
        )
        `when`(payments.findAllByOrderIdOrderByCreatedAtDesc(1)).thenReturn(listOf(mockPayment, freePayment))

        assertFalse(service.hasManagedPayment(order))
        service.sync(order)
        verifyNoInteractions(tokens)
    }

    @Test
    fun `real successful WeChat transaction is managed`() {
        val order = OrderEntity(id = 2, orderNo = "XH26082200000002", status = "paid", totalCents = 1)
        val payment = PaymentIntentEntity(
            id = 3, orderId = 2, provider = "wechat_pay", status = "succeeded",
            outTradeNo = order.orderNo, transactionId = "4200000000202608220000000002",
        )
        `when`(payments.findAllByOrderIdOrderByCreatedAtDesc(2)).thenReturn(listOf(payment))

        assertTrue(service.hasManagedPayment(order))
    }

    private fun properties() = AppProperties(
        publicBaseUrl = "https://example.invalid", uploadsDir = "/tmp", allowMockUser = false,
        userTokenSecret = "user-secret-user-secret-user-secret-1",
        adminTokenSecret = "admin-secret-admin-secret-admin-sec-2",
        adminBootstrapEmail = "admin@example.invalid", adminBootstrapPassword = "password-1234",
        adminBootstrapName = "admin", companyNameZh = "测试珠宝", companyNameEn = "Test Jewelry",
        shippingFeeCents = 0, freeShippingThresholdCents = 0,
        wechat = AppProperties.Wechat(appId = "wx-test"),
        pay = AppProperties.Pay(mock = false, merchantId = "1112005993"),
    )
}
