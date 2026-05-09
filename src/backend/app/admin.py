from datetime import datetime, timezone
from pathlib import Path
from secrets import token_hex

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlmodel import Session, col, select

from app.auth import create_admin_token, get_admin_by_email, get_current_admin, require_super_admin
from app.database import get_session
from app.models import AdminUser, Asset, Banner, Category, Order, PetProfile, Product, SiteSetting, User
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
    OrderRead,
    OrderStatusUpdate,
    PetRead,
    ProductRead,
    ProductWrite,
    SettingBulkWrite,
    SettingRead,
    SettingWrite,
    UserRead,
)
from app.security import hash_password, verify_password
from app.services import (
    apply_product_payload,
    resolve_pet_level,
    serialize_product,
    update_order_status,
    write_audit_log,
)
from app.settings import settings


router = APIRouter(prefix="/api/admin", tags=["admin"])


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
    try:
        order = update_order_status(session, order_id, payload.status)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    write_audit_log(session, admin, "update_status", "order", str(order.id or ""), payload.status)
    session.commit()
    return _order_read(order, session, include_payment=False)


@router.get("/users", response_model=list[UserRead])
def list_admin_users(session: Session = Depends(get_session), _: AdminUser = Depends(get_current_admin)) -> list[User]:
    return session.exec(select(User).order_by(col(User.created_at).desc())).all()


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
