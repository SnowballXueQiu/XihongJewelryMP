package com.xihong.jewelry.service

import com.xihong.jewelry.controller.AdminInvoiceDeliveryRequest
import com.xihong.jewelry.domain.OrderEntity
import com.xihong.jewelry.repository.OrderRepository
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.web.server.ResponseStatusException
import java.time.Instant

/**
 * Durable, single-writer orchestration for uploading an issued PDF to WeChat Wallet.
 *
 * The remote upload/insert API is intentionally outside the database transaction. Before making
 * that call we persist `delivering` under an order row lock, so a second administrator cannot
 * submit the same invoice concurrently. When the HTTP result is ambiguous we query WeChat's
 * authoritative application state; if WeChat has not exposed a result yet, the order remains in
 * `delivery_reconciling` and cannot be submitted again blindly.
 */
@Service
class InvoiceDeliveryCoordinator(
    private val orders: OrderRepository,
    private val domain: DomainMapper,
    private val invoiceApi: WechatInvoiceService,
    transactionManager: PlatformTransactionManager,
) {
    private val transactions = TransactionTemplate(transactionManager)

    fun deliver(
        orderId: Long,
        value: AdminInvoiceDeliveryRequest,
        fileName: String,
        pdf: ByteArray,
    ): InvoiceDeliveryOutcome {
        val claim = claim(orderId, value, fileName, pdf)

        // A locally failed attempt may have reached WeChat even though its response was lost. A
        // retry is safe only after the authoritative query proves that no invoice is registered.
        if (claim.previousStatus == DELIVERY_FAILED) {
            val status = try {
                invoiceApi.status(claim.command.fapiaoApplyId)
            } catch (error: RuntimeException) {
                markReconciling(claim.orderId, error)
                throw error
            }
            status.invoices.firstOrNull()?.let { item ->
                val recovered = finishFromAuthority(claim.orderId, item)
                if (isAuthorityFailure(item)) {
                    throw WechatPayConfigurationException("微信已记录该发票，但返回交付失败状态，请核对开票文件")
                }
                return InvoiceDeliveryOutcome(recovered, true, "${item.fapiaoId} · ${item.cardStatus.orEmpty()}")
            }
        }

        val receipt = try {
            invoiceApi.deliver(claim.command, pdf)
        } catch (deliveryError: RuntimeException) {
            // Timeout/connection reset after insert-cards may still mean WeChat accepted the card.
            // Query before changing local state or permitting any retry.
            val query = runCatching { invoiceApi.status(claim.command.fapiaoApplyId) }
            val item = query.getOrNull()?.invoices?.firstOrNull()
            if (item != null) {
                val recovered = finishFromAuthority(claim.orderId, item)
                if (!isAuthorityFailure(item)) {
                    return InvoiceDeliveryOutcome(recovered, true, "${item.fapiaoId} · ${item.cardStatus.orEmpty()}")
                }
            } else {
                val queryError = query.exceptionOrNull()
                markReconciling(
                    claim.orderId,
                    queryError ?: WechatPayConfigurationException(
                        "微信暂未返回发票交付结果，已停止重复提交并等待状态同步",
                        deliveryError,
                    ),
                )
            }
            throw deliveryError
        }

        val saved = inTransaction {
            val order = orders.lockById(claim.orderId)
                ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "订单不存在")
            order.invoiceMediaId = receipt.fapiaoMediaId
            // A callback may have committed `inserted` while the remote request was returning. Do
            // not downgrade that newer authoritative state to merely `delivery_submitted`.
            if (order.invoiceStatus == DELIVERING) order.invoiceStatus = DELIVERY_SUBMITTED
            order.invoiceCardStatus = order.invoiceCardStatus.ifBlank { receipt.cardStatus }
            order.invoiceError = ""
            order.invoiceUpdatedAt = receipt.acceptedAt
            orders.save(order)
        }
        return InvoiceDeliveryOutcome(saved, false, "${receipt.fapiaoMediaId} · ${receipt.cardStatus}")
    }

    /** Query WeChat outside a database transaction, then merge the result under a row lock. */
    fun syncStatus(orderId: Long): OrderEntity {
        val snapshot = orders.findById(orderId).orElseThrow {
            ResponseStatusException(HttpStatus.NOT_FOUND, "订单不存在")
        }
        require(snapshot.invoiceRequested && snapshot.invoiceApplyId.isNotBlank()) { "该订单尚未申请微信电子发票" }
        val status = try {
            invoiceApi.status(snapshot.invoiceApplyId, snapshot.invoiceFapiaoId.takeIf(String::isNotBlank))
        } catch (error: RuntimeException) {
            inTransaction {
                val current = orders.lockById(orderId)
                    ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "订单不存在")
                current.invoiceError = error.message ?: "微信电子发票状态同步失败"
                current.invoiceUpdatedAt = Instant.now()
                orders.save(current)
            }
            throw error
        }
        val item = status.invoices.firstOrNull { it.fapiaoId == snapshot.invoiceFapiaoId }
            ?: status.invoices.firstOrNull()
        return inTransaction {
            val current = orders.lockById(orderId)
                ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "订单不存在")
            if (status.invoices.isNotEmpty()) {
                current.invoiceStatus = InvoiceWorkflowPolicy.notification(
                    current.invoiceStatus,
                    "",
                    status.invoices.map(InvoiceStatusItem::fapiaoStatus),
                )
            }
            item?.let {
                current.invoiceFapiaoId = it.fapiaoId.ifBlank { current.invoiceFapiaoId }
                current.invoiceStatus = mergeAuthority(current.invoiceStatus, it)
                it.cardStatus?.takeIf(String::isNotBlank)?.let { cardStatus -> current.invoiceCardStatus = cardStatus }
            }
            if (item == null && current.invoiceStatus in setOf(DELIVERING, DELIVERY_RECONCILING)) {
                current.invoiceStatus = DELIVERY_RECONCILING
                current.invoiceError = "微信暂未返回发票交付结果，已停止重复提交，请稍后再次同步"
            } else {
                current.invoiceError = if (item != null && isAuthorityFailure(item)) {
                    "微信返回发票或卡包交付失败"
                } else ""
            }
            current.invoiceUpdatedAt = Instant.now()
            orders.save(current)
        }
    }

    private fun claim(
        orderId: Long,
        value: AdminInvoiceDeliveryRequest,
        fileName: String,
        pdf: ByteArray,
    ): InvoiceDeliveryClaim = inTransaction {
        val order = orders.lockById(orderId)
            ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "订单不存在")
        require(domain.authoritativeStatus(order) == "completed") { "只有微信已确认收货的订单可以交付发票" }
        require(order.invoiceRequested && order.invoiceApplyId.isNotBlank()) { "该订单尚未申请微信电子发票" }
        require(order.invoiceBuyerName.isNotBlank() && order.invoiceBuyerType in setOf("INDIVIDUAL", "ORGANIZATION")) {
            "请先同步微信发票抬头"
        }
        require(order.invoiceStatus in setOf("title_received", DELIVERY_FAILED)) {
            if (order.invoiceStatus in setOf(DELIVERING, DELIVERY_RECONCILING)) {
                "发票正在交付或核验中，请先同步微信发票状态"
            } else {
                "当前发票状态不能重复交付"
            }
        }
        require(value.totalAmount == order.totalCents.toLong()) { "价税合计必须与订单实付金额一致" }
        require(value.taxAmount in 0..value.totalAmount) { "税额不能小于0或大于价税合计" }

        val command = command(order, value, fileName)
        // Validate the complete PDF/card request before acquiring a durable remote-work claim.
        invoiceApi.validateDelivery(command, pdf)
        val previousStatus = order.invoiceStatus
        order.invoiceStatus = DELIVERING
        order.invoiceError = ""
        order.invoiceUpdatedAt = Instant.now()
        orders.save(order)
        InvoiceDeliveryClaim(order.id!!, previousStatus, command)
    }

    private fun command(order: OrderEntity, value: AdminInvoiceDeliveryRequest, fileName: String) =
        InvoiceDeliveryCommand(
            fapiaoApplyId = order.invoiceApplyId,
            scene = InvoiceScene.WITHOUT_WECHATPAY,
            buyer = InvoiceBuyerInformation(
                type = order.invoiceBuyerType,
                name = order.invoiceBuyerName,
                taxpayerId = order.invoiceBuyerTaxpayerId.takeIf(String::isNotBlank),
                address = order.invoiceBuyerAddress.takeIf(String::isNotBlank),
                telephone = order.invoiceBuyerTelephone.takeIf(String::isNotBlank),
                bankName = order.invoiceBuyerBankName.takeIf(String::isNotBlank),
                bankAccount = order.invoiceBuyerBankAccount.takeIf(String::isNotBlank),
            ),
            card = InvoiceCardInformation(
                fapiaoNumber = value.fapiaoNumber.trim(),
                fapiaoCode = value.fapiaoCode.trim(),
                fapiaoTime = value.fapiaoTime,
                checkCode = value.checkCode.trim(),
                password = value.password.trim(),
                totalAmount = value.totalAmount,
                taxAmount = value.taxAmount,
                amount = value.totalAmount - value.taxAmount,
                seller = InvoiceSellerInformation(value.sellerName.trim(), value.sellerTaxpayerId.trim()),
                extra = InvoiceExtraInformation(drawer = value.drawer.trim()),
            ),
            fileName = fileName.ifBlank { "invoice.pdf" },
        )

    private fun finishFromAuthority(orderId: Long, item: InvoiceStatusItem): OrderEntity = inTransaction {
        val order = orders.lockById(orderId)
            ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "订单不存在")
        order.invoiceFapiaoId = item.fapiaoId.ifBlank { order.invoiceFapiaoId }
        order.invoiceStatus = mergeAuthority(order.invoiceStatus, item)
        item.cardStatus?.takeIf(String::isNotBlank)?.let { order.invoiceCardStatus = it }
        order.invoiceError = if (isAuthorityFailure(item)) "微信返回发票或卡包交付失败" else ""
        order.invoiceUpdatedAt = Instant.now()
        orders.save(order)
    }

    private fun markReconciling(orderId: Long, error: Throwable): OrderEntity = inTransaction {
        val order = orders.lockById(orderId)
            ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "订单不存在")
        // Preserve a newer callback state if it won the race with the failed HTTP response.
        if (order.invoiceStatus == DELIVERING) {
            order.invoiceStatus = DELIVERY_RECONCILING
            order.invoiceError = (error.message ?: "微信发票交付结果待核验").take(2000)
            order.invoiceUpdatedAt = Instant.now()
            orders.save(order)
        } else order
    }

    private fun mergeAuthority(current: String, item: InvoiceStatusItem): String {
        var next = InvoiceWorkflowPolicy.notification(current, "", item.fapiaoStatus)
        val cardState = item.cardStatus.orEmpty().trim().lowercase()
        next = InvoiceWorkflowPolicy.advance(next, cardState)
        if (item.fapiaoStatus.isBlank() && cardState.isBlank()) {
            next = InvoiceWorkflowPolicy.advance(next, DELIVERY_SUBMITTED)
        } else if (item.fapiaoStatus.isBlank() && isAuthorityFailure(item)) {
            next = InvoiceWorkflowPolicy.advance(next, DELIVERY_REJECTED)
        }
        return next
    }

    private fun isAuthorityFailure(item: InvoiceStatusItem): Boolean =
        "FAIL" in item.fapiaoStatus.uppercase() || "FAIL" in item.cardStatus.orEmpty().uppercase()

    private fun <T> inTransaction(block: () -> T): T = transactions.execute { block() }
        ?: throw IllegalStateException("事务未返回结果")

    private companion object {
        const val DELIVERING = "delivering"
        const val DELIVERY_SUBMITTED = "delivery_submitted"
        const val DELIVERY_FAILED = "delivery_failed"
        const val DELIVERY_RECONCILING = "delivery_reconciling"
        const val DELIVERY_REJECTED = "delivery_rejected"
    }
}

data class InvoiceDeliveryOutcome(
    val order: OrderEntity,
    val recoveredFromWechat: Boolean,
    val detail: String,
)

private data class InvoiceDeliveryClaim(
    val orderId: Long,
    val previousStatus: String,
    val command: InvoiceDeliveryCommand,
)
