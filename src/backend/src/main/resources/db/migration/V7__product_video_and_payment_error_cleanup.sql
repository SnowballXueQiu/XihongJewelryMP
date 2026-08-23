ALTER TABLE products
    ADD COLUMN IF NOT EXISTS video_url TEXT NOT NULL DEFAULT '';

UPDATE payment_intents
SET failure_reason = '微信支付请求失败（敏感请求详情已隐藏）'
WHERE failure_reason ILIKE '%Authorization%'
   OR failure_reason ILIKE '%signature=%'
   OR failure_reason ILIKE '%HttpRequest%';
