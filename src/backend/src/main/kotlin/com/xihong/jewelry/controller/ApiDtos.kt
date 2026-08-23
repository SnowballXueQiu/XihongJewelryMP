package com.xihong.jewelry.controller

import com.fasterxml.jackson.annotation.JsonProperty
import jakarta.validation.Valid
import jakarta.validation.constraints.Email
import jakarta.validation.constraints.Max
import jakarta.validation.constraints.Min
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Pattern
import jakarta.validation.constraints.Size
import java.time.Instant
import java.time.OffsetDateTime

data class ErrorDto(val detail: String)

data class StoreConfigDto(
    val companyNameZh: String,
    val companyNameEn: String,
    val shippingFeeCents: Int,
    val freeShippingThresholdCents: Int,
    val pickupStoreName: String,
    val pickupStoreAddress: String,
    val pickupStorePhone: String,
)

data class CategoryDto(val id: Long, val name: String, val slug: String, val sortOrder: Int, val isActive: Boolean)
data class CategoryWrite(@field:NotBlank val name: String, @field:NotBlank val slug: String, val sortOrder: Int = 0, val isActive: Boolean = true)

data class ProductDto(
    val id: Long, val name: String, val subtitle: String, val description: String, val categorySlug: String,
    val material: String, val priceCents: Int, val originalPriceCents: Int, val stock: Int, val sales: Int,
    val isFeatured: Boolean, val freeShipping: Boolean, val tags: List<String>, val imageColor: String,
    val supportsAr: Boolean, val arModelUrl: String?, val arScale: String, val arRotation: String,
    val arPosition: String, val arAutoSync: Int, val status: String, val coverUrl: String,
    val videoUrl: String, val galleryUrls: List<String>, val sortOrder: Int,
)

data class ProductWrite(
    @field:NotBlank val name: String, val subtitle: String = "", val description: String = "",
    @field:NotBlank val categorySlug: String, val material: String = "", @field:Min(0) val priceCents: Int,
    @field:Min(0) val originalPriceCents: Int = 0, @field:Min(0) val stock: Int = 0, @field:Min(0) val sales: Int = 0,
    val isFeatured: Boolean = false, val freeShipping: Boolean = false, val tags: List<String> = emptyList(),
    val imageColor: String = "#D8B46A", val supportsAr: Boolean = false, val arModelUrl: String? = null,
    val arScale: String = "0.22 0.22 0.22", val arRotation: String = "0 0 0", val arPosition: String = "0 0.08 0",
    val arAutoSync: Int = 9, val status: String = "active", val coverUrl: String = "", val videoUrl: String = "",
    val galleryUrls: List<String> = emptyList(), val sortOrder: Int = 0,
)

data class BannerDto(
    val id: Long, val title: String, val subtitle: String, val imageUrl: String, val imageColor: String,
    val placement: String, val linkType: String, val linkValue: String, val sortOrder: Int, val isActive: Boolean,
)
data class BannerWrite(
    @field:NotBlank val title: String, val subtitle: String = "", val imageUrl: String = "",
    val imageColor: String = "#111111", val placement: String = "home_hero", val linkType: String = "none",
    val linkValue: String = "", val sortOrder: Int = 0, val isActive: Boolean = true,
)

data class UserDto(
    val id: Long, val nickname: String, val phone: String, val avatarColor: String,
    val wechatOpenid: String?, val points: Int, val createdAt: Instant,
)
data class UserTokenDto(val accessToken: String, val tokenType: String = "bearer", val user: UserDto)
data class WechatLoginRequest(@field:NotBlank val code: String, @field:Size(max = 40) val nickname: String = "微信用户")
data class WechatPhoneRequest(@field:NotBlank val code: String)

data class AddressDto(
    val id: Long, val receiverName: String, val phone: String, val province: String, val city: String,
    val district: String, val detail: String, val postalCode: String, val isDefault: Boolean,
)
data class AddressWrite(
    @field:NotBlank val receiverName: String,
    @field:Pattern(regexp = "^1\\d{10}$") val phone: String,
    @field:NotBlank val province: String, @field:NotBlank val city: String, @field:NotBlank val district: String,
    @field:NotBlank val detail: String, val postalCode: String = "", val isDefault: Boolean = false,
)

data class CartAddRequest(val productId: Long, @field:Min(1) @field:Max(99) val quantity: Int = 1)
data class CartUpdateRequest(@field:Min(1) @field:Max(99) val quantity: Int)
data class CartItemDto(val id: Long, val product: ProductDto, val quantity: Int, val subtotalCents: Int)
data class FavoriteDto(val id: Long, val product: ProductDto, val createdAt: Instant)

data class CouponDto(
    val id: Long, val code: String, val name: String, val description: String, val amountCents: Int,
    val minimumCents: Int, val totalQuantity: Int, val claimedQuantity: Int, val validFrom: Instant,
    val validUntil: Instant?, val isActive: Boolean, val claimed: Boolean = false, val used: Boolean = false,
    val available: Boolean = true,
)
data class CouponWrite(
    @field:Size(min = 2, max = 32) val code: String, @field:NotBlank val name: String,
    @field:Size(max = 200) val description: String = "", @field:Min(1) val amountCents: Int,
    @field:Min(0) val minimumCents: Int = 0, @field:Min(0) val totalQuantity: Int = 0,
    val validFrom: Instant, val validUntil: Instant? = null, val isActive: Boolean = true,
)

data class CheckoutItem(val productId: Long, @field:Min(1) @field:Max(99) val quantity: Int = 1)
data class CreateOrderRequest(
    @field:Valid @field:Size(min = 1) val items: List<CheckoutItem>, val addressId: Long? = null,
    val couponId: Long? = null, @field:Size(max = 200) val buyerNote: String = "",
    val fulfillmentType: String = "delivery", val pickupSlot: String = "",
    @Deprecated("发票仅允许收货后申请") val invoiceRequested: Boolean = false,
    @field:Pattern(regexp = "^[A-Za-z0-9_-]*$") val clientRequestId: String = "",
)
data class OrderItemDto(val productId: Long, val productName: String, val unitPriceCents: Int, val quantity: Int)

data class PaymentParamsDto(
    val provider: String,
    @get:JsonProperty("appId") val appId: String,
    @get:JsonProperty("timeStamp") val timeStamp: String,
    @get:JsonProperty("nonceStr") val nonceStr: String,
    @get:JsonProperty("package") val packageValue: String,
    @get:JsonProperty("signType") val signType: String = "RSA",
    @get:JsonProperty("paySign") val paySign: String,
    @get:JsonProperty("prepayId") val prepayId: String,
    @get:JsonProperty("outTradeNo") val outTradeNo: String,
    val mock: Boolean,
)

data class OrderDto(
    val id: Long, val orderNo: String, val status: String, val totalCents: Int, val subtotalCents: Int,
    val shippingFeeCents: Int, val discountCents: Int, val couponId: Long?, val items: List<OrderItemDto>,
    val payment: PaymentParamsDto? = null, val receiverName: String, val receiverPhone: String,
    val receiverAddress: String, val buyerNote: String, val fulfillmentType: String, val pickupSlot: String,
    val pickupCode: String, val invoiceRequested: Boolean, val invoiceStatus: String,
    val invoiceApplyId: String, val invoiceBuyerType: String, val invoiceBuyerName: String,
    val invoiceBuyerTaxpayerId: String, val invoiceBuyerAddress: String, val invoiceBuyerTelephone: String,
    val invoiceBuyerBankName: String, val invoiceBuyerBankAccount: String, val invoiceBillType: String,
    val invoiceUserMessage: String, val invoiceFapiaoId: String, val invoiceMediaId: String,
    val invoiceCardStatus: String, val invoiceError: String,
    val invoiceMiniprogramAppid: String = "", val invoiceMiniprogramPath: String = "",
    val logisticsCompany: String = "", val wechatDeliveryId: String = "", val wechatDeliveryName: String = "",
    val trackingNo: String, val paymentTransactionId: String,
    val platformShippingUploadedAt: Instant?, val platformOrderState: Int, val platformOrderStateUpdatedAt: Instant?,
    val platformShippingError: String, val platformConfirmReceiveRemindedAt: Instant? = null,
    val platformOrderStateLabel: String,
    val platformOrderStatusText: String = platformOrderStateLabel,
    val logisticsStatus: String, val logisticsDescription: String,
    val logisticsUpdatedAt: Instant?, val platformLogisticsStatus: String = logisticsStatus,
    val platformLogisticsDetail: String = logisticsDescription,
    val platformLogisticsUpdatedAt: Instant? = logisticsUpdatedAt,
    val canPay: Boolean, val canCancel: Boolean, val canRefund: Boolean,
    val canConfirmReceipt: Boolean, val canApplyInvoice: Boolean,
    val createdAt: Instant?, val paidAt: Instant?, val shippedAt: Instant?, val completedAt: Instant?,
)

data class PaymentStatusDto(
    val orderId: Long, val orderStatus: String, val paymentStatus: String?, val transactionId: String,
    val message: String,
)
data class RefundRequest(@field:Size(min = 1, max = 80) val reason: String = "用户申请退款")
data class RefundDto(
    val id: Long, val orderId: Long, val outRefundNo: String, val refundId: String, val amountCents: Int,
    val reason: String, val previousStatus: String, val status: String, val createdAt: Instant, val updatedAt: Instant,
    val businessAppliedAt: Instant? = null,
)
data class ShippingRequest(@field:NotBlank val trackingNo: String, @field:NotBlank val deliveryId: String)

/**
 * 管理端履约动作只接收业务状态、微信官方运力 ID 和运单号。
 */
data class AdminOrderStatusUpdate(
    @field:Pattern(regexp = "^(preparing|shipped|completed|cancelled|refunding|refunded)$") val status: String,
    @field:Size(max = 128) val trackingNo: String = "",
    @field:Size(max = 64) val deliveryId: String = "",
)

data class DeliveryCompanyDto(val deliveryId: String, val deliveryName: String, val common: Boolean = false)

data class InvoiceApplyDto(val orderNo: String, val invoiceApplyId: String, val status: String, val message: String)

data class PetDto(
    val id: Long, val userId: Long, val name: String, val level: Int, val exp: Int, val mood: Int,
    val hunger: Int, val nextLevelExp: Int, val reward: String, val assetKey: String,
)
data class PetActionRequest(@field:Pattern(regexp = "^(feed|pet|checkin)$") val action: String)

data class AdminLoginRequest(@field:Email val email: String, @field:NotBlank val password: String)
data class AdminTokenDto(val accessToken: String, val tokenType: String = "bearer")
data class AdminUserDto(
    val id: Long, val email: String, val name: String, val role: String, val isActive: Boolean,
    val createdAt: Instant, val lastLoginAt: Instant?,
)
data class AdminUserWrite(
    @field:Email val email: String, @field:NotBlank val name: String, @field:Size(min = 12) val password: String,
    val role: String = "admin", val isActive: Boolean = true,
)
data class AdminUserUpdate(val name: String? = null, val password: String? = null, val role: String? = null, val isActive: Boolean? = null)

data class DashboardDto(
    val productCount: Long, val activeProductCount: Long, val lowStockCount: Long, val pendingOrderCount: Long,
    val paidOrderCount: Long, val todayOrderCount: Long, val todayRevenueCents: Long, val totalRevenueCents: Long,
    val userCount: Long,
)
data class PaymentAdminDto(
    val id: Long, val orderId: Long, val provider: String, val status: String, val outTradeNo: String,
    val transactionId: String, val failureReason: String, val createdAt: Instant, val updatedAt: Instant,
    val notifiedAt: Instant?,
)
data class AssetDto(
    val id: Long, val filename: String, val originalName: String, val contentType: String, val url: String,
    val size: Long, val assetType: String, val createdAt: Instant,
)
data class SettingDto(val key: String, val value: String, val label: String, val group: String)
data class SettingWrite(val value: String, val label: String = "", val group: String = "general")
data class SettingBulkWrite(val settings: Map<String, SettingWrite>)
data class UserPointsUpdate(@field:Min(-1_000_000) @field:Max(1_000_000) val delta: Int, val note: String = "后台人工调整")
data class AuditLogDto(
    val id: Long, val adminId: Long?, val action: String, val entity: String, val entityId: String,
    val detail: String, val createdAt: Instant,
)
data class PlatformTradeStatusDto(
    val orderDetailPath: String, val messagePath: String, val orderCenterConfigured: Boolean,
    val shippingServiceEnabled: Boolean, val settlementConfirmed: Boolean,
)
data class PathWrite(@field:NotBlank val path: String)
data class InvoiceCapabilityDto(val configured: Boolean, val statusMode: String, val applicationCount: Long)
data class AdminInvoiceDeliveryRequest(
    val fapiaoNumber: String,
    val fapiaoCode: String,
    val fapiaoTime: OffsetDateTime,
    val checkCode: String,
    val password: String,
    val totalAmount: Long,
    val taxAmount: Long,
    val sellerName: String,
    val sellerTaxpayerId: String,
    val drawer: String,
)
data class OperationResultDto(val ok: Boolean = true)
