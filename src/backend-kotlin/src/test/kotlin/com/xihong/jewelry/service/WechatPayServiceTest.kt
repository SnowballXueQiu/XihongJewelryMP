package com.xihong.jewelry.service

import com.fasterxml.jackson.databind.ObjectMapper
import com.xihong.jewelry.config.AppProperties
import com.xihong.jewelry.repository.CallbackEventRepository
import com.xihong.jewelry.repository.OrderRepository
import com.xihong.jewelry.repository.PaymentIntentRepository
import com.xihong.jewelry.repository.RefundRepository
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.mockito.Mockito.mock
import org.springframework.beans.factory.ObjectProvider
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.security.KeyPairGenerator
import java.security.Signature
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

class WechatPayServiceTest {
    @TempDir
    lateinit var tempDir: Path

    @Test
    fun `payment and refund callback URLs are derived from public base URL`() {
        val properties = properties("0123456789abcdef0123456789abcdef", "PUB_KEY_ID_TEST", tempDir.resolve("unused.pem"))
        @Suppress("UNCHECKED_CAST")
        val lifecycle = mock(ObjectProvider::class.java) as ObjectProvider<OrderPaymentLifecycle>
        val service = WechatPayService(
            properties,
            mock(WechatPayClientProvider::class.java),
            ObjectMapper(),
            mock(PaymentIntentRepository::class.java),
            mock(RefundRepository::class.java),
            mock(OrderRepository::class.java),
            WechatCallbackInboxService(mock(CallbackEventRepository::class.java)),
            lifecycle,
        )

        assertEquals("https://api.example.com/payments/wechat/notify", service.callbackUrl("/payments/wechat/notify"))
        assertEquals("https://api.example.com/payments/wechat/refund-notify", service.callbackUrl("/payments/wechat/refund-notify"))
    }

    @Test
    fun `refund callback decrypts official amount without currency`() {
        val keyPair = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
        val publicKey = tempDir.resolve("wechatpay-public.pem")
        Files.writeString(
            publicKey,
            "-----BEGIN PUBLIC KEY-----\n" +
                Base64.getMimeEncoder(64, "\n".toByteArray()).encodeToString(keyPair.public.encoded) +
                "\n-----END PUBLIC KEY-----\n",
        )
        val apiV3Key = "0123456789abcdef0123456789abcdef"
        val publicKeyId = "PUB_KEY_ID_TEST"
        val properties = properties(apiV3Key, publicKeyId, publicKey)
        val mapper = ObjectMapper()
        val resource = mapper.writeValueAsString(
            mapOf(
                "mchid" to "1112005993",
                "out_trade_no" to "XH26082200000015",
                "transaction_id" to "4200000000202608220000000001",
                "out_refund_no" to "RF26082200000015",
                "refund_id" to "5030000000202608220000000001",
                "refund_status" to "SUCCESS",
                "success_time" to "2026-08-22T20:00:00+08:00",
                "user_received_account" to "支付用户零钱",
                // APIv3 refund notifications have no amount.currency field.
                "amount" to mapOf("total" to 328000L, "refund" to 328000L, "payer_total" to 328000L, "payer_refund" to 328000L),
            ),
        )
        val associatedData = "refund"
        val resourceNonce = "refundnonce1"
        val ciphertext = encrypt(apiV3Key, resourceNonce, associatedData, resource)
        val body = mapper.writeValueAsString(
            mapOf(
                "id" to "EV-REFUND-NO-CURRENCY",
                "create_time" to OffsetDateTime.now(ZoneOffset.UTC).toString(),
                "event_type" to "REFUND.SUCCESS",
                "resource_type" to "encrypt-resource",
                "summary" to "退款成功",
                "resource" to mapOf(
                    "algorithm" to "AEAD_AES_256_GCM",
                    "ciphertext" to ciphertext,
                    "associated_data" to associatedData,
                    "nonce" to resourceNonce,
                ),
            ),
        )
        val timestamp = Instant.now().epochSecond.toString()
        val callbackNonce = "callback-nonce"
        val signature = Signature.getInstance("SHA256withRSA").run {
            initSign(keyPair.private)
            update("$timestamp\n$callbackNonce\n$body\n".toByteArray(StandardCharsets.UTF_8))
            Base64.getEncoder().encodeToString(sign())
        }

        @Suppress("UNCHECKED_CAST")
        val lifecycle = mock(ObjectProvider::class.java) as ObjectProvider<OrderPaymentLifecycle>
        val service = WechatPayService(
            properties,
            WechatPayClientProvider(properties),
            mapper,
            mock(PaymentIntentRepository::class.java),
            mock(RefundRepository::class.java),
            mock(OrderRepository::class.java),
            WechatCallbackInboxService(mock(CallbackEventRepository::class.java)),
            lifecycle,
        )

        val parsed = service.parseRefundNotification(
            WechatCallbackHeaders(publicKeyId, signature, timestamp, callbackNonce),
            body,
        )
        assertEquals("RF26082200000015", parsed.refund.outRefundNo)
        assertEquals("SUCCESS", parsed.refund.status)
        assertEquals(328000L, parsed.refund.totalCents)
        assertEquals(328000L, parsed.refund.refundCents)
    }

    private fun encrypt(apiV3Key: String, nonce: String, associatedData: String, plaintext: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            Cipher.ENCRYPT_MODE,
            SecretKeySpec(apiV3Key.toByteArray(StandardCharsets.UTF_8), "AES"),
            GCMParameterSpec(128, nonce.toByteArray(StandardCharsets.UTF_8)),
        )
        cipher.updateAAD(associatedData.toByteArray(StandardCharsets.UTF_8))
        return Base64.getEncoder().encodeToString(cipher.doFinal(plaintext.toByteArray(StandardCharsets.UTF_8)))
    }

    private fun properties(apiV3Key: String, publicKeyId: String, publicKey: Path) = AppProperties(
        publicBaseUrl = "https://api.example.com",
        uploadsDir = tempDir.toString(),
        allowMockUser = false,
        userTokenSecret = "user-secret",
        adminTokenSecret = "admin-secret",
        adminBootstrapEmail = "admin@example.com",
        adminBootstrapPassword = "password",
        adminBootstrapName = "Admin",
        companyNameZh = "测试商户",
        companyNameEn = "Test Merchant",
        shippingFeeCents = 0,
        freeShippingThresholdCents = 0,
        wechat = AppProperties.Wechat(appId = "wx8469c45d32e0a628"),
        pay = AppProperties.Pay(
            mock = false,
            appId = "wx8469c45d32e0a628",
            merchantId = "1112005993",
            apiV3Key = apiV3Key,
            serialNo = "merchant-serial",
            privateKeyPath = tempDir.resolve("unused-private.pem").toString(),
            platformPublicKeyId = publicKeyId,
            platformPublicKeyPath = publicKey.toString(),
        ),
    )
}
