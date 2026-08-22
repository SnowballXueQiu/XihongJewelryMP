package com.xihong.jewelry.service

import com.fasterxml.jackson.databind.ObjectMapper
import com.xihong.jewelry.config.AppProperties
import com.xihong.jewelry.domain.*
import com.xihong.jewelry.repository.*
import com.xihong.jewelry.security.PasswordService
import org.springframework.boot.ApplicationArguments
import org.springframework.boot.ApplicationRunner
import org.springframework.core.annotation.Order
import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.time.temporal.ChronoUnit

@Component
@Order(100)
class BootstrapService(
    private val properties: AppProperties,
    private val passwords: PasswordService,
    private val users: UserRepository,
    private val admins: AdminUserRepository,
    private val categories: CategoryRepository,
    private val products: ProductRepository,
    private val coupons: CouponRepository,
    private val banners: BannerRepository,
    private val settings: SiteSettingRepository,
    private val pets: PetProfileRepository,
    private val mapper: ObjectMapper,
) : ApplicationRunner {
    @Transactional
    override fun run(args: ApplicationArguments) {
        val user = users.findById(1).orElseGet { users.save(UserEntity(nickname = "玺鸿会员")) }
        if (pets.findByUserId(user.id!!) == null) pets.save(PetProfileEntity(userId = user.id!!))
        if (admins.findByEmailIgnoreCase(properties.adminBootstrapEmail) == null) {
            admins.save(AdminUserEntity(email = properties.adminBootstrapEmail.lowercase(), name = properties.adminBootstrapName,
                passwordHash = passwords.hash(properties.adminBootstrapPassword), role = "super_admin"))
        }
        if (categories.count() == 0L) {
            categories.saveAll(listOf(
                CategoryEntity(name = "戒指", slug = "rings", sortOrder = 1),
                CategoryEntity(name = "手链手环", slug = "bracelets", sortOrder = 2),
                CategoryEntity(name = "项链", slug = "necklaces", sortOrder = 3),
                CategoryEntity(name = "耳饰", slug = "earrings", sortOrder = 4),
            ))
        }
        if (products.count() == 0L) {
            products.saveAll(listOf(
                ProductEntity(name = "支付测试商品（0.01元）", subtitle = "微信支付联调专用", description = "仅用于验证微信支付和订单履约链路。", categorySlug = "rings", material = "测试商品", priceCents = 1, stock = 9999, freeShipping = true, imageColor = "#D2B06D", tags = mapper.writeValueAsString(listOf("支付测试", "包邮"))),
                ProductEntity(name = "零元下单流程测试商品", subtitle = "不会调用微信支付", description = "用于验证下单、状态同步和履约流程，不会产生扣款。", categorySlug = "rings", material = "测试商品", priceCents = 0, stock = 9999, freeShipping = true, imageColor = "#D8B870", tags = mapper.writeValueAsString(listOf("零元", "流程测试"))),
                ProductEntity(name = "鸢尾方糖戒指", subtitle = "18K 金 / 紫晶 / 白钻", description = "几何方糖与鸢尾紫晶相遇。", categorySlug = "rings", material = "18K金", priceCents = 328000, originalPriceCents = 358000, stock = 16, sales = 41, isFeatured = true, imageColor = "#756079", tags = mapper.writeValueAsString(listOf("限量", "18K金"))),
            ))
        }
        if (coupons.count() == 0L) {
            coupons.save(CouponEntity(code = "WELCOME88", name = "新客礼遇", description = "满 800 元减 88 元", amountCents = 8800, minimumCents = 80000, totalQuantity = 10000, validUntil = Instant.now().plus(365, ChronoUnit.DAYS)))
        }
        if (banners.count() == 0L) banners.save(BannerEntity(title = "玺鸿珠宝", subtitle = "戒指、手链与日常轻珠宝", imageColor = "#111111"))
        seedSetting("shipping_fee_cents", properties.shippingFeeCents.toString(), "默认运费（分）", "commerce")
        seedSetting("free_shipping_threshold_cents", properties.freeShippingThresholdCents.toString(), "包邮门槛（分）", "commerce")
        seedSetting("pickup_store_name", "玺鸿珠宝天津店", "自提门店", "store")
        seedSetting("pickup_store_address", "天津市和平区南京路 219 号", "门店地址", "store")
        seedSetting("pickup_store_phone", "16622515550", "门店电话", "store")
        seedSetting("wechat_order_detail_path", "pages/order-detail/index?orderNo=\${商品订单号}", "微信购物订单详情路径", "wechat")
        seedSetting("wechat_message_path", "pages/orders/index", "微信发货消息路径", "wechat")
    }

    private fun seedSetting(key: String, value: String, label: String, group: String) {
        if (settings.findByKey(key) == null) settings.save(SiteSettingEntity(key = key, value = value, label = label, group = group))
    }
}
