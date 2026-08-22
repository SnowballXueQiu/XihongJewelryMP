CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY, nickname VARCHAR(80) NOT NULL, phone VARCHAR(32) NOT NULL DEFAULT '',
  avatar_color VARCHAR(32) NOT NULL DEFAULT '#913F5F', wechat_openid VARCHAR(128) UNIQUE,
  points INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_openid ON users(wechat_openid);

CREATE TABLE addresses (
  id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id), receiver_name VARCHAR(80) NOT NULL,
  phone VARCHAR(32) NOT NULL, province VARCHAR(80) NOT NULL DEFAULT '', city VARCHAR(80) NOT NULL DEFAULT '',
  district VARCHAR(80) NOT NULL DEFAULT '', detail VARCHAR(255) NOT NULL, postal_code VARCHAR(24) NOT NULL DEFAULT '',
  is_default BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_addresses_user ON addresses(user_id);

CREATE TABLE categories (
  id BIGSERIAL PRIMARY KEY, name VARCHAR(80) NOT NULL, slug VARCHAR(80) NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE products (
  id BIGSERIAL PRIMARY KEY, name VARCHAR(160) NOT NULL, subtitle VARCHAR(255) NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
  category_slug VARCHAR(80) NOT NULL, material VARCHAR(120) NOT NULL DEFAULT '', price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  original_price_cents INTEGER NOT NULL DEFAULT 0, stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0), sales INTEGER NOT NULL DEFAULT 0,
  is_featured BOOLEAN NOT NULL DEFAULT false, free_shipping BOOLEAN NOT NULL DEFAULT false, tags TEXT NOT NULL DEFAULT '[]',
  image_color VARCHAR(32) NOT NULL DEFAULT '#D8B46A', supports_ar BOOLEAN NOT NULL DEFAULT false, ar_model_url TEXT,
  ar_scale VARCHAR(80) NOT NULL DEFAULT '0.22 0.22 0.22', ar_rotation VARCHAR(80) NOT NULL DEFAULT '0 0 0',
  ar_position VARCHAR(80) NOT NULL DEFAULT '0 0.08 0', ar_auto_sync INTEGER NOT NULL DEFAULT 9,
  status VARCHAR(32) NOT NULL DEFAULT 'active', cover_url TEXT NOT NULL DEFAULT '', gallery_urls TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_products_category ON products(category_slug);
CREATE INDEX idx_products_status ON products(status);

CREATE TABLE cart_items (
  id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id), product_id BIGINT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_cart_user_product UNIQUE(user_id, product_id)
);
CREATE INDEX idx_cart_user ON cart_items(user_id);

CREATE TABLE favorites (
  id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id), product_id BIGINT NOT NULL REFERENCES products(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), CONSTRAINT uq_favorite_user_product UNIQUE(user_id, product_id)
);

CREATE TABLE coupons (
  id BIGSERIAL PRIMARY KEY, code VARCHAR(64) NOT NULL UNIQUE, name VARCHAR(120) NOT NULL, description TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL DEFAULT 0, minimum_cents INTEGER NOT NULL DEFAULT 0, total_quantity INTEGER NOT NULL DEFAULT 0,
  claimed_quantity INTEGER NOT NULL DEFAULT 0, valid_from TIMESTAMPTZ NOT NULL DEFAULT now(), valid_until TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY, order_no VARCHAR(64) NOT NULL UNIQUE, client_request_id VARCHAR(80) NOT NULL DEFAULT '',
  user_id BIGINT NOT NULL REFERENCES users(id), status VARCHAR(40) NOT NULL DEFAULT 'pending_payment',
  total_cents INTEGER NOT NULL DEFAULT 0, subtotal_cents INTEGER NOT NULL DEFAULT 0, shipping_fee_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0, coupon_id BIGINT REFERENCES coupons(id), receiver_name VARCHAR(80) NOT NULL DEFAULT '',
  receiver_phone VARCHAR(32) NOT NULL DEFAULT '', receiver_address TEXT NOT NULL DEFAULT '', buyer_note TEXT NOT NULL DEFAULT '',
  fulfillment_type VARCHAR(24) NOT NULL DEFAULT 'delivery', pickup_slot VARCHAR(100) NOT NULL DEFAULT '', pickup_code VARCHAR(80) NOT NULL DEFAULT '',
  test_order BOOLEAN NOT NULL DEFAULT false, invoice_requested BOOLEAN NOT NULL DEFAULT false,
  invoice_status VARCHAR(64) NOT NULL DEFAULT 'not_requested', invoice_apply_id VARCHAR(128) NOT NULL DEFAULT '',
  invoice_buyer_type VARCHAR(32) NOT NULL DEFAULT '', invoice_buyer_name VARCHAR(255) NOT NULL DEFAULT '',
  invoice_buyer_taxpayer_id VARCHAR(128) NOT NULL DEFAULT '', invoice_buyer_address VARCHAR(255) NOT NULL DEFAULT '',
  invoice_buyer_telephone VARCHAR(64) NOT NULL DEFAULT '', invoice_buyer_bank_name VARCHAR(255) NOT NULL DEFAULT '',
  invoice_buyer_bank_account VARCHAR(128) NOT NULL DEFAULT '', invoice_bill_type VARCHAR(64) NOT NULL DEFAULT '',
  invoice_user_message VARCHAR(255) NOT NULL DEFAULT '', invoice_fapiao_id VARCHAR(128) NOT NULL DEFAULT '',
  invoice_media_id VARCHAR(255) NOT NULL DEFAULT '', invoice_card_status VARCHAR(64) NOT NULL DEFAULT '',
  invoice_error TEXT NOT NULL DEFAULT '', invoice_updated_at TIMESTAMPTZ, tracking_no VARCHAR(128) NOT NULL DEFAULT '',
  wechat_delivery_id VARCHAR(64) NOT NULL DEFAULT '', wechat_delivery_name VARCHAR(120) NOT NULL DEFAULT '', waybill_token VARCHAR(255) NOT NULL DEFAULT '',
  logistics_status VARCHAR(80) NOT NULL DEFAULT '', logistics_description TEXT NOT NULL DEFAULT '', logistics_updated_at TIMESTAMPTZ, platform_shipping_uploaded_at TIMESTAMPTZ,
  platform_order_state INTEGER NOT NULL DEFAULT 0, platform_order_state_updated_at TIMESTAMPTZ,
  platform_order_payload TEXT NOT NULL DEFAULT '', platform_shipping_error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), paid_at TIMESTAMPTZ,
  shipped_at TIMESTAMPTZ, received_at TIMESTAMPTZ, cancelled_at TIMESTAMPTZ, cancellation_reason VARCHAR(255) NOT NULL DEFAULT ''
);
CREATE INDEX idx_orders_number ON orders(order_no);
CREATE INDEX idx_orders_user_status ON orders(user_id, status);
CREATE UNIQUE INDEX uq_orders_user_client_request ON orders(user_id, client_request_id) WHERE client_request_id <> '';

CREATE TABLE user_coupons (
  id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id), coupon_id BIGINT NOT NULL REFERENCES coupons(id),
  used_order_id BIGINT REFERENCES orders(id), claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(), used_at TIMESTAMPTZ,
  CONSTRAINT uq_user_coupon UNIQUE(user_id, coupon_id)
);

CREATE TABLE order_items (
  id BIGSERIAL PRIMARY KEY, order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id), product_name VARCHAR(160) NOT NULL,
  unit_price_cents INTEGER NOT NULL, quantity INTEGER NOT NULL CHECK (quantity > 0)
);
CREATE INDEX idx_order_items_order ON order_items(order_id);

CREATE TABLE payment_intents (
  id BIGSERIAL PRIMARY KEY, order_id BIGINT NOT NULL REFERENCES orders(id), provider VARCHAR(40) NOT NULL DEFAULT 'wechat_pay',
  status VARCHAR(40) NOT NULL DEFAULT 'created', out_trade_no VARCHAR(64) NOT NULL UNIQUE, transaction_id VARCHAR(80) NOT NULL DEFAULT '',
  prepay_id VARCHAR(255) NOT NULL DEFAULT '', nonce_str VARCHAR(80) NOT NULL DEFAULT '', package_value VARCHAR(255) NOT NULL DEFAULT '',
  pay_sign TEXT NOT NULL DEFAULT '', time_stamp VARCHAR(32) NOT NULL DEFAULT '', failure_reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ, notified_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX idx_payment_out_trade_no ON payment_intents(out_trade_no);

CREATE TABLE refunds (
  id BIGSERIAL PRIMARY KEY, order_id BIGINT NOT NULL REFERENCES orders(id), out_refund_no VARCHAR(64) NOT NULL UNIQUE,
  refund_id VARCHAR(80) NOT NULL DEFAULT '', amount_cents INTEGER NOT NULL, reason VARCHAR(255) NOT NULL DEFAULT '',
  previous_status VARCHAR(40) NOT NULL DEFAULT 'paid', status VARCHAR(40) NOT NULL DEFAULT 'processing',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refunds_order ON refunds(order_id);

CREATE TABLE pet_profiles (
  id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id), name VARCHAR(80) NOT NULL DEFAULT '玺宝',
  level INTEGER NOT NULL DEFAULT 1, exp INTEGER NOT NULL DEFAULT 0, mood INTEGER NOT NULL DEFAULT 70,
  hunger INTEGER NOT NULL DEFAULT 40, asset_key VARCHAR(80) NOT NULL DEFAULT 'gem-pet-v1', updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_pet_user UNIQUE(user_id)
);
CREATE TABLE point_ledgers (
  id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id), action VARCHAR(80) NOT NULL,
  points INTEGER NOT NULL, note VARCHAR(255) NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admin_users (
  id BIGSERIAL PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE, name VARCHAR(120) NOT NULL, password_hash TEXT NOT NULL,
  role VARCHAR(40) NOT NULL DEFAULT 'admin', is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_login_at TIMESTAMPTZ
);

CREATE TABLE banners (
  id BIGSERIAL PRIMARY KEY, title VARCHAR(160) NOT NULL, subtitle VARCHAR(255) NOT NULL DEFAULT '', image_url TEXT NOT NULL DEFAULT '',
  image_color VARCHAR(32) NOT NULL DEFAULT '#111111', placement VARCHAR(80) NOT NULL DEFAULT 'home_hero',
  link_type VARCHAR(40) NOT NULL DEFAULT 'none', link_value TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE assets (
  id BIGSERIAL PRIMARY KEY, filename VARCHAR(255) NOT NULL, original_name VARCHAR(255) NOT NULL,
  content_type VARCHAR(120) NOT NULL, url TEXT NOT NULL, size BIGINT NOT NULL DEFAULT 0,
  asset_type VARCHAR(40) NOT NULL DEFAULT 'image', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE site_settings (
  id BIGSERIAL PRIMARY KEY, key VARCHAR(120) NOT NULL UNIQUE, value TEXT NOT NULL DEFAULT '', label VARCHAR(255) NOT NULL DEFAULT '',
  setting_group VARCHAR(80) NOT NULL DEFAULT 'general', updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY, admin_id BIGINT REFERENCES admin_users(id), action VARCHAR(80) NOT NULL,
  entity VARCHAR(80) NOT NULL, entity_id VARCHAR(120) NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE callback_events (
  id BIGSERIAL PRIMARY KEY, source VARCHAR(80) NOT NULL, event_id VARCHAR(160) NOT NULL, event_type VARCHAR(120) NOT NULL DEFAULT '',
  request_id VARCHAR(120) NOT NULL DEFAULT '', payload TEXT NOT NULL DEFAULT '', processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_callback_source_event UNIQUE(source, event_id)
);
