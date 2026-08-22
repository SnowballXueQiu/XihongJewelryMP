package com.xihong.jewelry.security

import com.fasterxml.jackson.databind.ObjectMapper
import com.xihong.jewelry.config.AppProperties
import com.xihong.jewelry.controller.ErrorDto
import com.xihong.jewelry.domain.AdminUserEntity
import com.xihong.jewelry.domain.UserEntity
import com.xihong.jewelry.repository.AdminUserRepository
import com.xihong.jewelry.repository.UserRepository
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.http.HttpMethod
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.data.redis.core.script.DefaultRedisScript
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.security.crypto.codec.Hex
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter
import org.springframework.stereotype.Component
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.web.filter.OncePerRequestFilter
import org.springframework.web.server.ResponseStatusException
import org.springframework.web.cors.CorsConfiguration
import org.springframework.web.cors.CorsConfigurationSource
import org.springframework.web.cors.UrlBasedCorsConfigurationSource
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Duration
import java.time.Instant
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec
import kotlin.random.Random

sealed interface AppPrincipal { val id: Long }
data class UserPrincipal(override val id: Long) : AppPrincipal
data class AdminPrincipal(override val id: Long, val role: String) : AppPrincipal

@Component
class TokenService(private val properties: AppProperties) {
    private val mapper = ObjectMapper()
    private val encoder = Base64.getUrlEncoder().withoutPadding()
    private val decoder = Base64.getUrlDecoder()

    fun userToken(user: UserEntity): String = token(
        mapOf("sub" to user.id.toString(), "kind" to "user", "exp" to Instant.now().plusSeconds(30L * 86400).epochSecond),
        properties.userTokenSecret,
    )

    fun adminToken(admin: AdminUserEntity): String = token(
        mapOf("sub" to admin.id.toString(), "role" to admin.role, "exp" to Instant.now().plusSeconds(12L * 3600).epochSecond),
        properties.adminTokenSecret,
    )

    fun parseUser(value: String): Long? = parse(value, properties.userTokenSecret)
        ?.takeIf { it["kind"] == "user" }
        ?.get("sub")?.toString()?.toLongOrNull()

    fun parseAdmin(value: String): Pair<Long, String>? {
        val payload = parse(value, properties.adminTokenSecret) ?: return null
        return (payload["sub"]?.toString()?.toLongOrNull() ?: return null) to (payload["role"]?.toString() ?: "admin")
    }

    private fun token(payload: Map<String, Any>, secret: String): String {
        val header = encoder.encodeToString("{\"alg\":\"HS256\",\"typ\":\"JWT\"}".toByteArray())
        val body = encoder.encodeToString(mapper.writeValueAsBytes(payload))
        val signing = "$header.$body"
        return "$signing.${encoder.encodeToString(hmac(signing, secret))}"
    }

    @Suppress("UNCHECKED_CAST")
    private fun parse(value: String, secret: String): Map<String, Any>? = runCatching {
        val parts = value.split('.')
        require(parts.size == 3)
        val signing = "${parts[0]}.${parts[1]}"
        require(MessageDigest.isEqual(decoder.decode(parts[2]), hmac(signing, secret)))
        val payload = mapper.readValue(decoder.decode(parts[1]), Map::class.java) as Map<String, Any>
        require((payload["exp"] as? Number)?.toLong()?.let { it >= Instant.now().epochSecond } == true)
        payload
    }.getOrNull()

    private fun hmac(value: String, secret: String): ByteArray = Mac.getInstance("HmacSHA256").run {
        init(SecretKeySpec(secret.toByteArray(StandardCharsets.UTF_8), "HmacSHA256"))
        doFinal(value.toByteArray(StandardCharsets.UTF_8))
    }
}

@Component
class PasswordService {
    fun hash(password: String): String {
        val salt = ByteArray(16).also { Random.Default.nextBytes(it) }
        val saltText = Hex.encode(salt).concatToString()
        return "pbkdf2_sha256\$$saltText\$${Base64.getUrlEncoder().encodeToString(derive(password, saltText))}"
    }

    fun verify(password: String, encoded: String): Boolean = runCatching {
        val parts = encoded.split('$')
        require(parts.size == 3 && parts[0] == "pbkdf2_sha256")
        MessageDigest.isEqual(Base64.getUrlDecoder().decode(parts[2]), derive(password, parts[1]))
    }.getOrDefault(false)

    private fun derive(password: String, salt: String): ByteArray = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        .generateSecret(PBEKeySpec(password.toCharArray(), salt.toByteArray(), 160_000, 256)).encoded
}

@Component
class AdminLoginThrottle(private val redis: StringRedisTemplate) {
    private val incrementScript = DefaultRedisScript(
        """
        local attempts = redis.call('INCR', KEYS[1])
        if attempts == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
        return attempts
        """.trimIndent(),
        Long::class.java,
    )

    fun consume(email: String, clientIp: String): String {
        val identity = "${email.trim().lowercase()}|${clientIp.trim()}"
        val digest = MessageDigest.getInstance("SHA-256").digest(identity.toByteArray(StandardCharsets.UTF_8))
        val key = "xihong:admin-login:${Hex.encode(digest).concatToString()}"
        val attempts = runCatching {
            redis.execute(incrementScript, listOf(key), WINDOW.toMillis().toString())
        }.getOrNull()
        if (attempts != null && attempts > MAX_ATTEMPTS) {
            throw ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "登录尝试过于频繁，请稍后再试")
        }
        return key
    }

    fun clear(key: String) {
        runCatching { redis.delete(key) }
    }

    private companion object {
        const val MAX_ATTEMPTS = 5L
        val WINDOW: Duration = Duration.ofMinutes(10)
    }
}

@Component
class BearerFilter(
    private val tokenService: TokenService,
    private val users: UserRepository,
    private val admins: AdminUserRepository,
    private val properties: AppProperties,
) : OncePerRequestFilter() {
    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, chain: FilterChain) {
        val bearer = request.getHeader("Authorization")?.takeIf { it.startsWith("Bearer ") }?.removePrefix("Bearer ")?.trim()
        val path = request.requestURI
        val principal: AppPrincipal? = if (path.startsWith("/api/admin/")) {
            bearer?.let(tokenService::parseAdmin)?.let { (id, _) ->
                admins.findById(id).orElse(null)?.takeIf { it.isActive }?.let { AdminPrincipal(id, it.role) }
            }
        } else {
            bearer?.let(tokenService::parseUser)?.let { id -> users.findById(id).orElse(null)?.let { UserPrincipal(id) } }
                ?: if (properties.allowMockUser) users.findById(1).orElse(null)?.let { UserPrincipal(1) } else null
        }
        if (principal != null) {
            val authorities = when (principal) {
                is AdminPrincipal -> listOf(SimpleGrantedAuthority("ROLE_ADMIN"), SimpleGrantedAuthority("ROLE_${principal.role.uppercase()}"))
                is UserPrincipal -> listOf(SimpleGrantedAuthority("ROLE_USER"))
            }
            SecurityContextHolder.getContext().authentication = UsernamePasswordAuthenticationToken(principal, null, authorities)
        }
        chain.doFilter(request, response)
    }
}

@Configuration
class SecurityConfiguration(
    private val bearerFilter: BearerFilter,
    private val mapper: ObjectMapper,
    private val properties: AppProperties,
) {
    @Bean
    fun corsConfigurationSource(): CorsConfigurationSource {
        val configuration = CorsConfiguration().apply {
            allowedOrigins = properties.corsAllowedOrigins.map(String::trim).filter(String::isNotEmpty)
            allowedMethods = listOf("GET", "POST", "PUT", "DELETE", "OPTIONS")
            allowedHeaders = listOf("Authorization", "Content-Type", "Accept")
            exposedHeaders = listOf("Content-Disposition")
            allowCredentials = false
            maxAge = 3600
        }
        return UrlBasedCorsConfigurationSource().apply { registerCorsConfiguration("/**", configuration) }
    }

    @Bean
    fun securityFilterChain(http: HttpSecurity): SecurityFilterChain = http
        .csrf { it.disable() }
        .cors { it.configurationSource(corsConfigurationSource()) }
        .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
        .authorizeHttpRequests {
            it.requestMatchers("/health", "/actuator/health/**", "/uploads/**").permitAll()
            it.requestMatchers("/api/auth/wechat", "/api/payments/wechat/**", "/api/wechat/miniprogram/message-push").permitAll()
            it.requestMatchers(HttpMethod.GET, "/api/store/config", "/api/categories", "/api/banners", "/api/products", "/api/products/**").permitAll()
            it.requestMatchers("/api/admin/auth/login").permitAll()
            it.requestMatchers("/api/admin/**").hasRole("ADMIN")
            it.requestMatchers("/api/**").hasRole("USER")
            it.anyRequest().denyAll()
        }
        .exceptionHandling {
            it.authenticationEntryPoint { _, response, _ -> writeError(response, 401, "请先登录") }
            it.accessDeniedHandler { _, response, _ -> writeError(response, 403, "没有操作权限") }
        }
        .addFilterBefore(bearerFilter, UsernamePasswordAuthenticationFilter::class.java)
        .build()

    private fun writeError(response: HttpServletResponse, status: Int, detail: String) {
        response.status = status
        response.contentType = MediaType.APPLICATION_JSON_VALUE
        response.characterEncoding = StandardCharsets.UTF_8.name()
        mapper.writeValue(response.writer, ErrorDto(detail))
    }
}
