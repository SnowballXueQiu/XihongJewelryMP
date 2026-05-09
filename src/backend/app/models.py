from datetime import datetime, timezone
from enum import StrEnum
from typing import Optional

from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class OrderStatus(StrEnum):
    pending_payment = "pending_payment"
    paid = "paid"
    cancelled = "cancelled"
    failed = "failed"


class PaymentStatus(StrEnum):
    created = "created"
    pending = "pending"
    succeeded = "succeeded"
    failed = "failed"


class ProductStatus(StrEnum):
    draft = "draft"
    active = "active"
    inactive = "inactive"


class AdminRole(StrEnum):
    super_admin = "super_admin"
    admin = "admin"


class ProductCategoryLink(SQLModel, table=True):
    product_id: int | None = Field(default=None, foreign_key="product.id", primary_key=True)
    category_id: int | None = Field(default=None, foreign_key="category.id", primary_key=True)


class Category(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    slug: str = Field(index=True, unique=True)
    sort_order: int = 0
    is_active: bool = True


class Product(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    subtitle: str = ""
    description: str = ""
    category_slug: str = Field(index=True)
    material: str = Field(index=True)
    price_cents: int
    stock: int = 0
    image_color: str = "#D8B46A"
    supports_ar: bool = False
    ar_model_url: str | None = None
    ar_scale: str = "0.22 0.22 0.22"
    ar_rotation: str = "0 0 0"
    ar_position: str = "0 0.08 0"
    ar_auto_sync: int = 9
    status: ProductStatus = Field(default=ProductStatus.active, index=True)
    cover_url: str = ""
    gallery_urls: str = "[]"
    sort_order: int = 0
    created_at: datetime = Field(default_factory=utc_now)


class User(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    nickname: str
    phone: str = ""
    avatar_color: str = "#913F5F"
    wechat_openid: str | None = Field(default=None, index=True)
    points: int = 0
    created_at: datetime = Field(default_factory=utc_now)


class CartItem(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    product_id: int = Field(index=True, foreign_key="product.id")
    quantity: int = 1
    created_at: datetime = Field(default_factory=utc_now)


class Order(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    status: OrderStatus = Field(default=OrderStatus.pending_payment, index=True)
    total_cents: int = 0
    receiver_name: str = ""
    receiver_phone: str = ""
    receiver_address: str = ""
    created_at: datetime = Field(default_factory=utc_now)


class OrderItem(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    order_id: int = Field(index=True, foreign_key="order.id")
    product_id: int = Field(index=True, foreign_key="product.id")
    product_name: str
    unit_price_cents: int
    quantity: int


class PetProfile(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id", unique=True)
    name: str = "玺宝"
    level: int = 1
    exp: int = 0
    mood: int = 70
    hunger: int = 40
    asset_key: str = "gem-pet-v1"
    updated_at: datetime = Field(default_factory=utc_now)


class PointLedger(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    action: str
    points: int
    note: str = ""
    created_at: datetime = Field(default_factory=utc_now)


class PaymentIntent(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    order_id: int = Field(index=True, foreign_key="order.id")
    provider: str = "wechat_pay"
    status: PaymentStatus = Field(default=PaymentStatus.created, index=True)
    prepay_id: str
    nonce_str: str
    package: str
    pay_sign: str
    time_stamp: str
    created_at: datetime = Field(default_factory=utc_now)


class AdminUser(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    name: str
    password_hash: str
    role: AdminRole = Field(default=AdminRole.admin, index=True)
    is_active: bool = True
    created_at: datetime = Field(default_factory=utc_now)
    last_login_at: datetime | None = None


class Banner(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    title: str
    subtitle: str = ""
    image_url: str = ""
    image_color: str = "#111111"
    placement: str = Field(default="home_hero", index=True)
    link_type: str = "none"
    link_value: str = ""
    sort_order: int = 0
    is_active: bool = True
    created_at: datetime = Field(default_factory=utc_now)


class Asset(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    filename: str
    original_name: str
    content_type: str
    url: str
    size: int = 0
    asset_type: str = Field(default="image", index=True)
    created_at: datetime = Field(default_factory=utc_now)


class SiteSetting(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    key: str = Field(index=True, unique=True)
    value: str = ""
    label: str = ""
    group: str = Field(default="general", index=True)
    updated_at: datetime = Field(default_factory=utc_now)


class AuditLog(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    admin_id: int | None = Field(default=None, index=True, foreign_key="adminuser.id")
    action: str
    entity: str
    entity_id: str = ""
    detail: str = ""
    created_at: datetime = Field(default_factory=utc_now)
