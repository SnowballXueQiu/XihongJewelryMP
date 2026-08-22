package com.xihong.jewelry.service

/**
 * Single source of truth for the WeChat e-invoice lifecycle.
 *
 * `invoice_status` contains both our local orchestration stages and the authoritative tax/card
 * stages returned by WeChat. Every transition must therefore be monotonic: a delayed title event
 * must never make an issued invoice deliverable again, and removing a Wallet card must never be
 * treated as a tax reversal.
 */
object InvoiceWorkflowPolicy {
    private val titleFormStatuses = setOf("not_requested", "apply_failed", "pending_title", "title_pending_sync")
    private val titleSyncStatuses = setOf("apply_failed", "pending_title", "title_pending_sync", "title_received")
    private val refundSafeStatuses = setOf(
        "not_requested",
        "not_available_for_free_order",
        "apply_failed",
        "pending_title",
        "title_pending_sync",
        "title_received",
        // WeChat has authoritatively confirmed that no blue invoice was issued.
        "issue_failed",
        // The tax authority has confirmed the red-letter reversal; refund is now safe again.
        "reversed",
    )

    private val stage = mapOf(
        "not_requested" to 0,
        "not_available_for_free_order" to 0,
        "apply_failed" to 5,
        "pending_title" to 10,
        "title_pending_sync" to 15,
        "title_received" to 20,
        "delivery_failed" to 25,
        "delivering" to 30,
        "delivery_reconciling" to 35,
        "delivery_submitted" to 40,
        "delivery_rejected" to 45,
        "issue_accepted" to 46,
        "issue_failed" to 47,
        "issued" to 50,
        "insert_accepted" to 55,
        // Kept as an alias for rows written by the previous implementation.
        "card_insert_accepted" to 55,
        "inserted" to 60,
        "discard_accepted" to 65,
        // DISCARD only means the Wallet card was removed; the blue invoice may still be valid.
        "discarded" to 70,
        "reverse_accepted" to 80,
        "reverse_failed" to 82,
        // A batch may contain several invoices. One reversed item never makes the whole order safe.
        "partially_reversed" to 85,
        "reversed" to 90,
    )

    fun canAcquireTitleForm(status: String): Boolean = status in titleFormStatuses

    fun canSyncTitle(status: String): Boolean = status in titleSyncStatuses

    fun canRefundWithoutTaxReversal(status: String): Boolean = status in refundSafeStatuses

    fun titleFormSucceeded(current: String): String = when (current) {
        "not_requested", "apply_failed" -> "pending_title"
        else -> current
    }

    fun titleFormFailed(current: String): String = when (current) {
        "not_requested", "apply_failed" -> "apply_failed"
        else -> current
    }

    fun titleSynced(current: String): String = when {
        current in titleSyncStatuses -> advance(current, "title_received")
        else -> current
    }

    fun notification(current: String, eventType: String, fapiaoStatus: String?): String {
        return notification(current, eventType, listOfNotNull(fapiaoStatus))
    }

    fun notification(current: String, eventType: String, fapiaoStatuses: Collection<String>): String {
        val taxState = aggregateTaxState(fapiaoStatuses)
        var result = taxState?.let { advance(current, it) } ?: current
        result = when (eventType) {
            "FAPIAO.USER_APPLIED" -> if (result in titleFormStatuses) advance(result, "title_pending_sync") else result
            "FAPIAO.CARD_INSERTED" -> advance(result, "inserted")
            "FAPIAO.CARD_DISCARDED" -> advance(result, "discarded")
            // These two callbacks are authoritative on their own. Prefer the per-invoice states
            // when present, because a batch callback may contain a mixture of invoice states.
            "FAPIAO.ISSUED" -> if (taxState == null) advance(result, "issued") else result
            "FAPIAO.REVERSED" -> if (taxState == null) advance(result, "reversed") else result
            else -> result
        }
        return result
    }

    fun advance(current: String, candidate: String): String {
        val candidateRank = stage[candidate] ?: return current
        val currentRank = stage[current] ?: -1
        return if (candidateRank >= currentRank) candidate else current
    }

    private fun aggregateTaxState(values: Collection<String>): String? {
        val states = values.map(String::trim).map(String::lowercase).filter { it in taxStates }
        if (states.isEmpty()) return null
        if (states.all { it == "reversed" }) return "reversed"
        if ("reversed" in states) return "partially_reversed"
        if ("reverse_accepted" in states) return "reverse_accepted"
        if ("reverse_failed" in states) return "reverse_failed"
        if ("issued" in states) return "issued"
        if ("issue_accepted" in states) return "issue_accepted"
        if (states.all { it == "issue_failed" }) return "issue_failed"
        return null
    }

    private val taxStates = setOf(
        "issue_accepted",
        "issue_failed",
        "issued",
        "reverse_accepted",
        "reverse_failed",
        "reversed",
    )
}
