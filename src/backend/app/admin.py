from datetime import datetime, timezone
from pathlib import Path
from secrets import token_hex

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlmodel import Session, col, select

from app.auth import create_admin_token, get_admin_by_email, get_current_admin, require_super_admin
from app.database import get_session
from app import wechat_invoice, wechat_pay, wechat_platform
from app.models import AdminUser, Asset, Banner, Category, Coupon, Order, OrderStatus, PaymentIntent, PaymentStatus, PetProfile, PointLedger, Product, ProductStatus, Refund, SiteSetting, User
from app.schemas import (
    AdminLoginRequest,
    AdminTokenRead,
    AdminUserCreate,
    AdminUserRead,
    AdminUserUpdate,
    AssetRead,
    AuditLogRead,
    BannerRead,
    BannerWrite,
    CategoryWrite,
    CouponRead,
    CouponWrite,
    DashboardRead,
    OrderRead,
    OrderStatusUpdate,
    InvoiceDevelopmentConfigWrite,
    PlatformMessagePathWrite,
    PlatformSpecialOrderWrite,
    PaymentAdminRead,
    PetRead,
    ProductRead,
    ProductWrite,
    RefundRead,
    RefundRequest,
    SettingBulkWrite,
    SettingRead,
    SettingWrite,
    UserRead,
    UserPointsUpdate,
)
from app.security import hash_password, verify_password
from app.services import (
    apply_product_payload,
    mark_order_refunded,
    resolve_pet_level,
    serialize_product,
    update_order_status,
    write_audit_log,
)
from app.settings import settings


router = APIRouter(prefix="/api/admin", tags=["admin"])


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _coupon_read(coupon: Coupon) -> CouponRead:
    return CouponRead(
        id=coupon.id or 0,
        code=coupon.code,
        name=coupon.name,
        description=coupon.description,
        amount_cents=coupon.amount_cents,
        minimum_cents=coupon.minimum_cents,
        total_quantity=coupon.total_quantity,
        claimed_quantity=coupon.claimed_quantity,
        valid_from=coupon.valid_from,
        valid_until=coupon.valid_until,
        is_active=coupon.is_active,
        claimed=False,
        used=False,
        available=coupon.is_active,
    )


def _admin_read(admin: AdminUser) -> AdminUserRead:
    return AdminUserRead(
        id=admin.id or 0,
        email=admin.email,
        name=admin.name,
        role=admin.role,
        is_active=admin.is_active,
        created_at=admin.created_at,
        last_login_at=admin.last_login_at,
    )


def _banner_read(banner: Banner) -> BannerRead:
    return BannerRead(
        id=banner.id or 0,
        title=banner.title,
        subtitle=banner.subtitle,
        image_url=banner.image_url,
        image_color=banner.image_color,
        placement=banner.placement,
        link_type=banner.link_type,
        link_value=banner.link_value,
        sort_order=banner.sort_order,
        is_active=banner.is_active,
    )


def _asset_read(asset: Asset) -> AssetRead:
    return AssetRead(
        id=asset.id or 0,
        filename=asset.filename,
        original_name=asset.original_name,
        content_type=asset.content_type,
        url=asset.url,
        size=asset.size,
        asset_type=asset.asset_type,
        created_at=asset.created_at,
    )


def _setting_read(setting: SiteSetting) -> SettingRead:
    return SettingRead(key=setting.key, value=setting.value, label=setting.label, group=setting.group)


def _order_read(order: Order, session: Session, include_payment: bool = False) -> OrderRead:
    from app.main import serialize_order

    return serialize_order(order, session, include_payment=include_payment)


@router.post("/auth/login", response_model=AdminTokenRead)
def login(payload: AdminLoginRequest, session: Session = Depends(get_session)) -> AdminTokenRead:
    admin = get_admin_by_email(session, payload.email)
    if not admin or not admin.is_active or not verify_password(payload.password, admin.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    admin.last_login_at = datetime.now(timezone.utc)
    session.add(admin)
    write_audit_log(session, admin, "login", "admin_user", str(admin.id or ""))
    session.commit()
    return AdminTokenRead(access_token=create_admin_token(admin))


@router.get("/me", response_model=AdminUserRead)
def me(admin: AdminUser = Depends(get_current_admin)) -> AdminUserRead:
    return _admin_read(admin)


@router.get("/dashboard", response_model=DashboardRead)
def dashboard(session: Session = Depends(get_session), _: AdminUser = Depends(get_current_admin)) -> DashboardRead:
    from datetime import timedelta

    now = datetime.now(timezone.utc)
    day_start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    products = session.exec(select(Product)).all()
    orders = session.exec(select(Order)).all()
    revenue_statuses = {"paid", "preparing", "shipped", "completed"}
    return DashboardRead(
        product_count=len(products),
        active_product_count=sum(product.status == ProductStatus.active for product in products),
        low_stock_count=sum(product.status == ProductStatus.active and product.stock <= settings.low_stock_threshold for product in products),
        pending_order_count=sum(order.status.value == "pending_payment" for order in orders),
        paid_order_count=sum(order.status.value in revenue_statuses for order in orders),
        today_order_count=sum(_aware(order.created_at) >= day_start for order in orders),
        today_revenue_cents=sum(order.total_cents for order in orders if order.status.value in revenue_statuses and order.paid_at and _aware(order.paid_at) >= day_start),
        total_revenue_cents=sum(order.total_cents for order in orders if order.status.value in revenue_statuses),
        user_count=len(session.exec(select(User)).all()),
    )


@router.get("/products", response_model=list[ProductRead])
def list_admin_products(session: Session = Depends(get_session), _: AdminUser = Depends(get_current_admin)) -> list[ProductRead]:
    products = session.exec(select(Product).order_by(Product.sort_order, col(Product.created_at).desc())).all()
    return [serialize_product(product) for product in products]


@router.post("/products", response_model=ProductRead)
def create_admin_product(payload: ProductWrite, session: Session = Depends(get_session), admin: AdminUser = Depends(get_current_admin)) -> ProductRead:
    product = apply_product_payload(Product(), payload)
    session.add(product)
    session.commit()
    session.refresh(product)
    write_audit_log(session, admin, "create", "product", str(product.id or ""), product.name)
    session.commit()
    return serialize_product(product)


@router.put("/products/{product_id}", response_model=ProductRead)
def update_admin_product(product_id: int, payload: ProductWrite, session: Session = Depends(get_session), admin: AdminUser = Depends(get_current_admin)) -> ProductRead:
    product = session.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    apply_product_payload(product, payload)
    session.add(product)
    write_audit_log(session, admin, "update", "product", str(product.id or ""), product.name)
    session.commit()
    session.refresh(product)
    return serialize_product(product)


@router.delete("/products/{product_id}")
def delete_admin_product(product_id: int, session: Session = Depends(get_session), admin: AdminUser = Depends(get_current_admin)) -> dict[str, bool]:
    product = session.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    session.delete(product)
    write_audit_log(session, admin, "delete", "product", str(product_id), product.name)
    session.commit()
    return {"ok": True}


@router.get("/categories", response_model=list[Category])
def list_admin_categories(session: Session = Depends(get_session), _: AdminUser = Depends(get_current_admin)) -> list[Category]:
    return session.exec(select(Category).order_by(Category.sort_order)).all()


@router.post("/categories", response_model=Category)
def create_admin_category(payload: CategoryWrite, session: Session = Depends(get_session), admin: AdminUser = Depends(get_current_admin)) -> Category:
    category = Category(**payload.model_dump())
    session.add(category)
    session.commit()
    session.refresh(category)
    write_audit_log(session, admin, "create", "category", str(category.id or ""), category.name)
    session.commit()
    return category


@router.put("/categories/{category_id}", response_model=Category)
def update_admin_category(category_id: int, payload: CategoryWrite, session: Session = Depends(get_session), admin: AdminUser = Depends(get_current_admin)) -> Category:
    category = session.get(Category, category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    for field, value in payload.model_dump().items():
        setattr(category, field, value)
    session.add(category)
    write_audit_log(session, admin, "update", "category", str(category.id or ""), category.name)
    session.commit()
    session.refresh(category)
    return category


@router.delete("/categories/{category_id}")
def delete_admin_category(category_id: int, session: Session = Depends(get_session), admin: AdminUser = Depends(get_current_admin)) -> dict[str, bool]:
    category = session.get(Category, category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    session.delete(category)
    write_audit_log(session, admin, "delete", "category", str(category_id), category.name)
    session.commit()
    return {"ok": True}


@router.get("/banners", response_model=list[BannerRead])
def list_admin_banners(session: Session = Depends(get_session), _: AdminUser = Depends(get_current_admin)) -> list[BannerRead]:
    banners = session.exec(select(Banner).order_by(Banner.placement, Banner.sort_order)).all()
    return [_banner_read(banner) for banner in banners]


@router.post("/banners", response_model=BannerRead)
def create_admin_banner(payload: BannerWrite, session: Session = Depends(get_session), admin: AdminUser = Depends(get_current_admin)) -> BannerRead:
    banner = Banner(**payload.model_dump())
    session.add(banner)
    session.commit()
    session.refresh(banner)
    write_audit_log(session, admin, "create", "banner", str(banner.id or ""), banner.title)
    session.commit()
    return _banner_read(banner)


@router.put("/banners/{banner_id}", response_model=BannerRead)
def update_admin_banner(banner_id: int, payload: BannerWrite, session: Session = Depends(get_session), admin: AdminUser = Depends(get_current_admin)) -> BannerRead:
    banner = session.get(Banner, banner_id)
    if not banner:
        raise HTTPException(status_code=404, detail="Banner not found")
    for field, value in payload.model_dump().items():
        setattr(banner, field, value)
    session.add(banner)
    write_audit_log(session, admin, "update", "banner", str(banner.id or ""), banner.title)
    session.commit()
    session.refresh(banner)
    return _banner_read(banner)


@router.delete("/banners/{banner_id}")
def delete_admin_banner(banner_id: int, session: Session = Depends(get_session), admin: AdminUser = Depends(get_current_admin)) -> dict[str, bool]:
    banner = session.get(Banner, banner_id)
    if not banner:
        raise HTTPException(status_code=404, detail="Banner not found")
    session.delete(banner)
    write_audit_log(session, admin, "delete", "banner", str(banner_id), banner.title)
    session.commit()
    return {"ok": True}


@router.get("/orders", response_model=list[OrderRead])
def list_admin_orders(session: Session = Depends(get_session), _: AdminUser = Depends(get_current_admin)) -> list[OrderRead]:
    orders = session.exec(select(Order).order_by(col(Order.created_at).desc())).all()
    return [_order_read(order, session) for order in orders]


@router.put("/orders/{order_id}/status", response_model=OrderRead)
def update_admin_order_status(order_id: int, payload: OrderStatusUpdate, session: Session = Depends(get_session), admin: AdminUser = Depends(get_current_admin)) -> OrderRead:
    order = session.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if payload.logistics_company:
        order.logistics_company = payload.logistics_company
    if payload.tracking_no:
        order.tracking_no = payload.tracking_no
    session.add(order)
    try:
        if payload.status == OrderStatus.shipped and order.status != OrderStatus.shipped:
            if order.fulfillment_type != "pickup" and (not order.logistics_company or not order.tracking_no):
                raise ValueError("发货前必须填写物流公司和运单号")
            wechat_platform.upload_order_shipping(session, order)
        if (
            payload.status == OrderStatus.completed
            and order.status != OrderStatus.completed
            and not settings.wx_pay_mock
            and order.total_cents > 0
        ):
            platform_order = wechat_platform.query_order_shipping(session, order)
            if int(platform_order.get("order_state") or 0) not in {3, 4}:
                raise ValueError("微信平台订单尚未确认收货，不能提前完成订单")
        order = update_order_status(session, order_id, payload.status)
    except (ValueError, wechat_platform.WechatPlatformError) as error:
        session.rollback()
        failed_order = session.get(Order, order_id)
        if failed_order and isinstance(error, wechat_platform.WechatPlatformError):
            failed_order.platform_shipping_error = str(error)
            session.add(failed_order)
            session.commit()
        raise HTTPException(status_code=400, detail=str(error)) from error
    write_audit_log(session, admin, "update_status", "order", str(order.id or ""), payload.status)
    session.commit()
    return _order_read(order, session, include_payment=False)


@router.get("/platform-trade/status")
def get_platform_trade_status(_: AdminUser = Depends(get_current_admin)) -> dict:
    try:
        return {"configured": True, **wechat_platform.trade_management_status()}
    except wechat_platform.WechatPlatformError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@router.post("/platform-trade/message-path")
def configure_platform_message_path(
    payload: PlatformMessagePathWrite,
    _: AdminUser = Depends(require_super_admin),
) -> dict[str, str | bool]:
    try:
        wechat_platform.set_message_jump_path(payload.path)
    except wechat_platform.WechatPlatformError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    return {"ok": True, "path": payload.path}


@router.get("/platform-orders")
def list_platform_orders(
    order_state: int | None = Query(default=None, ge=1, le=6),
    openid: str = "",
    begin_time: int | None = None,
    end_time: int | None = None,
    last_index: str = "",
    page_size: int = Query(default=100, ge=1, le=100),
    _: AdminUser = Depends(get_current_admin),
) -> dict:
    try:
        return wechat_platform.query_order_list(
            order_state=order_state,
            openid=openid,
            begin_time=begin_time,
            end_time=end_time,
            last_index=last_index,
            page_size=page_size,
        )
    except wechat_platform.WechatPlatformError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@router.post("/orders/{order_id}/platform-sync", response_model=OrderRead)
def sync_admin_platform_order(
    order_id: int,
    session: Session = Depends(get_session),
    _: AdminUser = Depends(get_current_admin),
) -> OrderRead:
    order = session.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    try:
        wechat_platform.query_order_shipping(session, order)
    except wechat_platform.WechatPlatformError as error:
        order.platform_shipping_error = str(error)
        session.add(order)
        session.commit()
        raise HTTPException(status_code=502, detail=str(error)) from error
    session.commit()
    session.refresh(order)
    return _order_read(order, session)


@router.post("/orders/{order_id}/platform-remind-receive", response_model=OrderRead)
def remind_platform_confirm_receive(
    order_id: int,
    received_time: int | None = None,
    session: Session = Depends(get_session),
    admin: AdminUser = Depends(get_current_admin),
) -> OrderRead:
    order = session.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    try:
        wechat_platform.notify_confirm_receive(
            session,
            order,
            received_time or int(datetime.now(timezone.utc).timestamp()),
        )
    except wechat_platform.WechatPlatformError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    write_audit_log(session, admin, "confirm_receive_reminder", "order", str(order_id))
    session.commit()
    session.refresh(order)
    return _order_read(order, session)


@router.post("/orders/{order_id}/platform-special", response_model=OrderRead)
def report_admin_special_order(
    order_id: int,
    payload: PlatformSpecialOrderWrite,
    session: Session = Depends(get_session),
    admin: AdminUser = Depends(get_current_admin),
) -> OrderRead:
    order = session.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    delay_to = int(payload.delay_to.timestamp()) if payload.delay_to else None
    try:
        wechat_platform.report_special_order(session, order, payload.special_type, delay_to)
    except wechat_platform.WechatPlatformError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    write_audit_log(session, admin, "special_order", "order", str(order_id), str(payload.special_type))
    session.commit()
    session.refresh(order)
    return _order_read(order, session)


@router.get("/invoices", response_model=list[OrderRead])
def list_admin_invoices(
    session: Session = Depends(get_session),
    _: AdminUser = Depends(get_current_admin),
) -> list[OrderRead]:
    orders = session.exec(
        select(Order).where(Order.invoice_requested == True).order_by(col(Order.created_at).desc())  # noqa: E712
    ).all()
    return [_order_read(order, session) for order in orders]


@router.get("/invoices/capability")
def get_invoice_capability(
    session: Session = Depends(get_session),
    _: AdminUser = Depends(get_current_admin),
) -> dict:
    values = {item.key: item.value for item in session.exec(select(SiteSetting)).all()}
    card_appid = values.get("invoice_card_appid") or settings.invoice_card_appid or settings.wx_pay_appid
    card_logo_url = values.get("invoice_card_logo_url") or settings.invoice_card_logo_url
    card_id = values.get("invoice_card_id") or ""
    card_state = {
        "card_configured": bool(card_appid and card_logo_url),
        "card_appid": card_appid,
        "card_id": card_id,
    }
    if not wechat_invoice.is_configured():
        return {
            "configured": False,
            "development_config": None,
            "error": "微信支付生产参数未完整配置",
            **card_state,
        }
    try:
        config = wechat_invoice.get_development_config()
        return {"configured": True, "development_config": config, "error": "", **card_state}
    except wechat_pay.WechatPayError as error:
        return {
            "configured": True,
            "development_config": None,
            "error": str(error),
            **card_state,
        }


@router.post("/invoices/configure")
def configure_invoice_capability(
    payload: InvoiceDevelopmentConfigWrite,
    _: AdminUser = Depends(require_super_admin),
) -> dict:
    try:
        return wechat_invoice.configure_development(
            callback_url=settings.wx_pay_invoice_notify_url,
            show_fapiao_cell=payload.show_fapiao_cell,
        )
    except wechat_pay.WechatPayError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@router.post("/invoices/card-template")
def create_invoice_card_template(
    session: Session = Depends(get_session),
    _: AdminUser = Depends(require_super_admin),
) -> dict:
    values = {item.key: item.value for item in session.exec(select(SiteSetting)).all()}
    existing_card_id = values.get("invoice_card_id", "").strip()
    if existing_card_id:
        return {
            "card_appid": values.get("invoice_card_appid") or settings.invoice_card_appid or settings.wx_pay_appid,
            "card_id": existing_card_id,
            "existing": True,
        }
    try:
        result = wechat_invoice.create_card_template(
            card_appid=values.get("invoice_card_appid") or settings.invoice_card_appid or settings.wx_pay_appid,
            logo_url=values.get("invoice_card_logo_url") or settings.invoice_card_logo_url,
            payee_name=values.get("company_name") or settings.company_name_zh,
        )
    except wechat_pay.WechatPayError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    card_id = str(result.get("card_id") or "")
    if card_id:
        card_id_setting = session.exec(select(SiteSetting).where(SiteSetting.key == "invoice_card_id")).first()
        if card_id_setting:
            card_id_setting.value = card_id
            session.add(card_id_setting)
            session.commit()
    return result


def _store_invoice_title(order: Order, title: dict) -> None:
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


@router.post("/invoices/{order_id}/sync-title", response_model=OrderRead)
def sync_admin_invoice_title(
    order_id: int,
    session: Session = Depends(get_session),
    _: AdminUser = Depends(get_current_admin),
) -> OrderRead:
    order = session.get(Order, order_id)
    if not order or not order.invoice_apply_id:
        raise HTTPException(status_code=404, detail="订单尚无微信发票申请单号")
    try:
        title = wechat_invoice.get_user_title(order.invoice_apply_id)
    except wechat_pay.WechatPayError as error:
        order.invoice_error = str(error)
        order.invoice_updated_at = datetime.now(timezone.utc)
        session.add(order)
        session.commit()
        raise HTTPException(status_code=502, detail=str(error)) from error
    _store_invoice_title(order, title)
    session.add(order)
    session.commit()
    session.refresh(order)
    return _order_read(order, session)


@router.post("/invoices/{order_id}/sync-status", response_model=OrderRead)
def sync_admin_invoice_status(
    order_id: int,
    session: Session = Depends(get_session),
    _: AdminUser = Depends(get_current_admin),
) -> OrderRead:
    order = session.get(Order, order_id)
    if not order or not order.invoice_apply_id:
        raise HTTPException(status_code=404, detail="订单尚无微信发票申请单号")
    try:
        result = wechat_invoice.query_invoice(order.invoice_apply_id, order.invoice_fapiao_id)
    except wechat_pay.WechatPayError as error:
        order.invoice_error = str(error)
        order.invoice_updated_at = datetime.now(timezone.utc)
        session.add(order)
        session.commit()
        raise HTTPException(status_code=502, detail=str(error)) from error
    invoices = result.get("fapiao_information") or []
    first = invoices[0] if invoices else {}
    order.invoice_fapiao_id = str(first.get("fapiao_id") or order.invoice_fapiao_id)
    order.invoice_card_status = str((first.get("card_information") or {}).get("card_status") or "")
    order.invoice_status = "inserted" if order.invoice_card_status == "INSERTED" else str(first.get("status") or "queried").lower()
    order.invoice_error = ""
    order.invoice_updated_at = datetime.now(timezone.utc)
    session.add(order)
    session.commit()
    session.refresh(order)
    return _order_read(order, session)


@router.post("/invoices/{order_id}/deliver", response_model=OrderRead)
async def deliver_admin_invoice(
    order_id: int,
    file: UploadFile = File(...),
    fapiao_number: str = Form(...),
    fapiao_code: str = Form(...),
    fapiao_time: str = Form(...),
    check_code: str = Form(...),
    password: str = Form(...),
    total_amount: int = Form(...),
    tax_amount: int = Form(...),
    seller_name: str = Form(...),
    seller_taxpayer_id: str = Form(...),
    drawer: str = Form(...),
    session: Session = Depends(get_session),
    admin: AdminUser = Depends(get_current_admin),
) -> OrderRead:
    order = session.get(Order, order_id)
    if not order or not order.invoice_apply_id:
        raise HTTPException(status_code=404, detail="订单尚无微信发票申请单号")
    if order.invoice_status not in {"title_received", "delivery_failed"}:
        raise HTTPException(status_code=409, detail="请先从微信同步用户填写的发票抬头")
    if total_amount <= 0 or tax_amount < 0 or tax_amount > total_amount:
        raise HTTPException(status_code=400, detail="发票金额或税额不正确")
    content = await file.read()
    media_id = ""
    try:
        media_id = wechat_invoice.upload_invoice_file(file.filename or "invoice.pdf", content)
        buyer = {
            key: value
            for key, value in {
                "type": order.invoice_buyer_type,
                "name": order.invoice_buyer_name,
                "taxpayer_id": order.invoice_buyer_taxpayer_id,
                "address": order.invoice_buyer_address,
                "telephone": order.invoice_buyer_telephone,
                "bank_name": order.invoice_buyer_bank_name,
                "bank_account": order.invoice_buyer_bank_account,
            }.items()
            if value
        }
        fapiao_id = f"{fapiao_code}{fapiao_number}"
        wechat_invoice.insert_cards(
            fapiao_apply_id=order.invoice_apply_id,
            buyer_information=buyer,
            card_information={
                "fapiao_media_id": media_id,
                "fapiao_number": fapiao_number,
                "fapiao_code": fapiao_code,
                "fapiao_time": fapiao_time,
                "check_code": check_code,
                "password": password,
                "total_amount": total_amount,
                "tax_amount": tax_amount,
                "amount": total_amount - tax_amount,
                "seller_information": {"name": seller_name, "taxpayer_id": seller_taxpayer_id},
                "extra_information": {"drawer": drawer},
            },
        )
    except wechat_pay.WechatPayError as error:
        order.invoice_media_id = media_id
        order.invoice_status = "delivery_failed"
        order.invoice_error = str(error)
        order.invoice_updated_at = datetime.now(timezone.utc)
        session.add(order)
        session.commit()
        raise HTTPException(status_code=502, detail=str(error)) from error
    order.invoice_media_id = media_id
    order.invoice_fapiao_id = f"{fapiao_code}{fapiao_number}"
    order.invoice_card_status = "INSERT_ACCEPTED"
    order.invoice_status = "card_insert_accepted"
    order.invoice_error = ""
    order.invoice_updated_at = datetime.now(timezone.utc)
    session.add(order)
    write_audit_log(session, admin, "deliver_invoice", "order", str(order_id), order.invoice_fapiao_id)
    session.commit()
    session.refresh(order)
    return _order_read(order, session)


@router.get("/payments", response_model=list[PaymentAdminRead])
def list_payments(session: Session = Depends(get_session), _: AdminUser = Depends(get_current_admin)) -> list[PaymentIntent]:
    intents = session.exec(select(PaymentIntent).order_by(col(PaymentIntent.created_at).desc()).limit(300)).all()
    return intents


@router.get("/refunds", response_model=list[RefundRead])
def list_refunds(session: Session = Depends(get_session), _: AdminUser = Depends(get_current_admin)) -> list[Refund]:
    return session.exec(select(Refund).order_by(col(Refund.created_at).desc()).limit(300)).all()


@router.post("/orders/{order_id}/refund", response_model=RefundRead)
def refund_order(
    order_id: int,
    payload: RefundRequest,
    session: Session = Depends(get_session),
    admin: AdminUser = Depends(get_current_admin),
) -> Refund:
    order = session.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status not in {OrderStatus.paid, OrderStatus.preparing, OrderStatus.shipped, OrderStatus.completed}:
        raise HTTPException(status_code=400, detail="只有已付款的订单可以发起退款")
    existing = session.exec(
        select(Refund).where(Refund.order_id == order_id).order_by(col(Refund.created_at).desc())
    ).first()
    if existing and existing.status in {"processing", "success"}:
        return existing
    intent = session.exec(
        select(PaymentIntent)
        .where(PaymentIntent.order_id == order_id, PaymentIntent.status == PaymentStatus.succeeded)
        .order_by(col(PaymentIntent.created_at).desc())
    ).first()
    if not intent or not intent.out_trade_no:
        raise HTTPException(status_code=400, detail="订单没有可退款的成功支付流水")
    refund = Refund(
        order_id=order_id,
        out_refund_no=f"XHR{datetime.now(timezone.utc):%Y%m%d%H%M%S}{token_hex(3).upper()}",
        amount_cents=order.total_cents,
        reason=payload.reason,
        previous_status=order.status.value,
        status="processing",
    )
    session.add(refund)
    session.commit()
    session.refresh(refund)
    if settings.wx_pay_mock:
        refund.status = "success"
        refund.refund_id = f"mock_refund_{refund.out_refund_no}"
        refund.updated_at = datetime.now(timezone.utc)
        order.status = OrderStatus.refunding
        session.add_all([refund, order])
        session.commit()
        mark_order_refunded(session, order)
    else:
        if not settings.wx_pay_refund_notify_url:
            raise HTTPException(status_code=500, detail="退款通知地址未配置")
        try:
            data = wechat_pay.create_refund(
                out_trade_no=intent.out_trade_no,
                out_refund_no=refund.out_refund_no,
                total_cents=order.total_cents,
                refund_cents=order.total_cents,
                reason=payload.reason,
            )
        except wechat_pay.WechatPayError as error:
            refund.status = "failed"
            refund.updated_at = datetime.now(timezone.utc)
            session.add(refund)
            session.commit()
            raise HTTPException(status_code=502, detail=str(error)) from error
        refund.refund_id = str(data.get("refund_id") or "")
        response_status = str(data.get("status") or "PROCESSING").lower()
        refund.status = "success" if response_status == "success" else response_status
        refund.updated_at = datetime.now(timezone.utc)
        order.status = OrderStatus.refunding
        session.add_all([refund, order])
        session.commit()
        if refund.status == "success":
            mark_order_refunded(session, order)
    write_audit_log(session, admin, "refund", "order", str(order_id), f"{refund.out_refund_no} {payload.reason}")
    session.commit()
    session.refresh(refund)
    return refund


@router.get("/coupons", response_model=list[CouponRead])
def list_admin_coupons(session: Session = Depends(get_session), _: AdminUser = Depends(get_current_admin)) -> list[CouponRead]:
    return [_coupon_read(coupon) for coupon in session.exec(select(Coupon).order_by(col(Coupon.created_at).desc())).all()]


@router.post("/coupons", response_model=CouponRead)
def create_admin_coupon(payload: CouponWrite, session: Session = Depends(get_session), admin: AdminUser = Depends(get_current_admin)) -> CouponRead:
    coupon = Coupon(**payload.model_dump(), claimed_quantity=0)
    session.add(coupon)
    session.commit()
    session.refresh(coupon)
    write_audit_log(session, admin, "create", "coupon", str(coupon.id or ""), coupon.code)
    session.commit()
    return _coupon_read(coupon)


@router.put("/coupons/{coupon_id}", response_model=CouponRead)
def update_admin_coupon(coupon_id: int, payload: CouponWrite, session: Session = Depends(get_session), admin: AdminUser = Depends(get_current_admin)) -> CouponRead:
    coupon = session.get(Coupon, coupon_id)
    if not coupon:
        raise HTTPException(status_code=404, detail="Coupon not found")
    for field, value in payload.model_dump().items():
        setattr(coupon, field, value)
    session.add(coupon)
    write_audit_log(session, admin, "update", "coupon", str(coupon.id or ""), coupon.code)
    session.commit()
    session.refresh(coupon)
    return _coupon_read(coupon)


@router.get("/users", response_model=list[UserRead])
def list_admin_users(session: Session = Depends(get_session), _: AdminUser = Depends(get_current_admin)) -> list[User]:
    return session.exec(select(User).order_by(col(User.created_at).desc())).all()


@router.post("/users/{user_id}/points", response_model=UserRead)
def adjust_admin_user_points(
    user_id: int,
    payload: UserPointsUpdate,
    session: Session = Depends(get_session),
    admin: AdminUser = Depends(get_current_admin),
) -> User:
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.delta == 0:
        return user
    next_points = user.points + payload.delta
    if next_points < 0:
        raise HTTPException(status_code=400, detail="调整后积分不能小于 0")
    user.points = next_points
    ledger = PointLedger(user_id=user_id, action="admin_adjust", points=payload.delta, note=payload.note.strip() or "后台人工调整")
    session.add_all([user, ledger])
    write_audit_log(session, admin, "adjust_points", "user", str(user_id), f"{payload.delta:+d} {ledger.note}")
    session.commit()
    session.refresh(user)
    return user


@router.get("/pets", response_model=list[PetRead])
def list_admin_pets(session: Session = Depends(get_session), _: AdminUser = Depends(get_current_admin)) -> list[PetRead]:
    pets = session.exec(select(PetProfile).order_by(col(PetProfile.updated_at).desc())).all()
    result = []
    for pet in pets:
        _, next_exp, reward = resolve_pet_level(pet.exp)
        result.append(PetRead(**pet.model_dump(), next_level_exp=next_exp, reward=reward))
    return result


@router.get("/assets", response_model=list[AssetRead])
def list_assets(session: Session = Depends(get_session), _: AdminUser = Depends(get_current_admin)) -> list[AssetRead]:
    assets = session.exec(select(Asset).order_by(col(Asset.created_at).desc())).all()
    return [_asset_read(asset) for asset in assets]


@router.post("/assets", response_model=AssetRead)
async def upload_asset(file: UploadFile = File(...), session: Session = Depends(get_session), admin: AdminUser = Depends(get_current_admin)) -> AssetRead:
    allowed = {
        "image/jpeg": "image",
        "image/png": "image",
        "image/webp": "image",
        "image/gif": "image",
        "model/gltf-binary": "model",
        "model/gltf+json": "model",
        "application/octet-stream": "model",
    }
    if file.content_type not in allowed:
        raise HTTPException(status_code=400, detail="Unsupported asset type")
    content = await file.read()
    if len(content) > 15 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Asset exceeds 15MB")
    upload_dir = Path(settings.uploads_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(file.filename or "asset").suffix
    filename = f"{token_hex(12)}{suffix}"
    path = upload_dir / filename
    path.write_bytes(content)
    asset = Asset(
        filename=filename,
        original_name=file.filename or filename,
        content_type=file.content_type or "application/octet-stream",
        url=f"{settings.public_base_url}/uploads/{filename}",
        size=len(content),
        asset_type=allowed[file.content_type],
    )
    session.add(asset)
    session.commit()
    session.refresh(asset)
    write_audit_log(session, admin, "upload", "asset", str(asset.id or ""), asset.original_name)
    session.commit()
    return _asset_read(asset)


@router.delete("/assets/{asset_id}")
def delete_asset(asset_id: int, session: Session = Depends(get_session), admin: AdminUser = Depends(get_current_admin)) -> dict[str, bool]:
    asset = session.get(Asset, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    path = Path(settings.uploads_dir) / asset.filename
    session.delete(asset)
    write_audit_log(session, admin, "delete", "asset", str(asset_id), asset.original_name)
    session.commit()
    path.unlink(missing_ok=True)
    return {"ok": True}


@router.get("/settings", response_model=list[SettingRead])
def list_settings(session: Session = Depends(get_session), _: AdminUser = Depends(get_current_admin)) -> list[SettingRead]:
    settings_rows = session.exec(select(SiteSetting).order_by(SiteSetting.group, SiteSetting.key)).all()
    return [_setting_read(setting) for setting in settings_rows]


@router.put("/settings/{key}", response_model=SettingRead)
def update_setting(key: str, payload: SettingWrite, session: Session = Depends(get_session), admin: AdminUser = Depends(get_current_admin)) -> SettingRead:
    setting = session.exec(select(SiteSetting).where(SiteSetting.key == key)).first()
    if not setting:
        setting = SiteSetting(key=key)
    setting.value = payload.value
    setting.label = payload.label
    setting.group = payload.group
    setting.updated_at = datetime.now(timezone.utc)
    session.add(setting)
    write_audit_log(session, admin, "update", "setting", key)
    session.commit()
    session.refresh(setting)
    return _setting_read(setting)


@router.put("/settings", response_model=list[SettingRead])
def update_settings(payload: SettingBulkWrite, session: Session = Depends(get_session), admin: AdminUser = Depends(get_current_admin)) -> list[SettingRead]:
    rows = []
    for key, value in payload.settings.items():
        setting = session.exec(select(SiteSetting).where(SiteSetting.key == key)).first() or SiteSetting(key=key)
        setting.value = value.value
        setting.label = value.label
        setting.group = value.group
        setting.updated_at = datetime.now(timezone.utc)
        session.add(setting)
        rows.append(setting)
    write_audit_log(session, admin, "bulk_update", "setting", ",".join(payload.settings.keys()))
    session.commit()
    return [_setting_read(row) for row in rows]


@router.get("/admin-users", response_model=list[AdminUserRead])
def list_admin_accounts(session: Session = Depends(get_session), _: AdminUser = Depends(require_super_admin)) -> list[AdminUserRead]:
    admins = session.exec(select(AdminUser).order_by(col(AdminUser.created_at).desc())).all()
    return [_admin_read(admin) for admin in admins]


@router.post("/admin-users", response_model=AdminUserRead)
def create_admin_account(payload: AdminUserCreate, session: Session = Depends(get_session), admin: AdminUser = Depends(require_super_admin)) -> AdminUserRead:
    email = payload.email.strip().lower()
    if get_admin_by_email(session, email):
        raise HTTPException(status_code=400, detail="Admin email already exists")
    next_admin = AdminUser(
        email=email,
        name=payload.name,
        password_hash=hash_password(payload.password),
        role=payload.role,
        is_active=payload.is_active,
    )
    session.add(next_admin)
    session.commit()
    session.refresh(next_admin)
    write_audit_log(session, admin, "create", "admin_user", str(next_admin.id or ""), next_admin.email)
    session.commit()
    return _admin_read(next_admin)


@router.put("/admin-users/{admin_id}", response_model=AdminUserRead)
def update_admin_account(admin_id: int, payload: AdminUserUpdate, session: Session = Depends(get_session), admin: AdminUser = Depends(require_super_admin)) -> AdminUserRead:
    target = session.get(AdminUser, admin_id)
    if not target:
        raise HTTPException(status_code=404, detail="Admin account not found")
    data = payload.model_dump(exclude_unset=True)
    if "password" in data and data["password"]:
        target.password_hash = hash_password(data.pop("password"))
    for field, value in data.items():
        setattr(target, field, value)
    session.add(target)
    write_audit_log(session, admin, "update", "admin_user", str(target.id or ""), target.email)
    session.commit()
    session.refresh(target)
    return _admin_read(target)


@router.get("/audit-logs", response_model=list[AuditLogRead])
def list_audit_logs(session: Session = Depends(get_session), _: AdminUser = Depends(get_current_admin)) -> list[AuditLogRead]:
    from app.models import AuditLog

    logs = session.exec(select(AuditLog).order_by(col(AuditLog.created_at).desc()).limit(200)).all()
    return [AuditLogRead(**log.model_dump()) for log in logs]
