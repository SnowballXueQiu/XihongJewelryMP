package com.xihong.jewelry.service

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.xihong.jewelry.config.AppProperties
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.web.server.ResponseStatusException
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.time.Duration
import java.time.Instant
import java.util.concurrent.atomic.AtomicReference

@Service
class WechatAccessTokenService(
    private val properties: AppProperties,
    private val redis: StringRedisTemplate,
    private val mapper: ObjectMapper,
) {
    private val http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).build()
    private val local = AtomicReference<CachedToken?>()

    fun get(): String {
        local.get()?.takeIf { it.expiresAt.isAfter(Instant.now().plusSeconds(30)) }?.let { return it.value }
        runCatching { redis.opsForValue().get(CACHE_KEY) }.getOrNull()?.takeIf(String::isNotBlank)?.let {
            local.set(CachedToken(it, Instant.now().plusSeconds(300)))
            return it
        }
        val config = properties.wechat
        if (config.appId.isBlank() || config.appSecret.isBlank()) throw ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "微信小程序服务端凭证未配置")
        val url = "https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encode(config.appId)}&secret=${encode(config.appSecret)}"
        val response = http.send(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(10)).GET().build(), HttpResponse.BodyHandlers.ofString())
        val body = mapper.readTree(response.body())
        val token = body.path("access_token").asText()
        if (response.statusCode() !in 200..299 || token.isBlank()) throw WechatPlatformException("获取微信接口凭证失败：${body.path("errmsg").asText(body.path("errcode").asText("未知错误"))}")
        val ttl = (body.path("expires_in").asLong(7200) - 300).coerceAtLeast(60)
        local.set(CachedToken(token, Instant.now().plusSeconds(ttl)))
        runCatching { redis.opsForValue().set(CACHE_KEY, token, Duration.ofSeconds(ttl)) }
        return token
    }

    fun invalidate() {
        local.set(null)
        runCatching { redis.delete(CACHE_KEY) }
    }

    fun post(path: String, payload: Any): JsonNode = request("POST", path, payload)

    fun request(method: String, path: String, payload: Any? = null, retry: Boolean = true): JsonNode {
        val body = payload?.let(mapper::writeValueAsString) ?: ""
        val request = HttpRequest.newBuilder(URI.create("https://api.weixin.qq.com$path${if (path.contains('?')) "&" else "?"}access_token=${encode(get())}"))
            .timeout(Duration.ofSeconds(12))
            .header("Accept", "application/json")
            .apply {
                if (payload == null) method(method, HttpRequest.BodyPublishers.noBody())
                else header("Content-Type", "application/json; charset=utf-8").method(method, HttpRequest.BodyPublishers.ofString(body))
            }.build()
        val response = http.send(request, HttpResponse.BodyHandlers.ofString())
        val data = mapper.readTree(response.body().ifBlank { "{}" })
        val errcode = data.path("errcode").asInt(0)
        if (retry && errcode in setOf(40001, 40014, 42001)) {
            invalidate()
            return request(method, path, payload, false)
        }
        if (response.statusCode() !in 200..299 || errcode != 0) throw WechatPlatformException("微信接口失败（$errcode）：${data.path("errmsg").asText("未知错误")}")
        return data
    }

    private fun encode(value: String) = URLEncoder.encode(value, StandardCharsets.UTF_8)
    private data class CachedToken(val value: String, val expiresAt: Instant)
    companion object { private const val CACHE_KEY = "xihong:wechat:access-token" }
}

class WechatPlatformException(message: String, cause: Throwable? = null) : RuntimeException(message, cause)
