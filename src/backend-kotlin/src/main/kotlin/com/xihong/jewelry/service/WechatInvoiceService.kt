package com.xihong.jewelry.service

import com.fasterxml.jackson.databind.ObjectMapper
import com.google.gson.annotations.SerializedName
import com.wechat.pay.java.core.http.Constant
import com.wechat.pay.java.core.http.FileRequestBody
import com.wechat.pay.java.core.http.HttpHeaders
import com.wechat.pay.java.core.http.HttpMethod
import com.wechat.pay.java.core.http.HttpRequest
import com.wechat.pay.java.core.http.JsonRequestBody
import com.wechat.pay.java.core.http.MediaType
import com.xihong.jewelry.config.AppProperties
import org.bouncycastle.crypto.digests.SM3Digest
import org.springframework.beans.factory.ObjectProvider
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.stereotype.Service
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.util.HexFormat

/** Official ordinary-merchant electronic invoice APIs (APIv3). */
@Service
class WechatInvoiceService(
    private val properties: AppProperties,
    private val clients: WechatPayClientProvider,
    private val mapper: ObjectMapper,
    private val callbackInbox: WechatCallbackInboxService,
    private val lifecycle: ObjectProvider<InvoiceLifecycle>,
) {
    fun acquireTitleForm(command: InvoiceTitleFormCommand): InvoiceTitleLink {
        requireApplyId(command.fapiaoApplyId)
        require(command.openid.isNotBlank()) { "用户OpenID不能为空" }
        require(command.totalAmount > 0) { "开票金额必须大于0分" }
        rejectMockOperation()

        val query = linkedMapOf(
            "fapiao_apply_id" to command.fapiaoApplyId,
            "appid" to configuredAppId(),
            "openid" to command.openid,
            "total_amount" to command.totalAmount.toString(),
            "seller_name" to (command.sellerName ?: properties.companyNameZh).take(32),
            "show_phone_cell" to command.showPhoneCell.toString(),
            "must_input_phone" to command.mustInputPhone.toString(),
            "show_email_cell" to command.showEmailCell.toString(),
            "must_input_email" to command.mustInputEmail.toString(),
            "source" to "MINIPROGRAM",
        )
        val response = get(
            "/v3/new-tax-control-fapiao/user-title/title-url",
            query,
            InvoiceTitleLinkResponse::class.java,
        )
        val appId = response.miniprogramAppid?.takeIf(String::isNotBlank)
            ?: throw WechatPayConfigurationException("微信支付未返回抬头填写小程序AppID")
        val path = response.miniprogramPath?.takeIf(String::isNotBlank)
            ?: throw WechatPayConfigurationException("微信支付未返回抬头填写小程序路径")
        return InvoiceTitleLink(appId, path)
    }

    fun queryTitle(
        fapiaoApplyId: String,
        scene: InvoiceScene = InvoiceScene.WITHOUT_WECHATPAY,
    ): InvoiceTitleSnapshot {
        requireApplyId(fapiaoApplyId)
        rejectMockOperation()
        val response = get(
            "/v3/new-tax-control-fapiao/user-title",
            linkedMapOf("fapiao_apply_id" to fapiaoApplyId, "scene" to scene.name),
            InvoiceTitleResponse::class.java,
        )
        val type = response.type?.takeIf { it == "INDIVIDUAL" || it == "ORGANIZATION" }
            ?: throw WechatPayConfigurationException("微信支付返回了未知购买方类型")
        val name = response.name?.takeIf(String::isNotBlank)
            ?: throw WechatPayConfigurationException("微信支付返回的发票抬头名称为空")
        return InvoiceTitleSnapshot(
            type = type,
            name = name,
            taxpayerId = response.taxpayerId,
            address = response.address,
            telephone = response.telephone,
            bankName = response.bankName,
            bankAccount = response.bankAccount,
            phone = decryptSensitive(response.phone),
            email = decryptSensitive(response.email),
        )
    }

    /** Uploads the real PDF (2 MiB maximum) and submits it for asynchronous insertion into Wallet. */
    fun deliver(command: InvoiceDeliveryCommand, pdf: ByteArray): InvoiceDeliveryReceipt {
        validateDelivery(command, pdf)
        rejectMockOperation()
        val mediaId = uploadPdf(pdf, command.fileName)
        insertCard(command, mediaId)
        return InvoiceDeliveryReceipt(
            fapiaoApplyId = command.fapiaoApplyId,
            fapiaoMediaId = mediaId,
            acceptedAt = Instant.now(),
            cardStatus = "INSERT_ACCEPTED",
        )
    }

    /** Queries the authoritative invoice/card state after an asynchronous insert request. */
    fun status(fapiaoApplyId: String, fapiaoId: String? = null): InvoiceDeliveryStatus {
        requireApplyId(fapiaoApplyId)
        fapiaoId?.takeIf(String::isNotBlank)?.let(::requireFapiaoId)
        rejectMockOperation()
        val query = fapiaoId?.takeIf(String::isNotBlank)?.let { mapOf("fapiao_id" to it) }.orEmpty()
        val response = get(
            "/v3/new-tax-control-fapiao/fapiao-applications/${encode(fapiaoApplyId)}",
            query,
            InvoiceStatusResponse::class.java,
        )
        val invoices = response.fapiaoInformation.orEmpty().map {
            InvoiceStatusItem(
                fapiaoId = it.fapiaoId.orEmpty(),
                fapiaoStatus = it.status.orEmpty(),
                cardStatus = it.cardInformation?.cardStatus,
                cardId = it.cardInformation?.cardId,
                cardCode = it.cardInformation?.cardCode,
                totalAmount = it.totalAmount,
                taxAmount = it.taxAmount,
                amount = it.amount,
            )
        }
        return InvoiceDeliveryStatus(response.totalCount ?: invoices.size, invoices)
    }

    fun parseNotification(headers: WechatCallbackHeaders, body: String): InvoiceNotificationSnapshot {
        val envelope = parseEnvelope(body)
        return when (envelope.eventType) {
            TITLE_APPLIED_EVENT -> {
                val resource = verifyAndDecrypt(headers, body, InvoiceTitleNotificationResource::class.java)
                validateMerchant(resource.mchid)
                InvoiceNotificationSnapshot(
                    envelope = envelope,
                    fapiaoApplyId = resource.fapiaoApplyId.orEmpty().also(::requireApplyId),
                    applyTime = parseOffsetDateTimeOrNull(resource.applyTime),
                    invoices = emptyList(),
                )
            }
            INVOICE_ISSUED_EVENT, INVOICE_REVERSED_EVENT, CARD_INSERTED_EVENT, CARD_DISCARDED_EVENT -> {
                val resource = verifyAndDecrypt(headers, body, InvoiceCardNotificationResource::class.java)
                validateMerchant(resource.mchid)
                InvoiceNotificationSnapshot(
                    envelope = envelope,
                    fapiaoApplyId = resource.fapiaoApplyId.orEmpty().also(::requireApplyId),
                    applyTime = null,
                    invoices = resource.fapiaoInformation.orEmpty().map {
                        InvoiceStatusItem(
                            fapiaoId = it.fapiaoId.orEmpty(),
                            fapiaoStatus = it.fapiaoStatus.orEmpty(),
                            cardStatus = it.cardStatus,
                        )
                    },
                )
            }
            else -> throw WechatCallbackRejectedException("不支持的微信发票通知类型")
        }
    }

    fun acceptNotification(headers: WechatCallbackHeaders, body: String): InvoiceNotificationSnapshot {
        val parsed = parseNotification(headers, body)
        val registration = try {
            callbackInbox.register(
                INVOICE_CALLBACK_SOURCE,
                parsed.envelope.id,
                parsed.envelope.eventType,
                headers.requestId,
                body,
            )
        } catch (_: DataIntegrityViolationException) {
            callbackInbox.find(INVOICE_CALLBACK_SOURCE, parsed.envelope.id)
                ?: throw WechatCallbackRejectedException("发票回调幂等记录冲突")
        }
        if (registration.alreadyProcessed) return parsed
        return try {
            callbackInbox.process(INVOICE_CALLBACK_SOURCE, parsed.envelope.id) {
                val handler = lifecycle.getIfAvailable()
                    ?: throw IllegalStateException("微信发票回调业务处理器不可用")
                handler.invoiceNotification(parsed)
            }
            parsed
        } catch (error: Exception) {
            // process() has already rolled its transaction back at this point, so recording the
            // retryable failure cannot deadlock on the callback row lock.
            callbackInbox.markFailed(INVOICE_CALLBACK_SOURCE, parsed.envelope.id, error)
            throw error
        }
    }

    private fun uploadPdf(pdf: ByteArray, fileName: String): String {
        val digest = SM3Digest()
        digest.update(pdf, 0, pdf.size)
        val digestBytes = ByteArray(digest.digestSize)
        digest.doFinal(digestBytes, 0)
        val meta = mapper.writeValueAsString(
            mapOf(
                "file_type" to "PDF",
                // The misspelling is the exact official API field name.
                "digest_alogrithm" to "SM3",
                "digest" to HexFormat.of().formatHex(digestBytes),
            ),
        )
        val request = HttpRequest.Builder()
            .addHeader(Constant.ACCEPT, MediaType.APPLICATION_JSON.value)
            .addHeader(Constant.CONTENT_TYPE, MediaType.MULTIPART_FORM_DATA.value)
            .httpMethod(HttpMethod.POST)
            .url("$API_HOST/v3/new-tax-control-fapiao/fapiao-applications/upload-fapiao-file")
            .body(
                FileRequestBody.Builder()
                    .meta(meta)
                    .fileName(fileName.takeIf(String::isNotBlank) ?: "invoice.pdf")
                    .file(pdf)
                    .build(),
            )
            .build()
        val response = clients.http().execute(request, InvoiceUploadResponse::class.java).serviceResponse
        return response.fapiaoMediaId?.takeIf(String::isNotBlank)
            ?: throw WechatPayConfigurationException("微信支付未返回电子发票文件ID")
    }

    private fun insertCard(command: InvoiceDeliveryCommand, mediaId: String) {
        val encryptor = clients.config().createEncryptor()
        val buyer = command.buyer
        val card = command.card
        val buyerBody = linkedMapOf<String, Any>(
            "type" to buyer.type,
            "name" to buyer.name,
        ).apply {
            buyer.taxpayerId?.takeIf(String::isNotBlank)?.let { put("taxpayer_id", it) }
            buyer.address?.takeIf(String::isNotBlank)?.let { put("address", it) }
            buyer.telephone?.takeIf(String::isNotBlank)?.let { put("telephone", it) }
            buyer.bankName?.takeIf(String::isNotBlank)?.let { put("bank_name", it) }
            buyer.bankAccount?.takeIf(String::isNotBlank)?.let { put("bank_account", it) }
            buyer.phone?.takeIf(String::isNotBlank)?.let { put("phone", encryptor.encrypt(it)) }
            buyer.email?.takeIf(String::isNotBlank)?.let { put("email", encryptor.encrypt(it)) }
        }
        val sellerBody = linkedMapOf<String, Any>(
            "name" to card.seller.name,
            "taxpayer_id" to card.seller.taxpayerId,
        ).apply {
            card.seller.address?.takeIf(String::isNotBlank)?.let { put("address", it) }
            card.seller.telephone?.takeIf(String::isNotBlank)?.let { put("telephone", it) }
            card.seller.bankName?.takeIf(String::isNotBlank)?.let { put("bank_name", it) }
            card.seller.bankAccount?.takeIf(String::isNotBlank)?.let { put("bank_account", it) }
        }
        val cardBody = linkedMapOf<String, Any>(
            "fapiao_media_id" to mediaId,
            "fapiao_number" to card.fapiaoNumber,
            "fapiao_code" to card.fapiaoCode,
            "fapiao_time" to card.fapiaoTime.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME),
            "check_code" to card.checkCode,
            "password" to card.password,
            "total_amount" to card.totalAmount,
            "tax_amount" to card.taxAmount,
            "amount" to card.amount,
            "seller_information" to sellerBody,
            "extra_information" to linkedMapOf<String, Any>("drawer" to card.extra.drawer).apply {
                card.extra.payee?.takeIf(String::isNotBlank)?.let { put("payee", it) }
                card.extra.reviewer?.takeIf(String::isNotBlank)?.let { put("reviewer", it) }
            },
        ).apply {
            if (card.items.isNotEmpty()) put("items", card.items.map(::itemBody))
            card.remark?.takeIf(String::isNotBlank)?.let { put("remark", it) }
        }
        val body = mapper.writeValueAsString(
            mapOf(
                "scene" to command.scene.name,
                "buyer_information" to buyerBody,
                "fapiao_card_information" to listOf(cardBody),
            ),
        )
        val headers = HttpHeaders().apply {
            addHeader(Constant.ACCEPT, MediaType.APPLICATION_JSON.value)
            addHeader(Constant.CONTENT_TYPE, MediaType.APPLICATION_JSON.value)
            addHeader(Constant.WECHAT_PAY_SERIAL, encryptor.wechatpaySerial)
        }
        val request = HttpRequest.Builder()
            .httpMethod(HttpMethod.POST)
            .url("$API_HOST/v3/new-tax-control-fapiao/fapiao-applications/${encode(command.fapiaoApplyId)}/insert-cards")
            .headers(headers)
            .body(JsonRequestBody.Builder().body(body).build())
            .build()
        clients.http().execute<Any>(request, null)
    }

    private fun itemBody(item: InvoiceLineItem): Map<String, Any> = linkedMapOf(
        "tax_code" to item.taxCode,
        "goods_name" to item.goodsName,
        "quantity" to item.quantity,
        "unit_price" to item.unitPrice,
        "amount" to item.amount,
        "tax_amount" to item.taxAmount,
        "total_amount" to item.totalAmount,
        "tax_rate" to item.taxRate,
        "discount" to item.discount,
    ).apply {
        item.specification?.takeIf(String::isNotBlank)?.let { put("specification", it) }
        item.unit?.takeIf(String::isNotBlank)?.let { put("unit", it) }
        item.taxPreferMark?.takeIf(String::isNotBlank)?.let { put("tax_prefer_mark", it) }
    }

    fun validateDelivery(command: InvoiceDeliveryCommand, pdf: ByteArray) {
        requireApplyId(command.fapiaoApplyId)
        require(pdf.size in 5..MAX_PDF_BYTES) { "电子发票PDF必须小于等于2MB" }
        require(pdf.copyOfRange(0, 5).contentEquals("%PDF-".toByteArray(StandardCharsets.US_ASCII))) {
            "上传文件不是有效的PDF"
        }
        val buyer = command.buyer
        require(buyer.type == "INDIVIDUAL" || buyer.type == "ORGANIZATION") { "购买方类型无效" }
        require(buyer.name.isNotBlank() && buyer.name.length <= 256) { "购买方名称不能为空且不得超过256字符" }
        if (buyer.type == "ORGANIZATION") require(!buyer.taxpayerId.isNullOrBlank()) { "单位抬头必须填写纳税人识别号" }
        val card = command.card
        require(card.fapiaoNumber.isNotBlank() && card.fapiaoNumber.length <= 8) { "发票号码不能为空且不得超过8位" }
        require(card.fapiaoCode.isNotBlank() && card.fapiaoCode.length <= 12) { "发票代码不能为空且不得超过12位" }
        require(card.checkCode.isNotBlank() && card.checkCode.length <= 20) { "校验码不能为空且不得超过20位" }
        require(card.password.isNotBlank() && card.password.length <= 1024) { "发票密码区不能为空且不得超过1024位" }
        require(card.totalAmount > 0 && card.taxAmount >= 0 && card.amount >= 0 && card.amount + card.taxAmount == card.totalAmount) {
            "发票金额不正确：价税合计必须等于金额与税额之和"
        }
        require(card.seller.name.isNotBlank() && card.seller.taxpayerId.isNotBlank()) { "销售方名称和纳税人识别号不能为空" }
        require(card.extra.drawer.isNotBlank() && card.extra.drawer.length <= 20) { "开票人不能为空且不得超过20字符" }
        require(card.items.size <= 100) { "发票行数量过多" }
    }

    private fun <T> get(path: String, query: Map<String, String>, responseType: Class<T>): T {
        val suffix = query.takeIf(Map<String, String>::isNotEmpty)?.entries?.joinToString("&", prefix = "?") {
            "${encode(it.key)}=${encode(it.value)}"
        }.orEmpty()
        val headers = HttpHeaders().apply { addHeader(Constant.ACCEPT, MediaType.APPLICATION_JSON.value) }
        return clients.http().get(headers, "$API_HOST$path$suffix", responseType).serviceResponse
    }

    private fun <T> verifyAndDecrypt(headers: WechatCallbackHeaders, body: String, type: Class<T>): T = runCatching {
        clients.notifications().parse(headers.toRequestParam(body), type)
    }.getOrElse { throw WechatCallbackRejectedException("微信发票通知验签或解密失败", it) }

    private fun parseEnvelope(body: String): WechatNotificationEnvelope = runCatching {
        val root = mapper.readTree(body)
        WechatNotificationEnvelope(
            id = root.path("id").asText().takeIf { it.isNotBlank() && it.length <= 160 }
                ?: throw IllegalArgumentException("通知ID无效"),
            createTime = OffsetDateTime.parse(root.path("create_time").asText(), DateTimeFormatter.ISO_OFFSET_DATE_TIME),
            eventType = root.path("event_type").asText().ifBlank { throw IllegalArgumentException("缺少通知类型") },
            resourceType = root.path("resource_type").asText(),
            summary = root.path("summary").asText(),
        )
    }.getOrElse { throw WechatCallbackRejectedException("微信发票通知报文格式错误", it) }

    private fun decryptSensitive(value: String?): String? {
        if (value.isNullOrBlank()) return null
        return runCatching { clients.config().createDecryptor().decrypt(value) }
            .getOrElse { throw WechatPayConfigurationException("微信发票敏感字段解密失败", it) }
    }

    private fun validateMerchant(merchantId: String?) {
        if (merchantId != properties.pay.merchantId) throw WechatCallbackRejectedException("发票通知商户号不匹配")
    }

    private fun requireApplyId(value: String) {
        require(value.length in 1..32 && value.all { it.isLetterOrDigit() || it in "-_|*" }) {
            "发票申请单号仅支持1至32位字母、数字、-、_、|、*"
        }
    }

    private fun requireFapiaoId(value: String) {
        require(value.length in 1..32) { "商户发票单号长度须为1至32位" }
    }

    private fun configuredAppId(): String = properties.pay.appId.ifBlank { properties.wechat.appId }
        .ifBlank { throw WechatPayConfigurationException("WX_PAY_APPID或WECHAT_APPID未配置") }

    private fun rejectMockOperation() {
        if (clients.isMock()) throw WechatPayConfigurationException("模拟支付模式不能调用微信电子发票API")
    }

    private fun parseOffsetDateTimeOrNull(value: String?): OffsetDateTime? = value?.takeIf(String::isNotBlank)?.let {
        runCatching { OffsetDateTime.parse(it, DateTimeFormatter.ISO_OFFSET_DATE_TIME) }.getOrNull()
    }

    private fun encode(value: String): String = URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20")

    private companion object {
        const val API_HOST = "https://api.mch.weixin.qq.com"
        const val MAX_PDF_BYTES = 2 * 1024 * 1024
        const val INVOICE_CALLBACK_SOURCE = "wechat_invoice_apiv3"
        const val TITLE_APPLIED_EVENT = "FAPIAO.USER_APPLIED"
        const val INVOICE_ISSUED_EVENT = "FAPIAO.ISSUED"
        const val INVOICE_REVERSED_EVENT = "FAPIAO.REVERSED"
        const val CARD_INSERTED_EVENT = "FAPIAO.CARD_INSERTED"
        const val CARD_DISCARDED_EVENT = "FAPIAO.CARD_DISCARDED"
    }
}

data class InvoiceTitleFormCommand(
    val fapiaoApplyId: String,
    val openid: String,
    val totalAmount: Long,
    val sellerName: String? = null,
    val showPhoneCell: Boolean = true,
    val mustInputPhone: Boolean = false,
    val showEmailCell: Boolean = true,
    val mustInputEmail: Boolean = false,
)

/** Valid for 30 minutes; callers should return it directly rather than persist it long-term. */
data class InvoiceTitleLink(val appId: String, val path: String)

enum class InvoiceScene { WITH_WECHATPAY, WITHOUT_WECHATPAY }

data class InvoiceTitleSnapshot(
    val type: String,
    val name: String,
    val taxpayerId: String?,
    val address: String?,
    val telephone: String?,
    val bankName: String?,
    val bankAccount: String?,
    val phone: String?,
    val email: String?,
)

data class InvoiceDeliveryCommand(
    val fapiaoApplyId: String,
    val scene: InvoiceScene,
    val buyer: InvoiceBuyerInformation,
    val card: InvoiceCardInformation,
    val fileName: String = "invoice.pdf",
)

data class InvoiceBuyerInformation(
    val type: String,
    val name: String,
    val taxpayerId: String? = null,
    val address: String? = null,
    val telephone: String? = null,
    val bankName: String? = null,
    val bankAccount: String? = null,
    val phone: String? = null,
    val email: String? = null,
)

data class InvoiceCardInformation(
    val fapiaoNumber: String,
    val fapiaoCode: String,
    val fapiaoTime: OffsetDateTime,
    val checkCode: String,
    val password: String,
    val totalAmount: Long,
    val taxAmount: Long,
    val amount: Long,
    val seller: InvoiceSellerInformation,
    val extra: InvoiceExtraInformation,
    val items: List<InvoiceLineItem> = emptyList(),
    val remark: String? = null,
)

data class InvoiceSellerInformation(
    val name: String,
    val taxpayerId: String,
    val address: String? = null,
    val telephone: String? = null,
    val bankName: String? = null,
    val bankAccount: String? = null,
)

data class InvoiceExtraInformation(
    val drawer: String,
    val payee: String? = null,
    val reviewer: String? = null,
)

data class InvoiceLineItem(
    val taxCode: String,
    val goodsName: String,
    val specification: String? = null,
    val unit: String? = null,
    val quantity: Long,
    val unitPrice: Long,
    val amount: Long,
    val taxAmount: Long,
    val totalAmount: Long,
    val taxRate: Int,
    val taxPreferMark: String? = null,
    val discount: Boolean = false,
)

data class InvoiceDeliveryReceipt(
    val fapiaoApplyId: String,
    val fapiaoMediaId: String,
    val acceptedAt: Instant,
    val cardStatus: String,
)

data class InvoiceDeliveryStatus(val totalCount: Int, val invoices: List<InvoiceStatusItem>)

data class InvoiceStatusItem(
    val fapiaoId: String,
    val fapiaoStatus: String,
    val cardStatus: String?,
    val cardId: String? = null,
    val cardCode: String? = null,
    val totalAmount: Long? = null,
    val taxAmount: Long? = null,
    val amount: Long? = null,
)

data class InvoiceNotificationSnapshot(
    val envelope: WechatNotificationEnvelope,
    val fapiaoApplyId: String,
    val applyTime: OffsetDateTime?,
    val invoices: List<InvoiceStatusItem>,
)

interface InvoiceLifecycle {
    fun invoiceNotification(notification: InvoiceNotificationSnapshot)
}

private class InvoiceTitleLinkResponse {
    @SerializedName("miniprogram_appid") var miniprogramAppid: String? = null
    @SerializedName("miniprogram_path") var miniprogramPath: String? = null
}

private class InvoiceTitleResponse {
    var type: String? = null
    var name: String? = null
    @SerializedName("taxpayer_id") var taxpayerId: String? = null
    var address: String? = null
    var telephone: String? = null
    @SerializedName("bank_name") var bankName: String? = null
    @SerializedName("bank_account") var bankAccount: String? = null
    var phone: String? = null
    var email: String? = null
}

private class InvoiceUploadResponse {
    @SerializedName("fapiao_media_id") var fapiaoMediaId: String? = null
}

private class InvoiceStatusResponse {
    @SerializedName("total_count") var totalCount: Int? = null
    @SerializedName("fapiao_information") var fapiaoInformation: List<InvoiceStatusResource>? = null
}

private class InvoiceStatusResource {
    @SerializedName("fapiao_id") var fapiaoId: String? = null
    var status: String? = null
    @SerializedName("card_information") var cardInformation: InvoiceCardStatusResource? = null
    @SerializedName("total_amount") var totalAmount: Long? = null
    @SerializedName("tax_amount") var taxAmount: Long? = null
    var amount: Long? = null
}

private class InvoiceCardStatusResource {
    @SerializedName("card_status") var cardStatus: String? = null
    @SerializedName("card_id") var cardId: String? = null
    @SerializedName("card_code") var cardCode: String? = null
}

private class InvoiceTitleNotificationResource {
    var mchid: String? = null
    @SerializedName("fapiao_apply_id") var fapiaoApplyId: String? = null
    @SerializedName("apply_time") var applyTime: String? = null
}

private class InvoiceCardNotificationResource {
    var mchid: String? = null
    @SerializedName("fapiao_apply_id") var fapiaoApplyId: String? = null
    @SerializedName("fapiao_information") var fapiaoInformation: List<InvoiceCardNotificationItem>? = null
}

private class InvoiceCardNotificationItem {
    @SerializedName("fapiao_id") var fapiaoId: String? = null
    @SerializedName("fapiao_status") var fapiaoStatus: String? = null
    @SerializedName("card_status") var cardStatus: String? = null
}
