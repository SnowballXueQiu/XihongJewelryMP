package com.xihong.jewelry.service

import com.xihong.jewelry.config.AppProperties
import com.xihong.jewelry.domain.OrderEntity
import com.xihong.jewelry.domain.OrderItemEntity
import com.xihong.jewelry.domain.PaymentIntentEntity
import com.xihong.jewelry.domain.ProductEntity
import com.xihong.jewelry.domain.RefundEntity
import com.xihong.jewelry.domain.UserCouponEntity
import com.xihong.jewelry.domain.UserEntity
import com.xihong.jewelry.repository.AddressRepository
import com.xihong.jewelry.repository.CartItemRepository
import com.xihong.jewelry.repository.CouponRepository
import com.xihong.jewelry.repository.OrderItemRepository
import com.xihong.jewelry.repository.OrderRepository
import com.xihong.jewelry.repository.PaymentIntentRepository
import com.xihong.jewelry.repository.PointLedgerRepository
import com.xihong.jewelry.repository.ProductRepository
import com.xihong.jewelry.repository.RefundRepository
import com.xihong.jewelry.repository.SiteSettingRepository
import com.xihong.jewelry.repository.UserCouponRepository
import com.xihong.jewelry.repository.UserRepository
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.inOrder
import org.mockito.Mockito.mock
import org.mockito.Mockito.times
import org.mockito.Mockito.verify
import org.mockito.Mockito.verifyNoInteractions
import org.mockito.Mockito.`when`
import org.springframework.beans.factory.ObjectProvider
import org.springframework.data.domain.PageRequest
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.TransactionStatus
import org.springframework.transaction.support.SimpleTransactionStatus
import java.time.Instant
import java.util.Optional
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock

class OrderServiceLifecycleTest {
    private val users = mock(UserRepository::class.java)
    private val addresses = mock(AddressRepository::class.java)
    private val products = mock(ProductRepository::class.java)
    private val cartItems = mock(CartItemRepository::class.java)
    private val coupons = mock(CouponRepository::class.java)
    private val userCoupons = mock(UserCouponRepository::class.java)
    private val orders = mock(OrderRepository::class.java)
    private val orderItems = mock(OrderItemRepository::class.java)
    private val payments = mock(PaymentIntentRepository::class.java)
    private val refunds = mock(RefundRepository::class.java)
    private val pointLedgers = mock(PointLedgerRepository::class.java)
    private val settings = mock(SiteSettingRepository::class.java)
    private val mapper = mock(DomainMapper::class.java)
    private val platform = mock(WechatPlatformService::class.java)

    @Suppress("UNCHECKED_CAST")
    private val paymentProvider = mock(ObjectProvider::class.java) as ObjectProvider<WechatPayService>

    @Suppress("UNCHECKED_CAST")
    private val invoiceProvider = mock(ObjectProvider::class.java) as ObjectProvider<WechatInvoiceService>

    private fun service(properties: AppProperties = properties()) = OrderService(
        properties = properties, users = users, addresses = addresses, products = products,
        cartItems = cartItems, coupons = coupons, userCoupons = userCoupons, orders = orders,
        orderItems = orderItems, payments = payments, refunds = refunds, pointLedgers = pointLedgers,
        settings = settings, mapper = mapper, platform = platform, paymentProvider = paymentProvider,
        invoiceProvider = invoiceProvider, transactionManager = SerialTransactionManager(),
    )

    private val service = service()

    @Test
    fun `duplicate payment callbacks apply sales and points once`() {
        val order = OrderEntity(id = 1, orderNo = "XH26082200000001", userId = 10, status = "pending_payment", totalCents = 1_000)
        val item = OrderItemEntity(id = 1, orderId = 1, productId = 100, productName = "戒指", unitPriceCents = 1_000, quantity = 2)
        val product = ProductEntity(id = 100, name = "戒指", stock = 8, sales = 3)
        val user = UserEntity(id = 10, nickname = "测试会员", points = 5)
        val payment = PaymentIntentEntity(id = 8, orderId = 1, status = "pending", outTradeNo = order.orderNo)
        `when`(orders.lockById(1)).thenReturn(order)
        `when`(orderItems.findAllByOrderIdOrderByIdAsc(1)).thenReturn(listOf(item))
        `when`(products.lockAllById(listOf(100L))).thenReturn(listOf(product))
        `when`(users.findById(10)).thenReturn(Optional.of(user))
        `when`(payments.lockAllByOrderIdOrderByCreatedAtDesc(1)).thenReturn(listOf(payment))

        service.paymentSucceeded(1, "4200000000001", Instant.parse("2026-08-22T10:00:00Z"))
        service.paymentSucceeded(1, "4200000000001", Instant.parse("2026-08-22T10:00:00Z"))

        assertEquals("paid", order.status)
        assertEquals(5, product.sales)
        assertEquals(6, user.points)
        assertEquals("succeeded", payment.status)
        verify(pointLedgers, times(1)).save(any())
        verify(orderItems, times(1)).findAllByOrderIdOrderByIdAsc(1)
    }

    @Test
    fun `concurrent refund callbacks restore stock coupon and points once`() {
        // Platform snapshot/local status may reach the terminal value before business compensation.
        val order = OrderEntity(id = 2, orderNo = "XH26082200000002", userId = 20, status = "refunded", totalCents = 2_000, platformOrderState = 5)
        val refund = RefundEntity(id = 3, orderId = 2, outRefundNo = "RF26082200000002", amountCents = 2_000, status = "success")
        val item = OrderItemEntity(id = 2, orderId = 2, productId = 200, productName = "项链", unitPriceCents = 1_000, quantity = 2)
        val product = ProductEntity(id = 200, name = "项链", stock = 4, sales = 7)
        val coupon = UserCouponEntity(id = 4, userId = 20, couponId = 9, usedOrderId = 2, usedAt = Instant.now())
        // The member already spent part of the two points earned by this order. A refund must still
        // reverse the full earning instead of silently retaining the unavailable portion.
        val user = UserEntity(id = 20, nickname = "退款会员", points = 1)
        `when`(orders.lockById(2)).thenReturn(order)
        `when`(refunds.lockById(3)).thenReturn(refund)
        `when`(orderItems.findAllByOrderIdOrderByIdAsc(2)).thenReturn(listOf(item))
        `when`(products.lockAllById(listOf(200L))).thenReturn(listOf(product))
        `when`(userCoupons.findByUsedOrderId(2)).thenReturn(coupon)
        `when`(users.findById(20)).thenReturn(Optional.of(user))

        val executor = Executors.newFixedThreadPool(2)
        val futures = (1..2).map {
            executor.submit { service.refundSucceeded(2, 3, "5030000000001", Instant.parse("2026-08-22T11:00:00Z")) }
        }
        executor.shutdown()
        check(executor.awaitTermination(5, TimeUnit.SECONDS)) { "refund callback test timed out" }
        futures.forEach { it.get(1, TimeUnit.SECONDS) }

        assertEquals("refunded", order.status)
        assertNotNull(refund.businessAppliedAt)
        assertEquals(6, product.stock)
        assertEquals(5, product.sales)
        assertEquals(null, coupon.usedOrderId)
        assertEquals(null, coupon.usedAt)
        assertEquals(-1, user.points)
        verify(pointLedgers, times(1)).save(any())
        verify(orderItems, times(1)).findAllByOrderIdOrderByIdAsc(2)
    }

    @Test
    fun `late successful payment after cancellation re-reserves resources and revives order`() {
        val paidAt = Instant.parse("2026-08-22T12:00:00Z")
        val order = OrderEntity(
            id = 4, orderNo = "XH26082200000004", userId = 40, status = "cancelled",
            totalCents = 1_000, couponId = 12, cancelledAt = paidAt.minusSeconds(30), cancellationReason = "用户取消",
        )
        val item = OrderItemEntity(id = 4, orderId = 4, productId = 400, productName = "手链", unitPriceCents = 500, quantity = 2)
        // Cancellation has already restored the two units.
        val product = ProductEntity(id = 400, name = "手链", stock = 10, sales = 3)
        val coupon = UserCouponEntity(id = 12, userId = 40, couponId = 12, usedOrderId = null, usedAt = null)
        val user = UserEntity(id = 40, nickname = "迟到支付会员", points = 2)
        val payment = PaymentIntentEntity(
            id = 44, orderId = 4, status = "succeeded", outTradeNo = order.orderNo,
            transactionId = "4200000000004",
        )
        `when`(orders.lockById(4)).thenReturn(order)
        `when`(payments.lockAllByOrderIdOrderByCreatedAtDesc(4)).thenReturn(listOf(payment))
        `when`(orderItems.findAllByOrderIdOrderByIdAsc(4)).thenReturn(listOf(item))
        `when`(products.lockAllById(listOf(400L))).thenReturn(listOf(product))
        `when`(userCoupons.lockByUserIdAndCouponId(40, 12)).thenReturn(coupon)
        `when`(userCoupons.save(coupon)).thenReturn(coupon)
        `when`(users.findById(40)).thenReturn(Optional.of(user))

        service.paymentSucceeded(4, payment.transactionId, paidAt)

        assertEquals("paid", order.status)
        assertEquals(null, order.cancelledAt)
        assertEquals("", order.cancellationReason)
        assertEquals(8, product.stock)
        assertEquals(5, product.sales)
        assertEquals(4L, coupon.usedOrderId)
        assertEquals(3, user.points)
    }

    @Test
    fun `duplicate callback for the already refunded payment does not revive the order`() {
        val order = OrderEntity(
            id = 6, orderNo = "XH26082200000006", userId = 60, status = "refunded", totalCents = 1_000,
        )
        val payment = PaymentIntentEntity(
            id = 66, orderId = 6, status = "succeeded", outTradeNo = order.orderNo,
            transactionId = "4200000000006",
        )
        `when`(orders.lockById(6)).thenReturn(order)
        `when`(payments.lockAllByOrderIdOrderByCreatedAtDesc(6)).thenReturn(listOf(payment))
        `when`(refunds.existsByOrderIdAndPaymentIntentIdAndBusinessAppliedAtIsNotNull(6, 66)).thenReturn(true)

        service.paymentSucceeded(6, payment.transactionId, Instant.parse("2026-08-22T13:00:00Z"))

        assertEquals("refunded", order.status)
        verifyNoInteractions(orderItems, products)
    }

    @Test
    fun `cancelling a started payment closes WeChat order before releasing stock`() {
        val payApi = mock(WechatPayService::class.java)
        `when`(paymentProvider.getObject()).thenReturn(payApi)
        val order = OrderEntity(id = 5, orderNo = "XH26082200000005", userId = 50, status = "pending_payment", totalCents = 100)
        val intent = PaymentIntentEntity(id = 55, orderId = 5, status = "pending", outTradeNo = order.orderNo)
        val item = OrderItemEntity(id = 5, orderId = 5, productId = 500, productName = "戒指", unitPriceCents = 100, quantity = 1)
        val product = ProductEntity(id = 500, name = "戒指", stock = 9)
        `when`(orders.lockById(5)).thenReturn(order)
        `when`(payments.lockAllByOrderIdOrderByCreatedAtDesc(5)).thenReturn(listOf(intent))
        `when`(payments.findById(55)).thenReturn(Optional.of(intent))
        `when`(payments.lockById(55)).thenReturn(intent)
        `when`(orderItems.findAllByOrderIdOrderByIdAsc(5)).thenReturn(listOf(item))
        `when`(products.lockAllById(listOf(500L))).thenReturn(listOf(product))
        `when`(payApi.queryOrderByOutTradeNo(order.orderNo)).thenReturn(PaymentOrderSnapshot(
            outTradeNo = order.orderNo, transactionId = null, tradeState = "NOTPAY", tradeStateDesc = null,
            bankType = null, successTime = null, totalCents = 100, payerTotalCents = 100, currency = "CNY",
        ))

        service(properties(mock = false)).cancelByAdmin(5)

        assertEquals("cancelled", order.status)
        assertEquals("closed", intent.status)
        assertEquals(10, product.stock)
        inOrder(payApi, products).apply {
            verify(payApi).closeOrder(order.orderNo)
            verify(products).saveAll(org.mockito.ArgumentMatchers.any<Iterable<ProductEntity>>())
        }
    }

    @Test
    fun `scheduled recovery settles a stale pending payment once when callback was lost`() {
        val now = Instant.parse("2026-08-22T14:00:00Z")
        val cutoff = now.minusSeconds(5 * 60)
        val order = OrderEntity(id = 7, orderNo = "XH26082200000007", userId = 70, status = "pending_payment", totalCents = 1_000)
        val intent = PaymentIntentEntity(
            id = 77, orderId = 7, provider = "wechat_pay", status = "pending", outTradeNo = order.orderNo,
            updatedAt = cutoff.minusSeconds(1), expiresAt = now.plusSeconds(3_600),
        )
        val item = OrderItemEntity(id = 7, orderId = 7, productId = 700, productName = "耳饰", unitPriceCents = 1_000)
        val product = ProductEntity(id = 700, name = "耳饰", stock = 9, sales = 2)
        val user = UserEntity(id = 70, nickname = "查单恢复会员", points = 4)
        val payApi = mock(WechatPayService::class.java)
        val page = PageRequest.of(0, 1)
        `when`(paymentProvider.getObject()).thenReturn(payApi)
        `when`(payments.findAllByProviderAndStatusInAndUpdatedAtBeforeOrderByUpdatedAtAsc(
            "wechat_pay", setOf("creating", "pending"), cutoff, page,
        )).thenReturn(listOf(intent))
        `when`(orders.lockById(7)).thenReturn(order)
        `when`(payments.lockAllByOrderIdOrderByCreatedAtDesc(7)).thenReturn(listOf(intent))
        `when`(payments.lockById(77)).thenReturn(intent)
        `when`(orderItems.findAllByOrderIdOrderByIdAsc(7)).thenReturn(listOf(item))
        `when`(products.lockAllById(listOf(700L))).thenReturn(listOf(product))
        `when`(users.findById(70)).thenReturn(Optional.of(user))
        `when`(payApi.queryOrderByOutTradeNo(order.orderNo)).thenReturn(PaymentOrderSnapshot(
            outTradeNo = order.orderNo, transactionId = "4200000000007", tradeState = "SUCCESS", tradeStateDesc = "支付成功",
            bankType = "OTHERS", successTime = java.time.OffsetDateTime.parse("2026-08-22T21:59:00+08:00"),
            totalCents = 1_000, payerTotalCents = 1_000, currency = "CNY",
        ))

        val workflow = service(properties(mock = false))
        workflow.reconcileStalePaymentIntents(limit = 1, now = now)
        // A duplicate scheduler selection is harmless because the locked row is no longer pending.
        workflow.reconcileStalePaymentIntents(limit = 1, now = now)

        assertEquals("succeeded", intent.status)
        assertEquals("4200000000007", intent.transactionId)
        assertEquals("paid", order.status)
        assertEquals(3, product.sales)
        assertEquals(5, user.points)
        verify(payApi, times(1)).queryOrderByOutTradeNo(order.orderNo)
        verify(pointLedgers, times(1)).save(any())
        verify(orderItems, times(1)).findAllByOrderIdOrderByIdAsc(7)
    }

    @Test
    fun `scheduled recovery leaves an unexpired notpay intent payable`() {
        val now = Instant.parse("2026-08-22T14:30:00Z")
        val cutoff = now.minusSeconds(5 * 60)
        val order = OrderEntity(id = 8, orderNo = "XH26082200000008", userId = 80, status = "pending_payment", totalCents = 100)
        val intent = PaymentIntentEntity(
            id = 88, orderId = 8, provider = "wechat_pay", status = "pending", outTradeNo = order.orderNo,
            updatedAt = cutoff.minusSeconds(1), expiresAt = now.plusSeconds(3_600), packageValue = "prepay_id=still-valid",
        )
        val payApi = mock(WechatPayService::class.java)
        `when`(paymentProvider.getObject()).thenReturn(payApi)
        `when`(payments.findAllByProviderAndStatusInAndUpdatedAtBeforeOrderByUpdatedAtAsc(
            "wechat_pay", setOf("creating", "pending"), cutoff, PageRequest.of(0, 1),
        )).thenReturn(listOf(intent))
        `when`(orders.lockById(8)).thenReturn(order)
        `when`(payments.lockAllByOrderIdOrderByCreatedAtDesc(8)).thenReturn(listOf(intent))
        `when`(payApi.queryOrderByOutTradeNo(order.orderNo)).thenReturn(PaymentOrderSnapshot(
            outTradeNo = order.orderNo, transactionId = null, tradeState = "NOTPAY", tradeStateDesc = "未支付",
            bankType = null, successTime = null, totalCents = 100, payerTotalCents = 100, currency = "CNY",
        ))

        service(properties(mock = false)).reconcileStalePaymentIntents(limit = 1, now = now)

        assertEquals("pending", intent.status)
        assertEquals(now, intent.updatedAt)
        verify(payApi).queryOrderByOutTradeNo(order.orderNo)
        verify(payApi, org.mockito.Mockito.never()).closeOrder(order.orderNo)
    }

    @Test
    fun `scheduled recovery closes stale creating intent without creating another payment`() {
        val now = Instant.parse("2026-08-22T15:00:00Z")
        val cutoff = now.minusSeconds(5 * 60)
        val order = OrderEntity(id = 9, orderNo = "XH26082200000009", userId = 90, status = "pending_payment", totalCents = 100)
        val intent = PaymentIntentEntity(
            id = 99, orderId = 9, provider = "wechat_pay", status = "creating", outTradeNo = order.orderNo,
            updatedAt = cutoff.minusSeconds(1), expiresAt = now.plusSeconds(3_600),
        )
        val payApi = mock(WechatPayService::class.java)
        `when`(paymentProvider.getObject()).thenReturn(payApi)
        `when`(payments.findAllByProviderAndStatusInAndUpdatedAtBeforeOrderByUpdatedAtAsc(
            "wechat_pay", setOf("creating", "pending"), cutoff, PageRequest.of(0, 1),
        )).thenReturn(listOf(intent))
        `when`(orders.lockById(9)).thenReturn(order)
        `when`(payments.lockAllByOrderIdOrderByCreatedAtDesc(9)).thenReturn(listOf(intent))
        `when`(payments.findById(99)).thenReturn(Optional.of(intent))
        `when`(payments.lockById(99)).thenReturn(intent)
        `when`(payApi.queryOrderByOutTradeNo(order.orderNo)).thenReturn(PaymentOrderSnapshot(
            outTradeNo = order.orderNo, transactionId = null, tradeState = "NOTPAY", tradeStateDesc = "未支付",
            bankType = null, successTime = null, totalCents = 100, payerTotalCents = 100, currency = "CNY",
        ))

        service(properties(mock = false)).reconcileStalePaymentIntents(limit = 1, now = now)

        assertEquals("closed", intent.status)
        assertEquals("支付初始化超时，需核验并关闭微信支付单", intent.failureReason)
        verify(payApi).queryOrderByOutTradeNo(order.orderNo)
        verify(payApi).closeOrder(order.orderNo)
        org.mockito.Mockito.verifyNoMoreInteractions(payApi)
    }

    @Test
    fun `scheduled recovery closes an expired pending payment only after querying it`() {
        val now = Instant.parse("2026-08-22T15:15:00Z")
        val cutoff = now.minusSeconds(5 * 60)
        val order = OrderEntity(id = 10, orderNo = "XH26082200000010", userId = 100, status = "pending_payment", totalCents = 100)
        val intent = PaymentIntentEntity(
            id = 100, orderId = 10, provider = "wechat_pay", status = "pending", outTradeNo = order.orderNo,
            updatedAt = cutoff.minusSeconds(1), expiresAt = now.minusSeconds(1), packageValue = "prepay_id=expired",
        )
        val payApi = mock(WechatPayService::class.java)
        `when`(paymentProvider.getObject()).thenReturn(payApi)
        `when`(payments.findAllByProviderAndStatusInAndUpdatedAtBeforeOrderByUpdatedAtAsc(
            "wechat_pay", setOf("creating", "pending"), cutoff, PageRequest.of(0, 1),
        )).thenReturn(listOf(intent))
        `when`(orders.lockById(10)).thenReturn(order)
        `when`(payments.lockAllByOrderIdOrderByCreatedAtDesc(10)).thenReturn(listOf(intent))
        `when`(payments.findById(100)).thenReturn(Optional.of(intent))
        `when`(payments.lockById(100)).thenReturn(intent)
        `when`(payApi.queryOrderByOutTradeNo(order.orderNo)).thenReturn(PaymentOrderSnapshot(
            outTradeNo = order.orderNo, transactionId = null, tradeState = "NOTPAY", tradeStateDesc = "未支付",
            bankType = null, successTime = null, totalCents = 100, payerTotalCents = 100, currency = "CNY",
        ))

        service(properties(mock = false)).reconcileStalePaymentIntents(limit = 1, now = now)

        assertEquals("closed", intent.status)
        assertEquals("微信支付单已超过支付截止时间，需核验并关闭", intent.failureReason)
        inOrder(payApi).apply {
            verify(payApi).queryOrderByOutTradeNo(order.orderNo)
            verify(payApi).closeOrder(order.orderNo)
        }
    }

    @Test
    fun `scheduled recovery rechecks staleness under the order lock`() {
        val now = Instant.parse("2026-08-22T15:20:00Z")
        val cutoff = now.minusSeconds(5 * 60)
        val order = OrderEntity(id = 11, orderNo = "XH26082200000011", userId = 110, status = "pending_payment", totalCents = 100)
        val selectedSnapshot = PaymentIntentEntity(
            id = 110, orderId = 11, provider = "wechat_pay", status = "pending", outTradeNo = order.orderNo,
            updatedAt = cutoff.minusSeconds(1), expiresAt = now.plusSeconds(3_600),
        )
        val refreshedIntent = PaymentIntentEntity(
            id = 110, orderId = 11, provider = "wechat_pay", status = "pending", outTradeNo = order.orderNo,
            updatedAt = now, expiresAt = now.plusSeconds(3_600),
        )
        `when`(payments.findAllByProviderAndStatusInAndUpdatedAtBeforeOrderByUpdatedAtAsc(
            "wechat_pay", setOf("creating", "pending"), cutoff, PageRequest.of(0, 1),
        )).thenReturn(listOf(selectedSnapshot))
        `when`(orders.lockById(11)).thenReturn(order)
        `when`(payments.lockAllByOrderIdOrderByCreatedAtDesc(11)).thenReturn(listOf(refreshedIntent))

        service(properties(mock = false)).reconcileStalePaymentIntents(limit = 1, now = now)

        assertEquals("pending", refreshedIntent.status)
        assertEquals(now, refreshedIntent.updatedAt)
        verifyNoInteractions(paymentProvider)
    }

    @Test
    fun `scheduled recovery bounds stale intent scan`() {
        val now = Instant.parse("2026-08-22T15:30:00Z")
        val cutoff = now.minusSeconds(5 * 60)
        `when`(payments.findAllByProviderAndStatusInAndUpdatedAtBeforeOrderByUpdatedAtAsc(
            "wechat_pay", setOf("creating", "pending"), cutoff, PageRequest.of(0, 100),
        )).thenReturn(emptyList())

        service(properties(mock = false)).reconcileStalePaymentIntents(limit = 10_000, now = now)

        verify(payments).findAllByProviderAndStatusInAndUpdatedAtBeforeOrderByUpdatedAtAsc(
            "wechat_pay", setOf("creating", "pending"), cutoff, PageRequest.of(0, 100),
        )
        verifyNoInteractions(paymentProvider)
    }

    private fun properties(mock: Boolean = true) = AppProperties(
        publicBaseUrl = "https://example.invalid", uploadsDir = "/tmp", allowMockUser = true,
        userTokenSecret = "test-user", adminTokenSecret = "test-admin", adminBootstrapEmail = "admin@example.invalid",
        adminBootstrapPassword = "password", adminBootstrapName = "admin", companyNameZh = "测试珠宝",
        companyNameEn = "Test Jewelry", shippingFeeCents = 1_500, freeShippingThresholdCents = 80_000,
        wechat = AppProperties.Wechat(), pay = AppProperties.Pay(mock = mock),
    )

    /** Serializes complete TransactionTemplate executions, mirroring the database row-lock boundary. */
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
