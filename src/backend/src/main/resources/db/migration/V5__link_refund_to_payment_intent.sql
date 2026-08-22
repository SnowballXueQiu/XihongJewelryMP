-- A business order may have legacy duplicate WeChat payment intents. Persist the exact original
-- payment selected for each refund so callbacks never validate against (or revive) the wrong one.
ALTER TABLE refunds
  ADD COLUMN payment_intent_id BIGINT REFERENCES payment_intents(id);

UPDATE refunds AS refund
SET payment_intent_id = (
  SELECT payment.id
  FROM payment_intents AS payment
  WHERE payment.order_id = refund.order_id
    AND payment.status = 'succeeded'
    AND (payment.notified_at IS NULL OR payment.notified_at <= refund.created_at)
  ORDER BY payment.notified_at DESC NULLS LAST, payment.created_at DESC, payment.id DESC
  LIMIT 1
)
WHERE refund.payment_intent_id IS NULL;

CREATE INDEX idx_refunds_payment_intent
  ON refunds(payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;
