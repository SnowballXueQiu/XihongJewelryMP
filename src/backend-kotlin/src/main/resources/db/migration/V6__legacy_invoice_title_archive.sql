-- Legacy FastAPI releases stored a reusable local invoice-title book. The current product uses
-- WeChat's invoice title form as the sole business authority, so these rows must not be attached
-- to arbitrary orders or exposed as an active local title book. Keep all source values in a
-- migration-only archive instead. A conservatively matched user_id enables account erasure;
-- source_user_id retains orphaned records without binding them to an unrelated PostgreSQL user.
CREATE TABLE legacy_invoice_titles (
  id BIGSERIAL PRIMARY KEY,
  source_user_id BIGINT NOT NULL,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  source_invoice_type TEXT NOT NULL DEFAULT '',
  buyer_type VARCHAR(32) NOT NULL,
  buyer_name TEXT NOT NULL DEFAULT '',
  buyer_taxpayer_id TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  source_is_default TEXT NOT NULL DEFAULT '',
  is_default BOOLEAN NOT NULL DEFAULT false,
  source_created_at_raw TEXT NOT NULL DEFAULT '',
  source_updated_at_raw TEXT NOT NULL DEFAULT '',
  source_created_at TIMESTAMPTZ,
  source_updated_at TIMESTAMPTZ,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_legacy_invoice_titles_source_user ON legacy_invoice_titles(source_user_id);
CREATE INDEX idx_legacy_invoice_titles_user ON legacy_invoice_titles(user_id);

COMMENT ON TABLE legacy_invoice_titles IS
  'Migration-only archive of the retired local invoice-title book; WeChat remains authoritative';
