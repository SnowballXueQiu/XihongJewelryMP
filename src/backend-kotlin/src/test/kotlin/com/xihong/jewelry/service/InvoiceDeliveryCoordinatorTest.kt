package com.xihong.jewelry.service

import com.xihong.jewelry.controller.AdminInvoiceDeliveryRequest
import com.xihong.jewelry.domain.OrderEntity
import com.xihong.jewelry.repository.OrderRepository
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.mock
import org.mockito.Mockito.times
import org.mockito.Mockito.verify
import org.mockito.Mockito.`when`
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.TransactionStatus
import org.springframework.transaction.support.SimpleTransactionStatus
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import java.util.Optional

class InvoiceDeliveryCoordinatorTest {
    private val orders = mock(OrderRepository::class.java)
    private val domain = mock(DomainMapper::class.java)
    private val invoiceApi = mock(WechatInvoiceService::class.java)
    private val service = InvoiceDeliveryCoordinator(orders, domain, invoiceApi, SerialTransactionManager())

    @Test
    fun `durable delivering claim rejects a concurrent admin submission`() {
        val order = invoiceOrder()
        `when`(orders.lockById(order.id!!)).thenReturn(order)
        `when`(orders.save(any(OrderEntity::class.java))).thenAnswer { it.getArgument(0) }
        `when`(domain.authoritativeStatus(order)).thenReturn("completed")
        val request = request()
        val pdf = pdf()
        val command = command(order, request)
        val enteredRemote = CountDownLatch(1)
        val releaseRemote = CountDownLatch(1)
        `when`(invoiceApi.deliver(command, pdf)).thenAnswer {
            enteredRemote.countDown()
            check(releaseRemote.await(3, TimeUnit.SECONDS)) { "test release timed out" }
            InvoiceDeliveryReceipt(order.invoiceApplyId, "media-1", Instant.now(), "INSERT_ACCEPTED")
        }
        val executor = Executors.newSingleThreadExecutor()
        val first = executor.submit<InvoiceDeliveryOutcome> {
            service.deliver(order.id!!, request, "invoice.pdf", pdf)
        }
        assertTrue(enteredRemote.await(2, TimeUnit.SECONDS))

        val duplicateError = assertThrows(IllegalArgumentException::class.java) {
            service.deliver(order.id!!, request, "invoice.pdf", pdf)
        }
        assertTrue(duplicateError.message.orEmpty().contains("正在交付"))
        releaseRemote.countDown()

        val outcome = first.get(2, TimeUnit.SECONDS)
        assertEquals("delivery_submitted", outcome.order.invoiceStatus)
        verify(invoiceApi, times(1)).deliver(command, pdf)
        executor.shutdownNow()
    }

    @Test
    fun `ambiguous response recovers from authoritative WeChat status without resubmission`() {
        val order = invoiceOrder()
        `when`(orders.lockById(order.id!!)).thenReturn(order)
        `when`(orders.save(any(OrderEntity::class.java))).thenAnswer { it.getArgument(0) }
        `when`(domain.authoritativeStatus(order)).thenReturn("completed")
        val request = request()
        val pdf = pdf()
        val command = command(order, request)
        `when`(invoiceApi.deliver(command, pdf))
            .thenThrow(WechatPayConfigurationException("connection reset after request"))
        `when`(invoiceApi.status(order.invoiceApplyId)).thenReturn(
            InvoiceDeliveryStatus(
                1,
                listOf(InvoiceStatusItem("fapiao-1", "ISSUED", "INSERTED")),
            ),
        )

        val outcome = service.deliver(order.id!!, request, "invoice.pdf", pdf)

        assertTrue(outcome.recoveredFromWechat)
        assertEquals("inserted", outcome.order.invoiceStatus)
        assertEquals("fapiao-1", outcome.order.invoiceFapiaoId)
        assertThrows(IllegalArgumentException::class.java) {
            service.deliver(order.id!!, request, "invoice.pdf", pdf)
        }
        verify(invoiceApi, times(1)).deliver(command, pdf)
    }

    @Test
    fun `status sync preserves card delivery failure while keeping authoritative issued tax state`() {
        val order = invoiceOrder().apply {
            invoiceStatus = "delivery_submitted"
            invoiceFapiaoId = "fapiao-1"
        }
        `when`(orders.findById(order.id!!)).thenReturn(Optional.of(order))
        `when`(orders.lockById(order.id!!)).thenReturn(order)
        `when`(orders.save(any(OrderEntity::class.java))).thenAnswer { it.getArgument(0) }
        `when`(invoiceApi.status(order.invoiceApplyId, order.invoiceFapiaoId)).thenReturn(
            InvoiceDeliveryStatus(
                1,
                listOf(InvoiceStatusItem("fapiao-1", "ISSUED", "INSERT_FAILED")),
            ),
        )

        val synced = service.syncStatus(order.id!!)

        assertEquals("issued", synced.invoiceStatus)
        assertFalse(synced.invoiceError.isBlank())
    }

    private fun invoiceOrder() = OrderEntity(
        id = 41,
        orderNo = "XH26082200000041",
        userId = 7,
        status = "completed",
        totalCents = 10_000,
        invoiceRequested = true,
        invoiceStatus = "title_received",
        invoiceApplyId = "XH26082200000041",
        invoiceBuyerType = "INDIVIDUAL",
        invoiceBuyerName = "测试用户",
    )

    private fun request() = AdminInvoiceDeliveryRequest(
        fapiaoNumber = "12345678",
        fapiaoCode = "123456789012",
        fapiaoTime = OffsetDateTime.of(2026, 8, 22, 20, 0, 0, 0, ZoneOffset.ofHours(8)),
        checkCode = "12345678901234567890",
        password = "password-area",
        totalAmount = 10_000,
        taxAmount = 100,
        sellerName = "天津玺鸿珠宝贸易有限公司",
        sellerTaxpayerId = "91120000TEST",
        drawer = "开票员",
    )

    private fun pdf() = "%PDF-1.7\ninvoice".toByteArray()

    private fun command(order: OrderEntity, value: AdminInvoiceDeliveryRequest) = InvoiceDeliveryCommand(
        fapiaoApplyId = order.invoiceApplyId,
        scene = InvoiceScene.WITHOUT_WECHATPAY,
        buyer = InvoiceBuyerInformation(type = order.invoiceBuyerType, name = order.invoiceBuyerName),
        card = InvoiceCardInformation(
            fapiaoNumber = value.fapiaoNumber,
            fapiaoCode = value.fapiaoCode,
            fapiaoTime = value.fapiaoTime,
            checkCode = value.checkCode,
            password = value.password,
            totalAmount = value.totalAmount,
            taxAmount = value.taxAmount,
            amount = value.totalAmount - value.taxAmount,
            seller = InvoiceSellerInformation(value.sellerName, value.sellerTaxpayerId),
            extra = InvoiceExtraInformation(value.drawer),
        ),
        fileName = "invoice.pdf",
    )

    private class SerialTransactionManager : PlatformTransactionManager {
        private val lock = ReentrantLock()
        override fun getTransaction(definition: TransactionDefinition?): TransactionStatus {
            lock.lock()
            return SimpleTransactionStatus()
        }
        override fun commit(status: TransactionStatus) = lock.unlock()
        override fun rollback(status: TransactionStatus) = lock.unlock()
    }
}
