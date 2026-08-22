package com.xihong.jewelry.service

import com.xihong.jewelry.domain.CallbackEventEntity
import com.xihong.jewelry.repository.CallbackEventRepository
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.locks.ReentrantLock

class WechatCallbackInboxServiceTest {
    @Test
    fun `concurrent duplicate runs business once and processed never downgrades`() {
        val repository = mock(CallbackEventRepository::class.java)
        val event = CallbackEventEntity(
            id = 9,
            source = "wechat_pay_apiv3",
            eventId = "evt-duplicate",
            status = "received",
        )
        // Model the SELECT ... FOR UPDATE boundary used by the real JPA repository. The lock is
        // released when the winning transaction writes its terminal state.
        val rowLock = ReentrantLock()
        `when`(repository.lockBySourceAndEventId(event.source, event.eventId)).thenAnswer {
            rowLock.lock()
            if (event.status == "processed") rowLock.unlock()
            event
        }
        `when`(repository.save(any(CallbackEventEntity::class.java))).thenAnswer { invocation ->
            val saved = invocation.getArgument<CallbackEventEntity>(0)
            if (saved.status == "processed" && rowLock.isHeldByCurrentThread) rowLock.unlock()
            saved
        }
        val service = WechatCallbackInboxService(repository)
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val executions = AtomicInteger()
        val executor = Executors.newFixedThreadPool(2)

        val first = executor.submit<Boolean> {
            service.process(event.source, event.eventId) {
                executions.incrementAndGet()
                entered.countDown()
                check(release.await(3, TimeUnit.SECONDS)) { "test release timed out" }
            }
        }
        assertTrue(entered.await(2, TimeUnit.SECONDS))
        val duplicate = executor.submit<Boolean> {
            service.process(event.source, event.eventId) { executions.incrementAndGet() }
        }
        Thread.sleep(100)
        assertFalse(duplicate.isDone, "duplicate must wait for the row-lock winner")
        release.countDown()

        assertTrue(first.get(2, TimeUnit.SECONDS))
        assertFalse(duplicate.get(2, TimeUnit.SECONDS))
        assertEquals(1, executions.get())
        assertEquals("processed", event.status)
        assertEquals(1, event.attempts)

        service.markFailed(event.source, event.eventId, IllegalStateException("late loser"))
        assertEquals("processed", event.status)
        assertEquals("", event.lastError)
        executor.shutdownNow()
    }
}
