from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select

from app.database import create_db_and_seed, get_session
from app.models import CartItem, Category, Order, OrderItem, OrderStatus, PetProfile, Product
from app.schemas import (
    CartAddRequest,
    CartItemRead,
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
    update_order_status,
)

app = FastAPI(title="玺鸿珠宝 API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    create_db_and_seed()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/categories")
def list_categories(session: Session = Depends(get_session)) -> list[Category]:
    return session.exec(select(Category).order_by(Category.sort_order)).all()


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
) -> list[Product]:
    statement = select(Product)
    if category and category != "all":
        statement = statement.where(Product.category_slug == category)
    if q:
        statement = statement.where(Product.name.contains(q))
    if material and material != "all":
        statement = statement.where(Product.material == material)
    if ar_only:
        statement = statement.where(Product.supports_ar == True)  # noqa: E712
    if min_price is not None:
        statement = statement.where(Product.price_cents >= min_price)
    if max_price is not None:
        statement = statement.where(Product.price_cents <= max_price)
    if sort == "price_asc":
        statement = statement.order_by(Product.price_cents)
    elif sort == "price_desc":
        statement = statement.order_by(Product.price_cents.desc())
    else:
        statement = statement.order_by(Product.created_at.desc())
    return session.exec(statement).all()


@app.get("/api/products/{product_id}", response_model=ProductRead)
def get_product(product_id: int, session: Session = Depends(get_session)) -> Product:
    product = session.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


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
            result.append(CartItemRead(id=item.id or 0, product=product, quantity=item.quantity, subtotal_cents=product.price_cents * item.quantity))
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
    orders = session.exec(select(Order).where(Order.user_id == user.id).order_by(Order.created_at.desc())).all()
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
