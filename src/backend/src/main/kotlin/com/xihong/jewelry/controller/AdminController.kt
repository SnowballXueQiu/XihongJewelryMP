package com.xihong.jewelry.controller

import com.xihong.jewelry.security.AdminPrincipal
import com.xihong.jewelry.service.AdminService
import jakarta.validation.Valid
import jakarta.servlet.http.HttpServletRequest
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.*
import org.springframework.web.multipart.MultipartFile
import java.time.OffsetDateTime

@RestController
@RequestMapping("/api/admin")
class AdminController(private val service: AdminService) {
    @PostMapping("/auth/login")
    fun login(@Valid @RequestBody value: AdminLoginRequest, request: HttpServletRequest) = service.login(
        value,
        request.getHeader("X-Real-IP")?.trim()?.takeIf(String::isNotBlank) ?: request.remoteAddr.orEmpty(),
    )

    @GetMapping("/me")
    fun me(@AuthenticationPrincipal principal: AdminPrincipal) = service.me(principal)

    @GetMapping("/dashboard")
    fun dashboard() = service.dashboard()

    @GetMapping("/products")
    fun products() = service.listProducts()

    @PostMapping("/products")
    fun createProduct(@Valid @RequestBody value: ProductWrite, @AuthenticationPrincipal principal: AdminPrincipal) =
        service.createProduct(value, principal)

    @PutMapping("/products/{id}")
    fun updateProduct(@PathVariable id: Long, @Valid @RequestBody value: ProductWrite, @AuthenticationPrincipal principal: AdminPrincipal) =
        service.updateProduct(id, value, principal)

    @DeleteMapping("/products/{id}")
    fun deleteProduct(@PathVariable id: Long, @AuthenticationPrincipal principal: AdminPrincipal) = service.deleteProduct(id, principal)

    @GetMapping("/categories")
    fun categories() = service.listCategories()

    @PostMapping("/categories")
    fun createCategory(@Valid @RequestBody value: CategoryWrite, @AuthenticationPrincipal principal: AdminPrincipal) =
        service.createCategory(value, principal)

    @PutMapping("/categories/{id}")
    fun updateCategory(@PathVariable id: Long, @Valid @RequestBody value: CategoryWrite, @AuthenticationPrincipal principal: AdminPrincipal) =
        service.updateCategory(id, value, principal)

    @DeleteMapping("/categories/{id}")
    fun deleteCategory(@PathVariable id: Long, @AuthenticationPrincipal principal: AdminPrincipal) = service.deleteCategory(id, principal)

    @GetMapping("/banners")
    fun banners() = service.listBanners()

    @PostMapping("/banners")
    fun createBanner(@Valid @RequestBody value: BannerWrite, @AuthenticationPrincipal principal: AdminPrincipal) =
        service.createBanner(value, principal)

    @PutMapping("/banners/{id}")
    fun updateBanner(@PathVariable id: Long, @Valid @RequestBody value: BannerWrite, @AuthenticationPrincipal principal: AdminPrincipal) =
        service.updateBanner(id, value, principal)

    @DeleteMapping("/banners/{id}")
    fun deleteBanner(@PathVariable id: Long, @AuthenticationPrincipal principal: AdminPrincipal) = service.deleteBanner(id, principal)

    @GetMapping("/orders")
    fun orders() = service.listOrders()

    @GetMapping("/orders/{id}")
    fun order(@PathVariable id: Long) = service.getOrder(id)

    @GetMapping("/delivery-companies")
    fun deliveryCompanies(@RequestParam(defaultValue = "false") refresh: Boolean) = service.listDeliveryCompanies(refresh)

    @PutMapping("/orders/{id}/status")
    fun updateOrderStatus(
        @PathVariable id: Long,
        @Valid @RequestBody value: AdminOrderStatusUpdate,
        @AuthenticationPrincipal principal: AdminPrincipal,
    ) = service.updateOrderStatus(id, value, principal)

    @PostMapping("/orders/{id}/platform-sync")
    fun syncPlatformOrder(@PathVariable id: Long, @AuthenticationPrincipal principal: AdminPrincipal) =
        service.syncPlatformOrder(id, principal)

    @PostMapping("/orders/{id}/platform-remind-receive")
    fun remindPlatformReceive(@PathVariable id: Long, @AuthenticationPrincipal principal: AdminPrincipal) =
        service.remindPlatformReceive(id, principal)

    @GetMapping("/payments")
    fun payments() = service.listPayments()

    @GetMapping("/refunds")
    fun refunds() = service.listRefunds()

    @PostMapping("/orders/{id}/refund")
    fun refundOrder(
        @PathVariable id: Long,
        @Valid @RequestBody value: RefundRequest,
        @AuthenticationPrincipal principal: AdminPrincipal,
    ) = service.refundOrder(id, value, principal)

    @GetMapping("/invoices")
    fun invoices() = service.listInvoices()

    @GetMapping("/invoices/capability")
    fun invoiceCapability() = service.invoiceCapability()

    @PostMapping("/invoices/{id}/sync-title")
    fun syncInvoiceTitle(@PathVariable id: Long, @AuthenticationPrincipal principal: AdminPrincipal) =
        service.syncInvoiceTitle(id, principal)

    @PostMapping("/invoices/{id}/sync-status")
    fun syncInvoiceStatus(@PathVariable id: Long, @AuthenticationPrincipal principal: AdminPrincipal) =
        service.syncInvoiceStatus(id, principal)

    @PostMapping("/invoices/{id}/deliver", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun deliverInvoice(
        @PathVariable id: Long,
        @RequestPart("file") file: MultipartFile,
        @RequestParam("fapiao_number") fapiaoNumber: String,
        @RequestParam("fapiao_code") fapiaoCode: String,
        @RequestParam("fapiao_time") fapiaoTime: OffsetDateTime,
        @RequestParam("check_code") checkCode: String,
        @RequestParam("password") password: String,
        @RequestParam("total_amount") totalAmount: Long,
        @RequestParam("tax_amount") taxAmount: Long,
        @RequestParam("seller_name") sellerName: String,
        @RequestParam("seller_taxpayer_id") sellerTaxpayerId: String,
        @RequestParam("drawer") drawer: String,
        @AuthenticationPrincipal principal: AdminPrincipal,
    ) = service.deliverInvoice(
        id = id,
        value = AdminInvoiceDeliveryRequest(
            fapiaoNumber = fapiaoNumber,
            fapiaoCode = fapiaoCode,
            fapiaoTime = fapiaoTime,
            checkCode = checkCode,
            password = password,
            totalAmount = totalAmount,
            taxAmount = taxAmount,
            sellerName = sellerName,
            sellerTaxpayerId = sellerTaxpayerId,
            drawer = drawer,
        ),
        file = file,
        principal = principal,
    )

    @GetMapping("/coupons")
    fun coupons() = service.listCoupons()

    @PostMapping("/coupons")
    fun createCoupon(@Valid @RequestBody value: CouponWrite, @AuthenticationPrincipal principal: AdminPrincipal) =
        service.createCoupon(value, principal)

    @PutMapping("/coupons/{id}")
    fun updateCoupon(@PathVariable id: Long, @Valid @RequestBody value: CouponWrite, @AuthenticationPrincipal principal: AdminPrincipal) =
        service.updateCoupon(id, value, principal)

    @DeleteMapping("/coupons/{id}")
    fun deleteCoupon(@PathVariable id: Long, @AuthenticationPrincipal principal: AdminPrincipal) = service.deleteCoupon(id, principal)

    @GetMapping("/users")
    fun users() = service.listUsers()

    @PostMapping("/users/{id}/points")
    fun adjustPoints(@PathVariable id: Long, @Valid @RequestBody value: UserPointsUpdate, @AuthenticationPrincipal principal: AdminPrincipal) =
        service.adjustPoints(id, value, principal)

    @GetMapping("/pets")
    fun pets() = service.listPets()

    @GetMapping("/assets")
    fun assets() = service.listAssets()

    @PostMapping("/assets")
    fun uploadAsset(@RequestPart("file") file: MultipartFile, @AuthenticationPrincipal principal: AdminPrincipal) =
        service.uploadAsset(file, principal)

    @DeleteMapping("/assets/{id}")
    fun deleteAsset(@PathVariable id: Long, @AuthenticationPrincipal principal: AdminPrincipal) = service.deleteAsset(id, principal)

    @GetMapping("/settings")
    fun settings() = service.listSettings()

    @PutMapping("/settings/{key}")
    fun updateSetting(@PathVariable key: String, @Valid @RequestBody value: SettingWrite, @AuthenticationPrincipal principal: AdminPrincipal) =
        service.updateSetting(key, value, principal)

    @PutMapping("/settings")
    fun updateSettings(@Valid @RequestBody value: SettingBulkWrite, @AuthenticationPrincipal principal: AdminPrincipal) =
        service.updateSettings(value, principal)

    @GetMapping("/platform-trade/status")
    fun platformStatus() = service.platformStatus()

    @PostMapping("/platform-trade/order-detail-path")
    fun configureOrderPath(@Valid @RequestBody value: PathWrite, @AuthenticationPrincipal principal: AdminPrincipal) =
        service.configureOrderPath(value, principal)

    @PostMapping("/platform-trade/message-path")
    fun configureMessagePath(@Valid @RequestBody value: PathWrite, @AuthenticationPrincipal principal: AdminPrincipal) =
        service.configureMessagePath(value, principal)

    @GetMapping("/admin-users")
    fun admins(@AuthenticationPrincipal principal: AdminPrincipal) = service.listAdmins(principal)

    @PostMapping("/admin-users")
    fun createAdmin(@Valid @RequestBody value: AdminUserWrite, @AuthenticationPrincipal principal: AdminPrincipal) =
        service.createAdmin(value, principal)

    @PutMapping("/admin-users/{id}")
    fun updateAdmin(@PathVariable id: Long, @Valid @RequestBody value: AdminUserUpdate, @AuthenticationPrincipal principal: AdminPrincipal) =
        service.updateAdmin(id, value, principal)

    @DeleteMapping("/admin-users/{id}")
    fun deleteAdmin(@PathVariable id: Long, @AuthenticationPrincipal principal: AdminPrincipal) = service.deleteAdmin(id, principal)

    @GetMapping("/audit-logs")
    fun auditLogs() = service.listAudit()
}
