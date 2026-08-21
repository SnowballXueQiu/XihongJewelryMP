from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import inspect, text
from sqlmodel import Session, SQLModel, create_engine, select

from app.models import Address, AdminRole, AdminUser, Banner, Category, Coupon, InvoiceTitle, PetProfile, Product, SiteSetting, User, UserCoupon
from app.security import hash_password
from app.settings import settings


if settings.database_url.startswith("sqlite:///"):
    db_path = settings.database_url.replace("sqlite:///", "", 1)
    if db_path != ":memory:":
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(settings.database_url, echo=False, connect_args={"check_same_thread": False})


def get_session():
    with Session(engine) as session:
        yield session


def _quote_default(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def _ensure_sqlite_columns() -> None:
    if not settings.database_url.startswith("sqlite:///"):
        return

    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    wanted = {
        "product": {
            "status": ("VARCHAR", "active"),
            "cover_url": ("VARCHAR", ""),
            "gallery_urls": ("VARCHAR", "[]"),
            "sort_order": ("INTEGER", 0),
            "original_price_cents": ("INTEGER", 0),
            "sales": ("INTEGER", 0),
            "is_featured": ("BOOLEAN", False),
            "free_shipping": ("BOOLEAN", False),
            "tags": ("VARCHAR", "[]"),
        },
        "category": {
            "is_active": ("BOOLEAN", True),
        },
        "order": {
            "order_no": ("VARCHAR", ""),
            "client_request_id": ("VARCHAR", ""),
            "subtotal_cents": ("INTEGER", 0),
            "shipping_fee_cents": ("INTEGER", 0),
            "discount_cents": ("INTEGER", 0),
            "coupon_id": ("INTEGER", None),
            "buyer_note": ("VARCHAR", ""),
            "fulfillment_type": ("VARCHAR", "delivery"),
            "pickup_slot": ("VARCHAR", ""),
            "pickup_code": ("VARCHAR", ""),
            "invoice_type": ("VARCHAR", "none"),
            "invoice_title": ("VARCHAR", ""),
            "invoice_tax_number": ("VARCHAR", ""),
            "invoice_email": ("VARCHAR", ""),
            "logistics_company": ("VARCHAR", ""),
            "tracking_no": ("VARCHAR", ""),
            "platform_shipping_uploaded_at": ("DATETIME", None),
            "updated_at": ("DATETIME", None),
            "paid_at": ("DATETIME", None),
            "shipped_at": ("DATETIME", None),
            "completed_at": ("DATETIME", None),
            "cancelled_at": ("DATETIME", None),
            "cancellation_reason": ("VARCHAR", ""),
        },
        "paymentintent": {
            "out_trade_no": ("VARCHAR", ""),
            "transaction_id": ("VARCHAR", ""),
            "failure_reason": ("VARCHAR", ""),
            "updated_at": ("DATETIME", None),
            "expires_at": ("DATETIME", None),
            "notified_at": ("DATETIME", None),
        },
        "refund": {
            "previous_status": ("VARCHAR", "paid"),
        },
    }

    with engine.begin() as connection:
        for table, columns in wanted.items():
            if table not in existing_tables:
                continue
            existing_columns = {column["name"] for column in inspector.get_columns(table)}
            for column_name, (column_type, default) in columns.items():
                if column_name not in existing_columns:
                    connection.execute(
                        text(
                            f'ALTER TABLE "{table}" ADD COLUMN "{column_name}" '
                            f"{column_type} DEFAULT {_quote_default(default)}"
                        )
                    )
        if "usercoupon" in existing_tables:
            duplicate_count = connection.execute(
                text("SELECT COUNT(*) FROM (SELECT user_id, coupon_id FROM usercoupon GROUP BY user_id, coupon_id HAVING COUNT(*) > 1)")
            ).scalar_one()
            if duplicate_count == 0:
                connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_user_coupon ON usercoupon (user_id, coupon_id)"))
        if "order" in existing_tables:
            duplicate_request_count = connection.execute(
                text(
                    'SELECT COUNT(*) FROM (SELECT user_id, client_request_id FROM "order" '
                    "WHERE client_request_id <> '' GROUP BY user_id, client_request_id HAVING COUNT(*) > 1)"
                )
            ).scalar_one()
            if duplicate_request_count == 0:
                connection.execute(
                    text(
                        'CREATE UNIQUE INDEX IF NOT EXISTS uq_order_client_request '
                        'ON "order" (user_id, client_request_id) WHERE client_request_id <> \'\''
                    )
                )


def create_db_and_seed() -> None:
    SQLModel.metadata.create_all(engine)
    _ensure_sqlite_columns()
    with Session(engine) as session:
        user = session.get(User, 1)
        if not user:
            user = User(id=1, nickname="玺鸿会员", phone="13800000000", points=120)
            session.add(user)
        if not session.exec(select(PetProfile).where(PetProfile.user_id == 1)).first():
            session.add(PetProfile(user_id=1, exp=120, level=2, mood=78, hunger=28))

        categories = [
            Category(name="戒指", slug="rings", sort_order=1, is_active=True),
            Category(name="手链手环", slug="bracelets", sort_order=2, is_active=True),
            Category(name="项链", slug="necklaces", sort_order=3, is_active=True),
            Category(name="耳饰", slug="earrings", sort_order=4, is_active=True),
        ]
        products = [
            Product(
                name="红宝石叠戴戒指",
                subtitle="18K 金 / 红宝石",
                description="适合日常叠戴的轻珠宝戒指，预留 AR 手部试戴参数。",
                category_slug="rings",
                material="18K金",
                price_cents=268000,
                original_price_cents=298000,
                stock=12,
                sales=86,
                is_featured=True,
                tags='["主理人推荐", "叠戴"]',
                image_color="#B98B85",
                cover_url="",
                gallery_urls="[]",
                supports_ar=True,
                ar_model_url="https://mmbizwxaminiprogram-1258344707.cos.ap-guangzhou.myqcloud.com/xr-frame/demo/cool-star.glb",
                ar_scale="0.12 0.12 0.12",
                ar_rotation="0 0 0",
                ar_position="0 0.05 0",
                ar_auto_sync=9,
            ),
            Product(
                name="月光珍珠手链",
                subtitle="淡水珍珠 / 银镀金",
                description="柔和珍珠光泽，支持后续替换手腕试戴模型。",
                category_slug="bracelets",
                material="珍珠",
                price_cents=98000,
                original_price_cents=118000,
                stock=24,
                sales=132,
                is_featured=True,
                tags='["珍珠", "轻复古"]',
                image_color="#E6D8BF",
                cover_url="",
                gallery_urls="[]",
                supports_ar=True,
                ar_model_url="https://mmbizwxaminiprogram-1258344707.cos.ap-guangzhou.myqcloud.com/xr-frame/demo/cool-star.glb",
                ar_scale="0.18 0.18 0.18",
                ar_position="0 0.08 0",
                ar_auto_sync=5,
            ),
            Product(
                name="鎏金细链项链",
                subtitle="14K 包金",
                description="通勤款细链，MVP 阶段仅展示商品详情。",
                category_slug="necklaces",
                material="包金",
                price_cents=76000,
                original_price_cents=88000,
                stock=18,
                sales=64,
                tags='["通勤", "极简"]',
                image_color="#C7AD76",
                cover_url="",
                gallery_urls="[]",
                supports_ar=False,
            ),
            Product(
                name="星砂耳钉",
                subtitle="925 银 / 锆石",
                description="低敏耳钉，适合作为会员等级礼。",
                category_slug="earrings",
                material="银",
                price_cents=42000,
                original_price_cents=52000,
                stock=36,
                sales=208,
                tags='["低敏", "礼赠"]',
                image_color="#B8B4AA",
                cover_url="",
                gallery_urls="[]",
                supports_ar=False,
            ),
            Product(
                name="鸢尾方糖戒指",
                subtitle="18K 金 / 紫晶 / 白钻",
                description="几何切割紫晶置于细窄戒臂之上，侧面镂空让光线穿过主石，适合单戴或与素圈叠戴。",
                category_slug="rings",
                material="18K金",
                price_cents=328000,
                original_price_cents=358000,
                stock=8,
                sales=41,
                is_featured=True,
                tags='["限量", "彩宝"]',
                image_color="#6E596B",
            ),
            Product(
                name="山茶金珠手链",
                subtitle="足金 / 黑玛瑙",
                description="以抛光金珠和哑光黑玛瑙交替编排，保留东方首饰的秩序感，日常佩戴不挑衣着。",
                category_slug="bracelets",
                material="足金",
                price_cents=186000,
                original_price_cents=198000,
                stock=6,
                sales=57,
                is_featured=True,
                tags='["东方", "足金"]',
                image_color="#A87B43",
            ),
            Product(
                name="晨露钻石锁骨链",
                subtitle="18K 白金 / 培育钻石",
                description="单颗明亮式切割钻石悬于锁骨中央，链节轻盈，适合作为每天都能佩戴的第一条钻石项链。",
                category_slug="necklaces",
                material="18K白金",
                price_cents=218000,
                original_price_cents=248000,
                stock=10,
                sales=75,
                tags='["钻石", "经典"]',
                image_color="#C9CDD0",
            ),
            Product(
                name="流苏红玉耳线",
                subtitle="14K 金 / 红玛瑙",
                description="纤细耳线连接一颗深红玛瑙，走动时产生克制的摆动，让东方红成为造型里的点睛色。",
                category_slug="earrings",
                material="14K金",
                price_cents=68000,
                original_price_cents=76000,
                stock=20,
                sales=119,
                tags='["新中式", "红玛瑙"]',
                image_color="#8B3338",
            ),
            Product(
                name="零元下单流程测试商品",
                subtitle="免支付流程联调专用",
                description="用于验证下单、订单状态和履约流程，不会调用微信支付，也不会产生扣款。",
                category_slug="rings",
                material="测试商品",
                price_cents=0,
                original_price_cents=0,
                stock=9999,
                sales=0,
                free_shipping=True,
                tags='["零元测试", "免支付"]',
                image_color="#CDB27A",
                sort_order=999,
            ),
        ]
        for category in categories:
            existing_category = session.exec(select(Category).where(Category.slug == category.slug)).first()
            if existing_category:
                existing_category.name = category.name
                existing_category.sort_order = category.sort_order
                existing_category.is_active = category.is_active
                session.add(existing_category)
            else:
                session.add(category)

        for product in products:
            existing_product = session.exec(select(Product).where(Product.name == product.name)).first()
            if existing_product:
                continue
            else:
                session.add(product)

        if not session.exec(select(Address).where(Address.user_id == 1)).first():
            session.add(
                Address(
                    user_id=1,
                    receiver_name="玺鸿会员",
                    phone="13800000000",
                    province="天津市",
                    city="天津市",
                    district="和平区",
                    detail="南京路 219 号玺鸿珠宝体验店",
                    is_default=True,
                )
            )

        if not session.exec(select(InvoiceTitle).where(InvoiceTitle.user_id == 1)).first():
            session.add(
                InvoiceTitle(
                    user_id=1,
                    invoice_type="personal",
                    title="个人",
                    is_default=True,
                )
            )

        coupon = session.exec(select(Coupon).where(Coupon.code == "WELCOME88")).first()
        if not coupon:
            coupon = Coupon(
                code="WELCOME88",
                name="新客礼遇",
                description="满 800 元减 88 元",
                amount_cents=8800,
                minimum_cents=80000,
                total_quantity=10000,
                claimed_quantity=1,
                valid_from=datetime.now(timezone.utc) - timedelta(days=1),
                valid_until=datetime.now(timezone.utc) + timedelta(days=365),
            )
            session.add(coupon)
            session.flush()
        if coupon.id and not session.exec(select(UserCoupon).where(UserCoupon.user_id == 1, UserCoupon.coupon_id == coupon.id)).first():
            session.add(UserCoupon(user_id=1, coupon_id=coupon.id))

        if not session.exec(select(Banner)).first():
            session.add(
                Banner(
                    title="玺鸿珠宝",
                    subtitle="戒指、手链与日常轻珠宝的线上试戴门店",
                    image_color="#111111",
                    placement="home_hero",
                    link_type="tab",
                    link_value="/pages/products/index",
                    sort_order=1,
                )
            )

        seed_settings = [
            SiteSetting(key="store_name", value="玺鸿珠宝", label="门店名称", group="general"),
            SiteSetting(key="company_name", value=settings.company_name_zh, label="公司名称", group="general"),
            SiteSetting(key="contact_email", value=settings.contact_email, label="联系邮箱", group="general"),
            SiteSetting(key="shipping_fee_cents", value=str(settings.shipping_fee_cents), label="配送费（分）", group="commerce"),
            SiteSetting(key="free_shipping_threshold_cents", value=str(settings.free_shipping_threshold_cents), label="包邮门槛（分）", group="commerce"),
            SiteSetting(key="pickup_store_name", value="玺鸿珠宝天津店", label="自提门店名称", group="fulfillment"),
            SiteSetting(key="pickup_store_address", value="天津市和平区南京路 219 号", label="自提门店地址", group="fulfillment"),
            SiteSetting(key="pickup_store_phone", value="16622515550", label="自提联系电话", group="fulfillment"),
            SiteSetting(key="wechat_appid", value=settings.wechat_appid, label="微信 AppID", group="wechat"),
            SiteSetting(key="wechat_mch_id", value=settings.wx_pay_mch_id, label="微信支付商户号", group="payment"),
        ]
        for setting in seed_settings:
            existing_setting = session.exec(select(SiteSetting).where(SiteSetting.key == setting.key)).first()
            if not existing_setting:
                session.add(setting)

        bootstrap_email = settings.admin_bootstrap_email.strip().lower()
        if bootstrap_email and not session.exec(select(AdminUser).where(AdminUser.email == bootstrap_email)).first():
            session.add(
                AdminUser(
                    email=bootstrap_email,
                    name="超级管理员",
                    password_hash=hash_password(settings.admin_bootstrap_password),
                    role=AdminRole.super_admin,
                    is_active=True,
                )
            )
        session.commit()
