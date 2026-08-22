from datetime import datetime, timezone
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import or_, update
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select

from app import wechat_invoice, wechat_pay, wechat_platform
from app.admin import router as admin_router
from app.database import create_db_and_seed, get_session
from app.models import (
    Address,
    Banner,
    CartItem,
    Category,
    Coupon,
    Favorite,
    Order,
    OrderItem,
    OrderStatus,
    PaymentIntent,
    PaymentStatus,
    PetProfile,
    Product,
    ProductStatus,
    Refund,
    SiteSetting,
    User,
    UserCoupon,
)
from app.schemas import (
    AddressRead,
    AddressWrite,
    BannerRead,
    CartAddRequest,
    CartItemRead,
    CartUpdateRequest,
    CouponRead,
    CreateOrderRequest,
    FavoriteRead,
    OrderItemRead,
    OrderRead,
    PaymentParams,
    PaymentStatusRead,
    PetActionRequest,
    PetRead,
    ProductRead,
    StoreConfigRead,
    UserRead,
    UserTokenRead,
    WechatLoginRequest,
    WechatPhoneRequest,
)
from app.services import (
    apply_pet_action,
    cancel_order,
    clear_cart_for_user,
    create_order_from_items,
    current_pending_order_amounts,
    get_mock_user,
    get_commerce_rules,
    mark_order_paid,
    mark_order_refunded,
    resolve_pet_level,
    serialize_product,
    start_order_payment,
    sync_order_payment,
)
from app.settings import settings
from app.user_auth import create_user_token, get_current_user, login_with_wechat


@asynccontextmanager
async def lifespan(_: FastAPI):
    create_db_and_seed()
    yield


app = FastAPI(title="玺鸿珠宝 API", version="0.3.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
Path(settings.uploads_dir).mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.uploads_dir), name="uploads")
app.include_router(admin_router)


@app.middleware("http")
async def prevent_api_caching(request: Request, call_next):
    response = await call_next(request)
    if request.url.path == "/health" or request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "private, no-store, max-age=0, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _apply_invoice_title(order: Order, title: dict) -> None:
    order.invoice_buyer_type = str(title.get("type") or "")
    order.invoice_buyer_name = str(title.get("name") or "")
    order.invoice_buyer_taxpayer_id = str(title.get("taxpayer_id") or "")
    order.invoice_buyer_address = str(title.get("address") or "")
    order.invoice_buyer_telephone = str(title.get("telephone") or "")
    order.invoice_buyer_bank_name = str(title.get("bank_name") or "")
    order.invoice_buyer_bank_account = str(title.get("bank_account") or "")
    order.invoice_bill_type = str(title.get("fapiao_bill_type") or "")
    order.invoice_user_message = str(title.get("user_apply_message") or "")
    order.invoice_status = "title_received"
    order.invoice_error = ""
    order.invoice_updated_at = datetime.now(timezone.utc)


@app.get("/health")
def health() -> dict[str, str | bool]:
    return {"status": "ok", "wechat_pay_configured": wechat_pay.is_configured(), "payment_mock": settings.wx_pay_mock}


@app.get("/api/store/config", response_model=StoreConfigRead)
def store_config(session: Session = Depends(get_session)) -> StoreConfigRead:
    values = {row.key: row.value for row in session.exec(select(SiteSetting)).all()}
    shipping_fee_cents, free_shipping_threshold_cents = get_commerce_rules(session)
    return StoreConfigRead(
        company_name_zh=values.get("company_name") or settings.company_name_zh,
        company_name_en=settings.company_name_en,
        shipping_fee_cents=shipping_fee_cents,
        free_shipping_threshold_cents=free_shipping_threshold_cents,
        pickup_store_name=values.get("pickup_store_name") or "玺鸿珠宝天津店",
        pickup_store_address=values.get("pickup_store_address") or "天津市和平区南京路 219 号",
        pickup_store_phone=values.get("pickup_store_phone") or "16622515550",
    )


@app.post("/api/auth/wechat", response_model=UserTokenRead)
def wechat_login(payload: WechatLoginRequest, session: Session = Depends(get_session)) -> UserTokenRead:
    user = login_with_wechat(session, payload.code, payload.nickname)
    return UserTokenRead(access_token=create_user_token(user), user=UserRead(**user.model_dump()))


@app.get("/api/categories")
def list_categories(session: Session = Depends(get_session)) -> list[Category]:
    return list(session.exec(select(Category).where(Category.is_active == True).order_by(col(Category.sort_order))))  # noqa: E712


@app.get("/api/banners", response_model=list[BannerRead])
def list_banners(placement: str | None = None, session: Session = Depends(get_session)) -> list[Banner]:
    statement = select(Banner).where(Banner.is_active == True)  # noqa: E712
    if placement:
        statement = statement.where(Banner.placement == placement)
    return list(session.exec(statement.order_by(col(Banner.sort_order))))


@app.get("/api/products", response_model=list[ProductRead])
def list_products(
    category: str | None = None,
    q: str | None = None,
    material: str | None = None,
    min_price: int | None = Query(default=None, ge=0),
    max_price: int | None = Query(default=None, ge=0),
    featured: bool = False,
    in_stock: bool = False,
    sort: str = "recommended",
    session: Session = Depends(get_session),
) -> list[ProductRead]:
    statement = select(Product).where(Product.status == ProductStatus.active)
    if category and category != "all":
        statement = statement.where(Product.category_slug == category)
    if q:
        statement = statement.where(
            col(Product.name).contains(q) | col(Product.subtitle).contains(q) | col(Product.material).contains(q)
        )
    if material and material != "all":
        statement = statement.where(Product.material == material)
    if featured:
        statement = statement.where(Product.is_featured == True)  # noqa: E712
    if in_stock:
        statement = statement.where(Product.stock > 0)
    if min_price is not None:
        statement = statement.where(Product.price_cents >= min_price)
    if max_price is not None:
        statement = statement.where(Product.price_cents <= max_price)
    if sort == "price_asc":
        statement = statement.order_by(col(Product.price_cents), col(Product.sort_order))
    elif sort == "price_desc":
        statement = statement.order_by(col(Product.price_cents).desc(), col(Product.sort_order))
    elif sort == "sales":
        statement = statement.order_by(col(Product.sales).desc(), col(Product.sort_order))
    elif sort == "newest":
        statement = statement.order_by(col(Product.created_at).desc())
    else:
        statement = statement.order_by(col(Product.is_featured).desc(), col(Product.sort_order), col(Product.sales).desc())
    return [serialize_product(product) for product in session.exec(statement).all()]


@app.get("/api/products/{product_id}", response_model=ProductRead)
def get_product(product_id: int, session: Session = Depends(get_session)) -> ProductRead:
    product = session.get(Product, product_id)
    if not product or product.status != ProductStatus.active:
        raise HTTPException(status_code=404, detail="商品不存在或已下架")
    return serialize_product(product)


@app.get("/api/me", response_model=UserRead)
def get_me(user: User = Depends(get_current_user)) -> User:
    return user


@app.post("/api/me/phone", response_model=UserRead)
def bind_wechat_phone(
    payload: WechatPhoneRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> User:
    try:
        phone = wechat_platform.exchange_phone_number(payload.code)
    except wechat_platform.WechatPlatformError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    user.phone = phone
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


@app.get("/api/cart", response_model=list[CartItemRead])
def get_cart(user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> list[CartItemRead]:
    rows = session.exec(select(CartItem).where(CartItem.user_id == user.id).order_by(col(CartItem.created_at).desc())).all()
    result = []
    for item in rows:
        product = session.get(Product, item.product_id)
        if product and product.status == ProductStatus.active:
            result.append(
                CartItemRead(
                    id=item.id or 0,
                    product=serialize_product(product),
                    quantity=item.quantity,
                    subtotal_cents=product.price_cents * item.quantity,
                )
            )
    return result


@app.post("/api/cart", response_model=list[CartItemRead])
def add_to_cart(payload: CartAddRequest, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    product = session.get(Product, payload.product_id)
    if not product or product.status != ProductStatus.active:
        raise HTTPException(status_code=404, detail="商品不存在或已下架")
    existing = session.exec(
        select(CartItem).where(CartItem.user_id == user.id, CartItem.product_id == payload.product_id)
    ).first()
    next_quantity = (existing.quantity if existing else 0) + payload.quantity
    if next_quantity > product.stock:
        raise HTTPException(status_code=400, detail="库存不足")
    if existing:
        existing.quantity = next_quantity
        session.add(existing)
    else:
        session.add(CartItem(user_id=user.id or 0, product_id=payload.product_id, quantity=payload.quantity))
    session.commit()
    return get_cart(user, session)


@app.put("/api/cart/{item_id}", response_model=list[CartItemRead])
def update_cart_item(
    item_id: int,
    payload: CartUpdateRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    item = session.get(CartItem, item_id)
    if not item or item.user_id != user.id:
        raise HTTPException(status_code=404, detail="购物车商品不存在")
    product = session.get(Product, item.product_id)
    if not product or payload.quantity > product.stock:
        raise HTTPException(status_code=400, detail="库存不足")
    item.quantity = payload.quantity
    session.add(item)
    session.commit()
    return get_cart(user, session)


@app.delete("/api/cart/{item_id}", response_model=list[CartItemRead])
def delete_cart_item(item_id: int, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    item = session.get(CartItem, item_id)
    if not item or item.user_id != user.id:
        raise HTTPException(status_code=404, detail="购物车商品不存在")
    session.delete(item)
    session.commit()
    return get_cart(user, session)


@app.delete("/api/cart")
def clear_cart(user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict[str, bool]:
    clear_cart_for_user(session, user.id or 0)
    return {"ok": True}


def _set_default_address(session: Session, user_id: int, address_id: int) -> None:
    addresses = session.exec(select(Address).where(Address.user_id == user_id)).all()
    for address in addresses:
        address.is_default = address.id == address_id
        address.updated_at = datetime.now(timezone.utc)
        session.add(address)


@app.get("/api/addresses", response_model=list[AddressRead])
def list_addresses(user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> list[Address]:
    return list(
        session.exec(
            select(Address).where(Address.user_id == user.id).order_by(col(Address.is_default).desc(), col(Address.updated_at).desc())
        )
    )


@app.post("/api/addresses", response_model=AddressRead)
def create_address(payload: AddressWrite, user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> Address:
    address = Address(user_id=user.id or 0, **payload.model_dump())
    session.add(address)
    session.flush()
    if payload.is_default or not session.exec(select(Address).where(Address.user_id == user.id, Address.id != address.id)).first():
        _set_default_address(session, user.id or 0, address.id or 0)
    session.commit()
    session.refresh(address)
    return address


@app.put("/api/addresses/{address_id}", response_model=AddressRead)
def update_address(
    address_id: int,
    payload: AddressWrite,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> Address:
    address = session.get(Address, address_id)
    if not address or address.user_id != user.id:
        raise HTTPException(status_code=404, detail="收货地址不存在")
    was_default = address.is_default
    for field, value in payload.model_dump().items():
        setattr(address, field, value)
    address.updated_at = datetime.now(timezone.utc)
    session.add(address)
    if payload.is_default:
        _set_default_address(session, user.id or 0, address.id or 0)
    elif was_default:
        next_address = session.exec(
            select(Address).where(Address.user_id == user.id, Address.id != address.id).order_by(col(Address.updated_at).desc())
        ).first()
        if next_address:
            _set_default_address(session, user.id or 0, next_address.id or 0)
        else:
            address.is_default = True
            session.add(address)
    session.commit()
    session.refresh(address)
    return address


@app.delete("/api/addresses/{address_id}")
def delete_address(
    address_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, bool]:
    address = session.get(Address, address_id)
    if not address or address.user_id != user.id:
        raise HTTPException(status_code=404, detail="收货地址不存在")
    was_default = address.is_default
    session.delete(address)
    session.commit()
    if was_default:
        next_address = session.exec(select(Address).where(Address.user_id == user.id).order_by(col(Address.updated_at).desc())).first()
        if next_address:
            _set_default_address(session, user.id or 0, next_address.id or 0)
            session.commit()
    return {"ok": True}


@app.get("/api/favorites", response_model=list[FavoriteRead])
def list_favorites(user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> list[FavoriteRead]:
    favorites = session.exec(
        select(Favorite).where(Favorite.user_id == user.id).order_by(col(Favorite.created_at).desc())
    ).all()
    result = []
    for favorite in favorites:
        product = session.get(Product, favorite.product_id)
        if product and product.status == ProductStatus.active:
            result.append(FavoriteRead(id=favorite.id or 0, product=serialize_product(product), created_at=favorite.created_at))
    return result


@app.put("/api/favorites/{product_id}")
def toggle_favorite(
    product_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, bool]:
    product = session.get(Product, product_id)
    if not product or product.status != ProductStatus.active:
        raise HTTPException(status_code=404, detail="商品不存在")
    favorite = session.exec(select(Favorite).where(Favorite.user_id == user.id, Favorite.product_id == product_id)).first()
    if favorite:
        session.delete(favorite)
        active = False
    else:
        session.add(Favorite(user_id=user.id or 0, product_id=product_id))
        active = True
    session.commit()
    return {"active": active}


@app.get("/api/coupons", response_model=list[CouponRead])
def list_coupons(user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> list[CouponRead]:
    now = datetime.now(timezone.utc)
    coupons = session.exec(select(Coupon).where(Coupon.is_active == True).order_by(col(Coupon.created_at).desc())).all()  # noqa: E712
    claims = {row.coupon_id: row for row in session.exec(select(UserCoupon).where(UserCoupon.user_id == user.id)).all()}
    return [
        CouponRead(
            **coupon.model_dump(),
            claimed=coupon.id in claims,
            used=bool(claims.get(coupon.id) and claims[coupon.id].used_order_id),
            available=(
                _aware(coupon.valid_from) <= now
                and (coupon.valid_until is None or _aware(coupon.valid_until) >= now)
                and (coupon.id in claims or coupon.total_quantity == 0 or coupon.claimed_quantity < coupon.total_quantity)
                and not bool(claims.get(coupon.id) and claims[coupon.id].used_order_id)
            ),
        )
        for coupon in coupons
    ]


@app.post("/api/coupons/{coupon_id}/claim", response_model=CouponRead)
def claim_coupon(
    coupon_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CouponRead:
    coupon = session.get(Coupon, coupon_id)
    if not coupon or not coupon.is_active:
        raise HTTPException(status_code=404, detail="优惠券不存在")
    now = datetime.now(timezone.utc)
    if _aware(coupon.valid_from) > now or (coupon.valid_until and _aware(coupon.valid_until) < now):
        raise HTTPException(status_code=400, detail="优惠券不在可领取时间内")
    existing = session.exec(select(UserCoupon).where(UserCoupon.user_id == user.id, UserCoupon.coupon_id == coupon_id)).first()
    if existing:
        raise HTTPException(status_code=400, detail="已经领取过这张优惠券")
    result = session.exec(
        update(Coupon)
        .where(
            Coupon.id == coupon_id,
            Coupon.is_active == True,  # noqa: E712
            or_(Coupon.total_quantity == 0, Coupon.claimed_quantity < Coupon.total_quantity),
        )
        .values(claimed_quantity=Coupon.claimed_quantity + 1)
    )
    if result.rowcount != 1:
        session.rollback()
        raise HTTPException(status_code=400, detail="优惠券已领完")
    session.add(UserCoupon(user_id=user.id or 0, coupon_id=coupon_id))
    try:
        session.commit()
    except IntegrityError as error:
        session.rollback()
        raise HTTPException(status_code=400, detail="已经领取过这张优惠券") from error
    session.refresh(coupon)
    return CouponRead(**coupon.model_dump(), claimed=True, used=False, available=True)


def serialize_order(order: Order, session: Session, include_payment: bool = False) -> OrderRead:
    items = session.exec(select(OrderItem).where(OrderItem.order_id == order.id)).all()
    display_shipping, display_total = current_pending_order_amounts(session, order)
    intent = session.exec(
        select(PaymentIntent).where(PaymentIntent.order_id == order.id).order_by(col(PaymentIntent.created_at).desc())
    ).first()
    payment = None
    if include_payment:
        if intent:
            payment = PaymentParams(
                provider=intent.provider,
                appId=settings.wx_pay_appid or settings.wechat_appid or "wx_mock_appid",
                timeStamp=intent.time_stamp,
                nonceStr=intent.nonce_str,
                package=intent.package,
                paySign=intent.pay_sign,
                prepayId=intent.prepay_id,
                mock=settings.wx_pay_mock,
            )
    return OrderRead(
        id=order.id or 0,
        order_no=order.order_no or f"XH{order.id or 0:010d}",
        status=order.status,
        total_cents=display_total,
        subtotal_cents=order.subtotal_cents or order.total_cents,
        shipping_fee_cents=display_shipping,
        discount_cents=order.discount_cents,
        coupon_id=order.coupon_id,
        receiver_name=order.receiver_name,
        receiver_phone=order.receiver_phone,
        receiver_address=order.receiver_address,
        buyer_note=order.buyer_note,
        fulfillment_type=order.fulfillment_type,
        pickup_slot=order.pickup_slot,
        pickup_code=order.pickup_code,
        invoice_requested=order.invoice_requested,
        invoice_status=order.invoice_status,
        invoice_apply_id=order.invoice_apply_id,
        invoice_buyer_type=order.invoice_buyer_type,
        invoice_buyer_name=order.invoice_buyer_name,
        invoice_buyer_taxpayer_id=order.invoice_buyer_taxpayer_id,
        invoice_buyer_address=order.invoice_buyer_address,
        invoice_buyer_telephone=order.invoice_buyer_telephone,
        invoice_buyer_bank_name=order.invoice_buyer_bank_name,
        invoice_buyer_bank_account=order.invoice_buyer_bank_account,
        invoice_bill_type=order.invoice_bill_type,
        invoice_user_message=order.invoice_user_message,
        invoice_fapiao_id=order.invoice_fapiao_id,
        invoice_media_id=order.invoice_media_id,
        invoice_card_status=order.invoice_card_status,
        invoice_error=order.invoice_error,
        logistics_company=order.logistics_company,
        tracking_no=order.tracking_no,
        payment_transaction_id=intent.transaction_id if intent else "",
        platform_shipping_uploaded_at=order.platform_shipping_uploaded_at,
        platform_order_state=order.platform_order_state,
        platform_order_state_updated_at=order.platform_order_state_updated_at,
        platform_shipping_error=order.platform_shipping_error,
        platform_confirm_receive_reminded_at=order.platform_confirm_receive_reminded_at,
        platform_special_order_type=order.platform_special_order_type,
        created_at=order.created_at,
        paid_at=order.paid_at,
        shipped_at=order.shipped_at,
        completed_at=order.completed_at,
        can_pay=order.status == OrderStatus.pending_payment,
        can_cancel=order.status == OrderStatus.pending_payment,
        items=[
            OrderItemRead(
                product_id=item.product_id,
                product_name=item.product_name,
                unit_price_cents=item.unit_price_cents,
                quantity=item.quantity,
            )
            for item in items
        ],
        payment=payment,
    )


@app.post("/api/orders", response_model=OrderRead)
def create_order(
    payload: CreateOrderRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> OrderRead:
    if payload.client_request_id:
        existing = session.exec(
            select(Order).where(
                Order.user_id == user.id,
                Order.client_request_id == payload.client_request_id,
            )
        ).first()
        if existing:
            return serialize_order(existing, session)
    address_id = payload.address_id
    if payload.fulfillment_type == "delivery" and address_id is None:
        default_address = session.exec(
            select(Address).where(Address.user_id == user.id).order_by(col(Address.is_default).desc(), col(Address.updated_at).desc())
        ).first()
        if not default_address:
            raise HTTPException(status_code=400, detail="请先添加收货地址")
        address_id = default_address.id
    config_values = {row.key: row.value for row in session.exec(select(SiteSetting)).all()}
    try:
        order = create_order_from_items(
            session,
            user.id or 0,
            [(item.product_id, item.quantity) for item in payload.items],
            address_id,
            payload.coupon_id,
            payload.buyer_note,
            payload.fulfillment_type,
            payload.pickup_slot,
            payload.invoice_requested,
            config_values.get("pickup_store_name") or "玺鸿珠宝天津店",
            config_values.get("pickup_store_address") or "天津市和平区南京路 219 号",
            config_values.get("pickup_store_phone") or "16622515550",
            payload.client_request_id,
        )
    except IntegrityError as error:
        session.rollback()
        existing = session.exec(
            select(Order).where(
                Order.user_id == user.id,
                Order.client_request_id == payload.client_request_id,
            )
        ).first()
        if existing:
            return serialize_order(existing, session)
        raise HTTPException(status_code=409, detail="订单正在创建，请到订单中心查看") from error
    except ValueError as error:
        session.rollback()
        raise HTTPException(status_code=400, detail=str(error)) from error
    return serialize_order(order, session)


@app.get("/api/orders", response_model=list[OrderRead])
def list_orders(
    status: OrderStatus | None = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[OrderRead]:
    statement = select(Order).where(Order.user_id == user.id)
    if status:
        statement = statement.where(Order.status == status)
    orders = session.exec(statement.order_by(col(Order.created_at).desc())).all()
    return [serialize_order(order, session) for order in orders]


@app.get("/api/orders/by-number/{order_number}", response_model=OrderRead)
def get_order_by_number(
    order_number: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> OrderRead:
    normalized = order_number.strip()
    order = session.exec(select(Order).where(Order.order_no == normalized)).first()
    if not order:
        payment = session.exec(
            select(PaymentIntent)
            .where(PaymentIntent.out_trade_no == normalized)
            .order_by(col(PaymentIntent.created_at).desc())
        ).first()
        order = session.get(Order, payment.order_id) if payment else None
    if not order or order.user_id != user.id:
        raise HTTPException(status_code=404, detail="订单不存在")
    return serialize_order(order, session)


@app.get("/api/orders/{order_id}", response_model=OrderRead)
def get_order(order_id: int, user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> OrderRead:
    order = session.get(Order, order_id)
    if not order or order.user_id != user.id:
        raise HTTPException(status_code=404, detail="订单不存在")
    return serialize_order(order, session)


@app.post("/api/orders/{order_id}/pay", response_model=PaymentParams)
def pay_order(order_id: int, user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> PaymentParams:
    order = session.get(Order, order_id)
    if not order or order.user_id != user.id:
        raise HTTPException(status_code=404, detail="订单不存在")
    try:
        return start_order_payment(order, user, session)
    except (ValueError, wechat_pay.WechatPayError) as error:
        raise HTTPException(status_code=400 if isinstance(error, ValueError) else 502, detail=str(error)) from error


@app.get("/api/orders/{order_id}/payment-status", response_model=PaymentStatusRead)
def payment_status(
    order_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> PaymentStatusRead:
    order = session.get(Order, order_id)
    if not order or order.user_id != user.id:
        raise HTTPException(status_code=404, detail="订单不存在")
    try:
        intent = sync_order_payment(session, order)
    except wechat_pay.WechatPayError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    session.refresh(order)
    return PaymentStatusRead(
        order_id=order.id or 0,
        order_status=order.status,
        payment_status=intent.status if intent else None,
        transaction_id=intent.transaction_id if intent else "",
        message="支付成功" if order.status == OrderStatus.paid else "订单尚未支付",
    )


@app.post("/api/orders/{order_id}/mock-pay", response_model=OrderRead)
def mock_pay_order(
    order_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> OrderRead:
    if not settings.wx_pay_mock:
        raise HTTPException(status_code=404, detail="Not found")
    order = session.get(Order, order_id)
    if not order or order.user_id != user.id:
        raise HTTPException(status_code=404, detail="订单不存在")
    intent = session.exec(select(PaymentIntent).where(PaymentIntent.order_id == order.id)).first()
    order = mark_order_paid(session, order, f"mock_transaction_{order.order_no}")
    if intent:
        intent.status = PaymentStatus.succeeded
        intent.transaction_id = f"mock_transaction_{order.order_no}"
        intent.notified_at = datetime.now(timezone.utc)
        session.add(intent)
        session.commit()
    return serialize_order(order, session)


@app.post("/api/orders/{order_id}/cancel", response_model=OrderRead)
def cancel_user_order(
    order_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> OrderRead:
    order = session.get(Order, order_id)
    if not order or order.user_id != user.id:
        raise HTTPException(status_code=404, detail="订单不存在")
    try:
        cancelled = cancel_order(session, order)
    except (ValueError, wechat_pay.WechatPayError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return serialize_order(cancelled, session)


@app.post("/api/orders/{order_id}/complete", response_model=OrderRead)
def complete_order(
    order_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> OrderRead:
    order = session.get(Order, order_id)
    if not order or order.user_id != user.id:
        raise HTTPException(status_code=404, detail="订单不存在")
    if order.status != OrderStatus.shipped:
        raise HTTPException(status_code=400, detail="订单尚未发货")
    if not settings.wx_pay_mock and order.total_cents > 0:
        try:
            platform_order = wechat_platform.query_order_shipping(session, order)
        except wechat_platform.WechatPlatformError as error:
            raise HTTPException(status_code=502, detail=str(error)) from error
        if int(platform_order.get("order_state") or 0) not in {3, 4}:
            raise HTTPException(status_code=409, detail="请先通过微信官方确认收货组件完成确认")
        session.commit()
        session.refresh(order)
        return serialize_order(order, session)
    order.status = OrderStatus.completed
    order.completed_at = datetime.now(timezone.utc)
    order.updated_at = order.completed_at
    session.add(order)
    session.commit()
    session.refresh(order)
    return serialize_order(order, session)


@app.post("/api/orders/{order_id}/platform-sync", response_model=OrderRead)
def sync_user_platform_order(
    order_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> OrderRead:
    order = session.get(Order, order_id)
    if not order or order.user_id != user.id:
        raise HTTPException(status_code=404, detail="订单不存在")
    try:
        wechat_platform.query_order_shipping(session, order)
    except wechat_platform.WechatPlatformError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    session.commit()
    session.refresh(order)
    return serialize_order(order, session)


@app.post("/api/orders/{order_id}/invoice-sync", response_model=OrderRead)
def sync_user_invoice(
    order_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> OrderRead:
    order = session.get(Order, order_id)
    if not order or order.user_id != user.id:
        raise HTTPException(status_code=404, detail="订单不存在")
    if not order.invoice_requested or not order.invoice_apply_id:
        raise HTTPException(status_code=400, detail="该订单没有微信电子发票申请")
    try:
        title = wechat_invoice.get_user_title(order.invoice_apply_id)
    except wechat_pay.WechatPayError as error:
        order.invoice_error = str(error)
        order.invoice_updated_at = datetime.now(timezone.utc)
        session.add(order)
        session.commit()
        raise HTTPException(status_code=502, detail=str(error)) from error
    _apply_invoice_title(order, title)
    session.add(order)
    session.commit()
    session.refresh(order)
    return serialize_order(order, session)


@app.get("/api/pet", response_model=PetRead)
def get_pet(user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> PetRead:
    pet = session.exec(select(PetProfile).where(PetProfile.user_id == user.id)).first()
    if not pet:
        pet = PetProfile(user_id=user.id or 0)
        session.add(pet)
        session.commit()
        session.refresh(pet)
    _, next_exp, reward = resolve_pet_level(pet.exp)
    return PetRead(**pet.model_dump(), next_level_exp=next_exp, reward=reward)


@app.post("/api/pet/action", response_model=PetRead)
def pet_action(
    payload: PetActionRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> PetRead:
    pet = apply_pet_action(session, payload.action, user)
    _, next_exp, reward = resolve_pet_level(pet.exp)
    return PetRead(**pet.model_dump(), next_level_exp=next_exp, reward=reward)


@app.post("/api/payments/wechat/notify", status_code=204)
async def wechat_pay_notify(request: Request, session: Session = Depends(get_session)) -> Response:
    if not wechat_pay.is_configured():
        raise HTTPException(status_code=503, detail="微信支付未配置")
    raw_body = await request.body()
    try:
        payload = wechat_pay.verify_callback(raw_body, request.headers)
        if payload.get("event_type") != "TRANSACTION.SUCCESS":
            return Response(status_code=204)
        resource = wechat_pay.decrypt_callback_resource(payload)
    except wechat_pay.WechatPayError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if resource.get("mchid") != settings.wx_pay_mch_id or resource.get("appid") != settings.wx_pay_appid:
        raise HTTPException(status_code=400, detail="回调商户信息不匹配")
    order = session.exec(select(Order).where(Order.order_no == resource.get("out_trade_no"))).first()
    if not order:
        raise HTTPException(status_code=404, detail="订单不存在")
    amount = resource.get("amount") or {}
    if int(amount.get("total", -1)) != order.total_cents or amount.get("currency") != "CNY":
        raise HTTPException(status_code=400, detail="回调金额不匹配")
    mark_order_paid(session, order, str(resource.get("transaction_id") or ""))
    return Response(status_code=204)


@app.post("/api/payments/wechat/invoice-notify", status_code=204)
async def wechat_invoice_notify(request: Request, session: Session = Depends(get_session)) -> Response:
    if not wechat_pay.is_configured():
        raise HTTPException(status_code=503, detail="微信支付未配置")
    raw_body = await request.body()
    try:
        payload = wechat_pay.verify_callback(raw_body, request.headers)
        resource = wechat_pay.decrypt_callback_resource(payload)
    except wechat_pay.WechatPayError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if resource.get("mchid") != settings.wx_pay_mch_id:
        raise HTTPException(status_code=400, detail="发票回调商户号不匹配")
    apply_id = str(resource.get("fapiao_apply_id") or "")
    intent = session.exec(select(PaymentIntent).where(PaymentIntent.transaction_id == apply_id)).first()
    order = session.get(Order, intent.order_id) if intent else session.exec(
        select(Order).where(Order.invoice_apply_id == apply_id)
    ).first()
    if not order:
        raise HTTPException(status_code=404, detail="发票申请对应订单不存在")
    event_type = str(payload.get("event_type") or "")
    order.invoice_apply_id = apply_id
    order.invoice_updated_at = datetime.now(timezone.utc)
    order.invoice_error = ""
    if event_type == "FAPIAO.USER_APPLIED":
        order.invoice_status = "title_pending_sync"
    elif event_type in {"FAPIAO.CARD_INSERTED", "FAPIAO.CARD_DISCARDED"}:
        information = resource.get("fapiao_information") or []
        if isinstance(information, dict):
            information = [information]
        first = information[0] if information else {}
        order.invoice_fapiao_id = str(first.get("fapiao_id") or order.invoice_fapiao_id)
        order.invoice_card_status = str(first.get("card_status") or "")
        order.invoice_status = "inserted" if order.invoice_card_status == "INSERTED" else "card_updated"
    session.add(order)
    session.commit()
    return Response(status_code=204)


@app.post("/api/payments/wechat/refund-notify", status_code=204)
async def wechat_refund_notify(request: Request, session: Session = Depends(get_session)) -> Response:
    if not wechat_pay.is_configured():
        raise HTTPException(status_code=503, detail="微信支付未配置")
    raw_body = await request.body()
    try:
        payload = wechat_pay.verify_callback(raw_body, request.headers)
        resource = wechat_pay.decrypt_callback_resource(payload)
    except wechat_pay.WechatPayError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if resource.get("mchid") != settings.wx_pay_mch_id:
        raise HTTPException(status_code=400, detail="退款回调商户信息不匹配")
    refund = session.exec(select(Refund).where(Refund.out_refund_no == resource.get("out_refund_no"))).first()
    if not refund:
        raise HTTPException(status_code=404, detail="退款单不存在")
    amount = resource.get("amount") or {}
    if int(amount.get("refund", -1)) != refund.amount_cents or amount.get("currency") != "CNY":
        raise HTTPException(status_code=400, detail="退款回调金额不匹配")
    refund_status = str(resource.get("refund_status") or "").upper()
    refund.refund_id = str(resource.get("refund_id") or refund.refund_id)
    refund.updated_at = datetime.now(timezone.utc)
    order = session.get(Order, refund.order_id)
    if refund_status == "SUCCESS":
        refund.status = "success"
        session.add(refund)
        session.commit()
        if order and order.status != OrderStatus.refunded:
            if order.status != OrderStatus.refunding:
                order.status = OrderStatus.refunding
                session.add(order)
                session.commit()
            mark_order_refunded(session, order)
    elif refund_status in {"CLOSED", "ABNORMAL"}:
        refund.status = refund_status.lower()
        if order and order.status == OrderStatus.refunding:
            try:
                order.status = OrderStatus(refund.previous_status)
            except ValueError:
                order.status = OrderStatus.paid
            order.updated_at = refund.updated_at
            session.add(order)
        session.add(refund)
        session.commit()
    else:
        refund.status = "processing"
        session.add(refund)
        session.commit()
    return Response(status_code=204)
