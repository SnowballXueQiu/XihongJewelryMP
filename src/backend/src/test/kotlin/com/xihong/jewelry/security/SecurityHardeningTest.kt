package com.xihong.jewelry.security

import com.xihong.jewelry.config.AppProperties
import com.xihong.jewelry.domain.AdminUserEntity
import com.xihong.jewelry.repository.AdminUserRepository
import com.xihong.jewelry.repository.UserRepository
import jakarta.validation.Validation
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.mockito.Mockito
import org.springframework.mock.web.MockFilterChain
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.security.core.context.SecurityContextHolder
import java.util.Optional

class SecurityHardeningTest {
    @AfterEach
    fun clearSecurityContext() = SecurityContextHolder.clearContext()

    @Test
    fun `admin authentication uses current database role instead of token role`() {
        val properties = properties()
        val tokens = TokenService(properties)
        val token = tokens.adminToken(AdminUserEntity(id = 7, role = "super_admin", isActive = true))
        val currentAdmin = AdminUserEntity(id = 7, role = "admin", isActive = true)
        val admins = Mockito.mock(AdminUserRepository::class.java)
        val users = Mockito.mock(UserRepository::class.java)
        Mockito.`when`(admins.findById(7)).thenReturn(Optional.of(currentAdmin))
        val filter = BearerFilter(tokens, users, admins, properties)
        val request = MockHttpServletRequest("GET", "/api/admin/me").apply {
            addHeader("Authorization", "Bearer $token")
        }

        filter.doFilter(request, MockHttpServletResponse(), MockFilterChain())

        val principal = requireNotNull(SecurityContextHolder.getContext().authentication).principal as AdminPrincipal
        assertThat(principal.role).isEqualTo("admin")
    }

    @Test
    fun `production credentials reject short token secrets and bootstrap passwords`() {
        val validator = Validation.buildDefaultValidatorFactory().validator

        assertThat(validator.validate(properties().copy(userTokenSecret = "short")).map { it.propertyPath.toString() })
            .contains("userTokenSecret")
        assertThat(validator.validate(properties().copy(adminTokenSecret = "short")).map { it.propertyPath.toString() })
            .contains("adminTokenSecret")
        assertThat(validator.validate(properties().copy(adminBootstrapPassword = "short")).map { it.propertyPath.toString() })
            .contains("adminBootstrapPassword")
        val reusedSecret = properties().userTokenSecret
        assertThat(validator.validate(properties().copy(adminTokenSecret = reusedSecret)).map { it.propertyPath.toString() })
            .contains("tokenSecretsAreDistinct")
        assertThat(validator.validate(properties().copy(corsAllowedOrigins = listOf("*"))).map { it.propertyPath.toString() })
            .contains("corsOriginsAreExplicit")
        assertThat(validator.validate(properties().copy(
            production = true,
            pay = properties().pay.copy(mock = true),
        )).map { it.propertyPath.toString() })
            .contains("productionDisablesMockModes")
    }

    private fun properties() = AppProperties(
        publicBaseUrl = "https://api.example.test",
        uploadsDir = "/tmp/uploads",
        allowMockUser = false,
        userTokenSecret = "user-token-secret-with-at-least-32-characters",
        adminTokenSecret = "admin-token-secret-with-at-least-32-characters",
        adminBootstrapEmail = "admin@example.test",
        adminBootstrapPassword = "a-unique-bootstrap-password",
        adminBootstrapName = "Admin",
        companyNameZh = "测试公司",
        companyNameEn = "Test Company",
        shippingFeeCents = 0,
        freeShippingThresholdCents = 0,
        wechat = AppProperties.Wechat(),
        pay = AppProperties.Pay(),
        corsAllowedOrigins = listOf("https://admin.example.test"),
    )
}
