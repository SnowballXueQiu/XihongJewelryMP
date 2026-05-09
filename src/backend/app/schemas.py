from datetime import datetime

from pydantic import BaseModel, Field

from app.models import AdminRole, OrderStatus, ProductStatus


class ProductRead(BaseModel):
    id: int
    name: str
    subtitle: str
    description: str
    category_slug: str
    material: str
    price_cents: int
    stock: int
    image_color: str
    supports_ar: bool
    ar_model_url: str | None
    ar_scale: str
    ar_rotation: str
    ar_position: str
    ar_auto_sync: int
    status: ProductStatus = ProductStatus.active
    cover_url: str = ""
    gallery_urls: list[str] = []
    sort_order: int = 0


class ProductWrite(BaseModel):
    name: str = Field(min_length=1)
    subtitle: str = ""
    description: str = ""
    category_slug: str
    material: str
    price_cents: int = Field(ge=0)
    stock: int = Field(ge=0)
    image_color: str = "#D8B46A"
    supports_ar: bool = False
    ar_model_url: str | None = None
    ar_scale: str = "0.22 0.22 0.22"
    ar_rotation: str = "0 0 0"
    ar_position: str = "0 0.08 0"
    ar_auto_sync: int = 9
    status: ProductStatus = ProductStatus.active
    cover_url: str = ""
    gallery_urls: list[str] = []
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
    receiver_name: str = "测试用户"
    receiver_phone: str = "13800000000"
    receiver_address: str = "天津市玺鸿珠宝体验店"


class OrderStatusUpdate(BaseModel):
    status: OrderStatus


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
    status: OrderStatus
    total_cents: int
    items: list[OrderItemRead]
    payment: PaymentParams | None = None
    receiver_name: str = ""
    receiver_phone: str = ""
    receiver_address: str = ""
    created_at: datetime | None = None


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
