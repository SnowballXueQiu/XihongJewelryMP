package com.xihong.jewelry.controller

import com.fasterxml.jackson.databind.ObjectMapper
import com.xihong.jewelry.config.AppProperties
import com.xihong.jewelry.repository.CallbackEventRepository
import com.xihong.jewelry.repository.OrderRepository
import com.xihong.jewelry.repository.PaymentIntentRepository
import com.xihong.jewelry.service.OrderService
import com.xihong.jewelry.service.WechatCallbackInboxService
import com.xihong.jewelry.service.WechatMessageService
import jakarta.servlet.http.HttpServletRequest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

class WechatMessageControllerTest {
    private val token = "SecureToken2026"
    private val encodingAesKey = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFG"
    private val appId = "wx8469c45d32e0a628"
    private val originalId = "gh_dfcecb9b3f62"
    private val messages = WechatMessageService(
        properties(),
        ObjectMapper(),
        WechatCallbackInboxService(mock(CallbackEventRepository::class.java)),
        mock(PaymentIntentRepository::class.java),
        mock(OrderRepository::class.java),
        mock(OrderService::class.java),
    )
    private val controller = WechatMessageController(messages)
    private val request = mock(HttpServletRequest::class.java).also {
        `when`(it.getHeader("Request-ID")).thenReturn("safe-mode-test")
    }

    @Test
    fun `safe mode XML callback verifies decrypts and acknowledges`() {
        val timestamp = "1787428800"
        val nonce = "safe-mode-nonce"
        val payload = """
            <xml>
              <ToUserName><![CDATA[$originalId]]></ToUserName>
              <MsgType><![CDATA[event]]></MsgType>
              <Event><![CDATA[non_business_test_event]]></Event>
            </xml>
        """.trimIndent()
        val encrypted = encrypt(payload, appId)
        val signature = signature(timestamp, nonce, encrypted)
        val body = "<xml><Encrypt><![CDATA[$encrypted]]></Encrypt></xml>"

        val response = controller.callback(request, body, timestamp, nonce, null, signature, "aes")

        assertEquals(200, response.statusCode.value())
        assertEquals("success", response.body)
    }

    @Test
    fun `safe mode JSON callback is supported`() {
        val timestamp = "1787428801"
        val nonce = "safe-json-nonce"
        val payload = """{"ToUserName":"$originalId","MsgType":"event","Event":"non_business_test_event"}"""
        val encrypted = encrypt(payload, originalId)
        val signature = signature(timestamp, nonce, encrypted)
        val body = ObjectMapper().writeValueAsString(mapOf("Encrypt" to encrypted))

        val response = controller.callback(request, body, timestamp, nonce, null, signature, "aes")

        assertEquals(200, response.statusCode.value())
        assertEquals("success", response.body)
    }

    @Test
    fun `plaintext POST and invalid encrypted signature are forbidden`() {
        val plaintext = "<xml><MsgType>event</MsgType><Event>test</Event></xml>"
        assertEquals(403, controller.callback(request, plaintext, "1", "n", "plain-signature", null, null).statusCode.value())

        val encrypted = encrypt(plaintext, appId)
        val body = "<xml><Encrypt><![CDATA[$encrypted]]></Encrypt></xml>"
        assertEquals(403, controller.callback(request, body, "1", "n", null, "invalid", "aes").statusCode.value())
    }

    @Test
    fun `receiver mismatch is rejected after valid decryption`() {
        val encrypted = encrypt("<xml><MsgType>event</MsgType><Event>test</Event></xml>", "wx-wrong-receiver")
        assertThrows(IllegalArgumentException::class.java) { messages.decrypt(encrypted) }
    }

    @Test
    fun `GET verification supports official plain and encrypted handshakes`() {
        val timestamp = "1787428802"
        val nonce = "handshake-nonce"
        val echo = "official-echo"
        val plain = controller.handshake(timestamp, nonce, echo, signature(timestamp, nonce), null, null)
        assertEquals(200, plain.statusCode.value())
        assertEquals(echo, plain.body)

        val encrypted = encrypt(echo, appId)
        val encryptedResponse = controller.handshake(
            timestamp,
            nonce,
            encrypted,
            null,
            signature(timestamp, nonce, encrypted),
            "aes",
        )
        assertEquals(200, encryptedResponse.statusCode.value())
        assertEquals(echo, encryptedResponse.body)
    }

    private fun properties() = AppProperties(
        publicBaseUrl = "https://api.xihongzhubao.com",
        uploadsDir = "build/test-uploads",
        allowMockUser = false,
        userTokenSecret = "user-secret-at-least-thirty-two-characters",
        adminTokenSecret = "admin-secret-at-least-thirty-two-characters",
        adminBootstrapEmail = "admin@example.com",
        adminBootstrapPassword = "test-password-strong",
        adminBootstrapName = "Admin",
        companyNameZh = "测试商户",
        companyNameEn = "Test Merchant",
        shippingFeeCents = 0,
        freeShippingThresholdCents = 0,
        wechat = AppProperties.Wechat(
            originalId = originalId,
            appId = appId,
            messageToken = token,
            messageAesKey = encodingAesKey,
            messageCallbackUrl = "https://api.xihongzhubao.com/wechat/miniprogram/message-push",
        ),
        pay = AppProperties.Pay(merchantId = "1112005993"),
    )

    private fun encrypt(payload: String, receiver: String): String {
        val key = Base64.getDecoder().decode("$encodingAesKey=")
        val payloadBytes = payload.toByteArray(StandardCharsets.UTF_8)
        val receiverBytes = receiver.toByteArray(StandardCharsets.UTF_8)
        val plain = "0123456789abcdef".toByteArray() +
            ByteBuffer.allocate(4).putInt(payloadBytes.size).array() + payloadBytes + receiverBytes
        val padding = 32 - plain.size % 32
        val padded = plain + ByteArray(padding) { padding.toByte() }
        val cipher = Cipher.getInstance("AES/CBC/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), IvParameterSpec(key.copyOfRange(0, 16)))
        return Base64.getEncoder().encodeToString(cipher.doFinal(padded))
    }

    private fun signature(vararg values: String): String = MessageDigest.getInstance("SHA-1")
        .digest((listOf(token) + values).sorted().joinToString("").toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
}
