package com.xihong.jewelry.service

import com.fasterxml.jackson.databind.ObjectMapper
import com.google.gson.annotations.SerializedName
import com.wechat.pay.java.core.notification.RequestParam
import com.wechat.pay.java.service.payments.jsapi.JsapiServiceExtension
import com.wechat.pay.java.service.payments.jsapi.model.Amount
import com.wechat.pay.java.service.payments.jsapi.model.CloseOrderRequest
import com.wechat.pay.java.service.payments.jsapi.model.Payer
import com.wechat.pay.java.service.payments.jsapi.model.PrepayRequest
import com.wechat.pay.java.service.payments.jsapi.model.QueryOrderByIdRequest
import com.wechat.pay.java.service.payments.jsapi.model.QueryOrderByOutTradeNoRequest
import com.wechat.pay.java.service.payments.model.Transaction
import com.wechat.pay.java.service.refund.RefundService
import com.wechat.pay.java.service.refund.model.AmountReq
import com.wechat.pay.java.service.refund.model.CreateRequest
import com.wechat.pay.java.service.refund.model.QueryByOutRefundNoRequest
import com.wechat.pay.java.service.refund.model.Refund
import com.xihong.jewelry.config.AppProperties
import com.xihong.jewelry.repository.OrderRepository
import com.xihong.jewelry.repository.PaymentIntentRepository
import com.xihong.jewelry.repository.RefundRepository
import org.springframework.beans.factory.ObjectProvider
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.stereotype.Service
import java.net.URI
import java.time.Instant
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter

@Service
class WechatPayService(
    private val properties: AppProperties,
    private val clients: WechatPayClientProvider,
    private val mapper: ObjectMapper,
    private val paymentIntents: PaymentIntentRepository,
    private val refunds: RefundRepository,
    private val orders: OrderRepository,
    private val callbackInbox: WechatCallbackInboxService,
    // Lazy lookup avoids a constructor cycle because OrderService also calls this payment service.
    private val lifecycle: ObjectProvider<OrderPaymentLifecycle>,
) {
    private val jsapi: JsapiServiceExtension by lazy(LazyThreadSafetyMode.SYNCHRONIZED) {
        JsapiServiceExtension.Builder().config(clients.config()).build()
    }
    private val refundApi: RefundService by lazy(LazyThreadSafetyMode.SYNCHRONIZED) {
        RefundService.Builder().config(clients.config()).build()
    }

    fun createJsapiPrepay(command: JsapiPrepayCommand): JsapiPrepayResult {
        require(command.outTradeNo.matches(Regex("[0-9A-Za-z_-]{6,32}"))) { "商户订单号格式不正确" }
        require(command.description.isNotBlank() && command.description.length <= 127) { "商品描述长度须为1至127个字符" }
        require(command.totalCents > 0) { "微信支付金额必须大于0分" }
        require(command.openid.isNotBlank()) { "支付用户OpenID不能为空" }

        if (clients.isMock()) {
            return JsapiPrepayResult(
                appId = configuredAppId(),
                timeStamp = Instant.now().epochSecond.toString(),
                nonceStr = "mock-${command.outTradeNo}",
                packageValue = "prepay_id=mock_${command.outTradeNo}",
                signType = "RSA",
                paySign = "MOCK",
            )
        }

        val request = PrepayRequest().apply {
            appid = configuredAppId()
            mchid = properties.pay.merchantId
            description = command.description
            outTradeNo = command.outTradeNo
            notifyUrl = callbackUrl(PAYMENT_NOTIFY_PATH)
            timeExpire = command.expiresAt?.toWechatRfc3339()
            attach = command.attach?.takeIf(String::isNotBlank)
            // 发票在确认收货后通过官方抬头接口申请，不在支付凭证提前开放入口。
            supportFapiao = false
            amount = Amount().apply {
                total = command.totalCents
                currency = "CNY"
            }
            payer = Payer().apply { openid = command.openid }
        }
        val response = jsapi.prepayWithRequestPayment(request)
        return JsapiPrepayResult(
            appId = response.appId,
            timeStamp = response.timeStamp,
            nonceStr = response.nonceStr,
            packageValue = response.packageVal,
            signType = response.signType,
            paySign = response.paySign,
        )
    }

    fun queryOrderByOutTradeNo(outTradeNo: String): PaymentOrderSnapshot {
        require(outTradeNo.isNotBlank()) { "商户订单号不能为空" }
        rejectMockOperation()
        val request = QueryOrderByOutTradeNoRequest().apply {
            this.outTradeNo = outTradeNo
            mchid = properties.pay.merchantId
        }
        return jsapi.queryOrderByOutTradeNo(request).toSnapshot()
    }

    fun queryOrderByTransactionId(transactionId: String): PaymentOrderSnapshot {
        require(transactionId.isNotBlank()) { "微信支付订单号不能为空" }
        rejectMockOperation()
        val request = QueryOrderByIdRequest().apply {
            this.transactionId = transactionId
            mchid = properties.pay.merchantId
        }
        return jsapi.queryOrderById(request).toSnapshot()
    }

    fun closeOrder(outTradeNo: String) {
        require(outTradeNo.isNotBlank()) { "商户订单号不能为空" }
        rejectMockOperation()
        jsapi.closeOrder(CloseOrderRequest().apply {
            this.outTradeNo = outTradeNo
            mchid = properties.pay.merchantId
        })
    }

    fun createRefund(command: OriginalRefundCommand): RefundSnapshot {
        require(command.outTradeNo.isNotBlank()) { "商户订单号不能为空" }
        require(command.outRefundNo.matches(Regex("[0-9A-Za-z_-]{6,64}"))) { "商户退款单号格式不正确" }
        require(command.totalCents > 0 && command.refundCents > 0 && command.refundCents <= command.totalCents) { "退款金额不正确" }
        rejectMockOperation()
        val request = CreateRequest().apply {
            outTradeNo = command.outTradeNo
            outRefundNo = command.outRefundNo
            reason = command.reason?.take(80)?.takeIf(String::isNotBlank)
            notifyUrl = callbackUrl(REFUND_NOTIFY_PATH)
            amount = AmountReq().apply {
                refund = command.refundCents
                total = command.totalCents
                currency = "CNY"
            }
        }
        return refundApi.create(request).toSnapshot()
    }

    fun queryRefund(outRefundNo: String): RefundSnapshot {
        require(outRefundNo.isNotBlank()) { "商户退款单号不能为空" }
        rejectMockOperation()
        return refundApi.queryByOutRefundNo(QueryByOutRefundNoRequest().apply { this.outRefundNo = outRefundNo }).toSnapshot()
    }

    fun parsePaymentNotification(headers: WechatCallbackHeaders, body: String): ParsedPaymentNotification {
        val transaction = verifyAndDecrypt(headers, body, Transaction::class.java)
        val envelope = parseEnvelope(body)
        if (envelope.eventType != "TRANSACTION.SUCCESS") throw WechatCallbackRejectedException("不支持的支付通知类型")
        validateMerchant(transaction.appid, transaction.mchid)
        if (transaction.tradeState?.name != "SUCCESS") throw WechatCallbackRejectedException("支付通知状态不是SUCCESS")
        return ParsedPaymentNotification(envelope, transaction.toSnapshot())
    }

    fun parseRefundNotification(headers: WechatCallbackHeaders, body: String): ParsedRefundNotification {
        val notification = verifyAndDecrypt(headers, body, RefundNotificationResource::class.java)
        val envelope = parseEnvelope(body)
        if (envelope.eventType !in REFUND_EVENTS) throw WechatCallbackRejectedException("不支持的退款通知类型")
        validateMerchant(null, notification.mchid)
        val status = notification.refundStatus.orEmpty()
        if (status !in REFUND_STATUSES) throw WechatCallbackRejectedException("未知退款状态")
        return ParsedRefundNotification(envelope, notification.toSnapshot())
    }

    /** Verify/decrypt first, then atomically update the payment ledger and order lifecycle. */
    fun acceptPaymentNotification(headers: WechatCallbackHeaders, body: String): ParsedPaymentNotification {
        val parsed = parsePaymentNotification(headers, body)
        val registration = registerInbox(parsed.envelope, headers, body)
        if (registration.alreadyProcessed) return parsed
        return try {
            callbackInbox.process(CALLBACK_SOURCE, parsed.envelope.id) {
                val snapshot = parsed.payment
                val intent = paymentIntents.findByOutTradeNo(snapshot.outTradeNo)
                    ?: throw WechatCallbackRejectedException("商户支付单不存在")
                val order = orders.findById(intent.orderId).orElseThrow { WechatCallbackRejectedException("支付订单不存在") }
                if (snapshot.totalCents != order.totalCents || snapshot.currency != "CNY") {
                    throw WechatCallbackRejectedException("支付金额或币种不一致")
                }
                val transactionId = snapshot.transactionId?.takeIf(String::isNotBlank)
                    ?: throw WechatCallbackRejectedException("支付通知缺少transaction_id")
                paymentIntents.findByTransactionId(transactionId)?.let {
                    if (it.id != intent.id) throw WechatCallbackRejectedException("微信支付订单号已绑定其他流水")
                }
                intent.status = "succeeded"
                intent.transactionId = transactionId
                intent.notifiedAt = Instant.now()
                intent.updatedAt = Instant.now()
                paymentIntents.save(intent)
                // Different event IDs can report the same successful transaction. The lifecycle
                // owns business idempotency under its order lock, so always let it repair any
                // partially applied local state.
                lifecycle.getObject().paymentSucceeded(intent.orderId, intent.transactionId, snapshot.successTime?.toInstant())
            }
            parsed
        } catch (error: Exception) {
            // process() has completed rollback before this call, so this retry marker cannot
            // deadlock with the callback row's processing lock.
            callbackInbox.markFailed(CALLBACK_SOURCE, parsed.envelope.id, error)
            throw error
        }
    }

    /** Refund notifications intentionally do not require amount.currency: the official resource has no such field. */
    fun acceptRefundNotification(headers: WechatCallbackHeaders, body: String): ParsedRefundNotification {
        val parsed = parseRefundNotification(headers, body)
        val registration = registerInbox(parsed.envelope, headers, body)
        if (registration.alreadyProcessed) return parsed
        return try {
            callbackInbox.process(CALLBACK_SOURCE, parsed.envelope.id) {
                val snapshot = parsed.refund
                val refund = refunds.findByOutRefundNo(snapshot.outRefundNo)
                    ?: throw WechatCallbackRejectedException("商户退款单不存在")
                val order = orders.findById(refund.orderId).orElseThrow { WechatCallbackRejectedException("退款订单不存在") }
                val payment = refund.paymentIntentId?.let { paymentIntents.findById(it).orElse(null) }
                    ?: paymentIntents.findFirstByOrderIdAndStatusOrderByCreatedAtDesc(order.id!!, "succeeded")
                    ?: throw WechatCallbackRejectedException("原支付流水不存在")
                if (snapshot.outTradeNo != payment.outTradeNo ||
                    (payment.transactionId.isNotBlank() && snapshot.transactionId != payment.transactionId) ||
                    snapshot.totalCents != order.totalCents.toLong() || snapshot.refundCents != refund.amountCents.toLong()
                ) {
                    throw WechatCallbackRejectedException("退款关联订单或金额不一致")
                }
                val previous = refund.status
                refund.refundId = snapshot.refundId ?: refund.refundId
                refund.status = snapshot.status.lowercase()
                refund.updatedAt = Instant.now()
                refunds.save(refund)
                when (snapshot.status) {
                    "SUCCESS" -> lifecycle.getObject().refundSucceeded(refund.orderId, refund.id, refund.refundId, snapshot.successTime?.toInstant())
                    "CLOSED", "ABNORMAL" -> if (previous != refund.status) {
                        lifecycle.getObject().refundFailed(refund.orderId, refund.previousStatus, snapshot.status)
                    }
                }
            }
            parsed
        } catch (error: Exception) {
            callbackInbox.markFailed(CALLBACK_SOURCE, parsed.envelope.id, error)
            throw error
        }
    }

    private fun registerInbox(
        envelope: WechatNotificationEnvelope,
        headers: WechatCallbackHeaders,
        body: String,
    ): CallbackInboxRegistration = try {
        callbackInbox.register(CALLBACK_SOURCE, envelope.id, envelope.eventType, headers.requestId, body)
    } catch (_: DataIntegrityViolationException) {
        callbackInbox.find(CALLBACK_SOURCE, envelope.id)
            ?: throw WechatCallbackRejectedException("回调幂等记录冲突")
    }

    private fun parseEnvelope(body: String): WechatNotificationEnvelope = runCatching {
        val root = mapper.readTree(body)
        WechatNotificationEnvelope(
            id = root.path("id").asText().takeIf { it.isNotBlank() && it.length <= 160 }
                ?: throw IllegalArgumentException("通知ID无效"),
            createTime = parseOffsetDateTime(root.path("create_time").asText()),
            eventType = root.path("event_type").asText().ifBlank { throw IllegalArgumentException("缺少通知类型") },
            resourceType = root.path("resource_type").asText(),
            summary = root.path("summary").asText(),
        )
    }.getOrElse { throw WechatCallbackRejectedException("通知报文格式错误", it) }

    private fun <T> verifyAndDecrypt(headers: WechatCallbackHeaders, body: String, type: Class<T>): T = runCatching {
        clients.notifications().parse(headers.toRequestParam(body), type)
    }.getOrElse { throw WechatCallbackRejectedException("通知验签或解密失败", it) }

    private fun validateMerchant(appId: String?, merchantId: String?) {
        if (appId != null && appId != configuredAppId()) throw WechatCallbackRejectedException("通知AppID不匹配")
        if (merchantId != properties.pay.merchantId) throw WechatCallbackRejectedException("通知商户号不匹配")
    }

    private fun configuredAppId(): String = properties.pay.appId.ifBlank { properties.wechat.appId }
        .ifBlank { throw WechatPayConfigurationException("WX_PAY_APPID或WECHAT_APPID未配置") }

    private fun rejectMockOperation() {
        if (clients.isMock()) throw WechatPayConfigurationException("模拟支付模式不能调用微信支付API")
    }

    private fun Transaction.toSnapshot(): PaymentOrderSnapshot = PaymentOrderSnapshot(
        outTradeNo = outTradeNo,
        transactionId = transactionId,
        tradeState = tradeState?.name ?: "",
        tradeStateDesc = tradeStateDesc,
        bankType = bankType,
        successTime = parseOffsetDateTimeOrNull(successTime),
        totalCents = amount?.total,
        payerTotalCents = amount?.payerTotal,
        currency = amount?.currency,
    )

    private fun Refund.toSnapshot(): RefundSnapshot = RefundSnapshot(
        outRefundNo = outRefundNo,
        refundId = refundId,
        outTradeNo = outTradeNo,
        transactionId = transactionId,
        status = status?.name ?: "",
        channel = channel?.name,
        userReceivedAccount = userReceivedAccount,
        successTime = parseOffsetDateTimeOrNull(successTime),
        refundCents = amount?.refund ?: 0,
        totalCents = amount?.total ?: 0,
        payerRefundCents = amount?.payerRefund,
        payerTotalCents = amount?.payerTotal,
    )

    private fun RefundNotificationResource.toSnapshot(): RefundSnapshot = RefundSnapshot(
        outRefundNo = outRefundNo.orEmpty(),
        refundId = refundId,
        outTradeNo = outTradeNo,
        transactionId = transactionId,
        status = refundStatus.orEmpty(),
        channel = channel,
        userReceivedAccount = userReceivedAccount,
        successTime = parseOffsetDateTimeOrNull(successTime),
        refundCents = amount?.refund ?: 0,
        totalCents = amount?.total ?: 0,
        payerRefundCents = amount?.payerRefund,
        payerTotalCents = amount?.payerTotal,
    )

    private fun parseOffsetDateTime(value: String): OffsetDateTime = OffsetDateTime.parse(value, DateTimeFormatter.ISO_OFFSET_DATE_TIME)
    private fun parseOffsetDateTimeOrNull(value: String?): OffsetDateTime? = value?.takeIf(String::isNotBlank)?.let {
        runCatching { parseOffsetDateTime(it) }.getOrNull()
    }

    internal fun callbackUrl(path: String): String {
        val value = "${properties.publicBaseUrl.trimEnd('/')}$path"
        val uri = runCatching { URI(value) }.getOrElse {
            throw WechatPayConfigurationException("PUBLIC_BASE_URL格式不正确")
        }
        if (properties.production && (!uri.scheme.equals("https", ignoreCase = true) || uri.host.isNullOrBlank())) {
            throw WechatPayConfigurationException("生产环境支付回调地址必须是公网HTTPS地址")
        }
        return value
    }

    private companion object {
        const val PAYMENT_NOTIFY_PATH = "/payments/wechat/notify"
        const val REFUND_NOTIFY_PATH = "/payments/wechat/refund-notify"
        const val CALLBACK_SOURCE = "wechat_pay_apiv3"
        val REFUND_EVENTS = setOf("REFUND.SUCCESS", "REFUND.ABNORMAL", "REFUND.CLOSED")
        val REFUND_STATUSES = setOf("SUCCESS", "ABNORMAL", "CLOSED", "PROCESSING")
    }
}

interface OrderPaymentLifecycle {
    fun paymentSucceeded(orderId: Long, transactionId: String, paidAt: Instant?)
    fun refundSucceeded(orderId: Long, refundRecordId: Long?, refundId: String, refundedAt: Instant?)
    fun refundFailed(orderId: Long, previousStatus: String, reason: String)
}

data class JsapiPrepayCommand(
    val outTradeNo: String,
    val description: String,
    val totalCents: Int,
    val openid: String,
    val attach: String? = null,
    val expiresAt: OffsetDateTime? = null,
)

data class JsapiPrepayResult(
    val appId: String,
    val timeStamp: String,
    val nonceStr: String,
    val packageValue: String,
    val signType: String,
    val paySign: String,
)

data class OriginalRefundCommand(
    val outTradeNo: String,
    val outRefundNo: String,
    val totalCents: Long,
    val refundCents: Long,
    val reason: String? = null,
)

data class PaymentOrderSnapshot(
    val outTradeNo: String,
    val transactionId: String?,
    val tradeState: String,
    val tradeStateDesc: String?,
    val bankType: String?,
    val successTime: OffsetDateTime?,
    val totalCents: Int?,
    val payerTotalCents: Int?,
    val currency: String?,
)

data class RefundSnapshot(
    val outRefundNo: String,
    val refundId: String?,
    val outTradeNo: String?,
    val transactionId: String?,
    val status: String,
    val channel: String?,
    val userReceivedAccount: String?,
    val successTime: OffsetDateTime?,
    val refundCents: Long,
    val totalCents: Long,
    val payerRefundCents: Long?,
    val payerTotalCents: Long?,
)

data class WechatCallbackHeaders(
    val serial: String,
    val signature: String,
    val timestamp: String,
    val nonce: String,
    val requestId: String = "",
) {
    fun toRequestParam(body: String): RequestParam = RequestParam.Builder()
        .serialNumber(serial)
        .signature(signature)
        .timestamp(timestamp)
        .nonce(nonce)
        .body(body)
        .build()
}

data class WechatNotificationEnvelope(
    val id: String,
    val createTime: OffsetDateTime,
    val eventType: String,
    val resourceType: String,
    val summary: String,
)

data class ParsedPaymentNotification(val envelope: WechatNotificationEnvelope, val payment: PaymentOrderSnapshot)
data class ParsedRefundNotification(val envelope: WechatNotificationEnvelope, val refund: RefundSnapshot)

class WechatCallbackRejectedException(message: String, cause: Throwable? = null) : RuntimeException(message, cause)

/** Exact decrypted APIv3 refund resource. The official refund callback amount has no currency field. */
class RefundNotificationResource {
    var mchid: String? = null
    @SerializedName("out_trade_no") var outTradeNo: String? = null
    @SerializedName("transaction_id") var transactionId: String? = null
    @SerializedName("out_refund_no") var outRefundNo: String? = null
    @SerializedName("refund_id") var refundId: String? = null
    @SerializedName("refund_status") var refundStatus: String? = null
    @SerializedName("success_time") var successTime: String? = null
    @SerializedName("user_received_account") var userReceivedAccount: String? = null
    var channel: String? = null
    var amount: RefundNotificationAmount? = null
}

class RefundNotificationAmount {
    var total: Long? = null
    var refund: Long? = null
    @SerializedName("payer_total") var payerTotal: Long? = null
    @SerializedName("payer_refund") var payerRefund: Long? = null
}
