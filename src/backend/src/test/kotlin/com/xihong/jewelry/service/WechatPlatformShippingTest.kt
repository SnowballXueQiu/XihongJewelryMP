package com.xihong.jewelry.service

import com.fasterxml.jackson.databind.ObjectMapper
import com.xihong.jewelry.config.AppProperties
import com.xihong.jewelry.domain.OrderEntity
import com.xihong.jewelry.domain.OrderItemEntity
import com.xihong.jewelry.domain.PaymentIntentEntity
import com.xihong.jewelry.domain.UserEntity
import com.xihong.jewelry.repository.OrderItemRepository
import com.xihong.jewelry.repository.OrderRepository
import com.xihong.jewelry.repository.PaymentIntentRepository
import com.xihong.jewelry.repository.UserRepository
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.anyString
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.TransactionStatus
import org.springframework.transaction.support.SimpleTransactionStatus
import java.util.Optional
import java.util.concurrent.atomic.AtomicInteger

class WechatPlatformShippingTest {
    @Test
    fun `waybill token survives a later carrier query failure and no remote call holds a transaction`() {
        val fixture = Fixture()
        fixture.answerRemote { path ->
            when (path) {
                FOLLOW_PATH -> """{"waybill_token":"token-41"}"""
                TRACE_PATH -> throw WechatPlatformException("trace timeout")
                else -> error("unexpected remote path $path")
            }
        }

        assertThrows(WechatPlatformException::class.java) {
            fixture.service.uploadShipping(fixture.order, fixture.trackingNo, false)
        }

        assertEquals("token-41", fixture.order.waybillToken)
        assertEquals(fixture.trackingNo, fixture.order.trackingNo)
        assertEquals("", fixture.order.wechatDeliveryId)
        assertTrue(fixture.order.platformShippingError.contains("trace timeout"))
        assertFalse(fixture.tx.active())
    }

    @Test
    fun `ambiguous upload queries unshipped authority before one safe retry`() {
        val fixture = Fixture()
        val uploadCalls = AtomicInteger()
        val queryCalls = AtomicInteger()
        fixture.answerRemote { path ->
            when (path) {
                FOLLOW_PATH -> """{"waybill_token":"token-41"}"""
                TRACE_PATH -> """{"delivery_info":{"delivery_id":"SF","delivery_name":"顺丰速运"}}"""
                UPLOAD_PATH -> {
                    assertEquals("token-41", fixture.order.waybillToken, "token must commit before shipping upload")
                    assertEquals("SF", fixture.order.wechatDeliveryId, "carrier must commit before shipping upload")
                    if (uploadCalls.incrementAndGet() == 1) throw WechatPlatformException("connection reset") else "{}"
                }
                ORDER_PATH -> {
                    queryCalls.incrementAndGet()
                    """{"order":{"order_state":1}}"""
                }
                else -> error("unexpected remote path $path")
            }
        }

        val saved = fixture.service.uploadShipping(fixture.order, fixture.trackingNo, false)

        assertEquals(2, uploadCalls.get())
        assertEquals(1, queryCalls.get())
        assertEquals("shipped", saved.status)
        assertEquals("token-41", saved.waybillToken)
        assertEquals("SF", saved.wechatDeliveryId)
        assertEquals("顺丰速运", saved.wechatDeliveryName)
        assertEquals("", saved.platformShippingError)
        assertTrue(saved.platformShippingUploadedAt != null)
    }

    @Test
    fun `ambiguous upload recovers accepted authority without duplicate submission`() {
        val fixture = Fixture()
        val uploadCalls = AtomicInteger()
        fixture.answerRemote { path ->
            when (path) {
                FOLLOW_PATH -> """{"waybill_token":"token-41"}"""
                TRACE_PATH -> """{"delivery_info":{"delivery_id":"SF","delivery_name":"顺丰速运"}}"""
                UPLOAD_PATH -> {
                    uploadCalls.incrementAndGet()
                    throw WechatPlatformException("response lost")
                }
                ORDER_PATH -> """{"order":{"order_state":2,"shipping_list":[{"tracking_no":"${fixture.trackingNo}"}]}}"""
                else -> error("unexpected remote path $path")
            }
        }

        val saved = fixture.service.uploadShipping(fixture.order, fixture.trackingNo, false)

        assertEquals(1, uploadCalls.get())
        assertEquals(2, saved.platformOrderState)
        assertEquals("shipped", saved.status)
        assertEquals("", saved.platformShippingError)
        assertTrue(saved.platformOrderPayload.contains(fixture.trackingNo))
    }

    @Test
    fun `upload and authority query failures leave a durable error and never retry blindly`() {
        val fixture = Fixture()
        val uploadCalls = AtomicInteger()
        fixture.answerRemote { path ->
            when (path) {
                FOLLOW_PATH -> """{"waybill_token":"token-41"}"""
                TRACE_PATH -> """{"delivery_info":{"delivery_id":"SF","delivery_name":"顺丰速运"}}"""
                UPLOAD_PATH -> {
                    uploadCalls.incrementAndGet()
                    throw WechatPlatformException("upload timeout")
                }
                ORDER_PATH -> throw WechatPlatformException("authority timeout")
                else -> error("unexpected remote path $path")
            }
        }

        val error = assertThrows(WechatPlatformException::class.java) {
            fixture.service.uploadShipping(fixture.order, fixture.trackingNo, false)
        }

        assertEquals(1, uploadCalls.get())
        assertTrue(error.message.orEmpty().contains("停止自动重试"))
        assertTrue(fixture.order.platformShippingError.contains("停止自动重试"))
        assertEquals("token-41", fixture.order.waybillToken)
        assertEquals("SF", fixture.order.wechatDeliveryId)
    }

    private class Fixture {
        val mapper = ObjectMapper()
        val tokens = mock(WechatAccessTokenService::class.java)
        val users = mock(UserRepository::class.java)
        val items = mock(OrderItemRepository::class.java)
        val payments = mock(PaymentIntentRepository::class.java)
        val orders = mock(OrderRepository::class.java)
        val tx = TrackingTransactionManager()
        val trackingNo = "SF1234567890"
        val order = OrderEntity(
            id = 41,
            orderNo = "XH26082200000041",
            userId = 7,
            status = "paid",
            totalCents = 1,
            receiverPhone = "18522657228",
            fulfillmentType = "delivery",
        )
        val payment = PaymentIntentEntity(
            id = 9,
            orderId = 41,
            provider = "wechat_pay",
            status = "succeeded",
            outTradeNo = order.orderNo,
            transactionId = "4200000000202608220000000041",
        )
        val service = WechatPlatformService(
            tokens = tokens,
            properties = properties(),
            mapper = mapper,
            users = users,
            orderItems = items,
            payments = payments,
            orders = orders,
            transactionManager = tx,
        )

        init {
            `when`(orders.lockById(order.id!!)).thenReturn(order)
            `when`(orders.save(any(OrderEntity::class.java))).thenAnswer { it.getArgument(0) }
            `when`(payments.findAllByOrderIdOrderByCreatedAtDesc(order.id!!)).thenReturn(listOf(payment))
            `when`(users.findById(order.userId)).thenReturn(Optional.of(UserEntity(id = order.userId, wechatOpenid = "openid-7")))
            `when`(items.findAllByOrderIdOrderByIdAsc(order.id!!)).thenReturn(
                listOf(OrderItemEntity(id = 1, orderId = order.id!!, productName = "测试珠宝", quantity = 1)),
            )
        }

        fun answerRemote(answer: (String) -> String) {
            `when`(tokens.post(anyString(), anyKotlin())).thenAnswer { invocation ->
                assertFalse(tx.active(), "remote WeChat call must execute outside a database transaction")
                mapper.readTree(answer(invocation.getArgument(0)))
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
            wechat = AppProperties.Wechat(appId = "wx-test"),
            pay = AppProperties.Pay(mock = false, merchantId = "1112005993"),
        )
    }

    private class TrackingTransactionManager : PlatformTransactionManager {
        private val inTransaction = ThreadLocal.withInitial { false }
        override fun getTransaction(definition: TransactionDefinition?): TransactionStatus {
            check(!inTransaction.get()) { "nested test transaction" }
            inTransaction.set(true)
            return SimpleTransactionStatus()
        }

        override fun commit(status: TransactionStatus) = inTransaction.set(false)
        override fun rollback(status: TransactionStatus) = inTransaction.set(false)
        fun active(): Boolean = inTransaction.get()
    }

    private companion object {
        const val FOLLOW_PATH = "/cgi-bin/express/delivery/open_msg/follow_waybill"
        const val TRACE_PATH = "/cgi-bin/express/delivery/open_msg/query_trace"
        const val UPLOAD_PATH = "/wxa/sec/order/upload_shipping_info"
        const val ORDER_PATH = "/wxa/sec/order/get_order"

        @Suppress("UNCHECKED_CAST")
        fun <T> anyKotlin(): T {
            any<T>()
            return null as T
        }
    }
}
