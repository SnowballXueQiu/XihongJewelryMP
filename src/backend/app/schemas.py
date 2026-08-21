from datetime import datetime

from pydantic import BaseModel, Field

from app.models import AdminRole, OrderStatus, PaymentStatus, ProductStatus


class StoreConfigRead(BaseModel):
    company_name_zh: str
    company_name_en: str
    shipping_fee_cents: int
    free_shipping_threshold_cents: int


class ProductRead(BaseModel):
    id: int
    name: str
    subtitle: str
    description: str
    category_slug: str
    material: str
    price_cents: int
    original_price_cents: int = 0
    stock: int
    sales: int = 0
    is_featured: bool = False
    tags: list[str] = Field(default_factory=list)
    image_color: str
    supports_ar: bool
    ar_model_url: str | None
    ar_scale: str
    ar_rotation: str
    ar_position: str
    ar_auto_sync: int
    status: ProductStatus = ProductStatus.active
    cover_url: str = ""
    gallery_urls: list[str] = Field(default_factory=list)
    sort_order: int = 0


class ProductWrite(BaseModel):
    name: str = Field(min_length=1)
    subtitle: str = ""
    description: str = ""
    category_slug: str
    material: str
    price_cents: int = Field(ge=0)
    original_price_cents: int = Field(default=0, ge=0)
    stock: int = Field(ge=0)
    sales: int = Field(default=0, ge=0)
    is_featured: bool = False
    tags: list[str] = Field(default_factory=list)
    image_color: str = "#D8B46A"
    supports_ar: bool = False
    ar_model_url: str | None = None
    ar_scale: str = "0.22 0.22 0.22"
    ar_rotation: str = "0 0 0"
    ar_position: str = "0 0.08 0"
    ar_auto_sync: int = 9
    status: ProductStatus = ProductStatus.active
    cover_url: str = ""
    gallery_urls: list[str] = Field(default_factory=list)
    sort_order: int = 0


class CategoryWrite(BaseModel):
    name: str = Field(min_length=1)
    slug: str = Field(min_length=1)
    sort_order: int = 0
    is_active: bool = True


class CartAddRequest(BaseModel):
    product_id: int
    quantity: int = Field(default=1, ge=1, le=99)


class CartUpdateRequest(BaseModel):
    quantity: int = Field(ge=1, le=99)


class CartItemRead(BaseModel):
    id: int
    product: ProductRead
    quantity: int
    subtotal_cents: int


class CheckoutItem(BaseModel):
    product_id: int
    quantity: int = Field(default=1, ge=1, le=99)


class CreateOrderRequest(BaseModel):
    items: list[CheckoutItem]
    address_id: int | None = None
    coupon_id: int | None = None
    buyer_note: str = Field(default="", max_length=200)


class OrderStatusUpdate(BaseModel):
    status: OrderStatus
    logistics_company: str = ""
    tracking_no: str = ""


class OrderItemRead(BaseModel):
    product_id: int
    product_name: str
    unit_price_cents: int
    quantity: int


class PaymentParams(BaseModel):
    provider: str
    appId: str
    timeStamp: str
    nonceStr: str
    package: str
    signType: str = "RSA"
    paySign: str
    prepayId: str
    mock: bool = True


class OrderRead(BaseModel):
    id: int
    order_no: str
    status: OrderStatus
    total_cents: int
    subtotal_cents: int = 0
    shipping_fee_cents: int = 0
    discount_cents: int = 0
    coupon_id: int | None = None
    items: list[OrderItemRead]
    payment: PaymentParams | None = None
    receiver_name: str = ""
    receiver_phone: str = ""
    receiver_address: str = ""
    buyer_note: str = ""
    logistics_company: str = ""
    tracking_no: str = ""
    can_pay: bool = False
    can_cancel: bool = False
    created_at: datetime | None = None
    paid_at: datetime | None = None
    shipped_at: datetime | None = None
    completed_at: datetime | None = None


class AddressRead(BaseModel):
    id: int
    receiver_name: str
    phone: str
    province: str
    city: str
    district: str
    detail: str
    postal_code: str
    is_default: bool


class AddressWrite(BaseModel):
    receiver_name: str = Field(min_length=1, max_length=30)
    phone: str = Field(pattern=r"^1\d{10}$")
    province: str = Field(min_length=1, max_length=30)
    city: str = Field(min_length=1, max_length=30)
    district: str = Field(min_length=1, max_length=30)
    detail: str = Field(min_length=2, max_length=100)
    postal_code: str = Field(default="", max_length=12)
    is_default: bool = False


class FavoriteRead(BaseModel):
    id: int
    product: ProductRead
    created_at: datetime


class CouponRead(BaseModel):
    id: int
    code: str
    name: str
    description: str
    amount_cents: int
    minimum_cents: int
    total_quantity: int = 0
    claimed_quantity: int = 0
    valid_from: datetime
    valid_until: datetime | None
    is_active: bool
    claimed: bool = False
    used: bool = False
    available: bool = True


class CouponWrite(BaseModel):
    code: str = Field(min_length=2, max_length=32)
    name: str = Field(min_length=1, max_length=50)
    description: str = Field(default="", max_length=200)
    amount_cents: int = Field(ge=1)
    minimum_cents: int = Field(default=0, ge=0)
    total_quantity: int = Field(default=0, ge=0)
    valid_from: datetime
    valid_until: datetime | None = None
    is_active: bool = True


class WechatLoginRequest(BaseModel):
    code: str = Field(min_length=1)
    nickname: str = Field(default="微信用户", max_length=40)


class PaymentStatusRead(BaseModel):
    order_id: int
    order_status: OrderStatus
    payment_status: PaymentStatus | None = None
    transaction_id: str = ""
    message: str = ""


class PaymentAdminRead(BaseModel):
    id: int
    order_id: int
    provider: str
    status: PaymentStatus
    out_trade_no: str
    transaction_id: str
    failure_reason: str
    created_at: datetime
    updated_at: datetime | None = None
    notified_at: datetime | None = None


class RefundRequest(BaseModel):
    reason: str = Field(default="用户申请退款", min_length=1, max_length=80)


class RefundRead(BaseModel):
    id: int
    order_id: int
    out_refund_no: str
    refund_id: str
    amount_cents: int
    reason: str
    previous_status: str
    status: str
    created_at: datetime
    updated_at: datetime


class PetRead(BaseModel):
    name: str
    level: int
    exp: int
    mood: int
    hunger: int
    next_level_exp: int
    reward: str
    asset_key: str


class PetActionRequest(BaseModel):
    action: str = Field(pattern="^(feed|pet|checkin|order_reward)$")


class UserRead(BaseModel):
    id: int
    nickname: str
    phone: str
    avatar_color: str
    wechat_openid: str | None
    points: int


class UserTokenRead(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserRead


class BannerRead(BaseModel):
    id: int
    title: str
    subtitle: str
    image_url: str
    image_color: str
    placement: str
    link_type: str
    link_value: str
    sort_order: int
    is_active: bool


class BannerWrite(BaseModel):
    title: str = Field(min_length=1)
    subtitle: str = ""
    image_url: str = ""
    image_color: str = "#111111"
    placement: str = "home_hero"
    link_type: str = "none"
    link_value: str = ""
    sort_order: int = 0
    is_active: bool = True


class AdminLoginRequest(BaseModel):
    email: str
    password: str = Field(min_length=1)


class AdminTokenRead(BaseModel):
    access_token: str
    token_type: str = "bearer"


class AdminUserRead(BaseModel):
    id: int
    email: str
    name: str
    role: AdminRole
    is_active: bool
    created_at: datetime
    last_login_at: datetime | None


class AdminUserCreate(BaseModel):
    email: str
    name: str = Field(min_length=1)
    password: str = Field(min_length=8)
    role: AdminRole = AdminRole.admin
    is_active: bool = True


class AdminUserUpdate(BaseModel):
    name: str | None = None
    password: str | None = Field(default=None, min_length=8)
    role: AdminRole | None = None
    is_active: bool | None = None


class AssetRead(BaseModel):
    id: int
    filename: str
    original_name: str
    content_type: str
    url: str
    size: int
    asset_type: str
    created_at: datetime


class SettingRead(BaseModel):
    key: str
    value: str
    label: str
    group: str


class SettingWrite(BaseModel):
    value: str
    label: str = ""
    group: str = "general"


class SettingBulkWrite(BaseModel):
    settings: dict[str, SettingWrite]


class AuditLogRead(BaseModel):
    id: int
    admin_id: int | None
    action: str
    entity: str
    entity_id: str
    detail: str
    created_at: datetime


class DashboardRead(BaseModel):
    product_count: int
    active_product_count: int
    low_stock_count: int
    pending_order_count: int
    paid_order_count: int
    today_order_count: int
    today_revenue_cents: int
    total_revenue_cents: int
    user_count: int
