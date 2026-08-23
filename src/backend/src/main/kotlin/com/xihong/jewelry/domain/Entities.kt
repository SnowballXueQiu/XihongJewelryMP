package com.xihong.jewelry.domain

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Index
import jakarta.persistence.Lob
import jakarta.persistence.Table
import jakarta.persistence.UniqueConstraint
import java.time.Instant

@Entity
@Table(name = "users", indexes = [Index(name = "idx_users_openid", columnList = "wechat_openid")])
class UserEntity(
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) var id: Long? = null,
    var nickname: String = "微信用户",
    var phone: String = "",
    @Column(name = "avatar_color") var avatarColor: String = "#913F5F",
    @Column(name = "wechat_openid", unique = true) var wechatOpenid: String? = null,
    var points: Int = 0,
    @Column(name = "created_at", nullable = false) var createdAt: Instant = Instant.now(),
)

@Entity
@Table(name = "addresses", indexes = [Index(name = "idx_addresses_user", columnList = "user_id")])
class AddressEntity(
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) var id: Long? = null,
    @Column(name = "user_id", nullable = false) var userId: Long = 0,
    @Column(name = "receiver_name") var receiverName: String = "",
    var phone: String = "",
    var province: String = "",
    var city: String = "",
    var district: String = "",
    var detail: String = "",
    @Column(name = "postal_code") var postalCode: String = "",
    @Column(name = "is_default") var isDefault: Boolean = false,
    @Column(name = "created_at", nullable = false) var createdAt: Instant = Instant.now(),
    @Column(name = "updated_at", nullable = false) var updatedAt: Instant = Instant.now(),
)

@Entity
@Table(name = "categories")
class CategoryEntity(
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) var id: Long? = null,
    var name: String = "",
    @Column(unique = true) var slug: String = "",
    @Column(name = "sort_order") var sortOrder: Int = 0,
    @Column(name = "is_active") var isActive: Boolean = true,
)

@Entity
@Table(name = "products", indexes = [Index(name = "idx_products_category", columnList = "category_slug"), Index(name = "idx_products_status", columnList = "status")])
class ProductEntity(
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) var id: Long? = null,
    var name: String = "",
    var subtitle: String = "",
    @Column(columnDefinition = "text") var description: String = "",
    @Column(name = "category_slug") var categorySlug: String = "",
    var material: String = "",
    @Column(name = "price_cents") var priceCents: Int = 0,
    @Column(name = "original_price_cents") var originalPriceCents: Int = 0,
    var stock: Int = 0,
    var sales: Int = 0,
    @Column(name = "is_featured") var isFeatured: Boolean = false,
    @Column(name = "free_shipping") var freeShipping: Boolean = false,
    @Column(columnDefinition = "text") var tags: String = "[]",
    @Column(name = "image_color") var imageColor: String = "#D8B46A",
    @Column(name = "supports_ar") var supportsAr: Boolean = false,
    @Column(name = "ar_model_url") var arModelUrl: String? = null,
    @Column(name = "ar_scale") var arScale: String = "0.22 0.22 0.22",
    @Column(name = "ar_rotation") var arRotation: String = "0 0 0",
    @Column(name = "ar_position") var arPosition: String = "0 0.08 0",
    @Column(name = "ar_auto_sync") var arAutoSync: Int = 9,
    var status: String = "active",
    @Column(name = "cover_url") var coverUrl: String = "",
    @Column(name = "video_url") var videoUrl: String = "",
    @Column(name = "gallery_urls", columnDefinition = "text") var galleryUrls: String = "[]",
    @Column(name = "sort_order") var sortOrder: Int = 0,
    @Column(name = "created_at", nullable = false) var createdAt: Instant = Instant.now(),
)

@Entity
@Table(name = "cart_items", indexes = [Index(name = "idx_cart_user", columnList = "user_id")], uniqueConstraints = [UniqueConstraint(name = "uq_cart_user_product", columnNames = ["user_id", "product_id"])])
class CartItemEntity(
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) var id: Long? = null,
    @Column(name = "user_id") var userId: Long = 0,
    @Column(name = "product_id") var productId: Long = 0,
    var quantity: Int = 1,
    @Column(name = "created_at") var createdAt: Instant = Instant.now(),
)

@Entity
@Table(name = "favorites", uniqueConstraints = [UniqueConstraint(name = "uq_favorite_user_product", columnNames = ["user_id", "product_id"])])
class FavoriteEntity(
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) var id: Long? = null,
    @Column(name = "user_id") var userId: Long = 0,
    @Column(name = "product_id") var productId: Long = 0,
    @Column(name = "created_at") var createdAt: Instant = Instant.now(),
)

@Entity
@Table(name = "coupons")
class CouponEntity(
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) var id: Long? = null,
    @Column(unique = true) var code: String = "",
    var name: String = "",
    @Column(columnDefinition = "text") var description: String = "",
    @Column(name = "amount_cents") var amountCents: Int = 0,
    @Column(name = "minimum_cents") var minimumCents: Int = 0,
    @Column(name = "total_quantity") var totalQuantity: Int = 0,
    @Column(name = "claimed_quantity") var claimedQuantity: Int = 0,
    @Column(name = "valid_from") var validFrom: Instant = Instant.now(),
    @Column(name = "valid_until") var validUntil: Instant? = null,
    @Column(name = "is_active") var isActive: Boolean = true,
    @Column(name = "created_at") var createdAt: Instant = Instant.now(),
)

@Entity
@Table(name = "user_coupons", uniqueConstraints = [UniqueConstraint(name = "uq_user_coupon", columnNames = ["user_id", "coupon_id"])])
class UserCouponEntity(
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) var id: Long? = null,
    @Column(name = "user_id") var userId: Long = 0,
    @Column(name = "coupon_id") var couponId: Long = 0,
    @Column(name = "used_order_id") var usedOrderId: Long? = null,
    @Column(name = "claimed_at") var claimedAt: Instant = Instant.now(),
    @Column(name = "used_at") var usedAt: Instant? = null,
)

@Entity
@Table(name = "orders", indexes = [Index(name = "idx_orders_number", columnList = "order_no", unique = true), Index(name = "idx_orders_user_status", columnList = "user_id,status")])
class OrderEntity(
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) var id: Long? = null,
    @Column(name = "order_no", unique = true) var orderNo: String = "",
    @Column(name = "client_request_id") var clientRequestId: String = "",
    @Column(name = "user_id") var userId: Long = 0,
    var status: String = "pending_payment",
    @Column(name = "total_cents") var totalCents: Int = 0,
    @Column(name = "subtotal_cents") var subtotalCents: Int = 0,
    @Column(name = "shipping_fee_cents") var shippingFeeCents: Int = 0,
    @Column(name = "discount_cents") var discountCents: Int = 0,
    @Column(name = "coupon_id") var couponId: Long? = null,
    @Column(name = "receiver_name") var receiverName: String = "",
    @Column(name = "receiver_phone") var receiverPhone: String = "",
    @Column(name = "receiver_address", columnDefinition = "text") var receiverAddress: String = "",
    @Column(name = "buyer_note", columnDefinition = "text") var buyerNote: String = "",
    @Column(name = "fulfillment_type") var fulfillmentType: String = "delivery",
    @Column(name = "pickup_slot") var pickupSlot: String = "",
    @Column(name = "pickup_code") var pickupCode: String = "",
    @Column(name = "test_order") var testOrder: Boolean = false,
    @Column(name = "invoice_requested") var invoiceRequested: Boolean = false,
    @Column(name = "invoice_status") var invoiceStatus: String = "not_requested",
    @Column(name = "invoice_apply_id") var invoiceApplyId: String = "",
    @Column(name = "invoice_miniprogram_appid") var invoiceMiniprogramAppid: String = "",
    @Column(name = "invoice_miniprogram_path", columnDefinition = "text") var invoiceMiniprogramPath: String = "",
    @Column(name = "invoice_buyer_type") var invoiceBuyerType: String = "",
    @Column(name = "invoice_buyer_name") var invoiceBuyerName: String = "",
    @Column(name = "invoice_buyer_taxpayer_id") var invoiceBuyerTaxpayerId: String = "",
    @Column(name = "invoice_buyer_address") var invoiceBuyerAddress: String = "",
    @Column(name = "invoice_buyer_telephone") var invoiceBuyerTelephone: String = "",
    @Column(name = "invoice_buyer_bank_name") var invoiceBuyerBankName: String = "",
    @Column(name = "invoice_buyer_bank_account") var invoiceBuyerBankAccount: String = "",
    @Column(name = "invoice_bill_type") var invoiceBillType: String = "",
    @Column(name = "invoice_user_message") var invoiceUserMessage: String = "",
    @Column(name = "invoice_fapiao_id") var invoiceFapiaoId: String = "",
    @Column(name = "invoice_media_id") var invoiceMediaId: String = "",
    @Column(name = "invoice_card_status") var invoiceCardStatus: String = "",
    @Column(name = "invoice_error", columnDefinition = "text") var invoiceError: String = "",
    @Column(name = "invoice_updated_at") var invoiceUpdatedAt: Instant? = null,
    @Column(name = "tracking_no") var trackingNo: String = "",
    @Column(name = "wechat_delivery_id") var wechatDeliveryId: String = "",
    @Column(name = "wechat_delivery_name") var wechatDeliveryName: String = "",
    @Column(name = "waybill_token") var waybillToken: String = "",
    @Column(name = "logistics_status") var logisticsStatus: String = "",
    @Column(name = "logistics_description") var logisticsDescription: String = "",
    @Column(name = "logistics_updated_at") var logisticsUpdatedAt: Instant? = null,
    @Column(name = "platform_shipping_uploaded_at") var platformShippingUploadedAt: Instant? = null,
    @Column(name = "platform_order_state") var platformOrderState: Int = 0,
    @Column(name = "platform_order_state_updated_at") var platformOrderStateUpdatedAt: Instant? = null,
    @Column(name = "platform_order_payload", columnDefinition = "text") var platformOrderPayload: String = "",
    @Column(name = "platform_shipping_error", columnDefinition = "text") var platformShippingError: String = "",
    @Column(name = "created_at") var createdAt: Instant = Instant.now(),
    @Column(name = "updated_at") var updatedAt: Instant = Instant.now(),
    @Column(name = "paid_at") var paidAt: Instant? = null,
    @Column(name = "shipped_at") var shippedAt: Instant? = null,
    @Column(name = "received_at") var receivedAt: Instant? = null,
    @Column(name = "cancelled_at") var cancelledAt: Instant? = null,
    @Column(name = "cancellation_reason") var cancellationReason: String = "",
)

@Entity
@Table(name = "order_items", indexes = [Index(name = "idx_order_items_order", columnList = "order_id")])
class OrderItemEntity(
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) var id: Long? = null,
    @Column(name = "order_id") var orderId: Long = 0,
    @Column(name = "product_id") var productId: Long = 0,
    @Column(name = "product_name") var productName: String = "",
    @Column(name = "unit_price_cents") var unitPriceCents: Int = 0,
    var quantity: Int = 1,
)

@Entity
@Table(name = "payment_intents", indexes = [Index(name = "idx_payment_out_trade_no", columnList = "out_trade_no", unique = true)])
class PaymentIntentEntity(
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) var id: Long? = null,
    @Column(name = "order_id") var orderId: Long = 0,
    var provider: String = "wechat_pay",
    var status: String = "created",
    @Column(name = "out_trade_no", unique = true) var outTradeNo: String = "",
    @Column(name = "transaction_id") var transactionId: String = "",
    @Column(name = "prepay_id") var prepayId: String = "",
    @Column(name = "nonce_str") var nonceStr: String = "",
    @Column(name = "package_value") var packageValue: String = "",
    @Column(name = "pay_sign", columnDefinition = "text") var paySign: String = "",
    @Column(name = "time_stamp") var timeStamp: String = "",
    @Column(name = "failure_reason") var failureReason: String = "",
    @Column(name = "created_at") var createdAt: Instant = Instant.now(),
    @Column(name = "updated_at") var updatedAt: Instant = Instant.now(),
    @Column(name = "expires_at") var expiresAt: Instant? = null,
    @Column(name = "notified_at") var notifiedAt: Instant? = null,
)

@Entity
@Table(name = "refunds", indexes = [Index(name = "idx_refunds_order", columnList = "order_id")])
class RefundEntity(
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) var id: Long? = null,
    @Column(name = "order_id") var orderId: Long = 0,
    @Column(name = "payment_intent_id") var paymentIntentId: Long? = null,
    @Column(name = "out_refund_no", unique = true) var outRefundNo: String = "",
    @Column(name = "refund_id") var refundId: String = "",
    @Column(name = "amount_cents") var amountCents: Int = 0,
    var reason: String = "",
    @Column(name = "previous_status") var previousStatus: String = "paid",
    var status: String = "processing",
    @Column(name = "business_applied_at") var businessAppliedAt: Instant? = null,
    @Column(name = "created_at") var createdAt: Instant = Instant.now(),
    @Column(name = "updated_at") var updatedAt: Instant = Instant.now(),
)

@Entity
@Table(name = "pet_profiles", uniqueConstraints = [UniqueConstraint(name = "uq_pet_user", columnNames = ["user_id"])])
class PetProfileEntity(
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) var id: Long? = null,
    @Column(name = "user_id") var userId: Long = 0,
    var name: String = "玺宝",
    var level: Int = 1,
    var exp: Int = 0,
    var mood: Int = 70,
    var hunger: Int = 40,
    @Column(name = "asset_key") var assetKey: String = "gem-pet-v1",
    @Column(name = "updated_at") var updatedAt: Instant = Instant.now(),
)

@Entity
@Table(name = "point_ledgers")
class PointLedgerEntity(
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) var id: Long? = null,
    @Column(name = "user_id") var userId: Long = 0,
    var action: String = "",
    var points: Int = 0,
    var note: String = "",
    @Column(name = "created_at") var createdAt: Instant = Instant.now(),
)

@Entity
@Table(name = "admin_users")
class AdminUserEntity(
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) var id: Long? = null,
    @Column(unique = true) var email: String = "",
    var name: String = "",
    @Column(name = "password_hash") var passwordHash: String = "",
    var role: String = "admin",
    @Column(name = "is_active") var isActive: Boolean = true,
    @Column(name = "created_at") var createdAt: Instant = Instant.now(),
    @Column(name = "last_login_at") var lastLoginAt: Instant? = null,
)

@Entity
@Table(name = "banners")
class BannerEntity(
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) var id: Long? = null,
    var title: String = "",
    var subtitle: String = "",
    @Column(name = "image_url") var imageUrl: String = "",
    @Column(name = "image_color") var imageColor: String = "#111111",
    var placement: String = "home_hero",
    @Column(name = "link_type") var linkType: String = "none",
    @Column(name = "link_value") var linkValue: String = "",
    @Column(name = "sort_order") var sortOrder: Int = 0,
    @Column(name = "is_active") var isActive: Boolean = true,
    @Column(name = "created_at") var createdAt: Instant = Instant.now(),
)

@Entity
@Table(name = "assets")
class AssetEntity(
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) var id: Long? = null,
    var filename: String = "",
    @Column(name = "original_name") var originalName: String = "",
    @Column(name = "content_type") var contentType: String = "",
    var url: String = "",
    var size: Long = 0,
    @Column(name = "asset_type") var assetType: String = "image",
    @Column(name = "created_at") var createdAt: Instant = Instant.now(),
)

@Entity
@Table(name = "site_settings")
class SiteSettingEntity(
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) var id: Long? = null,
    @Column(unique = true) var key: String = "",
    @Column(columnDefinition = "text") var value: String = "",
    var label: String = "",
    @Column(name = "setting_group") var group: String = "general",
    @Column(name = "updated_at") var updatedAt: Instant = Instant.now(),
)

@Entity
@Table(name = "audit_logs")
class AuditLogEntity(
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) var id: Long? = null,
    @Column(name = "admin_id") var adminId: Long? = null,
    var action: String = "",
    var entity: String = "",
    @Column(name = "entity_id") var entityId: String = "",
    @Column(columnDefinition = "text") var detail: String = "",
    @Column(name = "created_at") var createdAt: Instant = Instant.now(),
)

@Entity
@Table(name = "callback_events", uniqueConstraints = [UniqueConstraint(name = "uq_callback_source_event", columnNames = ["source", "event_id"])])
class CallbackEventEntity(
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) var id: Long? = null,
    var source: String = "",
    @Column(name = "event_id") var eventId: String = "",
    @Column(name = "event_type") var eventType: String = "",
    @Column(name = "request_id") var requestId: String = "",
    @Lob @Column(name = "payload", columnDefinition = "text") var payload: String = "",
    var status: String = "received",
    var attempts: Int = 0,
    @Column(name = "last_error", columnDefinition = "text") var lastError: String = "",
    @Column(name = "received_at") var receivedAt: Instant = Instant.now(),
    @Column(name = "processed_at") var processedAt: Instant? = null,
)
