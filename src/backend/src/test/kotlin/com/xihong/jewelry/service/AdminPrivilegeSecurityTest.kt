package com.xihong.jewelry.service

import com.xihong.jewelry.config.AppProperties
import com.xihong.jewelry.controller.AdminUserUpdate
import com.xihong.jewelry.controller.SettingWrite
import com.xihong.jewelry.domain.AdminUserEntity
import com.xihong.jewelry.repository.*
import com.xihong.jewelry.security.AdminLoginThrottle
import com.xihong.jewelry.security.AdminPrincipal
import com.xihong.jewelry.security.PasswordService
import com.xihong.jewelry.security.TokenService
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.mockito.Mockito
import java.util.Optional

class AdminPrivilegeSecurityTest {
    @Test
    fun `cannot demote the last active super administrator`() {
        val fixture = Fixture()
        val lastSuper = AdminUserEntity(id = 1, email = "root@example.test", name = "Root", role = "super_admin", isActive = true)
        Mockito.`when`(fixture.admins.findById(1)).thenReturn(Optional.of(lastSuper))
        Mockito.`when`(fixture.admins.lockActiveSuperAdmins()).thenReturn(listOf(lastSuper))

        val error = assertThrows(IllegalArgumentException::class.java) {
            fixture.service.updateAdmin(1, AdminUserUpdate(role = "admin"), AdminPrincipal(99, "super_admin"))
        }

        assertThat(error.message).isEqualTo("至少保留一个启用的超级管理员")
        Mockito.verify(fixture.admins, Mockito.never()).save(lastSuper)
    }

    @Test
    fun `generic settings endpoint keeps WeChat paths super-only`() {
        val fixture = Fixture()

        val error = assertThrows(IllegalArgumentException::class.java) {
            fixture.service.updateSetting(
                "wechat_order_detail_path",
                SettingWrite("pages/orders/index"),
                AdminPrincipal(5, "admin"),
            )
        }

        assertThat(error.message).isEqualTo("仅超级管理员可执行此操作")
        Mockito.verifyNoInteractions(fixture.settings, fixture.platform)
    }

    private class Fixture {
        val platform: WechatPlatformService = Mockito.mock(WechatPlatformService::class.java)
        val admins: AdminUserRepository = Mockito.mock(AdminUserRepository::class.java)
        val settings: SiteSettingRepository = Mockito.mock(SiteSettingRepository::class.java)
        val service = AdminService(
            Mockito.mock(AppProperties::class.java),
            Mockito.mock(TokenService::class.java),
            Mockito.mock(PasswordService::class.java),
            Mockito.mock(AdminLoginThrottle::class.java),
            Mockito.mock(DomainMapper::class.java),
            platform,
            Mockito.mock(OrderService::class.java),
            Mockito.mock(WechatInvoiceService::class.java),
            Mockito.mock(InvoiceDeliveryCoordinator::class.java),
            Mockito.mock(UserRepository::class.java),
            Mockito.mock(CategoryRepository::class.java),
            Mockito.mock(ProductRepository::class.java),
            Mockito.mock(CouponRepository::class.java),
            Mockito.mock(OrderRepository::class.java),
            Mockito.mock(PaymentIntentRepository::class.java),
            Mockito.mock(RefundRepository::class.java),
            Mockito.mock(PetProfileRepository::class.java),
            Mockito.mock(PointLedgerRepository::class.java),
            admins,
            Mockito.mock(BannerRepository::class.java),
            Mockito.mock(AssetRepository::class.java),
            settings,
            Mockito.mock(AuditLogRepository::class.java),
        )
    }
}
