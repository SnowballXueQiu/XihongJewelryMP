ALTER TABLE callback_events
  ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'received',
  ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN last_error TEXT NOT NULL DEFAULT '',
  ADD COLUMN received_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE callback_events ALTER COLUMN processed_at DROP NOT NULL;
ALTER TABLE callback_events ALTER COLUMN processed_at DROP DEFAULT;
UPDATE callback_events SET status = 'processed', received_at = processed_at WHERE processed_at IS NOT NULL;

CREATE UNIQUE INDEX uq_payment_transaction_id
  ON payment_intents(transaction_id)
  WHERE transaction_id <> '';

CREATE INDEX idx_callback_status_received
  ON callback_events(status, received_at);

ALTER TABLE orders
  ADD COLUMN invoice_miniprogram_appid VARCHAR(64) NOT NULL DEFAULT '',
  ADD COLUMN invoice_miniprogram_path TEXT NOT NULL DEFAULT '';
