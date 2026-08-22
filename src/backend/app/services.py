from datetime import datetime, timedelta, timezone
from secrets import token_hex
from time import time
import json

from sqlalchemy import update
from sqlmodel import Session, col, select

from app.models import (
    AdminUser,
    Address,
    AuditLog,
    CartItem,
    Coupon,
    Order,
    OrderItem,
    OrderStatus,
    PaymentIntent,
    PaymentStatus,
    PetProfile,
    PointLedger,
    Product,
    ProductStatus,
    SiteSetting,
    User,
    UserCoupon,
)
from app.schemas import PaymentParams, ProductRead
from app.settings import settings
from app import wechat_pay


PET_LEVELS = [
    (1, 0, "新人清洁布"),
    (2, 100, "会员包邮券"),
    (3, 300, "珠宝清洁保养券"),
    (4, 700, "生日礼预约资格"),
    (5, 1300, "VIP 新品预览资格"),
]


def get_commerce_rules(session: Session) -> tuple[int, int]:
    rows = session.exec(
        select(SiteSetting).where(col(SiteSetting.key).in_(["shipping_fee_cents", "free_shipping_threshold_cents"]))
    ).all()
    values = {row.key: row.value for row in rows}
    def parse(key: str, fallback: int) -> int:
        try:
            return max(0, int(values.get(key, fallback)))
        except (TypeError, ValueError):
            return fallback
    return parse("shipping_fee_cents", settings.shipping_fee_cents), parse("free_shipping_threshold_cents", settings.free_shipping_threshold_cents)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


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
    try:
        tags = json.loads(product.tags or "[]")
    except json.JSONDecodeError:
        tags = []
    return ProductRead(
        id=product.id or 0,
        name=product.name,
        subtitle=product.subtitle,
        description=product.description,
        category_slug=product.category_slug,
        material=product.material,
        price_cents=product.price_cents,
        original_price_cents=product.original_price_cents,
        stock=product.stock,
        sales=product.sales,
        is_featured=product.is_featured,
        free_shipping=product.free_shipping,
        tags=tags if isinstance(tags, list) else [],
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
    tags = data.pop("tags", [])
    for field, value in data.items():
        setattr(product, field, value)
    product.gallery_urls = json.dumps(gallery_urls, ensure_ascii=False)
    product.tags = json.dumps(tags, ensure_ascii=False)
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


def apply_pet_action(session: Session, action: str, user: User | None = None) -> PetProfile:
    user = user or get_mock_user(session)
    pet = session.exec(select(PetProfile).where(PetProfile.user_id == user.id)).first()
    if not pet:
        pet = PetProfile(user_id=user.id or 0)
        session.add(pet)
        session.flush()
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


def _payment_params(intent: PaymentIntent, mock: bool) -> PaymentParams:
    return PaymentParams(
        provider=intent.provider,
        appId=settings.wx_pay_appid or settings.wechat_appid or "wx_mock_appid",
        timeStamp=intent.time_stamp,
        nonceStr=intent.nonce_str,
        package=intent.package,
        paySign=intent.pay_sign,
        prepayId=intent.prepay_id,
        mock=mock,
    )


def current_pending_order_amounts(session: Session, order: Order) -> tuple[int, int]:
    """Return the amount a still-unpaid order should use under current shipping rules."""
    if order.status != OrderStatus.pending_payment:
        return order.shipping_fee_cents, order.total_cents
    if order.fulfillment_type == "pickup":
        return 0, max(0, order.subtotal_cents - order.discount_cents)
    items = session.exec(select(OrderItem).where(OrderItem.order_id == order.id)).all()
    products = [session.get(Product, item.product_id) for item in items]
    shipping_fee_cents, free_shipping_threshold_cents = get_commerce_rules(session)
    all_items_free_shipping = bool(products) and all(product and product.free_shipping for product in products)
    shipping = 0 if all_items_free_shipping or order.subtotal_cents >= free_shipping_threshold_cents else shipping_fee_cents
    return shipping, max(0, order.subtotal_cents + shipping - order.discount_cents)


def refresh_pending_order_pricing(session: Session, order: Order) -> None:
    shipping, total = current_pending_order_amounts(session, order)
    if shipping == order.shipping_fee_cents and total == order.total_cents:
        return
    pending_intents = session.exec(
        select(PaymentIntent).where(PaymentIntent.order_id == order.id, PaymentIntent.status == PaymentStatus.pending)
    ).all()
    for intent in pending_intents:
        if not settings.wx_pay_mock and intent.out_trade_no:
            wechat_pay.close_order(intent.out_trade_no)
        intent.status = PaymentStatus.closed
        intent.updated_at = datetime.now(timezone.utc)
        session.add(intent)
    order.shipping_fee_cents = shipping
    order.total_cents = total
    order.updated_at = datetime.now(timezone.utc)
    session.add(order)
    session.commit()
    session.refresh(order)


def start_order_payment(order: Order, user: User, session: Session) -> PaymentParams:
    if order.user_id != user.id:
        raise ValueError("Order not found")
    if order.status != OrderStatus.pending_payment:
        raise ValueError("Order is not payable")
    refresh_pending_order_pricing(session, order)

    existing = session.exec(
        select(PaymentIntent)
        .where(PaymentIntent.order_id == order.id, PaymentIntent.status == PaymentStatus.pending)
        .order_by(col(PaymentIntent.created_at).desc())
    ).first()
    now = datetime.now(timezone.utc)
    if existing and existing.expires_at and _aware(existing.expires_at) > now:
        if settings.wx_pay_mock:
            return _payment_params(existing, True)
        params = wechat_pay.build_miniprogram_params(existing.prepay_id)
        existing.time_stamp = params["timeStamp"]
        existing.nonce_str = params["nonceStr"]
        existing.package = params["package"]
        existing.pay_sign = params["paySign"]
        existing.updated_at = now
        session.add(existing)
        session.commit()
        return _payment_params(existing, False)

    prior_intent = session.exec(
        select(PaymentIntent).where(PaymentIntent.order_id == order.id).order_by(col(PaymentIntent.created_at).desc())
    ).first()
    out_trade_no = order.order_no if not prior_intent else f"{order.order_no}{token_hex(2).upper()}"
    if settings.wx_pay_mock:
        nonce = token_hex(16)
        timestamp = str(int(time()))
        prepay_id = f"mock_{out_trade_no}_{nonce[:6]}"
        intent = PaymentIntent(
            order_id=order.id or 0,
            status=PaymentStatus.pending,
            out_trade_no=out_trade_no,
            prepay_id=prepay_id,
            nonce_str=nonce,
            package=f"prepay_id={prepay_id}",
            pay_sign="MOCK_WECHAT_PAY_SIGNATURE",
            time_stamp=timestamp,
            expires_at=now + timedelta(hours=2),
        )
        session.add(intent)
        session.commit()
        session.refresh(intent)
        return _payment_params(intent, True)

    if not user.wechat_openid:
        raise ValueError("微信账号尚未绑定 OpenID")
    items = session.exec(select(OrderItem).where(OrderItem.order_id == order.id)).all()
    prepay_id = wechat_pay.create_jsapi_prepay(
        out_trade_no=out_trade_no,
        description=(items[0].product_name if len(items) == 1 else f"玺鸿珠宝 · {len(items)} 件商品"),
        total_cents=order.total_cents,
        openid=user.wechat_openid,
        goods_detail=[
            {
                "merchant_goods_id": str(item.product_id),
                "goods_name": item.product_name,
                "quantity": item.quantity,
                "unit_price": item.unit_price_cents,
            }
            for item in items
        ],
        support_fapiao=order.invoice_requested,
    )
    params = wechat_pay.build_miniprogram_params(prepay_id)
    intent = PaymentIntent(
        order_id=order.id or 0,
        status=PaymentStatus.pending,
        out_trade_no=out_trade_no,
        prepay_id=prepay_id,
        nonce_str=params["nonceStr"],
        package=params["package"],
        pay_sign=params["paySign"],
        time_stamp=params["timeStamp"],
        expires_at=now + timedelta(hours=2),
    )
    session.add(intent)
    session.commit()
    session.refresh(intent)
    return _payment_params(intent, False)


def create_order_from_items(
    session: Session,
    user_id: int,
    item_quantities: list[tuple[int, int]],
    address_id: int | None,
    coupon_id: int | None,
    buyer_note: str,
    fulfillment_type: str = "delivery",
    pickup_slot: str = "",
    invoice_requested: bool = False,
    pickup_store_name: str = "玺鸿珠宝天津店",
    pickup_store_address: str = "天津市和平区南京路 219 号",
    pickup_store_phone: str = "16622515550",
    client_request_id: str = "",
) -> Order:
    if not item_quantities:
        raise ValueError("Order items are required")
    merged: dict[int, int] = {}
    for product_id, quantity in item_quantities:
        merged[product_id] = merged.get(product_id, 0) + quantity
    product_ids = list(merged)
    products = {product.id: product for product in session.exec(select(Product).where(col(Product.id).in_(product_ids))).all()}
    if len(products) != len(product_ids):
        raise ValueError("Some products no longer exist")
    for product_id, quantity in merged.items():
        product = products[product_id]
        if product.status != ProductStatus.active:
            raise ValueError(f"Product {product.name} is unavailable")
        if product.stock < quantity:
            raise ValueError(f"Product {product.name} stock is insufficient")

    if fulfillment_type not in {"delivery", "pickup"}:
        raise ValueError("配送方式无效")
    address = session.get(Address, address_id) if address_id else None
    if fulfillment_type == "delivery" and (not address or address.user_id != user_id):
        raise ValueError("请先选择收货地址")
    if fulfillment_type == "pickup" and not pickup_slot.strip():
        raise ValueError("请选择到店自提时间")
    subtotal = sum(products[product_id].price_cents * quantity for product_id, quantity in merged.items())
    shipping_fee_cents, free_shipping_threshold_cents = get_commerce_rules(session)
    all_items_free_shipping = all(products[product_id].free_shipping for product_id in merged)
    shipping = 0 if fulfillment_type == "pickup" or all_items_free_shipping or subtotal >= free_shipping_threshold_cents else shipping_fee_cents
    discount = 0
    user_coupon = None
    if coupon_id is not None:
        coupon = session.get(Coupon, coupon_id)
        user_coupon = session.exec(
            select(UserCoupon).where(
                UserCoupon.user_id == user_id,
                UserCoupon.coupon_id == coupon_id,
                UserCoupon.used_order_id == None,  # noqa: E711
            )
        ).first()
        now = datetime.now(timezone.utc)
        if not coupon or not user_coupon or not coupon.is_active:
            raise ValueError("Coupon is unavailable")
        if _aware(coupon.valid_from) > now or (coupon.valid_until and _aware(coupon.valid_until) < now):
            raise ValueError("Coupon is outside its valid period")
        if subtotal < coupon.minimum_cents:
            raise ValueError("Order does not meet the coupon threshold")
        discount = min(coupon.amount_cents, subtotal)

    receiver_address = " ".join(filter(None, [address.province, address.city, address.district, address.detail])) if address else pickup_store_address
    order = Order(
        user_id=user_id,
        client_request_id=client_request_id,
        subtotal_cents=subtotal,
        shipping_fee_cents=shipping,
        discount_cents=discount,
        total_cents=max(0, subtotal + shipping - discount),
        coupon_id=coupon_id,
        receiver_name=address.receiver_name if address else pickup_store_name,
        receiver_phone=address.phone if address else pickup_store_phone,
        receiver_address=receiver_address,
        buyer_note=buyer_note,
        fulfillment_type=fulfillment_type,
        pickup_slot=pickup_slot.strip() if fulfillment_type == "pickup" else "",
        invoice_requested=invoice_requested,
        invoice_status="pending_payment" if invoice_requested else "not_requested",
    )
    session.add(order)
    session.flush()
    order.order_no = f"XH{datetime.now().strftime('%y%m%d')}{order.id:08d}"
    if fulfillment_type == "pickup":
        pickup_phrases = ("桂花金珠", "月光珍珠", "山茶红玉", "星砂流光", "鸢尾方糖", "晨露钻石")
        order.pickup_code = f"{100 + (order.id or 0) % 900}. {pickup_phrases[(order.id or 0) % len(pickup_phrases)]}"
    for product_id, quantity in merged.items():
        product = products[product_id]
        result = session.exec(
            update(Product)
            .where(Product.id == product_id, Product.stock >= quantity, Product.status == ProductStatus.active)
            .values(stock=Product.stock - quantity)
        )
        if result.rowcount != 1:
            session.rollback()
            raise ValueError(f"Product {product.name} stock is insufficient")
        session.add(
            OrderItem(
                order_id=order.id or 0,
                product_id=product.id or 0,
                product_name=product.name,
                unit_price_cents=product.price_cents,
                quantity=quantity,
            )
        )
    if user_coupon:
        result = session.exec(
            update(UserCoupon)
            .where(UserCoupon.id == user_coupon.id, UserCoupon.used_order_id == None)  # noqa: E711
            .values(used_order_id=order.id, used_at=datetime.now(timezone.utc))
        )
        if result.rowcount != 1:
            session.rollback()
            raise ValueError("Coupon has already been used")
    cart_items = session.exec(select(CartItem).where(CartItem.user_id == user_id, col(CartItem.product_id).in_(product_ids))).all()
    for cart_item in cart_items:
        session.delete(cart_item)
    session.add(order)
    session.commit()
    session.refresh(order)
    if order.total_cents == 0:
        order.invoice_requested = False
        order.invoice_status = "not_available_for_free_order"
        session.add(order)
        session.commit()
        order = mark_order_paid(session, order, "free_order")
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
    allowed: dict[OrderStatus, set[OrderStatus]] = {
        OrderStatus.pending_payment: {OrderStatus.pending_payment, OrderStatus.cancelled, OrderStatus.failed},
        OrderStatus.paid: {OrderStatus.paid, OrderStatus.preparing},
        OrderStatus.preparing: {OrderStatus.preparing, OrderStatus.shipped},
        OrderStatus.shipped: {OrderStatus.shipped, OrderStatus.completed},
        OrderStatus.completed: {OrderStatus.completed},
        OrderStatus.cancelled: {OrderStatus.cancelled},
        OrderStatus.refunding: {OrderStatus.refunding},
        OrderStatus.refunded: {OrderStatus.refunded},
        OrderStatus.failed: {OrderStatus.failed},
    }
    if status not in allowed.get(order.status, {order.status}):
        raise ValueError(f"订单状态不能从 {order.status.value} 直接变更为 {status.value}")
    if status == OrderStatus.shipped and order.fulfillment_type != "pickup" and (not order.logistics_company or not order.tracking_no):
        raise ValueError("发货前必须填写物流公司和运单号")
    now = datetime.now(timezone.utc)
    if status == OrderStatus.cancelled and order.status == OrderStatus.pending_payment:
        restore_order_stock(session, order)
        order.cancelled_at = now
    if status == OrderStatus.paid and order.status == OrderStatus.pending_payment:
        mark_order_paid(session, order)
        return order
    if status == OrderStatus.shipped:
        order.shipped_at = now
    if status == OrderStatus.completed:
        order.completed_at = now
    order.status = status
    order.updated_at = now
    session.add(order)
    session.commit()
    session.refresh(order)
    return order


def restore_order_stock(session: Session, order: Order) -> None:
    items = session.exec(select(OrderItem).where(OrderItem.order_id == order.id)).all()
    for item in items:
        product = session.get(Product, item.product_id)
        if product:
            product.stock += item.quantity
            session.add(product)
    if order.coupon_id:
        user_coupon = session.exec(select(UserCoupon).where(UserCoupon.used_order_id == order.id)).first()
        if user_coupon:
            user_coupon.used_order_id = None
            user_coupon.used_at = None
            session.add(user_coupon)


def cancel_order(session: Session, order: Order, reason: str = "用户取消") -> Order:
    if order.status != OrderStatus.pending_payment:
        raise ValueError("Only unpaid orders can be cancelled")
    intent = session.exec(
        select(PaymentIntent).where(PaymentIntent.order_id == order.id).order_by(col(PaymentIntent.created_at).desc())
    ).first()
    if intent and intent.status == PaymentStatus.pending:
        if not settings.wx_pay_mock:
            wechat_pay.close_order(intent.out_trade_no)
        intent.status = PaymentStatus.closed
        intent.updated_at = datetime.now(timezone.utc)
        session.add(intent)
    restore_order_stock(session, order)
    order.status = OrderStatus.cancelled
    order.cancellation_reason = reason
    order.cancelled_at = datetime.now(timezone.utc)
    order.updated_at = order.cancelled_at
    session.add(order)
    session.commit()
    session.refresh(order)
    return order


def mark_order_paid(session: Session, order: Order, transaction_id: str = "") -> Order:
    if order.status != OrderStatus.pending_payment:
        return order
    items = session.exec(select(OrderItem).where(OrderItem.order_id == order.id)).all()
    for item in items:
        product = session.get(Product, item.product_id)
        if product:
            product.sales += item.quantity
            session.add(product)
    order.status = OrderStatus.paid
    order.paid_at = datetime.now(timezone.utc)
    order.updated_at = order.paid_at
    session.add(order)
    user = session.get(User, order.user_id)
    if user:
        reward = max(0, order.total_cents // 1000)
        if reward:
            user.points += reward
            session.add(user)
            session.add(PointLedger(user_id=user.id or 0, action="order_paid", points=reward, note=f"订单 {order.order_no}"))
    if transaction_id:
        intent = session.exec(
            select(PaymentIntent)
            .where(PaymentIntent.order_id == order.id)
            .order_by(col(PaymentIntent.created_at).desc())
        ).first()
        if intent:
            intent.transaction_id = transaction_id
            intent.status = PaymentStatus.succeeded
            intent.notified_at = datetime.now(timezone.utc)
            intent.updated_at = intent.notified_at
            session.add(intent)
        if order.invoice_requested and transaction_id != "free_order":
            order.invoice_apply_id = transaction_id
            order.invoice_status = "pending_title"
            order.invoice_updated_at = datetime.now(timezone.utc)
            session.add(order)
    session.commit()
    session.refresh(order)
    return order


def mark_order_refunded(session: Session, order: Order) -> Order:
    if order.status == OrderStatus.refunded:
        return order
    if order.status != OrderStatus.refunding:
        raise ValueError("订单当前不在退款流程中")
    items = session.exec(select(OrderItem).where(OrderItem.order_id == order.id)).all()
    if not order.shipped_at:
        restore_order_stock(session, order)
    for item in items:
        product = session.get(Product, item.product_id)
        if product:
            product.sales = max(0, product.sales - item.quantity)
            session.add(product)
    user = session.get(User, order.user_id)
    reward = max(0, order.total_cents // 1000)
    if user:
        deducted = min(user.points, reward)
        user.points -= deducted
        session.add(user)
        if deducted:
            session.add(PointLedger(user_id=user.id or 0, action="order_refunded", points=-deducted, note=f"订单 {order.order_no}"))
    order.status = OrderStatus.refunded
    order.updated_at = datetime.now(timezone.utc)
    session.add(order)
    intent = session.exec(select(PaymentIntent).where(PaymentIntent.order_id == order.id).order_by(col(PaymentIntent.created_at).desc())).first()
    if intent:
        intent.status = PaymentStatus.refunded
        intent.updated_at = order.updated_at
        session.add(intent)
    session.commit()
    session.refresh(order)
    return order


def sync_order_payment(session: Session, order: Order) -> PaymentIntent | None:
    intent = session.exec(
        select(PaymentIntent).where(PaymentIntent.order_id == order.id).order_by(col(PaymentIntent.created_at).desc())
    ).first()
    if not intent or intent.status != PaymentStatus.pending or settings.wx_pay_mock:
        return intent
    data = wechat_pay.query_order(intent.out_trade_no)
    state = data.get("trade_state")
    if state == "SUCCESS":
        mark_order_paid(session, order, str(data.get("transaction_id") or ""))
        intent.status = PaymentStatus.succeeded
        intent.transaction_id = str(data.get("transaction_id") or "")
    elif state == "CLOSED":
        intent.status = PaymentStatus.closed
    elif state in {"PAYERROR", "REVOKED"}:
        intent.status = PaymentStatus.failed
        intent.failure_reason = str(data.get("trade_state_desc") or state)
    intent.updated_at = datetime.now(timezone.utc)
    session.add(intent)
    session.commit()
    session.refresh(intent)
    return intent
