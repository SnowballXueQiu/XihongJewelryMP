package com.xihong.jewelry.repository

import com.xihong.jewelry.domain.*
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import jakarta.persistence.LockModeType
import java.time.Instant

interface UserRepository : JpaRepository<UserEntity, Long> {
    fun findByWechatOpenid(openid: String): UserEntity?
    fun findAllByOrderByCreatedAtDesc(): List<UserEntity>
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select u from UserEntity u where u.id = :id")
    fun lockById(@Param("id") id: Long): UserEntity?
}
interface AddressRepository : JpaRepository<AddressEntity, Long> {
    fun findAllByUserIdOrderByIsDefaultDescIdDesc(userId: Long): List<AddressEntity>
    fun findByIdAndUserId(id: Long, userId: Long): AddressEntity?
}
interface CategoryRepository : JpaRepository<CategoryEntity, Long> {
    fun findAllByIsActiveTrueOrderBySortOrderAscIdAsc(): List<CategoryEntity>
    fun findAllByOrderBySortOrderAscIdAsc(): List<CategoryEntity>
    fun findBySlug(slug: String): CategoryEntity?
}
interface ProductRepository : JpaRepository<ProductEntity, Long> {
    fun findAllByStatusOrderBySortOrderAscIdAsc(status: String): List<ProductEntity>
    fun findAllByOrderBySortOrderAscCreatedAtDesc(): List<ProductEntity>
    fun existsByCategorySlug(categorySlug: String): Boolean
    fun countByStatus(status: String): Long
    fun countByStatusAndStockLessThanEqual(status: String, stock: Int): Long
    @Lock(LockModeType.PESSIMISTIC_WRITE) @Query("select p from ProductEntity p where p.id in :ids") fun lockAllById(@Param("ids") ids: Collection<Long>): List<ProductEntity>
}
interface CartItemRepository : JpaRepository<CartItemEntity, Long> {
    fun findAllByUserIdOrderByCreatedAtDesc(userId: Long): List<CartItemEntity>
    fun findByIdAndUserId(id: Long, userId: Long): CartItemEntity?
    fun findByUserIdAndProductId(userId: Long, productId: Long): CartItemEntity?
    fun findAllByUserIdAndProductIdIn(userId: Long, productIds: Collection<Long>): List<CartItemEntity>
    fun deleteAllByUserId(userId: Long)
}
interface FavoriteRepository : JpaRepository<FavoriteEntity, Long> { fun findAllByUserIdOrderByCreatedAtDesc(userId: Long): List<FavoriteEntity>; fun findByUserIdAndProductId(userId: Long, productId: Long): FavoriteEntity? }
interface CouponRepository : JpaRepository<CouponEntity, Long> {
    fun findByCode(code: String): CouponEntity?
    fun findAllByIsActiveTrueOrderByCreatedAtDesc(): List<CouponEntity>
    fun findAllByOrderByCreatedAtDesc(): List<CouponEntity>
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from CouponEntity c where c.id = :id")
    fun lockById(@Param("id") id: Long): CouponEntity?
}
interface UserCouponRepository : JpaRepository<UserCouponEntity, Long> {
    fun findAllByUserId(userId: Long): List<UserCouponEntity>
    fun findByUserIdAndCouponId(userId: Long, couponId: Long): UserCouponEntity?
    fun findByUsedOrderId(orderId: Long): UserCouponEntity?
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from UserCouponEntity c where c.userId = :userId and c.couponId = :couponId")
    fun lockByUserIdAndCouponId(@Param("userId") userId: Long, @Param("couponId") couponId: Long): UserCouponEntity?
}
interface OrderRepository : JpaRepository<OrderEntity, Long> {
    fun findByOrderNo(orderNo: String): OrderEntity?
    fun findByIdAndUserId(id: Long, userId: Long): OrderEntity?
    fun findByOrderNoAndUserId(orderNo: String, userId: Long): OrderEntity?
    fun findByUserIdAndClientRequestId(userId: Long, clientRequestId: String): OrderEntity?
    fun findAllByUserIdOrderByCreatedAtDesc(userId: Long): List<OrderEntity>
    fun findAllByUserIdAndStatusOrderByCreatedAtDesc(userId: Long, status: String): List<OrderEntity>
    fun findAllByStatusInOrderByUpdatedAtAsc(statuses: Collection<String>, pageable: Pageable): List<OrderEntity>
    fun findAllByOrderByCreatedAtDesc(pageable: Pageable): List<OrderEntity>
    fun findAllByInvoiceRequestedTrueOrderByCreatedAtDesc(): List<OrderEntity>
    fun findAllByInvoiceRequestedTrueAndInvoiceStatusInOrderByInvoiceUpdatedAtAsc(
        statuses: Collection<String>,
        pageable: Pageable,
    ): List<OrderEntity>
    fun countByStatus(status: String): Long
    fun countByStatusIn(statuses: Collection<String>): Long
    fun countByCreatedAtGreaterThanEqual(createdAt: java.time.Instant): Long
    @Query("select coalesce(sum(o.totalCents), 0) from OrderEntity o where o.status in :statuses")
    fun sumRevenueByStatuses(@Param("statuses") statuses: Collection<String>): Long
    @Query("select coalesce(sum(o.totalCents), 0) from OrderEntity o where o.status in :statuses and o.paidAt >= :paidAt")
    fun sumRevenueByStatusesSince(@Param("statuses") statuses: Collection<String>, @Param("paidAt") paidAt: java.time.Instant): Long
    fun findByPlatformOrderPayloadContaining(value: String): List<OrderEntity>
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select o from OrderEntity o where o.id = :id")
    fun lockById(@Param("id") id: Long): OrderEntity?
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select o from OrderEntity o where o.orderNo = :orderNo")
    fun lockByOrderNo(@Param("orderNo") orderNo: String): OrderEntity?
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select o from OrderEntity o where o.id = :id and o.userId = :userId")
    fun lockByIdAndUserId(@Param("id") id: Long, @Param("userId") userId: Long): OrderEntity?
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select o from OrderEntity o where o.orderNo = :orderNo and o.userId = :userId")
    fun lockByOrderNoAndUserId(@Param("orderNo") orderNo: String, @Param("userId") userId: Long): OrderEntity?
}
interface OrderItemRepository : JpaRepository<OrderItemEntity, Long> { fun findAllByOrderIdOrderByIdAsc(orderId: Long): List<OrderItemEntity> }
interface PaymentIntentRepository : JpaRepository<PaymentIntentEntity, Long> {
    fun findFirstByOrderIdOrderByCreatedAtDesc(orderId: Long): PaymentIntentEntity?
    fun findFirstByOrderIdAndStatusOrderByCreatedAtDesc(orderId: Long, status: String): PaymentIntentEntity?
    fun findByOutTradeNo(outTradeNo: String): PaymentIntentEntity?
    fun findByTransactionId(transactionId: String): PaymentIntentEntity?
    fun findAllByOrderIdOrderByCreatedAtDesc(orderId: Long): List<PaymentIntentEntity>
    fun findAllByOrderByCreatedAtDesc(pageable: Pageable): List<PaymentIntentEntity>
    fun findAllByStatusInOrderByUpdatedAtAsc(statuses: Collection<String>, pageable: Pageable): List<PaymentIntentEntity>
    fun findAllByProviderAndStatusInAndUpdatedAtBeforeOrderByUpdatedAtAsc(
        provider: String,
        statuses: Collection<String>,
        updatedAt: Instant,
        pageable: Pageable,
    ): List<PaymentIntentEntity>
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from PaymentIntentEntity p where p.id = :id")
    fun lockById(@Param("id") id: Long): PaymentIntentEntity?
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from PaymentIntentEntity p where p.orderId = :orderId order by p.createdAt desc, p.id desc")
    fun lockAllByOrderIdOrderByCreatedAtDesc(@Param("orderId") orderId: Long): List<PaymentIntentEntity>
}
interface RefundRepository : JpaRepository<RefundEntity, Long> {
    fun findFirstByOrderIdOrderByCreatedAtDesc(orderId: Long): RefundEntity?
    fun findByOutRefundNo(outRefundNo: String): RefundEntity?
    fun existsByOrderIdAndPaymentIntentIdAndBusinessAppliedAtIsNotNull(orderId: Long, paymentIntentId: Long): Boolean
    fun findAllByOrderByCreatedAtDesc(pageable: Pageable): List<RefundEntity>
    fun findAllByStatusAndBusinessAppliedAtIsNullOrderByUpdatedAtAsc(status: String, pageable: Pageable): List<RefundEntity>
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from RefundEntity r where r.id = :id")
    fun lockById(@Param("id") id: Long): RefundEntity?
}
interface PetProfileRepository : JpaRepository<PetProfileEntity, Long> {
    fun findByUserId(userId: Long): PetProfileEntity?
    fun findAllByOrderByUpdatedAtDesc(): List<PetProfileEntity>
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from PetProfileEntity p where p.userId = :userId")
    fun lockByUserId(@Param("userId") userId: Long): PetProfileEntity?
}
interface PointLedgerRepository : JpaRepository<PointLedgerEntity, Long> {
    fun findAllByUserIdOrderByCreatedAtDesc(userId: Long): List<PointLedgerEntity>
    fun existsByUserIdAndActionAndCreatedAtGreaterThanEqualAndCreatedAtLessThan(
        userId: Long,
        action: String,
        start: java.time.Instant,
        end: java.time.Instant,
    ): Boolean
}
interface AdminUserRepository : JpaRepository<AdminUserEntity, Long> {
    fun findByEmailIgnoreCase(email: String): AdminUserEntity?
    fun findAllByOrderByCreatedAtDesc(): List<AdminUserEntity>
    fun countByRoleAndIsActiveTrue(role: String): Long
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from AdminUserEntity a where a.role = 'super_admin' and a.isActive = true order by a.id")
    fun lockActiveSuperAdmins(): List<AdminUserEntity>
}
interface BannerRepository : JpaRepository<BannerEntity, Long> {
    fun findAllByPlacementAndIsActiveTrueOrderBySortOrderAscIdAsc(placement: String): List<BannerEntity>
    fun findAllByOrderByPlacementAscSortOrderAscIdAsc(): List<BannerEntity>
}
interface AssetRepository : JpaRepository<AssetEntity, Long> { fun findAllByOrderByCreatedAtDesc(): List<AssetEntity> }
interface SiteSettingRepository : JpaRepository<SiteSettingEntity, Long> { fun findByKey(key: String): SiteSettingEntity?; fun findAllByOrderByGroupAscKeyAsc(): List<SiteSettingEntity> }
interface AuditLogRepository : JpaRepository<AuditLogEntity, Long> {
    fun findAllByOrderByCreatedAtDesc(pageable: Pageable): List<AuditLogEntity>
    fun findFirstByActionAndEntityAndEntityIdOrderByCreatedAtDesc(action: String, entity: String, entityId: String): AuditLogEntity?
}
interface CallbackEventRepository : JpaRepository<CallbackEventEntity, Long> {
    fun existsBySourceAndEventId(source: String, eventId: String): Boolean
    fun findBySourceAndEventId(source: String, eventId: String): CallbackEventEntity?
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select e from CallbackEventEntity e where e.source = :source and e.eventId = :eventId")
    fun lockBySourceAndEventId(@Param("source") source: String, @Param("eventId") eventId: String): CallbackEventEntity?
}
