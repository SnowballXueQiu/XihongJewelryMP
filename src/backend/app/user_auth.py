import base64
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import Depends, Header, HTTPException
from sqlmodel import Session, select

from app.database import get_session
from app.models import User
from app.settings import settings


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(data: str) -> bytes:
    return base64.urlsafe_b64decode((data + "=" * (-len(data) % 4)).encode())


def create_user_token(user: User) -> str:
    header = _b64(b'{"alg":"HS256","typ":"JWT"}')
    payload = _b64(
        json.dumps(
            {
                "sub": str(user.id),
                "kind": "user",
                "exp": int((datetime.now(timezone.utc) + timedelta(days=30)).timestamp()),
            },
            separators=(",", ":"),
        ).encode()
    )
    signing_input = f"{header}.{payload}"
    signature = _b64(hmac.new(settings.user_token_secret.encode(), signing_input.encode(), hashlib.sha256).digest())
    return f"{signing_input}.{signature}"


def decode_user_token(token: str) -> int:
    try:
        header, payload, signature = token.split(".", 2)
        signing_input = f"{header}.{payload}"
        expected = _b64(hmac.new(settings.user_token_secret.encode(), signing_input.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            raise ValueError("bad signature")
        data = json.loads(_unb64(payload))
        if data.get("kind") != "user" or int(data.get("exp", 0)) < int(datetime.now(timezone.utc).timestamp()):
            raise ValueError("expired")
        return int(data["sub"])
    except Exception as error:
        raise HTTPException(status_code=401, detail="用户登录状态已失效") from error


def get_current_user(
    authorization: str | None = Header(default=None),
    session: Session = Depends(get_session),
) -> User:
    if authorization and authorization.startswith("Bearer "):
        user = session.get(User, decode_user_token(authorization.removeprefix("Bearer ").strip()))
        if user:
            return user
        raise HTTPException(status_code=401, detail="用户不存在")
    if settings.allow_mock_user:
        user = session.get(User, 1)
        if user:
            return user
    raise HTTPException(status_code=401, detail="请先登录微信")


def login_with_wechat(session: Session, code: str, nickname: str) -> User:
    if settings.wechat_appid and settings.wechat_app_secret and not settings.wx_pay_mock:
        try:
            response = httpx.get(
                "https://api.weixin.qq.com/sns/jscode2session",
                params={
                    "appid": settings.wechat_appid,
                    "secret": settings.wechat_app_secret,
                    "js_code": code,
                    "grant_type": "authorization_code",
                },
                timeout=8,
            )
            response.raise_for_status()
            data = response.json()
        except (httpx.HTTPError, ValueError) as error:
            raise HTTPException(status_code=502, detail="微信登录服务暂不可用") from error
        openid = data.get("openid")
        if not openid:
            raise HTTPException(status_code=400, detail=data.get("errmsg") or "微信登录失败")
    elif settings.allow_mock_user:
        openid = f"mock_{hashlib.sha256(code.encode()).hexdigest()[:24]}"
    else:
        raise HTTPException(status_code=503, detail="微信登录尚未配置")

    user = session.exec(select(User).where(User.wechat_openid == openid)).first()
    if not user:
        user = User(nickname=nickname or "微信用户", wechat_openid=openid)
    elif nickname and user.nickname in {"微信用户", "玺鸿会员"}:
        user.nickname = nickname
    session.add(user)
    session.commit()
    session.refresh(user)
    return user
