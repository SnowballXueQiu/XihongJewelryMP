package com.xihong.jewelry.config

import jakarta.validation.Valid
import jakarta.validation.constraints.AssertTrue
import jakarta.validation.constraints.Email
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.NotEmpty
import jakarta.validation.constraints.Pattern
import jakarta.validation.constraints.Size
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.validation.annotation.Validated
import java.net.URI

@Validated
@ConfigurationProperties("app")
data class AppProperties(
    val production: Boolean = false,
    val publicBaseUrl: String,
    val uploadsDir: String,
    val legacySqlitePath: String = "",
    val allowMockUser: Boolean,
    @field:NotBlank
    @field:Size(min = 32, max = 512)
    val userTokenSecret: String,
    @field:NotBlank
    @field:Size(min = 32, max = 512)
    val adminTokenSecret: String,
    @field:NotBlank
    @field:Email
    val adminBootstrapEmail: String,
    @field:NotBlank
    @field:Size(min = 12, max = 128)
    val adminBootstrapPassword: String,
    val adminBootstrapName: String,
    val companyNameZh: String,
    val companyNameEn: String,
    val shippingFeeCents: Int,
    val freeShippingThresholdCents: Int,
    @field:Valid
    val wechat: Wechat,
    @field:Valid
    val pay: Pay,
    @field:NotEmpty
    val corsAllowedOrigins: List<String> = listOf("https://xihongzhubao.com"),
) {
    @get:AssertTrue(message = "用户与管理员 JWT 密钥必须不同")
    val tokenSecretsAreDistinct: Boolean
        get() = userTokenSecret != adminTokenSecret

    @get:AssertTrue(message = "生产环境必须关闭模拟用户和模拟支付")
    val productionDisablesMockModes: Boolean
        get() = !production || (!allowMockUser && !pay.mock)

    @get:AssertTrue(message = "CORS 来源必须是明确的 HTTPS 域名（本机开发地址除外），不能使用通配符")
    val corsOriginsAreExplicit: Boolean
        get() = corsAllowedOrigins.isNotEmpty() && corsAllowedOrigins.all { origin ->
            runCatching {
                val uri = URI(origin.trim())
                origin.isNotBlank() && origin != "*" && uri.host.isNullOrBlank().not() &&
                    uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null && uri.rawPath in setOf("", "/") &&
                    (uri.scheme.equals("https", ignoreCase = true) ||
                        (uri.scheme.equals("http", ignoreCase = true) && uri.host in setOf("localhost", "127.0.0.1")))
            }.getOrDefault(false)
        }

    @get:AssertTrue(message = "生产环境必须完整配置微信安全模式消息推送")
    val productionWechatMessageSecurityConfigured: Boolean
        get() = !production || runCatching {
            val callback = URI(wechat.messageCallbackUrl.trim())
            wechat.messageToken.matches(Regex("[A-Za-z0-9]{3,32}")) &&
                wechat.messageAesKey.matches(Regex("[A-Za-z0-9]{43}")) &&
                wechat.appId.isNotBlank() && wechat.originalId.isNotBlank() &&
                callback.scheme.equals("https", ignoreCase = true) && !callback.host.isNullOrBlank() &&
                callback.rawQuery == null && callback.rawFragment == null &&
                wechat.messageCallbackUrl.trimEnd('/') ==
                "${publicBaseUrl.trimEnd('/')}/wechat/miniprogram/message-push"
        }.getOrDefault(false)

    data class Wechat(
        val originalId: String = "",
        val appId: String = "",
        @field:Pattern(regexp = "^$|^.{32}$")
        val appSecret: String = "",
        @field:Pattern(regexp = "^$|^[A-Za-z0-9]{3,32}$")
        val messageToken: String = "",
        @field:Pattern(regexp = "^$|^[A-Za-z0-9]{43}$")
        val messageAesKey: String = "",
        val messageCallbackUrl: String = "",
    )

    data class Pay(
        val mock: Boolean = false,
        val appId: String = "",
        val merchantId: String = "",
        @field:Pattern(regexp = "^$|^.{32}$")
        val apiV3Key: String = "",
        val serialNo: String = "",
        val privateKeyPath: String = "",
        val platformPublicKeyId: String = "",
        val platformPublicKeyPath: String = "",
    )
}
