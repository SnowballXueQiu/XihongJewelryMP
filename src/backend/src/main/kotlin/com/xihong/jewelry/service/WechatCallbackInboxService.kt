package com.xihong.jewelry.service

import com.xihong.jewelry.domain.CallbackEventEntity
import com.xihong.jewelry.repository.CallbackEventRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional
import java.time.Instant

/**
 * Durable inbox for APIv3 notifications.
 *
 * Registration is committed before the business transaction starts. [process] then takes a
 * database write lock on the inbox row and holds it for the complete business transaction. A
 * concurrent delivery of the same WeChat event therefore waits, observes `processed`, and never
 * executes the business action a second time. If processing fails, the business transaction rolls
 * back while the separately committed inbox row remains retryable.
 */
@Service
class WechatCallbackInboxService(private val callbacks: CallbackEventRepository) {
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    fun register(
        source: String,
        eventId: String,
        eventType: String,
        requestId: String,
        payload: String,
    ): CallbackInboxRegistration {
        val existing = callbacks.findBySourceAndEventId(source, eventId)
        // Never rewrite an existing row here. In particular, a duplicate registration must not
        // overwrite `processed` (or a row currently locked by the winning processor).
        if (existing != null) return CallbackInboxRegistration(existing.id!!, existing.status == PROCESSED)
        val saved = callbacks.saveAndFlush(
            CallbackEventEntity(
                source = source,
                eventId = eventId,
                eventType = eventType,
                requestId = requestId.take(120),
                payload = payload,
                status = RECEIVED,
                attempts = 0,
                lastError = "",
                receivedAt = Instant.now(),
                processedAt = null,
            ),
        )
        return CallbackInboxRegistration(saved.id!!, false)
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    fun find(source: String, eventId: String): CallbackInboxRegistration? =
        callbacks.findBySourceAndEventId(source, eventId)?.let {
            CallbackInboxRegistration(it.id!!, it.status == PROCESSED)
        }

    /**
     * Joins one transaction containing both the inbox state transition and the business action.
     * The pessimistic row lock is intentionally held until that transaction commits or rolls back.
     *
     * @return `true` when [action] ran, `false` when the event was already processed.
     */
    @Transactional
    fun process(source: String, eventId: String, action: () -> Unit): Boolean {
        val event = callbacks.lockBySourceAndEventId(source, eventId)
            ?: throw WechatCallbackRejectedException("回调收件记录不存在")
        if (event.status == PROCESSED) return false
        event.status = PROCESSING
        event.attempts += 1
        event.lastError = ""
        callbacks.save(event)

        action()

        event.status = PROCESSED
        event.lastError = ""
        event.processedAt = Instant.now()
        callbacks.save(event)
        return true
    }

    /** Must be called only after [process] has thrown and its transaction has rolled back. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    fun markFailed(source: String, eventId: String, error: Throwable) {
        callbacks.lockBySourceAndEventId(source, eventId)?.also {
            // A slow, losing request may report failure after the winning request has committed.
            // A terminal processed marker is monotonic and can never be downgraded.
            if (it.status == PROCESSED) return
            it.status = FAILED
            it.attempts += 1
            it.lastError = (error.message ?: error.javaClass.simpleName).take(2000)
            it.processedAt = null
            callbacks.save(it)
        }
    }

    private companion object {
        const val RECEIVED = "received"
        const val PROCESSING = "processing"
        const val PROCESSED = "processed"
        const val FAILED = "failed"
    }
}

data class CallbackInboxRegistration(val id: Long, val alreadyProcessed: Boolean)
