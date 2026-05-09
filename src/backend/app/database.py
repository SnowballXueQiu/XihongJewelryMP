from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine, select

from app.models import Category, PetProfile, Product, User
from app.settings import settings


if settings.database_url.startswith("sqlite:///"):
    db_path = settings.database_url.replace("sqlite:///", "", 1)
    if db_path != ":memory:":
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(settings.database_url, echo=False, connect_args={"check_same_thread": False})


def get_session():
    with Session(engine) as session:
        yield session


def create_db_and_seed() -> None:
    SQLModel.metadata.create_all(engine)
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
            Category(name="戒指", slug="rings", sort_order=1),
            Category(name="手链手环", slug="bracelets", sort_order=2),
            Category(name="项链", slug="necklaces", sort_order=3),
            Category(name="耳饰", slug="earrings", sort_order=4),
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
                supports_ar=False,
            ),
        ]
        for category in categories:
            existing_category = session.exec(select(Category).where(Category.slug == category.slug)).first()
            if existing_category:
                existing_category.name = category.name
                existing_category.sort_order = category.sort_order
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
        session.commit()
