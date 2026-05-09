from pydantic import BaseModel, Field

from app.models import OrderStatus


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


class CartAddRequest(BaseModel):
    product_id: int
    quantity: int = Field(default=1, ge=1, le=99)


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
