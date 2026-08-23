package com.xihong.jewelry.service

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.xihong.jewelry.config.AppProperties
import com.xihong.jewelry.controller.DeliveryCompanyDto
import com.xihong.jewelry.domain.OrderEntity
import com.xihong.jewelry.domain.PaymentIntentEntity
import com.xihong.jewelry.repository.*
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.support.TransactionTemplate
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.time.Duration
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId

@Service
class WechatPlatformService(
    private val tokens: WechatAccessTokenService,
    private val properties: AppProperties,
    private val mapper: ObjectMapper,
    private val users: UserRepository,
    private val orderItems: OrderItemRepository,
    private val payments: PaymentIntentRepository,
    private val orders: OrderRepository,
    transactionManager: PlatformTransactionManager,
) {
    private val http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).build()
    private val transactions = TransactionTemplate(transactionManager).apply {
        propagationBehavior = TransactionDefinition.PROPAGATION_REQUIRES_NEW
    }
    private val deliveryCompanyLock = Any()
    @Volatile private var deliveryCompanyCache: DeliveryCompanyCache? = null

    fun login(code: String): String {
        if (properties.wechat.appId.isBlank() || properties.wechat.appSecret.isBlank()) {
            if (properties.allowMockUser) return "mock_${code.hashCode().toUInt().toString(16)}"
            throw WechatPlatformException("微信登录尚未配置")
        }
        val query = listOf(
            "appid" to properties.wechat.appId, "secret" to properties.wechat.appSecret,
            "js_code" to code, "grant_type" to "authorization_code",
        ).joinToString("&") { "${it.first}=${URLEncoder.encode(it.second, StandardCharsets.UTF_8)}" }
        val response = http.send(HttpRequest.newBuilder(URI.create("https://api.weixin.qq.com/sns/jscode2session?$query")).timeout(Duration.ofSeconds(10)).GET().build(), HttpResponse.BodyHandlers.ofString())
        val data = mapper.readTree(response.body())
        return data.path("openid").asText().takeIf(String::isNotBlank)
            ?: throw WechatPlatformException("微信登录失败：${data.path("errmsg").asText("未知错误")}")
    }

    fun exchangePhone(code: String): String {
        val data = tokens.post("/wxa/business/getuserphonenumber", mapOf("code" to code))
        return data.path("phone_info").path("purePhoneNumber").asText().takeIf(String::isNotBlank)
            ?: data.path("phone_info").path("phoneNumber").asText().takeIf(String::isNotBlank)
            ?: throw WechatPlatformException("微信未返回有效手机号")
    }

    @Transactional
    fun sync(order: OrderEntity): OrderEntity {
        if (properties.pay.mock || order.totalCents == 0) return order
        // Seeded/free/mock ledgers are local-only and must never hit the real WeChat order API.
        val payment = successfulPaymentOrNull(order) ?: return order
        // The caller may have loaded this entity before a payment/refund callback committed. Lock
        // and mutate a fresh managed row so a slow platform query can never overwrite a newer
        // refunded/paid business state with a stale detached snapshot.
        val managedOrder = orders.lockById(order.id!!) ?: throw WechatPlatformException("订单不存在")
        val data = tokens.post("/wxa/sec/order/get_order", queryKey(payment))
        val platformOrder = data.path("order")
        if (!platformOrder.isMissingNode && !platformOrder.isNull) {
            managedOrder.platformOrderState = platformOrder.path("order_state").asInt(0)
            managedOrder.platformOrderStateUpdatedAt = Instant.now()
            managedOrder.platformOrderPayload = mapper.writeValueAsString(platformOrder)
            managedOrder.platformShippingError = ""
            applyAuthoritativeState(managedOrder)
            orders.save(managedOrder)
        }
        if (managedOrder.waybillToken.isNotBlank()) syncTrace(managedOrder)
        return managedOrder
    }

    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    fun uploadShipping(order: OrderEntity, trackingNo: String, deliveryId: String): OrderEntity {
        val orderId = order.id ?: throw IllegalArgumentException("订单不存在")
        val normalizedTrackingNo = trackingNo.trim()
        val carrier = if (order.fulfillmentType == "delivery") {
            val normalizedDeliveryId = deliveryId.trim()
            require(normalizedDeliveryId.isNotBlank()) { "请选择微信官方物流公司" }
            deliveryCompanies().firstOrNull { it.deliveryId == normalizedDeliveryId }
                ?: throw IllegalArgumentException("物流公司不在微信官方运力列表中，请刷新后重新选择")
        } else null
        val plan = prepareShipping(orderId, normalizedTrackingNo, carrier)
        if (plan is ShippingPlan.Local) return plan.order
        plan as ShippingPlan.Remote

        val trace = if (plan.logisticsType == 1) resolveTrace(plan) else null
        val itemDesc = plan.items.joinToString("、") { "${it.name}×${it.quantity}" }.take(120)
        val shipping = mutableMapOf<String, Any>("item_desc" to itemDesc)
        if (trace != null) {
            shipping["tracking_no"] = plan.trackingNo
            shipping["express_company"] = trace.deliveryId
            shipping["contact"] = mapOf("receiver_contact" to maskPhone(plan.receiverPhone))
        }
        val payload = mapOf(
            "order_key" to orderKey(plan.payment), "logistics_type" to plan.logisticsType, "delivery_mode" to 1,
            "shipping_list" to listOf(shipping),
            "upload_time" to OffsetDateTime.now(ZoneId.of("Asia/Shanghai")).toWechatRfc3339(),
            "payer" to mapOf("openid" to plan.openid),
        )
        return uploadWithAuthoritativeRecovery(plan, payload)
    }

    /**
     * Acquires only local data and releases the order row lock before any WeChat request. This is
     * deliberately a short transaction: a slow API call must never hold a database lock needed by
     * payment/refund callbacks.
     */
    private fun prepareShipping(orderId: Long, trackingNo: String, carrier: DeliveryCompanyDto?): ShippingPlan = inTransaction {
        val order = orders.lockById(orderId) ?: throw IllegalArgumentException("订单不存在")
        if (order.status !in setOf("paid", "preparing")) throw IllegalArgumentException("只有待发货订单可以提交运单")
        if (properties.pay.mock || order.totalCents == 0) {
            val now = Instant.now()
            order.trackingNo = trackingNo
            order.wechatDeliveryId = carrier?.deliveryId.orEmpty()
            order.wechatDeliveryName = carrier?.deliveryName.orEmpty()
            order.testOrder = false
            order.platformOrderState = 2
            order.platformOrderStateUpdatedAt = now
            order.platformShippingUploadedAt = now
            order.platformShippingError = ""
            order.status = "shipped"
            order.shippedAt = order.shippedAt ?: now
            order.updatedAt = now
            return@inTransaction ShippingPlan.Local(orders.save(order))
        }
        val payment = successfulPayment(order)
        val user = users.findById(order.userId).orElseThrow { WechatPlatformException("订单用户不存在") }
        val openid = user.wechatOpenid?.takeIf(String::isNotBlank)
            ?: throw WechatPlatformException("订单缺少支付用户 OpenID")
        val logisticsType = if (order.fulfillmentType == "pickup") 4 else 1
        if (logisticsType == 1 && trackingNo.isBlank()) throw IllegalArgumentException("请填写运单号")
        if (order.waybillToken.isNotBlank() && order.trackingNo.isNotBlank() && order.trackingNo != trackingNo) {
            throw IllegalArgumentException("该订单已绑定运单号 ${order.trackingNo}，不能更换后重复提交")
        }
        ShippingPlan.Remote(
            orderId = order.id!!,
            orderNo = order.orderNo,
            payment = payment,
            openid = openid,
            receiverPhone = order.receiverPhone,
            trackingNo = trackingNo,
            logisticsType = logisticsType,
            waybillToken = order.waybillToken,
            deliveryId = carrier?.deliveryId.orEmpty(),
            deliveryName = carrier?.deliveryName.orEmpty(),
            items = orderItems.findAllByOrderIdOrderByIdAsc(order.id!!).map { ShippingItem(it.productName, it.quantity) },
        )
    }

    @Transactional
    fun syncTrace(order: OrderEntity): OrderEntity {
        if (order.waybillToken.isBlank()) return order
        val user = users.findById(order.userId).orElseThrow { WechatPlatformException("订单用户不存在") }
        val data = tokens.post("/cgi-bin/express/delivery/open_msg/query_trace", mapOf("waybill_token" to order.waybillToken, "openid" to (user.wechatOpenid ?: "")))
        val info = data.path("waybill_info")
        val delivery = data.path("delivery_info")
        val status = info.path("status").asInt(0)
        order.logisticsStatus = when (status) {
            0 -> "未揽收"; 1 -> "已揽件"; 2 -> "运输中"; 3 -> "派件中"; 4 -> "已签收"; 5 -> "物流异常"; 6 -> "代签收"; else -> "未知状态"
        }
        order.logisticsDescription = listOfNotNull(
            delivery.path("delivery_name").asText().takeIf(String::isNotBlank),
            info.path("waybill_id").asText().takeIf(String::isNotBlank),
            order.logisticsStatus.takeIf(String::isNotBlank),
        ).joinToString(" · ")
        order.wechatDeliveryId = delivery.path("delivery_id").asText(order.wechatDeliveryId)
        order.wechatDeliveryName = delivery.path("delivery_name").asText(order.wechatDeliveryName)
        order.logisticsUpdatedAt = Instant.now()
        // 物流轨迹只能补充展示，不能覆盖微信购物订单的确认收货/退款终态。
        if (status in setOf(2, 3) && order.platformOrderState !in setOf(3, 4, 5) &&
            order.status !in setOf("received", "completed", "refunding", "refunded", "cancelled")) {
            order.status = "in_transit"
        }
        orders.save(order)
        return order
    }

    fun tradeStatus(): PlatformStatus {
        val managed = tokens.post("/wxa/sec/order/is_trade_managed", mapOf("appid" to properties.wechat.appId))
        val confirmation = tokens.post("/wxa/sec/order/is_trade_management_confirmation_completed", mapOf("appid" to properties.wechat.appId))
        return PlatformStatus(managed.path("is_trade_managed").asBoolean(false), confirmation.path("completed").asBoolean(false))
    }

    /**
     * 微信官方运力表数量较大，服务端缓存 6 小时；刷新失败时优先返回上一份官方快照。
     */
    fun deliveryCompanies(forceRefresh: Boolean = false): List<DeliveryCompanyDto> {
        val now = Instant.now()
        deliveryCompanyCache?.takeIf { !forceRefresh && it.expiresAt.isAfter(now) }?.let { return it.items }
        synchronized(deliveryCompanyLock) {
            val current = deliveryCompanyCache
            if (!forceRefresh && current != null && current.expiresAt.isAfter(now)) return current.items
            return try {
                val data = tokens.post("/cgi-bin/express/delivery/open_msg/get_delivery_list", emptyMap<String, Any>())
                val items = data.path("delivery_list").mapNotNull { item ->
                    val id = item.path("delivery_id").asText().trim()
                    val name = item.path("delivery_name").asText().trim()
                    if (id.isBlank() || name.isBlank()) null else DeliveryCompanyDto(id, name, isCommonCarrier(id, name))
                }.distinctBy { it.deliveryId }.sortedWith(compareByDescending<DeliveryCompanyDto> { it.common }.thenBy { it.deliveryName })
                if (items.isEmpty()) throw WechatPlatformException("微信未返回物流公司列表")
                deliveryCompanyCache = DeliveryCompanyCache(items, now.plus(Duration.ofHours(6)))
                items
            } catch (error: RuntimeException) {
                current?.items ?: throw error
            }
        }
    }

    fun setOrderDetailPath(path: String) {
        require(path.startsWith("pages/") && !path.substringBefore('?').contains(".html")) { "微信购物订单详情路径必须使用小程序页面路径" }
        require(path.contains("orderNo=\${商品订单号}")) { "详情路径必须通过 orderNo 传入商户订单号" }
        tokens.post("/wxa/sec/order/update_order_detail_path", mapOf("path" to path))
    }

    fun setMessagePath(path: String) { tokens.post("/wxa/sec/order/set_msg_jump_path", mapOf("path" to path)) }

    fun notifyConfirmReceive(order: OrderEntity, receivedTime: Long = Instant.now().epochSecond) {
        if (properties.pay.mock || order.totalCents == 0) return
        val payment = successfulPayment(order)
        val payload = queryKey(payment).mapValues { it.value as Any }.toMutableMap()
        payload["received_time"] = receivedTime
        tokens.post("/wxa/sec/order/notify_confirm_receive", payload)
    }

    fun hasManagedPayment(order: OrderEntity): Boolean = successfulPaymentOrNull(order) != null

    private fun successfulPayment(order: OrderEntity): PaymentIntentEntity = successfulPaymentOrNull(order)
        ?: throw WechatPlatformException("订单缺少真实微信成功支付流水，无法调用微信订单服务")

    private fun successfulPaymentOrNull(order: OrderEntity): PaymentIntentEntity? =
        payments.findAllByOrderIdOrderByCreatedAtDesc(order.id!!).firstOrNull {
            it.provider == "wechat_pay" &&
                it.status == "succeeded" &&
                it.transactionId.isNotBlank() &&
                !it.transactionId.startsWith("mock_") &&
                !it.outTradeNo.startsWith("mock_")
        }

    private fun queryKey(payment: PaymentIntentEntity): Map<String, String> = if (payment.transactionId.isNotBlank()) mapOf("transaction_id" to payment.transactionId)
        else mapOf("merchant_id" to properties.pay.merchantId, "merchant_trade_no" to payment.outTradeNo)

    private fun orderKey(payment: PaymentIntentEntity): Map<String, Any> = if (payment.transactionId.isNotBlank()) mapOf("order_number_type" to 2, "transaction_id" to payment.transactionId)
        else mapOf("order_number_type" to 1, "mchid" to properties.pay.merchantId, "out_trade_no" to payment.outTradeNo)

    private fun resolveTrace(plan: ShippingPlan.Remote): TraceIdentity {
        var token = plan.waybillToken
        if (token.isBlank()) {
            token = try {
                followWaybillToken(plan)
            } catch (error: RuntimeException) {
                recordShippingError(plan.orderId, error)
                throw error
            }
            // follow_waybill succeeded. Commit its token before the separate trace query so a
            // query timeout cannot lose the identity and cause a duplicate follow request.
            persistWaybillToken(plan.orderId, plan.trackingNo, token)
        }
        if (plan.deliveryId.isNotBlank()) {
            val selected = TraceIdentity(token, plan.deliveryId, plan.deliveryName)
            // The administrator selected this id from WeChat's own delivery list. Persist it
            // before upload_shipping_info so a timeout cannot lose the exact carrier identity.
            persistTraceIdentity(plan.orderId, plan.trackingNo, selected)
            return selected
        }
        val trace = try {
            queryTraceIdentity(token, plan.openid)
        } catch (error: RuntimeException) {
            recordShippingError(plan.orderId, error)
            throw error
        }
        // Persist carrier discovery independently of the final upload call. A later retry can
        // resume at upload_shipping_info without repeating either logistics-assistant request.
        persistTraceIdentity(plan.orderId, plan.trackingNo, trace)
        if (trace.deliveryId.isBlank()) {
            val error = WechatPlatformException("微信无法识别该运单的承运商，请核对运单号后重试")
            recordShippingError(plan.orderId, error)
            throw error
        }
        return trace
    }

    private fun followWaybillToken(plan: ShippingPlan.Remote): String {
        val products = plan.items.map {
            mapOf("goods_name" to it.name, "goods_img_url" to "https://xihongzhubao.com/icon.png", "goods_desc" to "${it.name} × ${it.quantity}")
        }
        val payload = mutableMapOf<String, Any>(
            "openid" to plan.openid, "receiver_phone" to plan.receiverPhone,
            "waybill_id" to plan.trackingNo, "goods_info" to mapOf("detail_list" to products),
            "trans_id" to plan.payment.transactionId,
            "order_detail_path" to "pages/order-detail/index?orderNo=${plan.orderNo}",
        )
        payload["delivery_id"] = plan.deliveryId
        val followed = tokens.post("/cgi-bin/express/delivery/open_msg/follow_waybill", payload)
        return followed.path("waybill_token").asText().takeIf(String::isNotBlank)
            ?: throw WechatPlatformException("微信物流助手未返回 waybill_token")
    }

    private fun queryTraceIdentity(token: String, openid: String): TraceIdentity {
        val trace = tokens.post("/cgi-bin/express/delivery/open_msg/query_trace", mapOf("waybill_token" to token, "openid" to openid))
        val delivery = trace.path("delivery_info")
        return TraceIdentity(token, delivery.path("delivery_id").asText(), delivery.path("delivery_name").asText())
    }

    private fun uploadWithAuthoritativeRecovery(plan: ShippingPlan.Remote, payload: Map<String, Any>): OrderEntity {
        return try {
            tokens.post("/wxa/sec/order/upload_shipping_info", payload)
            finishShipping(plan)
        } catch (firstError: RuntimeException) {
            recordShippingError(plan.orderId, firstError)
            when (val firstObservation = observeAfterFailure(plan, firstError)) {
                is ShippingObservationResult.Recovered -> firstObservation.order
                is ShippingObservationResult.RetryAllowed -> retryShippingOnce(plan, payload)
                is ShippingObservationResult.Uncertain -> throw firstObservation.error
            }
        }
    }

    /** A retry is allowed only after get_order positively reports the still-unshipped state 1. */
    private fun retryShippingOnce(plan: ShippingPlan.Remote, payload: Map<String, Any>): OrderEntity = try {
        tokens.post("/wxa/sec/order/upload_shipping_info", payload)
        finishShipping(plan)
    } catch (retryError: RuntimeException) {
        recordShippingError(plan.orderId, retryError)
        when (val observation = observeAfterFailure(plan, retryError)) {
            is ShippingObservationResult.Recovered -> observation.order
            is ShippingObservationResult.RetryAllowed -> throw retryError
            is ShippingObservationResult.Uncertain -> throw observation.error
        }
    }

    private fun observeAfterFailure(plan: ShippingPlan.Remote, cause: RuntimeException): ShippingObservationResult {
        val observation = try {
            queryOfficialOrder(plan.payment)
        } catch (queryError: RuntimeException) {
            val error = WechatPlatformException("微信发货结果不明确，查询微信订单状态也失败，已停止自动重试", queryError)
            recordShippingError(plan.orderId, error)
            return ShippingObservationResult.Uncertain(error)
        }
        return when {
            observation.state in ACCEPTED_SHIPPING_STATES -> ShippingObservationResult.Recovered(
                persistOfficialObservation(plan, observation, shippingAccepted = true),
            )
            observation.state == UNSHIPPED_STATE -> {
                persistOfficialObservation(plan, observation, shippingAccepted = false, error = cause)
                ShippingObservationResult.RetryAllowed
            }
            observation.state == REFUNDED_STATE -> {
                val error = WechatPlatformException("微信订单已进入退款状态，不能重复提交发货信息", cause)
                persistOfficialObservation(plan, observation, shippingAccepted = false, error = error)
                ShippingObservationResult.Uncertain(error)
            }
            else -> {
                val error = WechatPlatformException("微信发货结果不明确，平台未返回可安全重试的订单状态，已停止自动重试", cause)
                persistOfficialObservation(plan, observation, shippingAccepted = false, error = error)
                ShippingObservationResult.Uncertain(error)
            }
        }
    }

    private fun queryOfficialOrder(payment: PaymentIntentEntity): OfficialOrderObservation {
        val data = tokens.post("/wxa/sec/order/get_order", queryKey(payment))
        val platformOrder = data.path("order")
        if (platformOrder.isMissingNode || platformOrder.isNull) return OfficialOrderObservation(0, "")
        return OfficialOrderObservation(
            state = platformOrder.path("order_state").asInt(0),
            payload = mapper.writeValueAsString(platformOrder),
        )
    }

    private fun persistWaybillToken(orderId: Long, trackingNo: String, token: String): OrderEntity = inTransaction {
        val order = orders.lockById(orderId) ?: throw IllegalArgumentException("订单不存在")
        if (order.waybillToken.isNotBlank() && order.waybillToken != token) {
            throw WechatPlatformException("订单已绑定其他微信物流令牌，已停止重复关注运单")
        }
        order.trackingNo = trackingNo
        order.waybillToken = token
        order.updatedAt = Instant.now()
        orders.save(order)
    }

    private fun persistTraceIdentity(orderId: Long, trackingNo: String, trace: TraceIdentity): OrderEntity = inTransaction {
        val order = orders.lockById(orderId) ?: throw IllegalArgumentException("订单不存在")
        order.trackingNo = trackingNo
        order.waybillToken = trace.token
        order.wechatDeliveryId = trace.deliveryId
        order.wechatDeliveryName = trace.deliveryName
        order.updatedAt = Instant.now()
        orders.save(order)
    }

    private fun recordShippingError(orderId: Long, error: Throwable): OrderEntity = inTransaction {
        val order = orders.lockById(orderId) ?: throw IllegalArgumentException("订单不存在")
        order.platformShippingError = (error.message ?: "微信发货同步失败").take(2000)
        order.updatedAt = Instant.now()
        orders.save(order)
    }

    private fun finishShipping(plan: ShippingPlan.Remote): OrderEntity = inTransaction {
        val order = orders.lockById(plan.orderId) ?: throw IllegalArgumentException("订单不存在")
        val now = Instant.now()
        order.trackingNo = plan.trackingNo
        order.wechatDeliveryId = plan.deliveryId
        order.wechatDeliveryName = plan.deliveryName
        order.testOrder = false
        order.platformShippingUploadedAt = now
        if (order.platformOrderState !in TERMINAL_PLATFORM_STATES) {
            order.platformOrderState = 2
            order.platformOrderStateUpdatedAt = now
        }
        order.platformShippingError = ""
        if (order.status !in TERMINAL_LOCAL_STATES) order.status = "shipped"
        order.shippedAt = order.shippedAt ?: now
        order.updatedAt = now
        orders.save(order)
    }

    private fun persistOfficialObservation(
        plan: ShippingPlan.Remote,
        observation: OfficialOrderObservation,
        shippingAccepted: Boolean,
        error: Throwable? = null,
    ): OrderEntity = inTransaction {
        val order = orders.lockById(plan.orderId) ?: throw IllegalArgumentException("订单不存在")
        val now = Instant.now()
        if (observation.payload.isNotBlank()) {
            order.platformOrderState = observation.state
            order.platformOrderPayload = observation.payload
            order.platformOrderStateUpdatedAt = now
            applyAuthoritativeState(order)
        }
        if (shippingAccepted) {
            order.trackingNo = plan.trackingNo
            order.wechatDeliveryId = plan.deliveryId
            order.wechatDeliveryName = plan.deliveryName
            order.testOrder = false
            order.platformShippingUploadedAt = order.platformShippingUploadedAt ?: now
            order.platformShippingError = ""
            order.shippedAt = order.shippedAt ?: now
        } else if (error != null) {
            order.platformShippingError = (error.message ?: "微信发货同步失败").take(2000)
        }
        order.updatedAt = now
        orders.save(order)
    }

    private fun <T> inTransaction(block: () -> T): T = transactions.execute { block() }
        ?: throw IllegalStateException("事务未返回结果")

    private fun applyAuthoritativeState(order: OrderEntity) {
        when (order.platformOrderState) {
            2 -> {
                if (order.status !in setOf("refunding", "refunded")) order.status = "shipped"
                order.shippedAt = order.shippedAt ?: Instant.now()
            }
            3, 4 -> {
                if (order.status !in setOf("refunding", "refunded")) order.status = "received"
                order.receivedAt = order.receivedAt ?: Instant.now()
            }
            // State 5 is recorded as an authoritative platform snapshot only. Stock, coupon,
            // points and the local terminal status are changed atomically by refundSucceeded,
            // whose business_applied_at marker is the sole compensation idempotency guard.
            5 -> Unit
        }
        order.updatedAt = Instant.now()
    }

    private fun maskPhone(value: String): String = if (value.length >= 7) "${value.take(3)}****${value.takeLast(4)}" else value
    private fun isCommonCarrier(id: String, name: String): Boolean {
        val normalizedId = id.trim().uppercase()
        return normalizedId in COMMON_CARRIER_IDS || COMMON_CARRIER_NAME_KEYWORDS.any(name::contains)
    }
    data class PlatformStatus(val managed: Boolean, val confirmed: Boolean)
    private data class DeliveryCompanyCache(val items: List<DeliveryCompanyDto>, val expiresAt: Instant)
    private data class TraceIdentity(val token: String, val deliveryId: String, val deliveryName: String)

    private sealed interface ShippingPlan {
        data class Local(val order: OrderEntity) : ShippingPlan
        data class Remote(
            val orderId: Long,
            val orderNo: String,
            val payment: PaymentIntentEntity,
            val openid: String,
            val receiverPhone: String,
            val trackingNo: String,
            val logisticsType: Int,
            val waybillToken: String,
            val deliveryId: String,
            val deliveryName: String,
            val items: List<ShippingItem>,
        ) : ShippingPlan
    }

    private data class ShippingItem(val name: String, val quantity: Int)
    private data class OfficialOrderObservation(val state: Int, val payload: String)
    private sealed interface ShippingObservationResult {
        data class Recovered(val order: OrderEntity) : ShippingObservationResult
        data object RetryAllowed : ShippingObservationResult
        data class Uncertain(val error: RuntimeException) : ShippingObservationResult
    }

    private companion object {
        const val UNSHIPPED_STATE = 1
        const val REFUNDED_STATE = 5
        val ACCEPTED_SHIPPING_STATES = setOf(2, 3, 4)
        val TERMINAL_PLATFORM_STATES = setOf(3, 4, 5)
        val TERMINAL_LOCAL_STATES = setOf("received", "completed", "refunding", "refunded", "cancelled")
        val COMMON_CARRIER_IDS = setOf(
            "SF", "ZTO", "YTO", "STO", "YUNDA", "JTSD", "JD", "EMS", "DBL", "KY", "CAINIAO",
        )
        val COMMON_CARRIER_NAME_KEYWORDS = listOf(
            "顺丰", "中通", "圆通", "申通", "韵达", "极兔", "京东物流", "中国邮政", "邮政快递",
            "德邦", "菜鸟", "跨越速运",
        )
    }
}
