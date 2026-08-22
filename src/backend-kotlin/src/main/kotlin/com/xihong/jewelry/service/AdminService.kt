package com.xihong.jewelry.service

import com.xihong.jewelry.config.AppProperties
import com.xihong.jewelry.controller.*
import com.xihong.jewelry.domain.*
import com.xihong.jewelry.repository.*
import com.xihong.jewelry.security.AdminPrincipal
import com.xihong.jewelry.security.AdminLoginThrottle
import com.xihong.jewelry.security.PasswordService
import com.xihong.jewelry.security.TokenService
import org.springframework.data.domain.PageRequest
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.multipart.MultipartFile
import org.springframework.web.server.ResponseStatusException
import java.nio.file.Files
import java.nio.file.Path
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

@Service
class AdminService(
    private val properties: AppProperties,
    private val tokens: TokenService,
    private val passwords: PasswordService,
    private val loginThrottle: AdminLoginThrottle,
    private val domain: DomainMapper,
    private val platform: WechatPlatformService,
    private val orderWorkflow: OrderService,
    private val invoiceApi: WechatInvoiceService,
    private val invoiceDelivery: InvoiceDeliveryCoordinator,
    private val users: UserRepository,
    private val categories: CategoryRepository,
    private val products: ProductRepository,
    private val coupons: CouponRepository,
    private val orders: OrderRepository,
    private val payments: PaymentIntentRepository,
    private val refunds: RefundRepository,
    private val pets: PetProfileRepository,
    private val pointLedgers: PointLedgerRepository,
    private val admins: AdminUserRepository,
    private val banners: BannerRepository,
    private val assets: AssetRepository,
    private val settings: SiteSettingRepository,
    private val audits: AuditLogRepository,
) {
    @Transactional
    fun login(request: AdminLoginRequest, clientIp: String): AdminTokenDto {
        val throttleKey = loginThrottle.consume(request.email, clientIp)
        val admin = admins.findByEmailIgnoreCase(request.email.trim())
            ?.takeIf { it.isActive && passwords.verify(request.password, it.passwordHash) }
            ?: throw ResponseStatusException(HttpStatus.UNAUTHORIZED, "邮箱或密码不正确")
        admin.lastLoginAt = Instant.now()
        admins.save(admin)
        audit(admin.id, "login", "admin_user", admin.id.toString())
        loginThrottle.clear(throttleKey)
        return AdminTokenDto(tokens.adminToken(admin))
    }

    @Transactional(readOnly = true)
    fun me(principal: AdminPrincipal): AdminUserDto = adminDto(currentAdmin(principal))

    @Transactional(readOnly = true)
    fun dashboard(): DashboardDto {
        val revenueStatuses = setOf("paid", "preparing", "shipped", "in_transit", "received", "completed")
        val dayStart = LocalDate.now(ZoneId.of("Asia/Shanghai")).atStartOfDay(ZoneId.of("Asia/Shanghai")).toInstant()
        return DashboardDto(
            productCount = products.count(),
            activeProductCount = products.countByStatus("active"),
            lowStockCount = products.countByStatusAndStockLessThanEqual("active", 5),
            pendingOrderCount = orders.countByStatus("pending_payment"),
            paidOrderCount = orders.countByStatusIn(revenueStatuses),
            todayOrderCount = orders.countByCreatedAtGreaterThanEqual(dayStart),
            todayRevenueCents = orders.sumRevenueByStatusesSince(revenueStatuses, dayStart),
            totalRevenueCents = orders.sumRevenueByStatuses(revenueStatuses),
            userCount = users.count(),
        )
    }

    @Transactional(readOnly = true)
    fun listProducts(): List<ProductDto> = products.findAllByOrderBySortOrderAscCreatedAtDesc().map(domain::product)

    @Transactional
    fun createProduct(value: ProductWrite, principal: AdminPrincipal): ProductDto {
        require(categories.findBySlug(value.categorySlug) != null) { "商品分类不存在" }
        val saved = products.save(domain.apply(ProductEntity(), value))
        audit(principal.id, "create", "product", saved.id.toString(), saved.name)
        return domain.product(saved)
    }

    @Transactional
    fun updateProduct(id: Long, value: ProductWrite, principal: AdminPrincipal): ProductDto {
        require(categories.findBySlug(value.categorySlug) != null) { "商品分类不存在" }
        val product = products.findById(id).orElseThrow { notFound("商品不存在") }
        val saved = products.save(domain.apply(product, value))
        audit(principal.id, "update", "product", id.toString(), saved.name)
        return domain.product(saved)
    }

    @Transactional
    fun deleteProduct(id: Long, principal: AdminPrincipal): OperationResultDto {
        val product = products.findById(id).orElseThrow { notFound("商品不存在") }
        products.delete(product)
        audit(principal.id, "delete", "product", id.toString(), product.name)
        return OperationResultDto()
    }

    @Transactional(readOnly = true)
    fun listCategories(): List<CategoryDto> = categories.findAllByOrderBySortOrderAscIdAsc().map(domain::category)

    @Transactional
    fun createCategory(value: CategoryWrite, principal: AdminPrincipal): CategoryDto {
        require(categories.findBySlug(value.slug) == null) { "分类标识已存在" }
        val saved = categories.save(CategoryEntity(name = value.name, slug = value.slug, sortOrder = value.sortOrder, isActive = value.isActive))
        audit(principal.id, "create", "category", saved.id.toString(), saved.name)
        return domain.category(saved)
    }

    @Transactional
    fun updateCategory(id: Long, value: CategoryWrite, principal: AdminPrincipal): CategoryDto {
        val category = categories.findById(id).orElseThrow { notFound("分类不存在") }
        categories.findBySlug(value.slug)?.takeIf { it.id != id }?.let { throw IllegalArgumentException("分类标识已存在") }
        category.name = value.name
        category.slug = value.slug
        category.sortOrder = value.sortOrder
        category.isActive = value.isActive
        val saved = categories.save(category)
        audit(principal.id, "update", "category", id.toString(), saved.name)
        return domain.category(saved)
    }

    @Transactional
    fun deleteCategory(id: Long, principal: AdminPrincipal): OperationResultDto {
        val category = categories.findById(id).orElseThrow { notFound("分类不存在") }
        require(!products.existsByCategorySlug(category.slug)) { "仍有商品使用该分类，不能删除" }
        categories.delete(category)
        audit(principal.id, "delete", "category", id.toString(), category.name)
        return OperationResultDto()
    }

    @Transactional(readOnly = true)
    fun listBanners(): List<BannerDto> = banners.findAllByOrderByPlacementAscSortOrderAscIdAsc().map(domain::banner)

    @Transactional
    fun createBanner(value: BannerWrite, principal: AdminPrincipal): BannerDto {
        val saved = banners.save(applyBanner(BannerEntity(), value))
        audit(principal.id, "create", "banner", saved.id.toString(), saved.title)
        return domain.banner(saved)
    }

    @Transactional
    fun updateBanner(id: Long, value: BannerWrite, principal: AdminPrincipal): BannerDto {
        val banner = banners.findById(id).orElseThrow { notFound("轮播内容不存在") }
        val saved = banners.save(applyBanner(banner, value))
        audit(principal.id, "update", "banner", id.toString(), saved.title)
        return domain.banner(saved)
    }

    @Transactional
    fun deleteBanner(id: Long, principal: AdminPrincipal): OperationResultDto {
        val banner = banners.findById(id).orElseThrow { notFound("轮播内容不存在") }
        banners.delete(banner)
        audit(principal.id, "delete", "banner", id.toString(), banner.title)
        return OperationResultDto()
    }

    @Transactional(readOnly = true)
    fun listOrders(): List<OrderDto> = orders.findAllByOrderByCreatedAtDesc(PageRequest.of(0, 1000)).map(::orderDto)

    @Transactional(readOnly = true)
    fun getOrder(id: Long): OrderDto = orderDto(orders.findById(id).orElseThrow { notFound("订单不存在") })

    fun updateOrderStatus(id: Long, value: AdminOrderStatusUpdate, principal: AdminPrincipal): OrderDto {
        require(value.logisticsCompany.isNullOrBlank()) { "不接受物流公司字段，承运商由微信按运单号识别" }
        val order = orders.findById(id).orElseThrow { notFound("订单不存在") }
        val current = domain.authoritativeStatus(order)
        val saved = when (value.status) {
            "preparing" -> {
                require(current in setOf("paid", "preparing")) { "只有已付款订单可以进入待发货" }
                order.status = "preparing"
                order.updatedAt = Instant.now()
                orders.save(order)
            }
            "shipped" -> {
                require(current in setOf("paid", "preparing")) { "只有待发货订单可以提交微信发货信息" }
                if (order.fulfillmentType == "delivery" && !value.isTestOrder) {
                    require(value.trackingNo.isNotBlank()) { "请填写运单号" }
                }
                platformCall { platform.uploadShipping(order, value.trackingNo.trim(), value.isTestOrder) }
            }
            "completed" -> {
                val synced = platformCall { orderWorkflow.reconcileWechatOrder(order.id!!) }
                require(synced.platformOrderState in setOf(3, 4)) { "微信平台尚未确认收货，不能在后台提前完成订单" }
                synced
            }
            "cancelled" -> {
                require(current in setOf("pending_payment", "cancelling", "failed")) { "已付款订单不能直接取消，请发起微信原路退款" }
                orderWorkflow.cancelByAdmin(id)
                orders.findById(id).orElseThrow { notFound("订单不存在") }
            }
            "refunding", "refunded" -> throw IllegalArgumentException("退款状态只能由微信退款接口及回调更新")
            else -> throw IllegalArgumentException("不支持的订单状态")
        }
        audit(principal.id, "update_status", "order", id.toString(), "${current} -> ${value.status}")
        return orderDto(saved)
    }

    fun syncPlatformOrder(id: Long, principal: AdminPrincipal): OrderDto {
        val order = orders.findById(id).orElseThrow { notFound("订单不存在") }
        val saved = platformCall { orderWorkflow.reconcileWechatOrder(order.id!!) }
        audit(principal.id, "platform_sync", "order", id.toString(), saved.platformOrderState.toString())
        return orderDto(saved)
    }

    fun remindPlatformReceive(id: Long, principal: AdminPrincipal): OrderDto {
        val order = orders.findById(id).orElseThrow { notFound("订单不存在") }
        val synced = platformCall { orderWorkflow.reconcileWechatOrder(order.id!!) }
        require(synced.platformOrderState == 2) { "只有微信平台已发货且尚未确认收货的订单可以发送收货提醒" }
        require(synced.logisticsStatus in setOf("已签收", "代签收") && synced.logisticsUpdatedAt != null) {
            "微信物流轨迹尚未确认签收，不能提醒确认收货"
        }
        if (audits.findFirstByActionAndEntityAndEntityIdOrderByCreatedAtDesc("confirm_receive_reminder", "order", id.toString()) != null) {
            throw ResponseStatusException(HttpStatus.CONFLICT, "该订单已发送过微信收货提醒")
        }
        platformCall { platform.notifyConfirmReceive(synced, synced.logisticsUpdatedAt!!.epochSecond) }
        audit(principal.id, "confirm_receive_reminder", "order", id.toString(), synced.orderNo)
        return orderDto(synced)
    }

    @Transactional(readOnly = true)
    fun listPayments(): List<PaymentAdminDto> = payments.findAllByOrderByCreatedAtDesc(PageRequest.of(0, 300)).map(domain::payment)

    @Transactional(readOnly = true)
    fun listRefunds(): List<RefundDto> = refunds.findAllByOrderByCreatedAtDesc(PageRequest.of(0, 300)).map(domain::refund)

    fun refundOrder(id: Long, value: RefundRequest, principal: AdminPrincipal): RefundDto {
        val order = orders.findById(id).orElseThrow { notFound("订单不存在") }
        orderWorkflow.refund(order.userId, order.orderNo, value.reason)
        val refund = refunds.findFirstByOrderIdOrderByCreatedAtDesc(id)
            ?: throw ResponseStatusException(HttpStatus.BAD_GATEWAY, "微信退款请求已返回，但未生成退款流水")
        audit(principal.id, "refund", "order", id.toString(), "${refund.outRefundNo} · ${refund.reason}")
        return domain.refund(refund)
    }

    @Transactional(readOnly = true)
    fun listInvoices(): List<OrderDto> = orders.findAllByInvoiceRequestedTrueOrderByCreatedAtDesc().map(::orderDto)

    @Transactional(readOnly = true)
    fun invoiceCapability(): InvoiceCapabilityDto = InvoiceCapabilityDto(
        configured = properties.pay.merchantId.isNotBlank() && properties.pay.invoiceNotifyUrl.isNotBlank(),
        callbackUrl = properties.pay.invoiceNotifyUrl,
        applicationCount = orders.findAllByInvoiceRequestedTrueOrderByCreatedAtDesc().size.toLong(),
    )

    fun syncInvoiceTitle(id: Long, principal: AdminPrincipal): OrderDto {
        val order = orders.findById(id).orElseThrow { notFound("订单不存在") }
        require(InvoiceWorkflowPolicy.canSyncTitle(order.invoiceStatus)) { "当前发票状态不需要再次同步抬头" }
        orderWorkflow.syncInvoice(order.userId, id)
        val saved = orders.findById(id).orElseThrow { notFound("订单不存在") }
        audit(principal.id, "invoice_sync_title", "order", id.toString(), saved.invoiceApplyId)
        return orderDto(saved)
    }

    fun syncInvoiceStatus(id: Long, principal: AdminPrincipal): OrderDto {
        val saved = try {
            invoiceCall { invoiceDelivery.syncStatus(id) }
        } catch (error: RuntimeException) {
            val current = orders.findById(id).orElse(null)
            audit(principal.id, "invoice_sync_status_failed", "order", id.toString(), current?.invoiceError.orEmpty())
            throw error
        }
        audit(principal.id, "invoice_sync_status", "order", id.toString(), "${saved.invoiceStatus} · ${saved.invoiceCardStatus}")
        return orderDto(saved)
    }

    fun deliverInvoice(
        id: Long,
        value: AdminInvoiceDeliveryRequest,
        file: MultipartFile,
        principal: AdminPrincipal,
    ): OrderDto {
        val outcome = try {
            invoiceDelivery.deliver(
                orderId = id,
                value = value,
                fileName = file.originalFilename.orEmpty().ifBlank { "invoice.pdf" },
                pdf = file.bytes,
            )
        } catch (error: RuntimeException) {
            val current = orders.findById(id).orElse(null)
            audit(
                principal.id,
                "invoice_deliver_failed",
                "order",
                id.toString(),
                current?.invoiceError?.ifBlank { error.message.orEmpty() } ?: error.message.orEmpty(),
            )
            when (error) {
                is IllegalArgumentException, is ResponseStatusException -> throw error
                else -> throw ResponseStatusException(
                    HttpStatus.BAD_GATEWAY,
                    error.message ?: "微信电子发票接口调用失败",
                    error,
                )
            }
        }
        audit(
            principal.id,
            if (outcome.recoveredFromWechat) "invoice_deliver_recovered" else "invoice_deliver",
            "order",
            id.toString(),
            outcome.detail,
        )
        return orderDto(outcome.order)
    }

    @Transactional(readOnly = true)
    fun listCoupons(): List<CouponDto> = coupons.findAllByOrderByCreatedAtDesc().map(domain::coupon)

    @Transactional
    fun createCoupon(value: CouponWrite, principal: AdminPrincipal): CouponDto {
        require(coupons.findByCode(value.code.trim().uppercase()) == null) { "优惠券码已存在" }
        validateCoupon(value)
        val saved = coupons.save(applyCoupon(CouponEntity(), value))
        audit(principal.id, "create", "coupon", saved.id.toString(), saved.code)
        return domain.coupon(saved)
    }

    @Transactional
    fun updateCoupon(id: Long, value: CouponWrite, principal: AdminPrincipal): CouponDto {
        validateCoupon(value)
        val coupon = coupons.findById(id).orElseThrow { notFound("优惠券不存在") }
        coupons.findByCode(value.code.trim().uppercase())?.takeIf { it.id != id }?.let { throw IllegalArgumentException("优惠券码已存在") }
        val saved = coupons.save(applyCoupon(coupon, value))
        audit(principal.id, "update", "coupon", id.toString(), saved.code)
        return domain.coupon(saved)
    }

    @Transactional
    fun deleteCoupon(id: Long, principal: AdminPrincipal): OperationResultDto {
        val coupon = coupons.findById(id).orElseThrow { notFound("优惠券不存在") }
        coupons.delete(coupon)
        audit(principal.id, "delete", "coupon", id.toString(), coupon.code)
        return OperationResultDto()
    }

    @Transactional(readOnly = true)
    fun listUsers(): List<UserDto> = users.findAllByOrderByCreatedAtDesc().map(domain::user)

    @Transactional
    fun adjustPoints(id: Long, value: UserPointsUpdate, principal: AdminPrincipal): UserDto {
        val user = users.findById(id).orElseThrow { notFound("会员不存在") }
        if (value.delta == 0) return domain.user(user)
        require(user.points + value.delta >= 0) { "调整后积分不能小于 0" }
        user.points += value.delta
        users.save(user)
        pointLedgers.save(PointLedgerEntity(userId = id, action = "admin_adjust", points = value.delta, note = value.note.trim().ifBlank { "后台人工调整" }))
        audit(principal.id, "adjust_points", "user", id.toString(), "%+d %s".format(value.delta, value.note))
        return domain.user(user)
    }

    @Transactional(readOnly = true)
    fun listPets(): List<PetDto> = pets.findAllByOrderByUpdatedAtDesc().map(domain::pet)

    @Transactional(readOnly = true)
    fun listAssets(): List<AssetDto> = assets.findAllByOrderByCreatedAtDesc().map(::assetDto)

    @Transactional
    fun uploadAsset(file: MultipartFile, principal: AdminPrincipal): AssetDto {
        require(!file.isEmpty) { "请选择素材文件" }
        require(file.size <= 15L * 1024 * 1024) { "素材不能超过 15MB" }
        val originalName = file.originalFilename.orEmpty().replace('\\', '/').substringAfterLast('/').ifBlank { "asset" }
        val extension = originalName.substringAfterLast('.', "").lowercase()
        val contentType = file.contentType.orEmpty().lowercase()
        val assetType = when {
            contentType in setOf("image/jpeg", "image/png", "image/webp", "image/gif") && extension in setOf("jpg", "jpeg", "png", "webp", "gif") -> "image"
            extension in setOf("glb", "gltf") && contentType in setOf("model/gltf-binary", "model/gltf+json", "application/octet-stream", "") -> "model"
            else -> throw IllegalArgumentException("仅支持 JPG、PNG、WebP、GIF、GLB、GLTF")
        }
        val root = Path.of(properties.uploadsDir).toAbsolutePath().normalize()
        Files.createDirectories(root)
        val filename = "${UUID.randomUUID().toString().replace("-", "")}.${extension}"
        val target = root.resolve(filename).normalize()
        require(target.parent == root) { "素材路径不安全" }
        Files.write(target, file.bytes)
        val saved = assets.save(AssetEntity(
            filename = filename,
            originalName = originalName,
            contentType = file.contentType ?: "application/octet-stream",
            url = "${properties.publicBaseUrl.trimEnd('/')}/uploads/$filename",
            size = file.size,
            assetType = assetType,
        ))
        audit(principal.id, "upload", "asset", saved.id.toString(), originalName)
        return assetDto(saved)
    }

    @Transactional
    fun deleteAsset(id: Long, principal: AdminPrincipal): OperationResultDto {
        val asset = assets.findById(id).orElseThrow { notFound("素材不存在") }
        assets.delete(asset)
        val root = Path.of(properties.uploadsDir).toAbsolutePath().normalize()
        val target = root.resolve(asset.filename).normalize()
        if (target.parent == root) Files.deleteIfExists(target)
        audit(principal.id, "delete", "asset", id.toString(), asset.originalName)
        return OperationResultDto()
    }

    @Transactional(readOnly = true)
    fun listSettings(): List<SettingDto> = settings.findAllByOrderByGroupAscKeyAsc().map(::settingDto)

    @Transactional
    fun updateSetting(key: String, value: SettingWrite, principal: AdminPrincipal): SettingDto {
        require(key.matches(Regex("^[a-zA-Z0-9_.-]{1,120}$"))) { "配置键不合法" }
        if (key in SUPER_ONLY_SETTING_KEYS) requireSuper(principal)
        if (key == "wechat_order_detail_path") platformCall { platform.setOrderDetailPath(value.value) }
        if (key == "wechat_message_path") platformCall { platform.setMessagePath(value.value) }
        val setting = settings.findByKey(key) ?: SiteSettingEntity(key = key)
        setting.value = value.value
        setting.label = value.label
        setting.group = value.group
        setting.updatedAt = Instant.now()
        val saved = settings.save(setting)
        audit(principal.id, "update", "setting", key)
        return settingDto(saved)
    }

    @Transactional
    fun updateSettings(value: SettingBulkWrite, principal: AdminPrincipal): List<SettingDto> = value.settings.map { (key, write) ->
        updateSetting(key, write, principal)
    }.also { audit(principal.id, "bulk_update", "setting", value.settings.keys.joinToString(",")) }

    @Transactional(readOnly = true)
    fun platformStatus(): PlatformTradeStatusDto {
        val status = platformCall { platform.tradeStatus() }
        val detailPath = settings.findByKey("wechat_order_detail_path")?.value.orEmpty()
        val messagePath = settings.findByKey("wechat_message_path")?.value.orEmpty()
        return PlatformTradeStatusDto(detailPath, messagePath, detailPath.isNotBlank(), status.managed, status.confirmed)
    }

    @Transactional
    fun configureOrderPath(value: PathWrite, principal: AdminPrincipal): SettingDto {
        requireSuper(principal)
        return updateSetting("wechat_order_detail_path", SettingWrite(value.path, "微信购物订单详情路径", "wechat"), principal)
    }

    @Transactional
    fun configureMessagePath(value: PathWrite, principal: AdminPrincipal): SettingDto {
        requireSuper(principal)
        return updateSetting("wechat_message_path", SettingWrite(value.path, "微信发货消息路径", "wechat"), principal)
    }

    @Transactional(readOnly = true)
    fun listAdmins(principal: AdminPrincipal): List<AdminUserDto> {
        requireSuper(principal)
        return admins.findAllByOrderByCreatedAtDesc().map(::adminDto)
    }

    @Transactional
    fun createAdmin(value: AdminUserWrite, principal: AdminPrincipal): AdminUserDto {
        requireSuper(principal)
        validateRole(value.role)
        val email = value.email.trim().lowercase()
        require(admins.findByEmailIgnoreCase(email) == null) { "管理员邮箱已存在" }
        val saved = admins.save(AdminUserEntity(email = email, name = value.name.trim(), passwordHash = passwords.hash(value.password), role = value.role, isActive = value.isActive))
        audit(principal.id, "create", "admin_user", saved.id.toString(), email)
        return adminDto(saved)
    }

    @Transactional
    fun updateAdmin(id: Long, value: AdminUserUpdate, principal: AdminPrincipal): AdminUserDto {
        requireSuper(principal)
        val target = admins.findById(id).orElseThrow { notFound("管理员不存在") }
        value.role?.let(::validateRole)
        val nextRole = value.role ?: target.role
        val nextActive = value.isActive ?: target.isActive
        if (target.role == "super_admin" && target.isActive && (nextRole != "super_admin" || !nextActive)) {
            require(admins.lockActiveSuperAdmins().any { it.id != id }) { "至少保留一个启用的超级管理员" }
        }
        value.role?.let { target.role = it }
        value.name?.let { target.name = it.trim().ifBlank { throw IllegalArgumentException("管理员姓名不能为空") } }
        value.password?.takeIf(String::isNotBlank)?.let {
            require(it.length >= 12) { "管理员密码至少 12 位" }
            target.passwordHash = passwords.hash(it)
        }
        value.isActive?.let {
            require(id != principal.id || it) { "不能停用当前登录账号" }
            target.isActive = it
        }
        val saved = admins.save(target)
        audit(principal.id, "update", "admin_user", id.toString(), saved.email)
        return adminDto(saved)
    }

    @Transactional
    fun deleteAdmin(id: Long, principal: AdminPrincipal): OperationResultDto {
        requireSuper(principal)
        require(id != principal.id) { "不能删除当前登录账号" }
        val target = admins.findById(id).orElseThrow { notFound("管理员不存在") }
        if (target.role == "super_admin" && target.isActive) {
            require(admins.lockActiveSuperAdmins().any { it.id != id }) { "至少保留一个启用的超级管理员" }
        }
        admins.delete(target)
        audit(principal.id, "delete", "admin_user", id.toString(), target.email)
        return OperationResultDto()
    }

    @Transactional(readOnly = true)
    fun listAudit(): List<AuditLogDto> = audits.findAllByOrderByCreatedAtDesc(PageRequest.of(0, 500)).map {
        AuditLogDto(it.id!!, it.adminId, it.action, it.entity, it.entityId, it.detail, it.createdAt)
    }

    private fun orderDto(order: OrderEntity): OrderDto {
        val reminder = audits.findFirstByActionAndEntityAndEntityIdOrderByCreatedAtDesc("confirm_receive_reminder", "order", order.id.toString())?.createdAt
        return domain.order(order).copy(
            platformConfirmReceiveRemindedAt = reminder,
            platformSpecialOrderType = if (order.testOrder) 2 else 0,
        )
    }

    private fun applyBanner(entity: BannerEntity, value: BannerWrite) = entity.apply {
        title = value.title
        subtitle = value.subtitle
        imageUrl = value.imageUrl
        imageColor = value.imageColor
        placement = value.placement
        linkType = value.linkType
        linkValue = value.linkValue
        sortOrder = value.sortOrder
        isActive = value.isActive
    }

    private fun validateCoupon(value: CouponWrite) {
        require(value.validUntil == null || value.validUntil.isAfter(value.validFrom)) { "优惠券结束时间必须晚于开始时间" }
        require(value.minimumCents >= value.amountCents) { "最低消费不能小于优惠金额" }
    }

    private fun applyCoupon(entity: CouponEntity, value: CouponWrite) = entity.apply {
        code = value.code.trim().uppercase()
        name = value.name
        description = value.description
        amountCents = value.amountCents
        minimumCents = value.minimumCents
        totalQuantity = value.totalQuantity
        validFrom = value.validFrom
        validUntil = value.validUntil
        isActive = value.isActive
    }

    private fun currentAdmin(principal: AdminPrincipal): AdminUserEntity = admins.findById(principal.id).orElseThrow { notFound("管理员不存在") }
    private fun requireSuper(principal: AdminPrincipal) = require(principal.role == "super_admin") { "仅超级管理员可执行此操作" }
    private fun validateRole(role: String) = require(role in setOf("admin", "super_admin")) { "管理员角色不正确" }
    private fun adminDto(value: AdminUserEntity) = AdminUserDto(value.id!!, value.email, value.name, value.role, value.isActive, value.createdAt, value.lastLoginAt)
    private fun assetDto(value: AssetEntity) = AssetDto(value.id!!, value.filename, value.originalName, value.contentType, value.url, value.size, value.assetType, value.createdAt)
    private fun settingDto(value: SiteSettingEntity) = SettingDto(value.key, value.value, value.label, value.group)

    private fun audit(adminId: Long?, action: String, entity: String, entityId: String, detail: String = "") {
        audits.save(AuditLogEntity(adminId = adminId, action = action, entity = entity, entityId = entityId, detail = detail))
    }

    private fun notFound(message: String) = ResponseStatusException(HttpStatus.NOT_FOUND, message)

    private fun <T> platformCall(block: () -> T): T = try {
        block()
    } catch (error: WechatPlatformException) {
        throw ResponseStatusException(HttpStatus.BAD_GATEWAY, error.message ?: "微信平台接口调用失败", error)
    }

    private fun <T> invoiceCall(block: () -> T): T = try {
        block()
    } catch (error: IllegalArgumentException) {
        throw error
    } catch (error: RuntimeException) {
        throw ResponseStatusException(HttpStatus.BAD_GATEWAY, error.message ?: "微信电子发票接口调用失败", error)
    }

    private companion object {
        val SUPER_ONLY_SETTING_KEYS = setOf("wechat_order_detail_path", "wechat_message_path")
    }
}
