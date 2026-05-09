import hmac
import hashlib
import json
from datetime import datetime, timedelta, timezone

from fastapi import Depends, Header, HTTPException
from sqlmodel import Session, select

from app.database import get_session
from app.models import AdminRole, AdminUser
from app.security import verify_password
from app.settings import settings


def _b64(data: bytes) -> str:
    import base64

    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(data: str) -> bytes:
    import base64

    padded = data + "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(padded.encode())


def create_admin_token(admin: AdminUser) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": str(admin.id),
        "role": admin.role,
        "exp": int((datetime.now(timezone.utc) + timedelta(hours=12)).timestamp()),
    }
    signing_input = f"{_b64(json.dumps(header, separators=(',', ':')).encode())}.{_b64(json.dumps(payload, separators=(',', ':')).encode())}"
    signature = hmac.new(settings.admin_jwt_secret.encode(), signing_input.encode(), hashlib.sha256).digest()
    return f"{signing_input}.{_b64(signature)}"


def decode_admin_token(token: str) -> dict:
    try:
        header, payload, signature = token.split(".", 2)
        signing_input = f"{header}.{payload}"
        expected = _b64(hmac.new(settings.admin_jwt_secret.encode(), signing_input.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            raise ValueError("bad signature")
        data = json.loads(_unb64(payload))
        if int(data.get("exp", 0)) < int(datetime.now(timezone.utc).timestamp()):
            raise ValueError("expired")
        return data
    except Exception as error:
        raise HTTPException(status_code=401, detail="Invalid admin token") from error


def get_current_admin(
    authorization: str | None = Header(default=None),
    session: Session = Depends(get_session),
) -> AdminUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Admin token is required")
    data = decode_admin_token(authorization.removeprefix("Bearer ").strip())
    admin = session.get(AdminUser, int(data["sub"]))
    if not admin or not admin.is_active:
        raise HTTPException(status_code=401, detail="Admin account is inactive")
    return admin


def require_super_admin(admin: AdminUser = Depends(get_current_admin)) -> AdminUser:
    if admin.role != AdminRole.super_admin:
        raise HTTPException(status_code=403, detail="Super admin permission required")
    return admin


def get_admin_by_email(session: Session, email: str) -> AdminUser | None:
    return session.exec(select(AdminUser).where(AdminUser.email == email.strip().lower())).first()
