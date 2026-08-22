package com.xihong.jewelry.service

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.xihong.jewelry.config.AppProperties
import com.xihong.jewelry.repository.OrderRepository
import com.xihong.jewelry.repository.PaymentIntentRepository
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.stereotype.Service
import org.w3c.dom.Element
import java.io.ByteArrayInputStream
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec
import javax.xml.XMLConstants
import javax.xml.parsers.DocumentBuilderFactory

@Service
class WechatMessageService(
    private val properties: AppProperties,
    private val mapper: ObjectMapper,
    private val callbackInbox: WechatCallbackInboxService,
    private val payments: PaymentIntentRepository,
    private val orders: OrderRepository,
    private val orderWorkflow: OrderService,
) {
    fun verifyPlainSignature(signature: String, timestamp: String, nonce: String) {
        requireSignature(signature, listOf(properties.wechat.messageToken, timestamp, nonce))
    }

    fun verifyEncryptedSignature(signature: String, timestamp: String, nonce: String, encrypted: String) {
        requireSignature(signature, listOf(properties.wechat.messageToken, timestamp, nonce, encrypted))
    }

    fun decrypt(encrypted: String): String {
        val keyText = properties.wechat.messageAesKey.trim()
        require(keyText.length == 43) { "微信消息 EncodingAESKey 未配置或长度错误" }
        val key = Base64.getDecoder().decode("$keyText=")
        val cipher = Cipher.getInstance("AES/CBC/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), IvParameterSpec(key.copyOfRange(0, 16)))
        val padded = cipher.doFinal(Base64.getDecoder().decode(encrypted))
        val pad = padded.last().toInt() and 0xff
        require(pad in 1..32 && padded.takeLast(pad).all { (it.toInt() and 0xff) == pad }) { "微信消息填充校验失败" }
        val plain = padded.copyOfRange(0, padded.size - pad)
        require(plain.size > 20) { "微信消息密文长度错误" }
        val size = ByteBuffer.wrap(plain, 16, 4).int
        require(size >= 0 && 20 + size <= plain.size) { "微信消息正文长度错误" }
        val content = String(plain, 20, size, StandardCharsets.UTF_8)
        val receiver = String(plain, 20 + size, plain.size - 20 - size, StandardCharsets.UTF_8)
        val allowed = setOf(properties.wechat.appId, properties.wechat.originalId).filter(String::isNotBlank)
        require(allowed.isEmpty() || receiver in allowed) { "微信消息接收方校验失败" }
        return content
    }

    fun extractEncrypted(body: String): String = parse(body)["Encrypt"].orEmpty().ifBlank {
        throw IllegalArgumentException("微信加密消息缺少 Encrypt")
    }

    fun acceptAndProcess(payload: String, requestId: String): Boolean {
        val fields = parse(payload)
        val eventType = fields["Event"].orEmpty().ifBlank { fields["event"].orEmpty() }
        if (eventType != "trade_manage_order_settlement") return true
        val merchantId = fields["merchant_id"].orEmpty()
        require(merchantId.isBlank() || merchantId == properties.pay.merchantId) { "微信订单事件商户号不匹配" }
        val transactionId = fields["transaction_id"].orEmpty()
        val merchantTradeNo = fields["merchant_trade_no"].orEmpty()
        require(transactionId.isNotBlank() || merchantTradeNo.isNotBlank()) { "微信订单事件缺少交易单号" }
        val idMaterial = listOf(
            eventType, transactionId, merchantTradeNo, fields["shipped_time"].orEmpty(),
            fields["confirm_receive_time"].orEmpty(), fields["settlement_time"].orEmpty(),
        ).joinToString("|")
        val eventId = sha256(idMaterial)
        val registration = try {
            callbackInbox.register(SOURCE, eventId, eventType, requestId, payload)
        } catch (_: DataIntegrityViolationException) {
            callbackInbox.find(SOURCE, eventId)
                ?: throw WechatPlatformException("微信订单事件幂等记录冲突")
        }
        if (registration.alreadyProcessed) return true
        return runCatching {
            callbackInbox.process(SOURCE, eventId) {
                val payment = transactionId.takeIf(String::isNotBlank)?.let(payments::findByTransactionId)
                    ?: merchantTradeNo.takeIf(String::isNotBlank)?.let(payments::findByOutTradeNo)
                val order = payment?.let { orders.findById(it.orderId).orElse(null) }
                    ?: merchantTradeNo.takeIf(String::isNotBlank)?.let(orders::findByOrderNo)
                    ?: throw WechatPlatformException("微信订单事件未匹配到本地订单")
                orderWorkflow.reconcileWechatOrder(order.id!!)
            }
            true
        }.getOrElse {
            callbackInbox.markFailed(SOURCE, eventId, it)
            false
        }
    }

    fun parse(body: String): Map<String, String> = if (body.trimStart().startsWith("{")) parseJson(body) else parseXml(body)

    private fun parseJson(body: String): Map<String, String> {
        val root = mapper.readTree(body)
        return root.properties().asSequence().associate { it.key to scalar(it.value) }
    }

    private fun scalar(node: JsonNode): String = when {
        node.isTextual -> node.asText()
        node.isNumber || node.isBoolean -> node.asText()
        else -> mapper.writeValueAsString(node)
    }

    private fun parseXml(body: String): Map<String, String> {
        val factory = DocumentBuilderFactory.newInstance().apply {
            setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
            setFeature("http://xml.org/sax/features/external-general-entities", false)
            setFeature("http://xml.org/sax/features/external-parameter-entities", false)
            setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "")
            setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "")
            isExpandEntityReferences = false
        }
        val document = factory.newDocumentBuilder().parse(ByteArrayInputStream(body.toByteArray(StandardCharsets.UTF_8)))
        val root = document.documentElement
        return (0 until root.childNodes.length).mapNotNull { index ->
            (root.childNodes.item(index) as? Element)?.let { it.tagName to it.textContent.orEmpty() }
        }.toMap()
    }

    private fun requireSignature(actual: String, values: List<String>) {
        require(properties.wechat.messageToken.isNotBlank()) { "微信消息 Token 未配置" }
        val expected = sha1(values.sorted().joinToString(""))
        require(MessageDigest.isEqual(expected.toByteArray(), actual.lowercase().toByteArray())) { "微信消息签名校验失败" }
    }

    private fun sha1(value: String): String = MessageDigest.getInstance("SHA-1").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }

    companion object { private const val SOURCE = "wechat_miniprogram_message" }
}
