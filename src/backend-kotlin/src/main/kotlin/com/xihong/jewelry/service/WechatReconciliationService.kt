package com.xihong.jewelry.service

import com.xihong.jewelry.repository.OrderRepository
import org.slf4j.LoggerFactory
import org.springframework.data.domain.PageRequest
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.data.redis.core.script.DefaultRedisScript
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Service
import java.time.Duration
import java.util.UUID

/** Periodically reconciles every non-terminal paid order against WeChat's authoritative order state. */
@Service
class WechatReconciliationService(
    private val orders: OrderRepository,
    private val orderWorkflow: OrderService,
    private val redis: StringRedisTemplate,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    @Scheduled(fixedDelayString = "\${app.wechat.reconcile-delay-ms:180000}", initialDelayString = "\${app.wechat.reconcile-initial-delay-ms:45000}")
    fun reconcile() {
        val owner = UUID.randomUUID().toString()
        val locked = runCatching { redis.opsForValue().setIfAbsent(LOCK_KEY, owner, Duration.ofMinutes(3)) == true }.getOrDefault(false)
        if (!locked) return
        try {
            orderWorkflow.reconcileOpenPaymentIntents()
            orderWorkflow.reconcileStalePaymentIntents()
            orderWorkflow.reconcilePendingRefundCompensations()
            orders.findAllByStatusInOrderByUpdatedAtAsc(ACTIVE_STATUSES, PageRequest.of(0, 200)).forEach { order ->
                runCatching { orderWorkflow.reconcileWechatOrder(order.id!!) }.onFailure {
                    log.warn("WeChat reconciliation failed for {}: {}", order.orderNo, it.message)
                }
            }
        } finally {
            runCatching {
                redis.execute(
                    DefaultRedisScript(UNLOCK_SCRIPT, Long::class.java),
                    listOf(LOCK_KEY),
                    owner,
                )
            }
        }
    }

    companion object {
        private const val LOCK_KEY = "xihong:wechat:reconciliation:lock"
        private const val UNLOCK_SCRIPT = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end"
        private val ACTIVE_STATUSES = setOf("paid", "preparing", "shipped", "in_transit", "refunding")
    }
}
