from pathlib import Path
from typing import Any

from sqlalchemy import inspect, text
from sqlmodel import Session, SQLModel, create_engine, select

from app.models import AdminRole, AdminUser, Banner, Category, PetProfile, Product, SiteSetting, User
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
        },
        "category": {
            "is_active": ("BOOLEAN", True),
        },
    }

    with engine.begin() as connection:
        for table, columns in wanted.items():
            if table not in existing_tables:
                continue
            existing_columns = {column["name"] for column in inspector.get_columns(table)}
            for column_name, (column_type, default) in columns.items():
                if column_name not in existing_columns:
                    connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {column_name} {column_type} DEFAULT {_quote_default(default)}"))


def create_db_and_seed() -> None:
    SQLModel.metadata.create_all(engine)
    _ensure_sqlite_columns()
    with Session(engine) as session:
        user = session.get(User, 1)
        if not user:
            user = User(id=1, nickname="玺鸿会员", phone="13800000000", points=120)
            session.add(user)
        else:
            user.nickname = "玺鸿会员"
            user.avatar_color = "#B89A63"
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
                stock=12,
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
                stock=24,
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
                stock=18,
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
                stock=36,
                image_color="#B8B4AA",
                cover_url="",
                gallery_urls="[]",
                supports_ar=False,
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
                for field, value in product.model_dump(exclude={"id", "created_at"}).items():
                    setattr(existing_product, field, value)
                session.add(existing_product)
            else:
                session.add(product)

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
