package com.xihong.jewelry.service

import com.fasterxml.jackson.databind.ObjectMapper
import com.xihong.jewelry.domain.OrderEntity
import com.xihong.jewelry.domain.PaymentIntentEntity
import com.xihong.jewelry.repository.OrderItemRepository
import com.xihong.jewelry.repository.PaymentIntentRepository
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import java.time.Instant

class DomainMapperTest {
    private val items = mock(OrderItemRepository::class.java)
    private val payments = mock(PaymentIntentRepository::class.java)
    private val mapper = DomainMapper(ObjectMapper().findAndRegisterModules(), items, payments)

    @Test
    fun `pickup receipt uses the older successful transaction when the newest payment attempt failed`() {
        val order = completedPickupOrder()
        val failedRetry = PaymentIntentEntity(
            id = 22,
            orderId = order.id!!,
            status = "failed",
            outTradeNo = "XH-RETRY",
            createdAt = Instant.parse("2026-08-22T12:01:00Z"),
        )
        val successfulPayment = PaymentIntentEntity(
            id = 21,
            orderId = order.id!!,
            provider = "wechat_pay",
            status = "succeeded",
            outTradeNo = "XH26082200000051",
            transactionId = "420000260120260822000051",
            createdAt = Instant.parse("2026-08-22T12:00:00Z"),
        )
        `when`(items.findAllByOrderIdOrderByIdAsc(order.id!!)).thenReturn(emptyList())
        `when`(payments.findAllByOrderIdOrderByCreatedAtDesc(order.id!!))
            .thenReturn(listOf(failedRetry, successfulPayment))

        val dto = mapper.order(order)

        assertEquals(successfulPayment.transactionId, dto.paymentTransactionId)
        assertEquals("pickup_ready", dto.status)
        assertEquals("待取货", dto.platformOrderStateLabel)
        assertTrue(dto.canConfirmReceipt)
    }

    @Test
    fun `wallet discard remains refund blocked until tax reversal is authoritative`() {
        val order = completedPickupOrder().apply { invoiceStatus = "discarded" }
        `when`(items.findAllByOrderIdOrderByIdAsc(order.id!!)).thenReturn(emptyList())
        `when`(payments.findAllByOrderIdOrderByCreatedAtDesc(order.id!!)).thenReturn(emptyList())

        assertFalse(mapper.order(order).canRefund)

        order.invoiceStatus = "reversed"
        assertTrue(mapper.order(order).canRefund)
    }

    private fun completedPickupOrder() = OrderEntity(
        id = 51,
        orderNo = "XH26082200000051",
        userId = 7,
        status = "paid",
        totalCents = 10_000,
        fulfillmentType = "pickup",
        platformOrderState = 2,
        paidAt = Instant.parse("2026-08-22T12:00:00Z"),
    )
}
