from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session, col, select

from app.admin import router as admin_router
from app.database import create_db_and_seed, get_session
from app.models import Banner, CartItem, Category, Order, OrderItem, OrderStatus, PetProfile, Product, ProductStatus
from app.schemas import (
    BannerRead,
    CartAddRequest,
    CartItemRead,
    CartUpdateRequest,
    CreateOrderRequest,
    OrderItemRead,
    OrderRead,
    PetActionRequest,
    PetRead,
    ProductRead,
    UserRead,
)
from app.services import (
    apply_pet_action,
    build_payment_params,
    clear_cart_for_user,
    create_order_from_items,
    get_mock_user,
    resolve_pet_level,
    serialize_product,
    update_order_status,
)
from app.settings import settings

app = FastAPI(title="玺鸿珠宝 API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
Path(settings.uploads_dir).mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.uploads_dir), name="uploads")
app.include_router(admin_router)


@app.on_event("startup")
def on_startup() -> None:
    create_db_and_seed()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


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
    ar_only: bool = False,
    min_price: int | None = Query(default=None, ge=0),
    max_price: int | None = Query(default=None, ge=0),
    sort: str = "recommended",
    session: Session = Depends(get_session),
) -> list[ProductRead]:
    statement = select(Product).where(Product.status == ProductStatus.active)
    if category and category != "all":
        statement = statement.where(Product.category_slug == category)
    if q:
        statement = statement.where(col(Product.name).contains(q))
    if material and material != "all":
        statement = statement.where(Product.material == material)
    if ar_only:
        statement = statement.where(Product.supports_ar == True)  # noqa: E712
    if min_price is not None:
        statement = statement.where(Product.price_cents >= min_price)
    if max_price is not None:
        statement = statement.where(Product.price_cents <= max_price)
    if sort == "price_asc":
        statement = statement.order_by(col(Product.price_cents))
    elif sort == "price_desc":
        statement = statement.order_by(col(Product.price_cents).desc())
    else:
        statement = statement.order_by(col(Product.created_at).desc())
    return [serialize_product(product) for product in session.exec(statement).all()]


@app.get("/api/products/{product_id}", response_model=ProductRead)
def get_product(product_id: int, session: Session = Depends(get_session)) -> ProductRead:
    product = session.get(Product, product_id)
    if not product or product.status != ProductStatus.active:
        raise HTTPException(status_code=404, detail="Product not found")
    return serialize_product(product)


@app.get("/api/me", response_model=UserRead)
def get_me(session: Session = Depends(get_session)):
    return get_mock_user(session)


@app.get("/api/cart", response_model=list[CartItemRead])
def get_cart(session: Session = Depends(get_session)):
    user = get_mock_user(session)
    rows = session.exec(select(CartItem).where(CartItem.user_id == user.id)).all()
    result = []
    for item in rows:
        product = session.get(Product, item.product_id)
        if product:
            result.append(CartItemRead(id=item.id or 0, product=serialize_product(product), quantity=item.quantity, subtotal_cents=product.price_cents * item.quantity))
    return result


@app.post("/api/cart", response_model=list[CartItemRead])
def add_to_cart(payload: CartAddRequest, session: Session = Depends(get_session)):
    user = get_mock_user(session)
    product = session.get(Product, payload.product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    existing = session.exec(select(CartItem).where(CartItem.user_id == user.id, CartItem.product_id == payload.product_id)).first()
    if existing:
        existing.quantity += payload.quantity
        session.add(existing)
    else:
        session.add(CartItem(user_id=user.id or 0, product_id=payload.product_id, quantity=payload.quantity))
    session.commit()
    return get_cart(session)


@app.put("/api/cart/{item_id}", response_model=list[CartItemRead])
def update_cart_item(item_id: int, payload: CartUpdateRequest, session: Session = Depends(get_session)):
    user = get_mock_user(session)
    item = session.get(CartItem, item_id)
    if not item or item.user_id != user.id:
        raise HTTPException(status_code=404, detail="Cart item not found")
    product = session.get(Product, item.product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if payload.quantity > product.stock:
        raise HTTPException(status_code=400, detail="Stock is insufficient")
    item.quantity = payload.quantity
    session.add(item)
    session.commit()
    return get_cart(session)


@app.delete("/api/cart/{item_id}", response_model=list[CartItemRead])
def delete_cart_item(item_id: int, session: Session = Depends(get_session)):
    user = get_mock_user(session)
    item = session.get(CartItem, item_id)
    if not item or item.user_id != user.id:
        raise HTTPException(status_code=404, detail="Cart item not found")
    session.delete(item)
    session.commit()
    return get_cart(session)


@app.delete("/api/cart")
def clear_cart(session: Session = Depends(get_session)) -> dict[str, bool]:
    user = get_mock_user(session)
    clear_cart_for_user(session, user.id or 0)
    return {"ok": True}


def serialize_order(order: Order, session: Session, include_payment: bool = False) -> OrderRead:
    items = session.exec(select(OrderItem).where(OrderItem.order_id == order.id)).all()
    payment = build_payment_params(order, session) if include_payment else None
    return OrderRead(
        id=order.id or 0,
        status=order.status,
        total_cents=order.total_cents,
        receiver_name=order.receiver_name,
        receiver_phone=order.receiver_phone,
        receiver_address=order.receiver_address,
        created_at=order.created_at,
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
def create_order(payload: CreateOrderRequest, session: Session = Depends(get_session)):
    user = get_mock_user(session)
    try:
        order = create_order_from_items(
            session,
            user.id or 0,
            [(item.product_id, item.quantity) for item in payload.items],
            {
                "receiver_name": payload.receiver_name,
                "receiver_phone": payload.receiver_phone,
                "receiver_address": payload.receiver_address,
            },
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return serialize_order(order, session, include_payment=True)


@app.get("/api/orders", response_model=list[OrderRead])
def list_orders(session: Session = Depends(get_session)):
    user = get_mock_user(session)
    orders = session.exec(select(Order).where(Order.user_id == user.id).order_by(col(Order.created_at).desc())).all()
    return [serialize_order(order, session, include_payment=False) for order in orders]


@app.get("/api/pet", response_model=PetRead)
def get_pet(session: Session = Depends(get_session)):
    user = get_mock_user(session)
    pet = session.exec(select(PetProfile).where(PetProfile.user_id == user.id)).one()
    _, next_exp, reward = resolve_pet_level(pet.exp)
    return PetRead(**pet.model_dump(), next_level_exp=next_exp, reward=reward)


@app.post("/api/pet/action", response_model=PetRead)
def pet_action(payload: PetActionRequest, session: Session = Depends(get_session)):
    pet = apply_pet_action(session, payload.action)
    _, next_exp, reward = resolve_pet_level(pet.exp)
    return PetRead(**pet.model_dump(), next_level_exp=next_exp, reward=reward)


@app.post("/api/payments/wechat/notify")
def wechat_pay_notify(payload: dict, session: Session = Depends(get_session)) -> dict[str, str]:
    order_id = int(payload.get("order_id", 0))
    status = payload.get("status", "paid")
    if not order_id:
        raise HTTPException(status_code=400, detail="order_id is required")
    update_order_status(session, order_id, OrderStatus.paid if status == "paid" else OrderStatus.failed)
    return {"code": "SUCCESS", "message": "ok"}
