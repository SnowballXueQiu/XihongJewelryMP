from datetime import datetime, timezone
from enum import StrEnum
from typing import Optional

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class OrderStatus(StrEnum):
    pending_payment = "pending_payment"
    paid = "paid"
    preparing = "preparing"
    shipped = "shipped"
    completed = "completed"
    cancelled = "cancelled"
    refunding = "refunding"
    refunded = "refunded"
    failed = "failed"


class PaymentStatus(StrEnum):
    created = "created"
    pending = "pending"
    succeeded = "succeeded"
    failed = "failed"
    closed = "closed"
    refunded = "refunded"


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
    original_price_cents: int = 0
    stock: int = 0
    sales: int = 0
    is_featured: bool = False
    free_shipping: bool = False
    tags: str = "[]"
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


class Address(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    receiver_name: str
    phone: str
    province: str = ""
    city: str = ""
    district: str = ""
    detail: str
    postal_code: str = ""
    is_default: bool = False
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class InvoiceTitle(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    invoice_type: str = Field(default="personal", index=True)
    title: str
    tax_number: str = ""
    email: str = ""
    is_default: bool = False
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class Favorite(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    product_id: int = Field(index=True, foreign_key="product.id")
    created_at: datetime = Field(default_factory=utc_now)


class Coupon(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    code: str = Field(index=True, unique=True)
    name: str
    description: str = ""
    amount_cents: int = 0
    minimum_cents: int = 0
    total_quantity: int = 0
    claimed_quantity: int = 0
    valid_from: datetime = Field(default_factory=utc_now)
    valid_until: datetime | None = None
    is_active: bool = True
    created_at: datetime = Field(default_factory=utc_now)


class UserCoupon(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("user_id", "coupon_id", name="uq_user_coupon"),)

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    coupon_id: int = Field(index=True, foreign_key="coupon.id")
    used_order_id: int | None = Field(default=None, index=True, foreign_key="order.id")
    claimed_at: datetime = Field(default_factory=utc_now)
    used_at: datetime | None = None


class CartItem(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    product_id: int = Field(index=True, foreign_key="product.id")
    quantity: int = 1
    created_at: datetime = Field(default_factory=utc_now)


class Order(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    order_no: str = Field(default="", index=True)
    client_request_id: str = Field(default="", index=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    status: OrderStatus = Field(default=OrderStatus.pending_payment, index=True)
    total_cents: int = 0
    subtotal_cents: int = 0
    shipping_fee_cents: int = 0
    discount_cents: int = 0
    coupon_id: int | None = Field(default=None, foreign_key="coupon.id")
    receiver_name: str = ""
    receiver_phone: str = ""
    receiver_address: str = ""
    buyer_note: str = ""
    fulfillment_type: str = Field(default="delivery", index=True)
    pickup_slot: str = ""
    pickup_code: str = ""
    invoice_type: str = "none"
    invoice_title: str = ""
    invoice_tax_number: str = ""
    invoice_email: str = ""
    logistics_company: str = ""
    tracking_no: str = ""
    platform_shipping_uploaded_at: datetime | None = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    paid_at: datetime | None = None
    shipped_at: datetime | None = None
    completed_at: datetime | None = None
    cancelled_at: datetime | None = None
    cancellation_reason: str = ""


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
    out_trade_no: str = Field(default="", index=True)
    transaction_id: str = ""
    prepay_id: str = ""
    nonce_str: str = ""
    package: str = ""
    pay_sign: str = ""
    time_stamp: str = ""
    failure_reason: str = ""
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    expires_at: datetime | None = None
    notified_at: datetime | None = None


class Refund(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    order_id: int = Field(index=True, foreign_key="order.id")
    out_refund_no: str = Field(index=True, unique=True)
    refund_id: str = ""
    amount_cents: int
    reason: str = ""
    previous_status: str = "paid"
    status: str = Field(default="processing", index=True)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


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
