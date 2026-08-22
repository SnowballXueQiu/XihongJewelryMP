package com.xihong.jewelry.service

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.xihong.jewelry.controller.*
import com.xihong.jewelry.domain.*
import com.xihong.jewelry.repository.OrderItemRepository
import com.xihong.jewelry.repository.PaymentIntentRepository
import org.springframework.stereotype.Service
import java.time.Instant

@Service
class DomainMapper(
    private val mapper: ObjectMapper,
    private val orderItems: OrderItemRepository,
    private val payments: PaymentIntentRepository,
) {
    fun product(entity: ProductEntity) = ProductDto(
        entity.id!!, entity.name, entity.subtitle, entity.description, entity.categorySlug, entity.material,
        entity.priceCents, entity.originalPriceCents, entity.stock, entity.sales, entity.isFeatured,
        entity.freeShipping, stringList(entity.tags), entity.imageColor, entity.supportsAr, entity.arModelUrl,
        entity.arScale, entity.arRotation, entity.arPosition, entity.arAutoSync, entity.status, entity.coverUrl,
        stringList(entity.galleryUrls), entity.sortOrder,
    )

    fun apply(entity: ProductEntity, value: ProductWrite): ProductEntity = entity.apply {
        name = value.name; subtitle = value.subtitle; description = value.description; categorySlug = value.categorySlug
        material = value.material; priceCents = value.priceCents; originalPriceCents = value.originalPriceCents
        stock = value.stock; sales = value.sales; isFeatured = value.isFeatured; freeShipping = value.freeShipping
        tags = mapper.writeValueAsString(value.tags); imageColor = value.imageColor; supportsAr = value.supportsAr
        arModelUrl = value.arModelUrl; arScale = value.arScale; arRotation = value.arRotation; arPosition = value.arPosition
        arAutoSync = value.arAutoSync; status = value.status; coverUrl = value.coverUrl
        galleryUrls = mapper.writeValueAsString(value.galleryUrls); sortOrder = value.sortOrder
    }

    fun category(entity: CategoryEntity) = CategoryDto(entity.id!!, entity.name, entity.slug, entity.sortOrder, entity.isActive)
    fun banner(entity: BannerEntity) = BannerDto(entity.id!!, entity.title, entity.subtitle, entity.imageUrl, entity.imageColor, entity.placement, entity.linkType, entity.linkValue, entity.sortOrder, entity.isActive)
    fun user(entity: UserEntity) = UserDto(entity.id!!, entity.nickname, entity.phone, entity.avatarColor, entity.wechatOpenid, entity.points, entity.createdAt)
    fun address(entity: AddressEntity) = AddressDto(entity.id!!, entity.receiverName, entity.phone, entity.province, entity.city, entity.district, entity.detail, entity.postalCode, entity.isDefault)
    fun coupon(entity: CouponEntity, claimed: Boolean = false, used: Boolean = false): CouponDto {
        val now = Instant.now()
        val available = entity.isActive && !used && entity.validFrom <= now && (entity.validUntil == null || entity.validUntil!!.isAfter(now)) && (entity.totalQuantity == 0 || entity.claimedQuantity < entity.totalQuantity)
        return CouponDto(entity.id!!, entity.code, entity.name, entity.description, entity.amountCents, entity.minimumCents,
            entity.totalQuantity, entity.claimedQuantity, entity.validFrom, entity.validUntil, entity.isActive, claimed, used, available)
    }

    fun refund(entity: RefundEntity) = RefundDto(
        entity.id!!, entity.orderId, entity.outRefundNo, entity.refundId, entity.amountCents, entity.reason,
        entity.previousStatus, entity.status, entity.createdAt, entity.updatedAt, entity.businessAppliedAt,
    )
    fun payment(entity: PaymentIntentEntity) = PaymentAdminDto(entity.id!!, entity.orderId, entity.provider, entity.status, entity.outTradeNo, entity.transactionId, entity.failureReason, entity.createdAt, entity.updatedAt, entity.notifiedAt)
    fun pet(entity: PetProfileEntity): PetDto {
        val levels = listOf(1 to 0, 2 to 100, 3 to 300, 4 to 700, 5 to 1300)
        val next = levels.firstOrNull { it.second > entity.exp }?.second ?: entity.exp
        val rewards = mapOf(1 to "新人清洁布", 2 to "会员包邮券", 3 to "珠宝清洁保养券", 4 to "生日礼预约资格", 5 to "VIP 新品预览资格")
        return PetDto(entity.id!!, entity.userId, entity.name, entity.level, entity.exp, entity.mood, entity.hunger, next, rewards[entity.level] ?: "会员权益", entity.assetKey)
    }

    fun order(entity: OrderEntity, payment: PaymentParamsDto? = null): OrderDto {
        // A retry creates a newer intent. Receipt confirmation still needs the successful real
        // WeChat transaction, not whichever local attempt happened to be created last.
        val confirmedPayment = payments.findAllByOrderIdOrderByCreatedAtDesc(entity.id!!).firstOrNull {
            it.provider == "wechat_pay" &&
                it.status == "succeeded" &&
                it.transactionId.isNotBlank() &&
                !it.transactionId.startsWith("mock_") &&
                !it.outTradeNo.startsWith("mock_")
        }
        val payload = runCatching { mapper.readTree(entity.platformOrderPayload.ifBlank { "{}" }) }.getOrElse { mapper.createObjectNode() }
        val platformLabel = when (entity.platformOrderState) {
            1 -> "待发货"; 2 -> "已发货"; 3 -> "已确认收货"; 4 -> "交易完成"; 5 -> "已退款"; else -> "尚未同步"
        }
        val description = entity.logisticsDescription.ifBlank { logisticsDescription(payload) }
        val displayStatus = authoritativeStatus(entity)
        return OrderDto(
            id = entity.id!!, orderNo = entity.orderNo, status = displayStatus, totalCents = entity.totalCents,
            subtotalCents = entity.subtotalCents, shippingFeeCents = entity.shippingFeeCents, discountCents = entity.discountCents,
            couponId = entity.couponId, items = orderItems.findAllByOrderIdOrderByIdAsc(entity.id!!).map {
                OrderItemDto(it.productId, it.productName, it.unitPriceCents, it.quantity)
            }, payment = payment, receiverName = entity.receiverName, receiverPhone = entity.receiverPhone,
            receiverAddress = entity.receiverAddress, buyerNote = entity.buyerNote, fulfillmentType = entity.fulfillmentType,
            pickupSlot = entity.pickupSlot, pickupCode = entity.pickupCode, testOrder = entity.testOrder,
            invoiceRequested = entity.invoiceRequested, invoiceStatus = entity.invoiceStatus, invoiceApplyId = entity.invoiceApplyId,
            invoiceBuyerType = entity.invoiceBuyerType, invoiceBuyerName = entity.invoiceBuyerName,
            invoiceBuyerTaxpayerId = entity.invoiceBuyerTaxpayerId, invoiceBuyerAddress = entity.invoiceBuyerAddress,
            invoiceBuyerTelephone = entity.invoiceBuyerTelephone, invoiceBuyerBankName = entity.invoiceBuyerBankName,
            invoiceBuyerBankAccount = entity.invoiceBuyerBankAccount, invoiceBillType = entity.invoiceBillType,
            invoiceUserMessage = entity.invoiceUserMessage, invoiceFapiaoId = entity.invoiceFapiaoId,
            invoiceMediaId = entity.invoiceMediaId, invoiceCardStatus = entity.invoiceCardStatus, invoiceError = entity.invoiceError,
            invoiceMiniprogramAppid = entity.invoiceMiniprogramAppid, invoiceMiniprogramPath = entity.invoiceMiniprogramPath,
            trackingNo = entity.trackingNo, paymentTransactionId = confirmedPayment?.transactionId ?: "",
            platformShippingUploadedAt = entity.platformShippingUploadedAt, platformOrderState = entity.platformOrderState,
            platformOrderStateUpdatedAt = entity.platformOrderStateUpdatedAt, platformShippingError = entity.platformShippingError,
            platformOrderStateLabel = platformLabel, logisticsStatus = entity.logisticsStatus,
            logisticsDescription = description, logisticsUpdatedAt = entity.logisticsUpdatedAt ?: entity.platformOrderStateUpdatedAt,
            canPay = displayStatus == "pending_payment", canCancel = displayStatus == "pending_payment",
            canRefund = displayStatus in setOf("paid", "preparing", "in_transit", "shipped", "received", "completed") &&
                InvoiceWorkflowPolicy.canRefundWithoutTaxReversal(entity.invoiceStatus),
            // Both delivery (logistics_type=1) and in-store pickup (logistics_type=4) are platform
            // orders. Receipt confirmation belongs to WeChat and is gated by its state, not by our
            // fulfilment presentation.
            canConfirmReceipt = entity.platformOrderState == 2 && displayStatus !in setOf("refunding", "refunded"),
            canApplyInvoice = displayStatus in setOf("received", "completed") && entity.invoiceStatus in setOf("not_requested", "apply_failed"),
            createdAt = entity.createdAt, paidAt = entity.paidAt, shippedAt = entity.shippedAt, completedAt = entity.receivedAt,
        )
    }

    fun authoritativeStatus(entity: OrderEntity): String = when {
        // 微信平台已退款是终态，必须覆盖本地仍停留在 refunding 的中间态。
        entity.platformOrderState == 5 -> "refunded"
        entity.status in setOf("cancelled", "refunding", "refunded", "failed") -> entity.status
        // 对外沿用后台/小程序既有状态枚举；更细的微信物流阶段通过 platformLogisticsStatus 展示。
        entity.platformOrderState in setOf(3, 4) -> "completed"
        entity.platformOrderState == 2 -> "shipped"
        entity.platformOrderState == 1 -> if (entity.paidAt != null) "paid" else entity.status
        else -> entity.status
    }

    private fun logisticsDescription(root: JsonNode): String {
        val shipping = root.path("shipping").takeUnless { it.isMissingNode } ?: root.path("order").path("shipping")
        val list = shipping.path("shipping_list")
        if (list.isArray && list.size() > 0) {
            val first = list[0]
            return listOfNotNull(first.path("express_company").asText().takeIf(String::isNotBlank), first.path("tracking_no").asText().takeIf(String::isNotBlank)).joinToString(" · ")
        }
        return entityText(root, "logistics_detail", "shipping_status_desc")
    }

    private fun entityText(root: JsonNode, vararg keys: String): String = keys.firstNotNullOfOrNull { key -> root.path(key).asText().takeIf(String::isNotBlank) } ?: ""
    private fun stringList(value: String): List<String> = runCatching { mapper.readValue(value, object : TypeReference<List<String>>() {}) }.getOrDefault(emptyList())
}
