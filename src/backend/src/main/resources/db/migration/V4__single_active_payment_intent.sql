-- A business order must never expose more than one payable WeChat order. Rows left in
-- "creating" by an interrupted deployment are uncertain: the remote prepay request may have
-- succeeded even when its response was lost, so they must be queried/closed before retrying.
UPDATE payment_intents
SET status = 'close_required',
    failure_reason = CASE
      WHEN failure_reason = '' THEN '服务重启后需核验并关闭旧微信支付单'
      ELSE failure_reason
    END,
    updated_at = now()
WHERE status = 'creating';

-- A paid order has no legitimate payable intent left. Mark every legacy pending/closing
-- competitor for remote query+close instead of retaining one active row.
UPDATE payment_intents AS payment
SET status = 'close_required',
    failure_reason = CASE
      WHEN payment.failure_reason = '' THEN '订单已有成功支付，历史竞争支付单需关闭'
      ELSE payment.failure_reason
    END,
    updated_at = now()
WHERE payment.status IN ('pending', 'closing')
  AND EXISTS (
    SELECT 1
    FROM payment_intents AS succeeded
    WHERE succeeded.order_id = payment.order_id
      AND succeeded.status = 'succeeded'
  );

-- Older duplicate active rows can exist in the legacy SQLite data. Keep only the newest row
-- active and force every older remote order through the close/query reconciliation path.
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY order_id ORDER BY created_at DESC, id DESC) AS position
  FROM payment_intents
  WHERE status IN ('pending', 'closing')
)
UPDATE payment_intents AS payment
SET status = 'close_required',
    failure_reason = CASE
      WHEN payment.failure_reason = '' THEN '历史重复支付单需核验并关闭'
      ELSE payment.failure_reason
    END,
    updated_at = now()
FROM ranked
WHERE payment.id = ranked.id AND ranked.position > 1;

CREATE UNIQUE INDEX uq_payment_single_active_order
  ON payment_intents(order_id)
  WHERE status IN ('creating', 'pending', 'closing');
