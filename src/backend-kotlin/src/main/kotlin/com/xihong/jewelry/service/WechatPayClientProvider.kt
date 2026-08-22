package com.xihong.jewelry.service

import com.wechat.pay.java.core.Config
import com.wechat.pay.java.core.RSAPublicKeyConfig
import com.wechat.pay.java.core.http.DefaultHttpClientBuilder
import com.wechat.pay.java.core.http.HttpClient
import com.wechat.pay.java.core.notification.NotificationParser
import com.wechat.pay.java.core.notification.RSAPublicKeyNotificationConfig
import com.xihong.jewelry.config.AppProperties
import org.springframework.stereotype.Component

/**
 * Owns the official WeChat Pay APIv3 clients. Construction is lazy so local/mock
 * development does not require production key files at application startup.
 */
@Component
class WechatPayClientProvider(private val properties: AppProperties) {
    private val apiConfig: Config by lazy(LazyThreadSafetyMode.SYNCHRONIZED) {
        val pay = requiredConfiguration()
        RSAPublicKeyConfig.Builder()
            .merchantId(pay.merchantId)
            .privateKeyFromPath(pay.privateKeyPath)
            .merchantSerialNumber(pay.serialNo)
            .apiV3Key(pay.apiV3Key)
            .publicKeyFromPath(pay.platformPublicKeyPath)
            .publicKeyId(pay.platformPublicKeyId)
            .build()
    }

    private val notificationParser: NotificationParser by lazy(LazyThreadSafetyMode.SYNCHRONIZED) {
        val pay = requiredConfiguration()
        NotificationParser(
            RSAPublicKeyNotificationConfig.Builder()
                .publicKeyFromPath(pay.platformPublicKeyPath)
                .publicKeyId(pay.platformPublicKeyId)
                .apiV3Key(pay.apiV3Key)
                .build(),
        )
    }

    private val httpClient: HttpClient by lazy(LazyThreadSafetyMode.SYNCHRONIZED) {
        DefaultHttpClientBuilder().config(apiConfig).build()
    }

    fun config(): Config = apiConfig

    fun notifications(): NotificationParser = notificationParser

    fun http(): HttpClient = httpClient

    fun isMock(): Boolean = properties.pay.mock

    private fun requiredConfiguration(): AppProperties.Pay {
        val pay = properties.pay
        val missing = buildList {
            if (pay.merchantId.isBlank()) add("WX_PAY_MCH_ID")
            if (pay.apiV3Key.isBlank()) add("WX_PAY_API_V3_KEY")
            if (pay.serialNo.isBlank()) add("WX_PAY_SERIAL_NO")
            if (pay.privateKeyPath.isBlank()) add("WX_PAY_PRIVATE_KEY_PATH")
            if (pay.platformPublicKeyId.isBlank()) add("WX_PAY_PUBLIC_KEY_ID")
            if (pay.platformPublicKeyPath.isBlank()) add("WX_PAY_PUBLIC_KEY_PATH")
        }
        if (missing.isNotEmpty()) {
            throw WechatPayConfigurationException("微信支付配置缺失：${missing.joinToString()}")
        }
        return pay
    }
}

class WechatPayConfigurationException(message: String, cause: Throwable? = null) : RuntimeException(message, cause)
