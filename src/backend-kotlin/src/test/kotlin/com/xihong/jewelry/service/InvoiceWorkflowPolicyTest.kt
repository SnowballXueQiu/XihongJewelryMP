package com.xihong.jewelry.service

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class InvoiceWorkflowPolicyTest {
    @Test
    fun `late title events cannot downgrade an issued or inserted invoice`() {
        assertEquals(
            "inserted",
            InvoiceWorkflowPolicy.notification("inserted", "FAPIAO.USER_APPLIED", null),
        )
        assertEquals(
            "inserted",
            InvoiceWorkflowPolicy.notification("inserted", "FAPIAO.CARD_INSERTED", "ISSUED"),
        )
    }

    @Test
    fun `tax reversal outranks card discard and remains terminal`() {
        assertEquals(
            "reversed",
            InvoiceWorkflowPolicy.notification("issued", "FAPIAO.CARD_DISCARDED", "REVERSED"),
        )
        assertEquals(
            "reversed",
            InvoiceWorkflowPolicy.notification("reversed", "FAPIAO.CARD_INSERTED", "ISSUED"),
        )
        assertFalse(InvoiceWorkflowPolicy.canRefundWithoutTaxReversal("discarded"))
        assertTrue(InvoiceWorkflowPolicy.canRefundWithoutTaxReversal("reversed"))
    }

    @Test
    fun `refund is permitted only before invoice delivery begins`() {
        assertTrue(InvoiceWorkflowPolicy.canRefundWithoutTaxReversal("title_received"))
        assertTrue(InvoiceWorkflowPolicy.canRefundWithoutTaxReversal("issue_failed"))
        assertFalse(InvoiceWorkflowPolicy.canRefundWithoutTaxReversal("delivering"))
        assertFalse(InvoiceWorkflowPolicy.canRefundWithoutTaxReversal("issued"))
    }

    @Test
    fun `official issue and card states advance monotonically while unknown states are ignored`() {
        assertEquals(
            "issue_accepted",
            InvoiceWorkflowPolicy.notification("delivery_submitted", "", listOf("ISSUE_ACCEPTED")),
        )
        assertEquals(
            "insert_accepted",
            InvoiceWorkflowPolicy.advance("issued", "insert_accepted"),
        )
        assertEquals(
            "discard_accepted",
            InvoiceWorkflowPolicy.advance("inserted", "discard_accepted"),
        )
        assertEquals("issued", InvoiceWorkflowPolicy.advance("issued", "unexpected_remote_value"))
        assertEquals("issued", InvoiceWorkflowPolicy.notification("title_received", "FAPIAO.ISSUED", emptyList()))
        assertEquals("reversed", InvoiceWorkflowPolicy.notification("issued", "FAPIAO.REVERSED", emptyList()))
    }

    @Test
    fun `every invoice in a batch must be reversed before refund becomes safe`() {
        val partial = InvoiceWorkflowPolicy.notification(
            "issued",
            "FAPIAO.REVERSED",
            listOf("REVERSED", "ISSUED"),
        )
        assertEquals("partially_reversed", partial)
        assertFalse(InvoiceWorkflowPolicy.canRefundWithoutTaxReversal(partial))

        val complete = InvoiceWorkflowPolicy.notification(
            partial,
            "FAPIAO.REVERSED",
            listOf("REVERSED", "REVERSED"),
        )
        assertEquals("reversed", complete)
        assertTrue(InvoiceWorkflowPolicy.canRefundWithoutTaxReversal(complete))
    }
}
