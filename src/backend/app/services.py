from secrets import token_hex
from time import time
import json

from sqlmodel import Session, col, select

from app.models import (
    AdminUser,
    AuditLog,
    CartItem,
    Order,
    OrderItem,
    OrderStatus,
    PaymentIntent,
    PaymentStatus,
    PetProfile,
    PointLedger,
    Product,
    User,
)
from app.schemas import PaymentParams, ProductRead
from app.settings import settings


PET_LEVELS = [
    (1, 0, "新人清洁布"),
    (2, 100, "会员包邮券"),
    (3, 300, "珠宝清洁保养券"),
    (4, 700, "生日礼预约资格"),
    (5, 1300, "VIP 新品预览资格"),
]


def get_mock_user(session: Session) -> User:
    user = session.get(User, 1)
    if not user:
        user = User(id=1, nickname="玺鸿会员", points=0)
        session.add(user)
        session.commit()
        session.refresh(user)
    return user


def serialize_product(product: Product) -> ProductRead:
    try:
        gallery_urls = json.loads(product.gallery_urls or "[]")
    except json.JSONDecodeError:
        gallery_urls = []
    return ProductRead(
        id=product.id or 0,
        name=product.name,
        subtitle=product.subtitle,
        description=product.description,
        category_slug=product.category_slug,
        material=product.material,
        price_cents=product.price_cents,
        stock=product.stock,
        image_color=product.image_color,
        supports_ar=product.supports_ar,
        ar_model_url=product.ar_model_url,
        ar_scale=product.ar_scale,
        ar_rotation=product.ar_rotation,
        ar_position=product.ar_position,
        ar_auto_sync=product.ar_auto_sync,
        status=product.status,
        cover_url=product.cover_url,
        gallery_urls=gallery_urls if isinstance(gallery_urls, list) else [],
        sort_order=product.sort_order,
    )


def apply_product_payload(product: Product, payload) -> Product:
    data = payload.model_dump()
    gallery_urls = data.pop("gallery_urls", [])
    for field, value in data.items():
        setattr(product, field, value)
    product.gallery_urls = json.dumps(gallery_urls, ensure_ascii=False)
    return product


def write_audit_log(session: Session, admin: AdminUser | None, action: str, entity: str, entity_id: str = "", detail: str = "") -> None:
    session.add(
        AuditLog(
            admin_id=admin.id if admin else None,
            action=action,
            entity=entity,
            entity_id=entity_id,
            detail=detail,
        )
    )


def resolve_pet_level(exp: int) -> tuple[int, int, str]:
    current = PET_LEVELS[0]
    for level in PET_LEVELS:
        if exp >= level[1]:
            current = level
    next_exp = next((item[1] for item in PET_LEVELS if item[1] > exp), current[1])
    return current[0], next_exp, current[2]


def apply_pet_action(session: Session, action: str) -> PetProfile:
    user = get_mock_user(session)
    pet = session.exec(select(PetProfile).where(PetProfile.user_id == user.id)).one()
    gains = {
        "feed": (8, 12, -18, "喂养宠物"),
        "pet": (5, 8, 0, "抚摸宠物"),
        "checkin": (15, 6, -5, "每日签到"),
        "order_reward": (50, 10, -10, "订单成长奖励"),
    }
    points, mood_delta, hunger_delta, note = gains[action]
    pet.exp += points
    pet.mood = max(0, min(100, pet.mood + mood_delta))
    pet.hunger = max(0, min(100, pet.hunger + hunger_delta))
    pet.level = resolve_pet_level(pet.exp)[0]
    user.points += points
    session.add(PointLedger(user_id=user.id, action=action, points=points, note=note))
    session.add(user)
    session.add(pet)
    session.commit()
    session.refresh(pet)
    return pet


def build_payment_params(order: Order, session: Session) -> PaymentParams:
    nonce = token_hex(12)
    timestamp = str(int(time()))
    prepay_id = f"mock_prepay_{order.id}_{nonce[:8]}"
    intent = PaymentIntent(
        order_id=order.id or 0,
        status=PaymentStatus.pending,
        prepay_id=prepay_id,
        nonce_str=nonce,
        package=f"prepay_id={prepay_id}",
        pay_sign="MOCK_PAY_SIGN_REPLACE_WITH_WECHAT_PAY_RSA_SIGNATURE",
        time_stamp=timestamp,
    )
    session.add(intent)
    session.commit()
    return PaymentParams(
        provider="wechat_pay",
        appId=settings.wx_pay_appid or "wx_mock_appid",
        timeStamp=timestamp,
        nonceStr=nonce,
        package=f"prepay_id={prepay_id}",
        paySign=intent.pay_sign,
        prepayId=prepay_id,
        mock=True,
    )


def create_order_from_items(session: Session, user_id: int, item_quantities: list[tuple[int, int]], receiver: dict) -> Order:
    product_ids = [item[0] for item in item_quantities]
    products = {product.id: product for product in session.exec(select(Product).where(col(Product.id).in_(product_ids))).all()}
    total = 0
    order = Order(user_id=user_id, **receiver)
    session.add(order)
    session.commit()
    session.refresh(order)

    for product_id, quantity in item_quantities:
        product = products.get(product_id)
        if not product:
            raise ValueError(f"Product {product_id} not found")
        if product.stock < quantity:
            raise ValueError(f"Product {product.name} stock is insufficient")
        total += product.price_cents * quantity
        product.stock -= quantity
        session.add(
            OrderItem(
                order_id=order.id or 0,
                product_id=product.id or 0,
                product_name=product.name,
                unit_price_cents=product.price_cents,
                quantity=quantity,
            )
        )
        session.add(product)
    order.total_cents = total
    session.add(order)
    session.commit()
    session.refresh(order)
    return order


def clear_cart_for_user(session: Session, user_id: int) -> None:
    items = session.exec(select(CartItem).where(CartItem.user_id == user_id)).all()
    for item in items:
        session.delete(item)
    session.commit()


def update_order_status(session: Session, order_id: int, status: OrderStatus) -> Order:
    order = session.get(Order, order_id)
    if not order:
        raise ValueError("Order not found")
    order.status = status
    session.add(order)
    session.commit()
    session.refresh(order)
    return order
