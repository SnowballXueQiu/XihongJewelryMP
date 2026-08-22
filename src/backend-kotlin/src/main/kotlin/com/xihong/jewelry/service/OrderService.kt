package com.xihong.jewelry.service

import com.xihong.jewelry.config.AppProperties
import com.xihong.jewelry.controller.CreateOrderRequest
import com.xihong.jewelry.controller.OrderDto
import com.xihong.jewelry.controller.PaymentParamsDto
import com.xihong.jewelry.controller.PaymentStatusDto
import com.xihong.jewelry.domain.OrderEntity
import com.xihong.jewelry.domain.OrderItemEntity
import com.xihong.jewelry.domain.PaymentIntentEntity
import com.xihong.jewelry.domain.PointLedgerEntity
import com.xihong.jewelry.domain.ProductEntity
import com.xihong.jewelry.domain.RefundEntity
import com.xihong.jewelry.domain.UserCouponEntity
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
import com.wechat.pay.java.core.exception.ServiceException
import org.springframework.beans.factory.ObjectProvider
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.http.HttpStatus
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.web.server.ResponseStatusException
import java.security.SecureRandom
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Service
class OrderService(
    private val properties: AppProperties,
    private val users: UserRepository,
    private val addresses: AddressRepository,
    private val products: ProductRepository,
    private val cartItems: CartItemRepository,
    private val coupons: CouponRepository,
    private val userCoupons: UserCouponRepository,
    private val orders: OrderRepository,
    private val orderItems: OrderItemRepository,
    private val payments: PaymentIntentRepository,
    private val refunds: RefundRepository,
    private val pointLedgers: PointLedgerRepository,
    private val settings: SiteSettingRepository,
    private val mapper: DomainMapper,
    private val platform: WechatPlatformService,
    private val paymentProvider: ObjectProvider<WechatPayService>,
    private val invoiceProvider: ObjectProvider<WechatInvoiceService>,
    transactionManager: PlatformTransactionManager,
) : OrderPaymentLifecycle, InvoiceLifecycle {
    private val transactions = TransactionTemplate(transactionManager)
    private val random = SecureRandom()
    private val log = LoggerFactory.getLogger(javaClass)

    fun create(userId: Long, payload: CreateOrderRequest): OrderDto = try {
        inTransaction {
        payload.clientRequestId.trim().takeIf(String::isNotBlank)?.let { requestId ->
            orders.findByUserIdAndClientRequestId(userId, requestId)?.let { return@inTransaction userDto(it) }
        }
        require(payload.fulfillmentType in setOf("delivery", "pickup")) { "配送方式无效" }
        val merged = linkedMapOf<Long, Int>()
        payload.items.forEach { item ->
            val quantity = Math.addExact(merged[item.productId] ?: 0, item.quantity)
            require(quantity in 1..99) { "单件商品最多购买 99 件" }
            merged[item.productId] = quantity
        }
        require(merged.isNotEmpty()) { "订单商品不能为空" }
        val lockedProducts = products.lockAllById(merged.keys.sorted()).associateBy { it.id!! }
        require(lockedProducts.size == merged.size) { "部分商品已不存在，请刷新购物袋" }
        merged.forEach { (productId, quantity) ->
            val product = lockedProducts.getValue(productId)
            require(product.status == "active") { "${product.name} 已下架" }
            require(product.stock >= quantity) { "${product.name} 库存不足" }
        }

        val address = if (payload.fulfillmentType == "delivery") {
            payload.addressId?.let { addresses.findByIdAndUserId(it, userId) }
                ?: addresses.findAllByUserIdOrderByIsDefaultDescIdDesc(userId).firstOrNull()
                ?: throw IllegalArgumentException("请先添加收货地址")
        } else null
        if (payload.fulfillmentType == "pickup") require(payload.pickupSlot.isNotBlank()) { "请选择到店自提时间" }

        val subtotalLong = merged.entries.sumOf { (id, quantity) -> lockedProducts.getValue(id).priceCents.toLong() * quantity }
        require(subtotalLong in 0..Int.MAX_VALUE.toLong()) { "订单金额超出支持范围" }
        val subtotal = subtotalLong.toInt()
        val allFreeShipping = merged.keys.all { lockedProducts.getValue(it).freeShipping }
        val shipping = if (payload.fulfillmentType == "pickup" || allFreeShipping || subtotal >= freeShippingThreshold()) 0 else shippingFee()
        val couponUse = payload.couponId?.let { couponId -> validateCoupon(userId, couponId, subtotal) }
        val discount = couponUse?.first?.amountCents?.coerceAtMost(subtotal) ?: 0
        val total = Math.max(0, Math.addExact(subtotal, shipping) - discount)
        val now = Instant.now()
        val pickupName = setting("pickup_store_name", "玺鸿珠宝天津店")
        val pickupAddress = setting("pickup_store_address", "天津市和平区南京路 219 号")
        val pickupPhone = setting("pickup_store_phone", "16622515550")
        val order = orders.saveAndFlush(OrderEntity(
            clientRequestId = payload.clientRequestId.trim(),
            userId = userId,
            status = "pending_payment",
            totalCents = total,
            subtotalCents = subtotal,
            shippingFeeCents = shipping,
            discountCents = discount,
            couponId = payload.couponId,
            receiverName = address?.receiverName ?: pickupName,
            receiverPhone = address?.phone ?: pickupPhone,
            receiverAddress = address?.let { listOf(it.province, it.city, it.district, it.detail).filter(String::isNotBlank).joinToString(" ") } ?: pickupAddress,
            buyerNote = payload.buyerNote.trim(),
            fulfillmentType = payload.fulfillmentType,
            pickupSlot = payload.pickupSlot.trim().takeIf { payload.fulfillmentType == "pickup" }.orEmpty(),
            invoiceRequested = false,
            invoiceStatus = if (total == 0) "not_available_for_free_order" else "not_requested",
            createdAt = now,
            updatedAt = now,
        ))
        order.orderNo = orderNumber(order.id!!, now)
        if (payload.fulfillmentType == "pickup") order.pickupCode = pickupCode(order.id!!)
        orders.save(order)

        merged.forEach { (productId, quantity) ->
            val product = lockedProducts.getValue(productId)
            product.stock -= quantity
            products.save(product)
            orderItems.save(OrderItemEntity(
                orderId = order.id!!,
                productId = productId,
                productName = product.name,
                unitPriceCents = product.priceCents,
                quantity = quantity,
            ))
        }
        couponUse?.second?.let { userCoupon ->
            require(userCoupon.usedOrderId == null) { "优惠券已被使用" }
            userCoupon.usedOrderId = order.id
            userCoupon.usedAt = now
            userCoupons.save(userCoupon)
        }
        cartItems.deleteAll(cartItems.findAllByUserIdAndProductIdIn(userId, merged.keys))

        if (total == 0) {
            payments.save(PaymentIntentEntity(
                orderId = order.id!!,
                provider = "free_order",
                status = "succeeded",
                outTradeNo = order.orderNo,
                notifiedAt = now,
                createdAt = now,
                updatedAt = now,
            ))
            markPaid(order, "", now)
        }
            userDto(order)
        }
    } catch (error: DataIntegrityViolationException) {
        // Concurrent retries with the same client request id may both pass the first lookup. The
        // database partial unique index is the final arbiter; return the already-created order.
        payload.clientRequestId.trim().takeIf(String::isNotBlank)
            ?.let { orders.findByUserIdAndClientRequestId(userId, it) }
            ?.let(::userDto)
            ?: throw error
    }

    fun list(userId: Long, status: String?): List<OrderDto> {
        val values = orders.findAllByUserIdOrderByCreatedAtDesc(userId).map(::userDto)
        return status?.trim()?.takeIf(String::isNotBlank)?.let { requested -> values.filter { it.status == requested } } ?: values
    }

    fun get(userId: Long, id: Long): OrderDto = userDto(findUserOrder(userId, id))

    fun getByNumber(userId: Long, orderNo: String): OrderDto = userDto(findUserOrderByNumber(userId, orderNo))

    fun pay(userId: Long, id: Long): PaymentParamsDto {
        while (true) {
        val prepared = inTransaction {
            val order = orders.lockByIdAndUserId(id, userId) ?: notFound("订单不存在")
            require(order.status == "pending_payment") { "订单当前不可支付" }
            require(order.totalCents > 0) { "零元订单无需调用微信支付" }
            val user = users.findById(userId).orElseThrow { notFound("会员不存在") }
            require(!user.wechatOpenid.isNullOrBlank()) { "请先完成微信登录" }
            val now = Instant.now()
            val paymentRows = payments.lockAllByOrderIdOrderByCreatedAtDesc(order.id!!)
            // Interrupted legacy requests are remote-state-unknown. They must be queried/closed
            // before returning a newer prepay_id, even if a newer local row already exists.
            paymentRows.lastOrNull { it.status == "close_required" }?.let {
                return@inTransaction PaymentPreparation(intentToCloseId = it.id, closeOutTradeNo = it.outTradeNo)
            }
            val latest = paymentRows.firstOrNull { it.status in ACTIVE_PAYMENT_STATUSES }
            if (latest != null && latest.status == "pending" && latest.expiresAt?.isAfter(now.plusSeconds(30)) == true && latest.packageValue.isNotBlank()) {
                return@inTransaction PaymentPreparation(cached = cachedPayment(latest))
            }
            require(latest?.status != "creating") { "支付正在初始化，请勿重复提交" }
            if (latest != null) {
                if (latest.status == "pending") {
                    latest.status = "closing"
                    latest.updatedAt = now
                    payments.save(latest)
                }
                return@inTransaction PaymentPreparation(intentToCloseId = latest.id, closeOutTradeNo = latest.outTradeNo)
            }
            val outTradeNo = if (paymentRows.isEmpty()) order.orderNo else "${order.orderNo}${randomSuffix()}"
            val intent = payments.saveAndFlush(PaymentIntentEntity(
                orderId = order.id!!,
                status = "creating",
                outTradeNo = outTradeNo,
                createdAt = now,
                updatedAt = now,
                expiresAt = now.plusSeconds(2 * 3600),
            ))
            val itemNames = orderItems.findAllByOrderIdOrderByIdAsc(order.id!!)
            val description = if (itemNames.size == 1) itemNames[0].productName else "玺鸿珠宝 · ${itemNames.sumOf { it.quantity }} 件商品"
            PaymentPreparation(intentId = intent.id!!, order = order, openid = user.wechatOpenid!!, description = description)
        }
        prepared.cached?.let { return it }
        if (prepared.intentToCloseId != null) {
            when (closeRemoteIntent(id, prepared.intentToCloseId, prepared.closeOutTradeNo!!)) {
                RemoteCloseResult.CLOSED -> continue
                RemoteCloseResult.PAID -> throw ResponseStatusException(HttpStatus.CONFLICT, "订单已支付，请刷新订单状态")
            }
        }
        val intentId = prepared.intentId!!
        return try {
            val order = prepared.order!!
            val result = paymentProvider.getObject().createJsapiPrepay(JsapiPrepayCommand(
                outTradeNo = payments.findById(intentId).orElseThrow().outTradeNo,
                description = prepared.description!!.take(127),
                totalCents = order.totalCents,
                openid = prepared.openid!!,
                attach = order.orderNo,
                expiresAt = OffsetDateTime.now(ZoneId.of("Asia/Shanghai")).plusHours(2),
            ))
            inTransaction {
                val orderInTx = orders.lockById(id) ?: throw IllegalStateException("支付订单不存在")
                val intent = payments.lockById(intentId) ?: throw IllegalStateException("支付流水不存在")
                intent.prepayId = result.packageValue.removePrefix("prepay_id=")
                intent.nonceStr = result.nonceStr
                intent.packageValue = result.packageValue
                intent.paySign = result.paySign
                intent.timeStamp = result.timeStamp
                if (intent.status != "succeeded") {
                    require(orderInTx.status == "pending_payment" && intent.status == "creating") { "订单支付状态已变化" }
                    intent.status = "pending"
                }
                intent.updatedAt = Instant.now()
                payments.save(intent)
                PaymentParamsDto("wechat_pay", result.appId, result.timeStamp, result.nonceStr, result.packageValue,
                    result.signType, result.paySign, intent.prepayId, intent.outTradeNo, properties.pay.mock)
            }
        } catch (error: RuntimeException) {
            inTransaction {
                orders.lockById(id)
                payments.lockById(intentId)?.takeIf { it.status == "creating" }?.let {
                    // The create response can be lost after WeChat accepted the request. Keep the
                    // intent blocking new payments until query+close proves it is terminal.
                    it.status = "closing"
                    it.failureReason = error.message ?: "微信支付下单结果不确定"
                    it.updatedAt = Instant.now()
                    payments.save(it)
                }
            }
            runCatching { closeRemoteIntent(id, intentId, payments.findById(intentId).orElseThrow().outTradeNo) }
                .onSuccess { if (it == RemoteCloseResult.PAID) throw ResponseStatusException(HttpStatus.CONFLICT, "订单已支付，请刷新订单状态") }
            throw externalFailure("微信支付下单失败", error)
        }
        }
    }

    fun paymentStatus(userId: Long, id: Long): PaymentStatusDto {
        val initial = findUserOrder(userId, id)
        var intent = payments.findFirstByOrderIdOrderByCreatedAtDesc(initial.id!!)
        if (intent?.status == "succeeded" && initial.status == "pending_payment") {
            paymentSucceeded(initial.id!!, intent.transactionId, intent.notifiedAt)
        } else if (intent?.status == "pending" && !properties.pay.mock) {
            val snapshot = try { paymentProvider.getObject().queryOrderByOutTradeNo(intent.outTradeNo) }
            catch (error: RuntimeException) { throw externalFailure("微信支付状态查询失败", error) }
            reconcilePayment(initial.id!!, intent.id!!, snapshot)
            intent = payments.findById(intent.id!!).orElse(intent)
        }
        val order = findUserOrder(userId, id)
        val success = order.status in setOf("paid", "preparing", "shipped", "in_transit", "received", "completed")
        return PaymentStatusDto(
            orderId = order.id!!,
            orderStatus = mapper.authoritativeStatus(order),
            paymentStatus = intent?.status,
            transactionId = intent?.transactionId.orEmpty(),
            message = if (success) "支付成功" else if (intent?.status == "failed") intent.failureReason.ifBlank { "支付失败" } else "订单尚未支付",
        )
    }

    fun mockPay(userId: Long, id: Long): OrderDto {
        if (!properties.pay.mock) throw ResponseStatusException(HttpStatus.NOT_FOUND, "接口不存在")
        inTransaction {
            val order = orders.lockByIdAndUserId(id, userId) ?: notFound("订单不存在")
            require(order.status == "pending_payment") { "订单当前不可支付" }
            val intent = payments.findFirstByOrderIdOrderByCreatedAtDesc(order.id!!)
                ?: throw IllegalArgumentException("请先发起支付")
            val transactionId = "mock_${order.orderNo}"
            val notifiedAt = Instant.now()
            intent.status = "succeeded"
            intent.transactionId = transactionId
            intent.notifiedAt = notifiedAt
            intent.updatedAt = notifiedAt
            payments.save(intent)
            markPaid(order, transactionId, notifiedAt)
        }
        return get(userId, id)
    }

    fun cancel(userId: Long, id: Long): OrderDto {
        cancelOrder(id, userId, "用户取消", setOf("pending_payment", "cancelling"))
        return get(userId, id)
    }

    /** Admin cancellation uses exactly the same close/query/compensation workflow as users. */
    fun cancelByAdmin(id: Long) {
        cancelOrder(id, null, "后台取消", setOf("pending_payment", "cancelling", "failed"))
    }

    private fun cancelOrder(id: Long, userId: Long?, reason: String, allowedStatuses: Set<String>) {
        while (true) {
            val prepared = inNullableTransaction {
                val order = (if (userId == null) orders.lockById(id) else orders.lockByIdAndUserId(id, userId))
                    ?: notFound("订单不存在")
                require(order.status in allowedStatuses) { "只有待支付订单可以取消" }
                val paymentRows = payments.lockAllByOrderIdOrderByCreatedAtDesc(order.id!!)
                require(paymentRows.none { it.status == "succeeded" }) { "订单已支付，不能取消" }
                require(paymentRows.none { it.status == "creating" }) { "支付正在初始化，请稍后重试" }
                val remoteOpen = paymentRows.lastOrNull { it.status == "close_required" }
                    ?: paymentRows.firstOrNull { it.status in setOf("pending", "closing") }
                if (remoteOpen != null) {
                    order.status = "cancelling"
                    order.updatedAt = Instant.now()
                    orders.save(order)
                    if (remoteOpen.status == "pending") {
                        remoteOpen.status = "closing"
                        remoteOpen.updatedAt = order.updatedAt
                        payments.save(remoteOpen)
                    }
                    return@inNullableTransaction CancellationPreparation(remoteOpen.id!!, remoteOpen.outTradeNo)
                }
                finalizeCancellation(order, reason)
                null
            }
            if (prepared == null) return
            when (closeRemoteIntent(id, prepared.intentId, prepared.outTradeNo)) {
                RemoteCloseResult.PAID -> return
                // There can be multiple legacy close_required rows. Prove every remote order
                // terminal before releasing stock/coupon on the next loop iteration.
                RemoteCloseResult.CLOSED -> continue
            }
        }
    }

    fun syncWechat(userId: Long, orderNo: String): OrderDto {
        val order = findUserOrderByNumber(userId, orderNo)
        try {
            reconcileWechatOrder(order.id!!)
        } catch (error: RuntimeException) {
            throw externalFailure("微信订单状态同步失败", error)
        }
        return get(userId, order.id!!)
    }

    /**
     * Shared reconciliation entry for user requests, admin actions, message callbacks and the
     * scheduler. Platform state 5 is only a snapshot; refund business effects are applied here.
     */
    fun reconcileWechatOrder(orderId: Long): OrderEntity {
        val initial = orders.findById(orderId).orElseThrow { notFound("订单不存在") }
        if (!hasRealWechatPayment(initial)) return initial
        val synced = platform.sync(initial)
        val latestRefund = refunds.findFirstByOrderIdOrderByCreatedAtDesc(orderId)
        if (synced.platformOrderState == 5) {
            refundSucceeded(orderId, latestRefund?.id, latestRefund?.refundId.orEmpty(), latestRefund?.updatedAt)
        } else if (latestRefund != null) {
            when (latestRefund.status.uppercase()) {
                "SUCCESS" -> refundSucceeded(orderId, latestRefund.id, latestRefund.refundId, latestRefund.updatedAt)
                "CLOSED", "ABNORMAL", "FAILED" -> refundFailed(orderId, latestRefund.previousStatus, latestRefund.status)
                "PROCESSING" -> if (!properties.pay.mock) {
                    val snapshot = runCatching { paymentProvider.getObject().queryRefund(latestRefund.outRefundNo) }.getOrNull()
                    if (snapshot != null) reconcileRefund(orderId, latestRefund.id!!, snapshot)
                }
            }
        }
        return orders.findById(orderId).orElseThrow { notFound("订单不存在") }
    }

    /** Close/query interrupted remote payment intents without ever creating a new payment. */
    fun reconcileOpenPaymentIntents(limit: Int = 200) {
        payments.findAllByStatusInOrderByUpdatedAtAsc(
            setOf("close_required", "closing"),
            org.springframework.data.domain.PageRequest.of(0, limit.coerceIn(1, 500)),
        ).forEach { intent ->
            runCatching { closeRemoteIntent(intent.orderId, intent.id!!, intent.outTradeNo) }
                .onFailure { log.warn("WeChat payment-intent reconciliation failed for {}: {}", intent.outTradeNo, it.message) }
        }
    }

    /**
     * Recover payment successes whose asynchronous notification never reached us. Only old,
     * ordinary WeChat intents are selected, and this method never creates another prepay order.
     * A delivered, still-valid pending prepay remains payable; only an interrupted creating row,
     * an expired pending row, or a competitor of an already-paid order is queried then closed.
     */
    fun reconcileStalePaymentIntents(limit: Int = 50, now: Instant = Instant.now()) {
        if (properties.pay.mock) return
        val staleBefore = now.minusSeconds(PAYMENT_RECOVERY_STALE_AFTER_SECONDS)
        payments.findAllByProviderAndStatusInAndUpdatedAtBeforeOrderByUpdatedAtAsc(
            "wechat_pay",
            PAYMENT_RECOVERY_STATUSES,
            staleBefore,
            org.springframework.data.domain.PageRequest.of(0, limit.coerceIn(1, MAX_PAYMENT_RECOVERY_BATCH)),
        ).forEach { candidate ->
            val intentId = candidate.id ?: return@forEach
            runCatching { recoverStalePaymentIntent(candidate.orderId, intentId, staleBefore, now) }
                .onFailure { log.warn("WeChat stale payment-intent recovery failed for {}: {}", candidate.outTradeNo, it.message) }
        }
    }

    /** Retry a SUCCESS ledger whose atomic stock/coupon/points unit previously rolled back. */
    fun reconcilePendingRefundCompensations(limit: Int = 200) {
        refunds.findAllByStatusAndBusinessAppliedAtIsNullOrderByUpdatedAtAsc(
            "success",
            org.springframework.data.domain.PageRequest.of(0, limit.coerceIn(1, 500)),
        ).forEach { refund ->
            runCatching { refundSucceeded(refund.orderId, refund.id, refund.refundId, refund.updatedAt) }
                .onFailure { log.warn("Refund compensation reconciliation failed for {}: {}", refund.outRefundNo, it.message) }
        }
    }

    fun refund(userId: Long, orderNo: String, reason: String): OrderDto {
        val synced = syncWechat(userId, orderNo)
        require(synced.totalCents > 0 && hasRealWechatPayment(orders.findById(synced.id).orElseThrow())) { "该订单没有可退款的微信支付流水" }
        val paymentGuard = inTransaction {
            val order = orders.lockByOrderNoAndUserId(synced.orderNo, userId) ?: notFound("订单不存在")
            require(InvoiceWorkflowPolicy.canRefundWithoutTaxReversal(order.invoiceStatus)) {
                "该订单的电子发票已进入开具或交付流程，请联系客服先完成税务冲红后再退款"
            }
            val paymentRows = payments.lockAllByOrderIdOrderByCreatedAtDesc(order.id!!)
            val succeeded = paymentRows.filter(::isRealWechatPayment)
            require(succeeded.size == 1) { "订单存在多笔成功支付，需人工核对并分别退款" }
            val paid = succeeded.single()
            paymentRows.filter { it.id != paid.id && it.status in REMOTE_OPEN_PAYMENT_STATUSES }.forEach {
                it.status = "close_required"
                it.failureReason = it.failureReason.ifBlank { "退款前必须关闭竞争支付单" }
                it.updatedAt = Instant.now()
                payments.save(it)
            }
            RefundPaymentGuard(paid.id!!, paid.transactionId)
        }
        closeCompetingPaymentIntents(synced.id, paymentGuard.transactionId)
        val prepared = inTransaction {
            val order = orders.lockByOrderNoAndUserId(synced.orderNo, userId) ?: notFound("订单不存在")
            val displayStatus = mapper.authoritativeStatus(order)
            require(displayStatus in setOf("paid", "preparing", "shipped", "in_transit", "received", "completed")) { "当前订单状态不能申请退款" }
            require(InvoiceWorkflowPolicy.canRefundWithoutTaxReversal(order.invoiceStatus)) {
                "该订单的电子发票已进入开具或交付流程，请联系客服先完成税务冲红后再退款"
            }
            refunds.findFirstByOrderIdOrderByCreatedAtDesc(order.id!!)?.takeIf { it.status.uppercase() == "PROCESSING" }?.let {
                return@inTransaction RefundPreparation(order, null, null, null)
            }
            val paymentRows = payments.lockAllByOrderIdOrderByCreatedAtDesc(order.id!!)
            require(paymentRows.none { it.status in REMOTE_OPEN_PAYMENT_STATUSES }) { "旧微信支付单尚未安全关闭，请稍后重试" }
            val payment = paymentRows.firstOrNull { it.id == paymentGuard.intentId && isRealWechatPayment(it) }
                ?: throw IllegalArgumentException("原成功支付流水已变化，请重新同步订单")
            val refund = refunds.saveAndFlush(RefundEntity(
                orderId = order.id!!,
                paymentIntentId = payment.id,
                outRefundNo = "RF${order.orderNo.removePrefix("XH")}${randomSuffix(6)}",
                amountCents = order.totalCents,
                reason = reason.trim().take(80).ifBlank { "用户申请退款" },
                previousStatus = displayStatus,
                status = "processing",
            ))
            order.status = "refunding"
            order.updatedAt = Instant.now()
            orders.save(order)
            RefundPreparation(order, payment.outTradeNo, refund.id!!, refund.outRefundNo)
        }
        if (prepared.refundId == null) return userDto(prepared.order)
        if (properties.pay.mock) {
            inTransaction {
                val refund = refunds.findById(prepared.refundId).orElseThrow()
                refund.status = "success"
                refund.refundId = "mock_${refund.outRefundNo}"
                refund.updatedAt = Instant.now()
                refunds.save(refund)
            }
            refundSucceeded(prepared.order.id!!, prepared.refundId, "mock_${prepared.outRefundNo}", Instant.now())
            return get(userId, prepared.order.id!!)
        }
        return try {
            val snapshot = paymentProvider.getObject().createRefund(OriginalRefundCommand(
                outTradeNo = prepared.outTradeNo!!,
                outRefundNo = prepared.outRefundNo!!,
                totalCents = prepared.order.totalCents.toLong(),
                refundCents = prepared.order.totalCents.toLong(),
                reason = reason.trim().take(80),
            ))
            reconcileRefund(prepared.order.id!!, prepared.refundId, snapshot)
            get(userId, prepared.order.id!!)
        } catch (error: RuntimeException) {
            // The create-refund response can be lost after WeChat accepted the request. Querying by the
            // merchant refund number is the only safe way to distinguish that case. If both requests fail,
            // keep the local request in PROCESSING so a later sync can reconcile it without issuing a
            // duplicate refund.
            val queried = runCatching { paymentProvider.getObject().queryRefund(prepared.outRefundNo!!) }.getOrNull()
            if (queried != null) {
                reconcileRefund(prepared.order.id!!, prepared.refundId, queried)
                get(userId, prepared.order.id!!)
            } else {
                throw externalFailure("微信退款申请失败", error)
            }
        }
    }

    fun applyInvoice(userId: Long, orderNo: String): OrderDto {
        val order = syncWechat(userId, orderNo)
        require(order.totalCents > 0) { "零元订单不能申请发票" }
        require(order.status in setOf("received", "completed") || order.platformOrderState in setOf(3, 4)) { "请先在微信确认收货后再申请发票" }
        val user = users.findById(userId).orElseThrow { notFound("会员不存在") }
        require(!user.wechatOpenid.isNullOrBlank()) { "订单缺少微信用户标识" }
        require(order.totalCents in 1..Int.MAX_VALUE) { "开票金额超出微信支持范围" }
        inTransaction {
            val current = orders.lockByOrderNoAndUserId(order.orderNo, userId) ?: notFound("订单不存在")
            require(InvoiceWorkflowPolicy.canAcquireTitleForm(current.invoiceStatus)) { "当前发票状态不能重新申请抬头" }
        }
        val result = try {
            invoiceProvider.getObject().acquireTitleForm(InvoiceTitleFormCommand(
                fapiaoApplyId = order.orderNo,
                openid = user.wechatOpenid!!,
                totalAmount = order.totalCents.toLong(),
            ))
        } catch (error: RuntimeException) {
            inTransaction {
                orders.lockByOrderNoAndUserId(order.orderNo, userId)?.let {
                    it.invoiceStatus = InvoiceWorkflowPolicy.titleFormFailed(it.invoiceStatus)
                    it.invoiceError = error.message ?: "微信发票入口获取失败"
                    it.invoiceUpdatedAt = Instant.now()
                    orders.save(it)
                }
            }
            throw externalFailure("微信发票入口获取失败", error)
        }
        inTransaction {
            val entity = orders.lockByOrderNoAndUserId(order.orderNo, userId) ?: notFound("订单不存在")
            require(mapper.authoritativeStatus(entity) in setOf("received", "completed")) { "订单状态已变化，请重新同步" }
            require(InvoiceWorkflowPolicy.canAcquireTitleForm(entity.invoiceStatus)) { "发票状态已更新，请勿重复申请" }
            entity.invoiceRequested = true
            entity.invoiceApplyId = order.orderNo
            entity.invoiceStatus = InvoiceWorkflowPolicy.titleFormSucceeded(entity.invoiceStatus)
            entity.invoiceMiniprogramAppid = result.appId
            entity.invoiceMiniprogramPath = result.path
            entity.invoiceError = ""
            entity.invoiceUpdatedAt = Instant.now()
            orders.save(entity)
        }
        return get(userId, order.id)
    }

    fun syncInvoice(userId: Long, id: Long): OrderDto {
        val order = findUserOrder(userId, id)
        require(order.invoiceRequested && order.invoiceApplyId.isNotBlank()) { "该订单尚未申请微信电子发票" }
        require(InvoiceWorkflowPolicy.canSyncTitle(order.invoiceStatus)) { "当前发票状态不需要再次同步抬头" }
        val title = try { invoiceProvider.getObject().queryTitle(order.invoiceApplyId, InvoiceScene.WITHOUT_WECHATPAY) }
        catch (error: RuntimeException) {
            inTransaction {
                orders.lockByIdAndUserId(id, userId)?.let {
                    it.invoiceError = error.message ?: "微信发票抬头同步失败"
                    it.invoiceUpdatedAt = Instant.now()
                    orders.save(it)
                }
            }
            throw externalFailure("微信发票抬头同步失败", error)
        }
        inTransaction {
            val entity = orders.lockByIdAndUserId(id, userId) ?: notFound("订单不存在")
            if (!InvoiceWorkflowPolicy.canSyncTitle(entity.invoiceStatus)) return@inTransaction
            entity.invoiceBuyerType = title.type
            entity.invoiceBuyerName = title.name
            entity.invoiceBuyerTaxpayerId = title.taxpayerId.orEmpty()
            entity.invoiceBuyerAddress = title.address.orEmpty()
            entity.invoiceBuyerTelephone = title.telephone.orEmpty()
            entity.invoiceBuyerBankName = title.bankName.orEmpty()
            entity.invoiceBuyerBankAccount = title.bankAccount.orEmpty()
            entity.invoiceStatus = InvoiceWorkflowPolicy.titleSynced(entity.invoiceStatus)
            entity.invoiceError = ""
            entity.invoiceUpdatedAt = Instant.now()
            orders.save(entity)
        }
        return get(userId, id)
    }

    override fun paymentSucceeded(orderId: Long, transactionId: String, paidAt: Instant?) {
        inTransaction {
            val order = orders.lockById(orderId) ?: throw IllegalArgumentException("支付订单不存在")
            markPaid(order, transactionId, paidAt ?: Instant.now())
        }
        // A successful intent makes every other legacy remote prepay invalid for this business
        // order. Closing is best-effort here and is retried by scheduled reconciliation.
        closeCompetingPaymentIntents(orderId, transactionId)
    }

    override fun refundSucceeded(orderId: Long, refundRecordId: Long?, refundId: String, refundedAt: Instant?) {
        inTransaction {
            val order = orders.lockById(orderId) ?: throw IllegalArgumentException("退款订单不存在")
            val existingRefund = refundRecordId?.let(refunds::lockById)
                ?: refunds.findFirstByOrderIdOrderByCreatedAtDesc(orderId)?.id?.let(refunds::lockById)
            require(existingRefund == null || existingRefund.orderId == orderId) { "退款流水与订单不匹配" }
            // This durable marker, acquired under the refund row lock, is deliberately the only
            // compensation idempotency guard. Local/platform terminal status may arrive first.
            if (existingRefund?.businessAppliedAt != null) return@inTransaction
            val appliedAt = refundedAt ?: Instant.now()
            val refund = existingRefund ?: RefundEntity(
                orderId = orderId,
                paymentIntentId = payments.lockAllByOrderIdOrderByCreatedAtDesc(orderId)
                    .firstOrNull(::isRealWechatPayment)?.id,
                outRefundNo = "WX${order.orderNo}",
                amountCents = order.totalCents,
                reason = "微信平台同步退款",
                previousStatus = "paid",
                status = "processing",
            )
            refund.refundId = refundId.ifBlank { refund.refundId }
            refund.status = "success"
            refund.updatedAt = appliedAt
            val items = orderItems.findAllByOrderIdOrderByIdAsc(orderId)
            val lockedProducts = products.lockAllById(items.map { it.productId }.distinct()).associateBy { it.id!! }
            items.forEach { item -> lockedProducts[item.productId]?.let { it.stock += item.quantity } }
            items.forEach { item -> lockedProducts[item.productId]?.let { it.sales = (it.sales - item.quantity).coerceAtLeast(0) } }
            products.saveAll(lockedProducts.values)
            releaseCoupon(order)
            revokeOrderPoints(order)
            order.status = "refunded"
            order.updatedAt = appliedAt
            orders.save(order)
            // Written last in the same transaction as all business compensation. A rollback leaves
            // it null, allowing callback/platform reconciliation to safely retry the complete unit.
            refund.businessAppliedAt = appliedAt
            refunds.save(refund)
        }
    }

    override fun refundFailed(orderId: Long, previousStatus: String, reason: String) {
        inTransaction {
            val order = orders.lockById(orderId) ?: throw IllegalArgumentException("退款订单不存在")
            if (order.status != "refunding") return@inTransaction
            order.status = previousStatus.takeIf { it in REFUNDABLE_STATUSES } ?: "paid"
            order.updatedAt = Instant.now()
            orders.save(order)
            refunds.findFirstByOrderIdOrderByCreatedAtDesc(orderId)?.takeIf { it.status.lowercase() == "processing" }?.let {
                it.status = "failed"
                it.reason = listOf(it.reason, reason).filter(String::isNotBlank).joinToString("；").take(255)
                it.updatedAt = Instant.now()
                refunds.save(it)
            }
        }
    }

    override fun invoiceNotification(notification: InvoiceNotificationSnapshot) {
        inTransaction {
            val order = orders.lockByOrderNo(notification.fapiaoApplyId)
                ?: throw IllegalArgumentException("微信发票申请对应的订单不存在")
            order.invoiceRequested = true
            val invoice = notification.invoices.firstOrNull { it.fapiaoId == order.invoiceFapiaoId }
                ?: notification.invoices.firstOrNull()
            order.invoiceStatus = InvoiceWorkflowPolicy.notification(
                order.invoiceStatus,
                notification.envelope.eventType,
                notification.invoices.map(InvoiceStatusItem::fapiaoStatus),
            )
            invoice?.let {
                order.invoiceFapiaoId = invoice.fapiaoId.ifBlank { order.invoiceFapiaoId }
                invoice.cardStatus?.takeIf(String::isNotBlank)?.let { order.invoiceCardStatus = it }
            }
            val failed = notification.invoices.any {
                "FAIL" in it.fapiaoStatus.uppercase() || "FAIL" in it.cardStatus.orEmpty().uppercase()
            }
            order.invoiceError = if (failed) "微信返回发票或卡包处理失败，请联系商家处理" else ""
            order.invoiceUpdatedAt = notification.applyTime?.toInstant() ?: Instant.now()
            orders.save(order)
        }
    }

    private fun reconcilePayment(orderId: Long, intentId: Long, snapshot: PaymentOrderSnapshot) {
        inTransaction {
            val order = orders.lockById(orderId) ?: throw IllegalArgumentException("支付订单不存在")
            val intent = payments.lockById(intentId) ?: throw IllegalArgumentException("支付流水不存在")
            require(snapshot.totalCents == null || snapshot.totalCents == order.totalCents) { "微信支付金额与订单不一致" }
            require(snapshot.currency == null || snapshot.currency == "CNY") { "微信支付币种不正确" }
            intent.updatedAt = Instant.now()
            when (snapshot.tradeState) {
                "SUCCESS" -> {
                    intent.status = "succeeded"
                    intent.transactionId = snapshot.transactionId.orEmpty()
                    intent.notifiedAt = snapshot.successTime?.toInstant() ?: Instant.now()
                    payments.save(intent)
                    markPaid(order, intent.transactionId, intent.notifiedAt!!)
                }
                "CLOSED" -> { intent.status = "closed"; payments.save(intent) }
                "PAYERROR", "REVOKED" -> {
                    intent.status = "failed"
                    intent.failureReason = snapshot.tradeStateDesc ?: snapshot.tradeState
                    payments.save(intent)
                }
                else -> payments.save(intent)
            }
        }
    }

    private fun reconcileRefund(orderId: Long, refundId: Long, snapshot: RefundSnapshot) {
        inTransaction {
            orders.lockById(orderId) ?: throw IllegalArgumentException("退款订单不存在")
            val refund = refunds.lockById(refundId) ?: throw IllegalArgumentException("退款流水不存在")
            refund.refundId = snapshot.refundId ?: refund.refundId
            refund.status = snapshot.status.lowercase()
            refund.updatedAt = Instant.now()
            refunds.save(refund)
        }
        when (snapshot.status) {
            "SUCCESS" -> refundSucceeded(orderId, refundId, snapshot.refundId.orEmpty(), snapshot.successTime?.toInstant())
            "CLOSED", "ABNORMAL" -> {
                val previous = refunds.findById(refundId).orElseThrow().previousStatus
                refundFailed(orderId, previous, snapshot.status)
            }
        }
    }

    private fun markPaid(order: OrderEntity, transactionId: String, paidAt: Instant) {
        val paymentRows = payments.lockAllByOrderIdOrderByCreatedAtDesc(order.id!!)
        val winner = transactionId.takeIf(String::isNotBlank)?.let { id ->
            paymentRows.firstOrNull { it.transactionId == id }
                ?: paymentRows.firstOrNull { it.status in ACTIVE_PAYMENT_STATUSES }
        }
        winner?.let {
            it.transactionId = transactionId
            it.status = "succeeded"
            it.notifiedAt = paidAt
            it.updatedAt = paidAt
            payments.save(it)
        }
        paymentRows.filter { it.id != winner?.id && it.status in REMOTE_OPEN_PAYMENT_STATUSES }.forEach {
            it.status = "close_required"
            it.failureReason = it.failureReason.ifBlank { "同一订单已有成功支付，需关闭竞争支付单" }
            it.updatedAt = paidAt
            payments.save(it)
        }

        if (order.status == "refunded" && winner?.id != null &&
            refunds.existsByOrderIdAndPaymentIntentIdAndBusinessAppliedAtIsNotNull(order.id!!, winner.id!!)
        ) {
            // WeChat may redeliver the original payment callback long after its payment was fully
            // refunded. It is not a second receipt and must not reserve stock/coupon a second time.
            return
        }
        if (order.status in PAID_BUSINESS_STATUSES) return
        val resourcesWereReleased = order.status in setOf("cancelled", "refunded")
        require(order.status in PAYABLE_CALLBACK_STATUSES) { "订单状态 ${order.status} 不能接收支付成功" }
        val items = orderItems.findAllByOrderIdOrderByIdAsc(order.id!!)
        val lockedProducts = products.lockAllById(items.map { it.productId }.distinct()).associateBy { it.id!! }
        items.forEach { item -> lockedProducts[item.productId]?.let {
            if (resourcesWereReleased) it.stock -= item.quantity
            it.sales += item.quantity
        } }
        products.saveAll(lockedProducts.values)
        if (resourcesWereReleased) reclaimReleasedCoupon(order)
        order.status = "paid"
        order.paidAt = paidAt
        order.cancelledAt = null
        order.cancellationReason = ""
        order.updatedAt = paidAt
        orders.save(order)
        val reward = (order.totalCents / 1000).coerceAtLeast(0)
        if (reward > 0) users.findById(order.userId).orElse(null)?.let { user ->
            user.points += reward
            users.save(user)
            pointLedgers.save(PointLedgerEntity(userId = user.id!!, action = "order_paid", points = reward, note = "订单 ${order.orderNo}"))
        }
    }

    private fun closeCompetingPaymentIntents(orderId: Long, successfulTransactionId: String) {
        repeat(MAX_PAYMENT_CLOSE_ATTEMPTS) {
            val candidate = inNullableTransaction {
                val order = orders.lockById(orderId) ?: return@inNullableTransaction null
                payments.lockAllByOrderIdOrderByCreatedAtDesc(order.id!!)
                    .lastOrNull { intent ->
                        intent.status == "close_required" &&
                            (successfulTransactionId.isBlank() || intent.transactionId != successfulTransactionId)
                    }
                    ?.let { CancellationPreparation(it.id!!, it.outTradeNo) }
            } ?: return
            runCatching { closeRemoteIntent(orderId, candidate.intentId, candidate.outTradeNo) }
                .onFailure {
                    log.warn("Could not close competing WeChat payment {} for order {}: {}", candidate.outTradeNo, orderId, it.message)
                    return
                }
                .onSuccess { result ->
                    if (result == RemoteCloseResult.PAID) {
                        log.error("Multiple WeChat payments succeeded for business order {} (latest {})", orderId, candidate.outTradeNo)
                    }
                }
        }
        log.error("Too many close-required payment intents for order {}; reconciliation will continue later", orderId)
    }

    private fun closeRemoteIntent(orderId: Long, intentId: Long, outTradeNo: String): RemoteCloseResult {
        val local = payments.findById(intentId).orElse(null) ?: return RemoteCloseResult.CLOSED
        if (local.status == "succeeded") return RemoteCloseResult.PAID
        if (local.status in TERMINAL_PAYMENT_STATUSES) return RemoteCloseResult.CLOSED
        if (properties.pay.mock || local.provider != "wechat_pay" || outTradeNo.startsWith("mock_")) {
            return markIntentClosed(orderId, intentId)
        }

        val api = paymentProvider.getObject()
        val snapshot = try {
            api.queryOrderByOutTradeNo(outTradeNo)
        } catch (error: ServiceException) {
            if (error.errorCode == "ORDER_NOT_EXIST") return markIntentClosed(orderId, intentId)
            throw externalFailure("微信支付单查询失败", error)
        } catch (error: RuntimeException) {
            throw externalFailure("微信支付单查询失败", error)
        }
        terminalResult(orderId, intentId, snapshot)?.let { return it }
        if (snapshot.tradeState != "NOTPAY") {
            throw ResponseStatusException(HttpStatus.CONFLICT, "微信支付单状态为 ${snapshot.tradeState}，暂不能关闭")
        }

        try {
            api.closeOrder(outTradeNo)
            return markIntentClosed(orderId, intentId)
        } catch (closeError: RuntimeException) {
            // The close response itself can be lost. Query once more before deciding whether the
            // merchant may release goods/coupon or create another prepay order.
            val afterClose = try {
                api.queryOrderByOutTradeNo(outTradeNo)
            } catch (queryError: ServiceException) {
                if (queryError.errorCode == "ORDER_NOT_EXIST") return markIntentClosed(orderId, intentId)
                throw externalFailure("微信支付关单结果未知", closeError)
            } catch (_: RuntimeException) {
                throw externalFailure("微信支付关单结果未知", closeError)
            }
            terminalResult(orderId, intentId, afterClose)?.let { return it }
            throw externalFailure("微信支付关单失败", closeError)
        }
    }

    private fun recoverStalePaymentIntent(orderId: Long, intentId: Long, staleBefore: Instant, now: Instant) {
        val claim = inNullableTransaction {
            val order = orders.lockById(orderId) ?: return@inNullableTransaction null
            val paymentRows = payments.lockAllByOrderIdOrderByCreatedAtDesc(orderId)
            val intent = paymentRows.firstOrNull { it.id == intentId } ?: return@inNullableTransaction null
            if (intent.provider != "wechat_pay" || intent.status !in PAYMENT_RECOVERY_STATUSES ||
                !intent.updatedAt.isBefore(staleBefore) || intent.outTradeNo.startsWith("mock_")
            ) return@inNullableTransaction null

            val hasSuccessfulCompetitor = paymentRows.any { it.id != intent.id && it.status == "succeeded" }
            val expired = intent.expiresAt?.let { !it.isAfter(now) } == true
            val wasCreating = intent.status == "creating"
            val mustClose = wasCreating || expired || hasSuccessfulCompetitor || order.status != "pending_payment"
            if (mustClose) {
                intent.status = if (hasSuccessfulCompetitor) "close_required" else "closing"
                intent.failureReason = intent.failureReason.ifBlank {
                    when {
                        hasSuccessfulCompetitor -> "同一订单已有成功支付，需关闭竞争支付单"
                        wasCreating -> "支付初始化超时，需核验并关闭微信支付单"
                        expired -> "微信支付单已超过支付截止时间，需核验并关闭"
                        else -> "业务订单已非待支付，需核验并关闭微信支付单"
                    }
                }
            }
            // This timestamp is also a durable polling lease. A transient query failure cannot make
            // every scheduler tick hammer the same WeChat order, while the row remains recoverable.
            intent.updatedAt = now
            payments.save(intent)
            PaymentRecoveryClaim(intent.id!!, intent.outTradeNo, mustClose)
        } ?: return

        if (claim.mustClose) {
            closeRemoteIntent(orderId, claim.intentId, claim.outTradeNo)
            return
        }

        val snapshot = try {
            paymentProvider.getObject().queryOrderByOutTradeNo(claim.outTradeNo)
        } catch (error: ServiceException) {
            if (error.errorCode == "ORDER_NOT_EXIST") {
                markIntentClosed(orderId, claim.intentId)
                return
            }
            throw externalFailure("微信支付单查询失败", error)
        } catch (error: RuntimeException) {
            throw externalFailure("微信支付单查询失败", error)
        }
        terminalResult(orderId, claim.intentId, snapshot)
    }

    private fun terminalResult(orderId: Long, intentId: Long, snapshot: PaymentOrderSnapshot): RemoteCloseResult? = when (snapshot.tradeState) {
        "SUCCESS", "REFUND" -> {
            reconcilePayment(orderId, intentId, snapshot.copy(tradeState = "SUCCESS"))
            RemoteCloseResult.PAID
        }
        "CLOSED", "PAYERROR", "REVOKED" -> markIntentClosed(orderId, intentId)
        else -> null
    }

    private fun markIntentClosed(orderId: Long, intentId: Long): RemoteCloseResult = inTransaction {
        orders.lockById(orderId) ?: throw IllegalArgumentException("支付订单不存在")
        val intent = payments.lockById(intentId) ?: return@inTransaction RemoteCloseResult.CLOSED
        if (intent.status == "succeeded") return@inTransaction RemoteCloseResult.PAID
        intent.status = "closed"
        intent.updatedAt = Instant.now()
        payments.save(intent)
        RemoteCloseResult.CLOSED
    }

    private fun finalizeCancellation(order: OrderEntity, reason: String) {
        if (order.status == "cancelled") return
        require(order.status in setOf("pending_payment", "cancelling", "failed")) { "订单当前不能取消" }
        restoreInventory(order)
        releaseCoupon(order)
        val now = Instant.now()
        order.status = "cancelled"
        order.cancelledAt = now
        order.cancellationReason = reason
        order.updatedAt = now
        orders.save(order)
    }

    private fun restoreInventory(order: OrderEntity) {
        val items = orderItems.findAllByOrderIdOrderByIdAsc(order.id!!)
        val locked = products.lockAllById(items.map { it.productId }.distinct()).associateBy { it.id!! }
        items.forEach { item -> locked[item.productId]?.let { it.stock += item.quantity } }
        products.saveAll(locked.values)
    }

    private fun releaseCoupon(order: OrderEntity) {
        userCoupons.findByUsedOrderId(order.id!!)?.let {
            it.usedOrderId = null
            it.usedAt = null
            userCoupons.save(it)
        }
    }

    private fun reclaimReleasedCoupon(order: OrderEntity) {
        val couponId = order.couponId ?: return
        val coupon = userCoupons.lockByUserIdAndCouponId(order.userId, couponId) ?: return
        val usedOrderId = coupon.usedOrderId
        val orderId = requireNotNull(order.id) { "支付订单缺少主键" }
        if (usedOrderId == null || usedOrderId == orderId) {
            coupon.usedOrderId = orderId
            coupon.usedAt = Instant.now()
            userCoupons.save(coupon)
        } else {
            log.error(
                "Late payment {} could not reclaim coupon {} because it is now used by order {}",
                order.orderNo, couponId, coupon.usedOrderId,
            )
        }
    }

    private fun revokeOrderPoints(order: OrderEntity) {
        val reward = (order.totalCents / 1000).coerceAtLeast(0)
        if (reward == 0) return
        users.findById(order.userId).orElse(null)?.let { user ->
            // Reverse the exact earning even if some points have already been spent. The negative
            // balance is repaid by future earnings and keeps the balance consistent with the ledger.
            user.points -= reward
            users.save(user)
            pointLedgers.save(PointLedgerEntity(userId = user.id!!, action = "order_refunded", points = -reward, note = "订单 ${order.orderNo}"))
        }
    }

    private fun validateCoupon(userId: Long, couponId: Long, subtotal: Int): Pair<com.xihong.jewelry.domain.CouponEntity, UserCouponEntity> {
        val coupon = coupons.lockById(couponId) ?: throw IllegalArgumentException("优惠券不存在")
        val userCoupon = userCoupons.lockByUserIdAndCouponId(userId, couponId) ?: throw IllegalArgumentException("请先领取优惠券")
        val now = Instant.now()
        require(userCoupon.usedOrderId == null) { "优惠券已被使用" }
        require(coupon.isActive && coupon.validFrom <= now && (coupon.validUntil == null || coupon.validUntil!!.isAfter(now))) { "优惠券不在有效期内" }
        require(subtotal >= coupon.minimumCents) { "订单金额未达到优惠券使用门槛" }
        return coupon to userCoupon
    }

    private fun findUserOrder(userId: Long, id: Long): OrderEntity =
        orders.findByIdAndUserId(id, userId) ?: notFound("订单不存在")

    private fun findUserOrderByNumber(userId: Long, value: String): OrderEntity {
        val normalized = value.trim()
        orders.findByOrderNoAndUserId(normalized, userId)?.let { return it }
        payments.findByOutTradeNo(normalized)?.let { payment ->
            orders.findByIdAndUserId(payment.orderId, userId)?.let { return it }
        }
        return notFound("订单不存在")
    }

    private fun userDto(order: OrderEntity): OrderDto {
        val dto = mapper.order(order)
        val paidWechat = dto.totalCents > 0 && hasRealWechatPayment(order)
        return dto.copy(
            canRefund = dto.canRefund && paidWechat,
            canConfirmReceipt = dto.canConfirmReceipt && paidWechat && dto.platformOrderState !in setOf(3, 4),
            canApplyInvoice = dto.canApplyInvoice && dto.totalCents > 0,
        )
    }

    private fun hasRealWechatPayment(order: OrderEntity): Boolean =
        payments.findAllByOrderIdOrderByCreatedAtDesc(order.id!!).any(::isRealWechatPayment)

    private fun isRealWechatPayment(intent: PaymentIntentEntity): Boolean =
        intent.provider == "wechat_pay" &&
            intent.status == "succeeded" &&
            intent.transactionId.isNotBlank() &&
            !intent.transactionId.startsWith("mock_") &&
            !intent.outTradeNo.startsWith("mock_")

    private fun cachedPayment(intent: PaymentIntentEntity) = PaymentParamsDto(
        provider = intent.provider,
        appId = properties.pay.appId.ifBlank { properties.wechat.appId }.ifBlank { "wx_mock_appid" },
        timeStamp = intent.timeStamp,
        nonceStr = intent.nonceStr,
        packageValue = intent.packageValue,
        signType = "RSA",
        paySign = intent.paySign,
        prepayId = intent.prepayId,
        outTradeNo = intent.outTradeNo,
        mock = properties.pay.mock,
    )

    private fun orderNumber(id: Long, now: Instant): String {
        val date = DateTimeFormatter.ofPattern("yyMMdd").withZone(ZoneId.of("Asia/Shanghai")).format(now)
        return "XH$date${id.toString().padStart(8, '0')}"
    }

    private fun pickupCode(id: Long): String {
        val phrases = listOf("桂花金珠", "月光珍珠", "山茶红玉", "星砂流光", "鸢尾方糖", "晨露钻石")
        return "${100 + id % 900}. ${phrases[(id % phrases.size).toInt()]}"
    }

    private fun randomSuffix(length: Int = 4): String {
        val alphabet = "0123456789ABCDEF"
        return buildString(length) { repeat(length) { append(alphabet[random.nextInt(alphabet.length)]) } }
    }

    private fun shippingFee(): Int = setting("shipping_fee_cents", properties.shippingFeeCents.toString()).toIntOrNull()?.coerceAtLeast(0) ?: properties.shippingFeeCents
    private fun freeShippingThreshold(): Int = setting("free_shipping_threshold_cents", properties.freeShippingThresholdCents.toString()).toIntOrNull()?.coerceAtLeast(0) ?: properties.freeShippingThresholdCents
    private fun setting(key: String, fallback: String): String = settings.findByKey(key)?.value?.trim().takeUnless { it.isNullOrBlank() } ?: fallback

    private fun externalFailure(label: String, error: RuntimeException): ResponseStatusException =
        if (error is ResponseStatusException) error else ResponseStatusException(HttpStatus.BAD_GATEWAY, "$label：${error.message ?: "未知错误"}", error)

    private fun <T> inTransaction(block: () -> T): T = transactions.execute { block() }
        ?: throw IllegalStateException("事务未返回结果")

    private fun <T> inNullableTransaction(block: () -> T?): T? = transactions.execute { block() }

    private fun <T> notFound(message: String): T = throw ResponseStatusException(HttpStatus.NOT_FOUND, message)

    private data class PaymentPreparation(
        val cached: PaymentParamsDto? = null,
        val intentId: Long? = null,
        val order: OrderEntity? = null,
        val openid: String? = null,
        val description: String? = null,
        val intentToCloseId: Long? = null,
        val closeOutTradeNo: String? = null,
    )

    private data class CancellationPreparation(val intentId: Long, val outTradeNo: String)

    private data class PaymentRecoveryClaim(val intentId: Long, val outTradeNo: String, val mustClose: Boolean)

    private enum class RemoteCloseResult { CLOSED, PAID }

    private data class RefundPreparation(
        val order: OrderEntity,
        val outTradeNo: String?,
        val refundId: Long?,
        val outRefundNo: String?,
    )

    private data class RefundPaymentGuard(val intentId: Long, val transactionId: String)

    private companion object {
        val REFUNDABLE_STATUSES = setOf("paid", "preparing", "shipped", "in_transit", "received", "completed")
        val ACTIVE_PAYMENT_STATUSES = setOf("creating", "pending", "closing")
        val PAYMENT_RECOVERY_STATUSES = setOf("creating", "pending")
        val REMOTE_OPEN_PAYMENT_STATUSES = ACTIVE_PAYMENT_STATUSES + "close_required"
        val TERMINAL_PAYMENT_STATUSES = setOf("closed", "failed", "cancelled")
        val PAID_BUSINESS_STATUSES = setOf("paid", "preparing", "shipped", "in_transit", "received", "completed", "refunding")
        val PAYABLE_CALLBACK_STATUSES = setOf("pending_payment", "cancelling", "cancelled", "failed", "refunded")
        const val MAX_PAYMENT_CLOSE_ATTEMPTS = 20
        const val MAX_PAYMENT_RECOVERY_BATCH = 100
        const val PAYMENT_RECOVERY_STALE_AFTER_SECONDS = 5 * 60L
    }
}
