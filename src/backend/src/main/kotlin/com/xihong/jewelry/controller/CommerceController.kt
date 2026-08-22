package com.xihong.jewelry.controller

import com.xihong.jewelry.config.AppProperties
import com.xihong.jewelry.domain.CartItemEntity
import com.xihong.jewelry.domain.FavoriteEntity
import com.xihong.jewelry.domain.UserCouponEntity
import com.xihong.jewelry.repository.BannerRepository
import com.xihong.jewelry.repository.CartItemRepository
import com.xihong.jewelry.repository.CategoryRepository
import com.xihong.jewelry.repository.CouponRepository
import com.xihong.jewelry.repository.FavoriteRepository
import com.xihong.jewelry.repository.ProductRepository
import com.xihong.jewelry.repository.SiteSettingRepository
import com.xihong.jewelry.repository.UserCouponRepository
import com.xihong.jewelry.security.UserPrincipal
import com.xihong.jewelry.service.DomainMapper
import com.xihong.jewelry.service.OrderService
import jakarta.validation.Valid
import org.springframework.http.HttpStatus
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.server.ResponseStatusException
import java.time.Instant

@RestController
@RequestMapping("/api")
class CommerceController(
    private val properties: AppProperties,
    private val settings: SiteSettingRepository,
    private val categories: CategoryRepository,
    private val products: ProductRepository,
    private val banners: BannerRepository,
    private val cartItems: CartItemRepository,
    private val favorites: FavoriteRepository,
    private val coupons: CouponRepository,
    private val userCoupons: UserCouponRepository,
    private val orders: OrderService,
    private val mapper: DomainMapper,
) {
    @GetMapping("/store/config")
    fun storeConfig() = StoreConfigDto(
        companyNameZh = properties.companyNameZh,
        companyNameEn = properties.companyNameEn,
        shippingFeeCents = settingInt("shipping_fee_cents", properties.shippingFeeCents),
        freeShippingThresholdCents = settingInt("free_shipping_threshold_cents", properties.freeShippingThresholdCents),
        pickupStoreName = setting("pickup_store_name", "玺鸿珠宝天津店"),
        pickupStoreAddress = setting("pickup_store_address", "天津市和平区南京路 219 号"),
        pickupStorePhone = setting("pickup_store_phone", "16622515550"),
    )

    @GetMapping("/categories")
    fun categories(): List<CategoryDto> = categories.findAllByIsActiveTrueOrderBySortOrderAscIdAsc().map(mapper::category)

    @GetMapping("/products")
    fun products(
        @RequestParam(required = false) category: String?,
        @RequestParam(required = false) q: String?,
        @RequestParam(required = false) material: String?,
        @RequestParam(name = "in_stock", required = false, defaultValue = "false") inStock: Boolean,
        @RequestParam(required = false, defaultValue = "false") featured: Boolean,
        @RequestParam(name = "min_price", required = false) minPrice: Int?,
        @RequestParam(name = "max_price", required = false) maxPrice: Int?,
        @RequestParam(required = false) sort: String?,
    ): List<ProductDto> {
        require(minPrice == null || minPrice >= 0) { "最低价不能小于 0" }
        require(maxPrice == null || maxPrice >= 0) { "最高价不能小于 0" }
        require(minPrice == null || maxPrice == null || minPrice <= maxPrice) { "最低价不能高于最高价" }
        val keyword = q?.trim()?.lowercase().orEmpty()
        val result = products.findAllByStatusOrderBySortOrderAscIdAsc("active").asSequence().filter { product ->
            (category.isNullOrBlank() || category == "all" || product.categorySlug == category) &&
                (material.isNullOrBlank() || material == "all" || product.material == material) &&
                (!inStock || product.stock > 0) && (!featured || product.isFeatured) &&
                (minPrice == null || product.priceCents >= minPrice) && (maxPrice == null || product.priceCents <= maxPrice) &&
                (keyword.isBlank() || listOf(product.name, product.subtitle, product.material, product.tags).any { keyword in it.lowercase() })
        }.toList()
        val sorted = when (sort) {
            "price_asc" -> result.sortedBy { it.priceCents }
            "price_desc" -> result.sortedByDescending { it.priceCents }
            "sales" -> result.sortedByDescending { it.sales }
            else -> result
        }
        return sorted.map(mapper::product)
    }

    @GetMapping("/products/{id}")
    fun product(@PathVariable id: Long): ProductDto {
        val product = products.findById(id).orElseThrow { ResponseStatusException(HttpStatus.NOT_FOUND, "商品不存在") }
        if (product.status != "active") throw ResponseStatusException(HttpStatus.NOT_FOUND, "商品不存在")
        return mapper.product(product)
    }

    @GetMapping("/banners")
    fun banners(@RequestParam(defaultValue = "home_hero") placement: String): List<BannerDto> =
        banners.findAllByPlacementAndIsActiveTrueOrderBySortOrderAscIdAsc(placement).map(mapper::banner)

    @GetMapping("/cart")
    fun cart(@AuthenticationPrincipal principal: UserPrincipal): List<CartItemDto> = cartResponse(principal.id)

    @PostMapping("/cart")
    @Transactional
    fun addCart(
        @AuthenticationPrincipal principal: UserPrincipal,
        @Valid @RequestBody payload: CartAddRequest,
    ): List<CartItemDto> {
        val product = products.findById(payload.productId).orElseThrow { ResponseStatusException(HttpStatus.NOT_FOUND, "商品不存在") }
        require(product.status == "active") { "商品已下架" }
        val existing = cartItems.findByUserIdAndProductId(principal.id, payload.productId)
        val quantity = (existing?.quantity ?: 0) + payload.quantity
        require(quantity <= 99) { "单件商品最多购买 99 件" }
        require(quantity <= product.stock) { "商品库存不足" }
        if (existing == null) cartItems.save(CartItemEntity(userId = principal.id, productId = payload.productId, quantity = quantity))
        else { existing.quantity = quantity; cartItems.save(existing) }
        return cartResponse(principal.id)
    }

    @PutMapping("/cart/{id}")
    @Transactional
    fun updateCart(
        @AuthenticationPrincipal principal: UserPrincipal,
        @PathVariable id: Long,
        @Valid @RequestBody payload: CartUpdateRequest,
    ): List<CartItemDto> {
        val item = cartItems.findByIdAndUserId(id, principal.id) ?: notFound("购物袋商品不存在")
        val product = products.findById(item.productId).orElseThrow { ResponseStatusException(HttpStatus.NOT_FOUND, "商品不存在") }
        require(product.status == "active") { "商品已下架" }
        require(payload.quantity <= product.stock) { "商品库存不足" }
        item.quantity = payload.quantity
        cartItems.save(item)
        return cartResponse(principal.id)
    }

    @DeleteMapping("/cart/{id}")
    @Transactional
    fun deleteCart(@AuthenticationPrincipal principal: UserPrincipal, @PathVariable id: Long): List<CartItemDto> {
        val item = cartItems.findByIdAndUserId(id, principal.id) ?: notFound("购物袋商品不存在")
        cartItems.delete(item)
        cartItems.flush()
        return cartResponse(principal.id)
    }

    @DeleteMapping("/cart")
    @Transactional
    fun clearCart(@AuthenticationPrincipal principal: UserPrincipal): Map<String, Boolean> {
        cartItems.deleteAllByUserId(principal.id)
        return mapOf("ok" to true)
    }

    @GetMapping("/favorites")
    fun favorites(@AuthenticationPrincipal principal: UserPrincipal): List<FavoriteDto> =
        favorites.findAllByUserIdOrderByCreatedAtDesc(principal.id).mapNotNull { favorite ->
            products.findById(favorite.productId).orElse(null)?.takeIf { it.status == "active" }?.let {
                FavoriteDto(favorite.id!!, mapper.product(it), favorite.createdAt)
            }
        }

    @PutMapping("/favorites/{productId}")
    @Transactional
    fun toggleFavorite(@AuthenticationPrincipal principal: UserPrincipal, @PathVariable productId: Long): Map<String, Boolean> {
        val existing = favorites.findByUserIdAndProductId(principal.id, productId)
        if (existing != null) {
            favorites.delete(existing)
            return mapOf("active" to false)
        }
        val product = products.findById(productId).orElseThrow { ResponseStatusException(HttpStatus.NOT_FOUND, "商品不存在") }
        require(product.status == "active") { "商品已下架" }
        favorites.save(FavoriteEntity(userId = principal.id, productId = productId))
        return mapOf("active" to true)
    }

    @GetMapping("/coupons")
    fun coupons(@AuthenticationPrincipal principal: UserPrincipal): List<CouponDto> {
        val owned = userCoupons.findAllByUserId(principal.id).associateBy { it.couponId }
        return coupons.findAllByIsActiveTrueOrderByCreatedAtDesc().map { coupon ->
            val userCoupon = owned[coupon.id]
            mapper.coupon(coupon, claimed = userCoupon != null, used = userCoupon?.usedOrderId != null)
        }
    }

    @PostMapping("/coupons/{couponId}/claim")
    @Transactional
    fun claimCoupon(@AuthenticationPrincipal principal: UserPrincipal, @PathVariable couponId: Long): CouponDto {
        val coupon = coupons.lockById(couponId) ?: notFound("优惠券不存在")
        val existing = userCoupons.findByUserIdAndCouponId(principal.id, couponId)
        if (existing != null) return mapper.coupon(coupon, claimed = true, used = existing.usedOrderId != null)
        val now = Instant.now()
        require(coupon.isActive && coupon.validFrom <= now && (coupon.validUntil == null || coupon.validUntil!!.isAfter(now))) { "优惠券当前不可领取" }
        require(coupon.totalQuantity == 0 || coupon.claimedQuantity < coupon.totalQuantity) { "优惠券已领完" }
        userCoupons.save(UserCouponEntity(userId = principal.id, couponId = couponId))
        coupon.claimedQuantity += 1
        coupons.save(coupon)
        return mapper.coupon(coupon, claimed = true)
    }

    @PostMapping("/orders")
    fun createOrder(@AuthenticationPrincipal principal: UserPrincipal, @Valid @RequestBody payload: CreateOrderRequest): OrderDto =
        orders.create(principal.id, payload)

    @GetMapping("/orders")
    fun orders(@AuthenticationPrincipal principal: UserPrincipal, @RequestParam(required = false) status: String?): List<OrderDto> =
        orders.list(principal.id, status)

    @GetMapping("/orders/by-number/{orderNo}")
    fun orderByNumber(@AuthenticationPrincipal principal: UserPrincipal, @PathVariable orderNo: String): OrderDto =
        orders.getByNumber(principal.id, orderNo)

    @PostMapping("/orders/by-number/{orderNo}/wechat/sync")
    fun syncWechatOrder(@AuthenticationPrincipal principal: UserPrincipal, @PathVariable orderNo: String): OrderDto =
        orders.syncWechat(principal.id, orderNo)

    @PostMapping("/orders/by-number/{orderNo}/refund")
    fun refund(
        @AuthenticationPrincipal principal: UserPrincipal,
        @PathVariable orderNo: String,
        @Valid @RequestBody(required = false) payload: RefundRequest?,
    ): OrderDto = orders.refund(principal.id, orderNo, payload?.reason ?: "用户在小程序申请退款")

    @PostMapping("/orders/by-number/{orderNo}/invoice/apply")
    fun applyInvoice(@AuthenticationPrincipal principal: UserPrincipal, @PathVariable orderNo: String): OrderDto =
        orders.applyInvoice(principal.id, orderNo)

    @GetMapping("/orders/{id}")
    fun order(@AuthenticationPrincipal principal: UserPrincipal, @PathVariable id: Long): OrderDto = orders.get(principal.id, id)

    @PostMapping("/orders/{id}/pay")
    fun pay(@AuthenticationPrincipal principal: UserPrincipal, @PathVariable id: Long): PaymentParamsDto = orders.pay(principal.id, id)

    @GetMapping("/orders/{id}/payment-status")
    fun paymentStatus(@AuthenticationPrincipal principal: UserPrincipal, @PathVariable id: Long): PaymentStatusDto =
        orders.paymentStatus(principal.id, id)

    @PostMapping("/orders/{id}/mock-pay")
    fun mockPay(@AuthenticationPrincipal principal: UserPrincipal, @PathVariable id: Long): OrderDto = orders.mockPay(principal.id, id)

    @PostMapping("/orders/{id}/cancel")
    fun cancel(@AuthenticationPrincipal principal: UserPrincipal, @PathVariable id: Long): OrderDto = orders.cancel(principal.id, id)

    @PostMapping("/orders/{id}/invoice-sync")
    fun syncInvoice(@AuthenticationPrincipal principal: UserPrincipal, @PathVariable id: Long): OrderDto = orders.syncInvoice(principal.id, id)

    private fun cartResponse(userId: Long): List<CartItemDto> = cartItems.findAllByUserIdOrderByCreatedAtDesc(userId).mapNotNull { item ->
        products.findById(item.productId).orElse(null)?.takeIf { it.status == "active" }?.let {
            CartItemDto(item.id!!, mapper.product(it), item.quantity, Math.multiplyExact(it.priceCents, item.quantity))
        }
    }

    private fun setting(key: String, fallback: String): String =
        settings.findByKey(key)?.value?.trim().takeUnless { it.isNullOrBlank() } ?: fallback
    private fun settingInt(key: String, fallback: Int): Int = setting(key, fallback.toString()).toIntOrNull()?.coerceAtLeast(0) ?: fallback
    private fun <T> notFound(message: String): T = throw ResponseStatusException(HttpStatus.NOT_FOUND, message)
}
