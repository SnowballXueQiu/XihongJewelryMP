-- A WeChat refund notification and the order-platform refund state can arrive concurrently.
-- This marker is written in the same transaction as stock/coupon/points compensation and is
-- therefore the sole durable idempotency guard for applying the business-side refund effects.
ALTER TABLE refunds
  ADD COLUMN business_applied_at TIMESTAMPTZ;
