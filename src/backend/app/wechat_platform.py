from datetime import datetime, timezone
from time import monotonic

import httpx
from sqlmodel import Session, select

from app.models import Order, OrderItem, PaymentIntent, PaymentStatus, User
from app.settings import settings


class WechatPlatformError(RuntimeError):
    pass


_access_token = ""
_access_token_expires_at = 0.0


def _get_access_token() -> str:
    global _access_token, _access_token_expires_at
    if _access_token and monotonic() < _access_token_expires_at:
        return _access_token
    if not settings.wechat_appid or not settings.wechat_app_secret:
        raise WechatPlatformError("微信小程序服务端凭证未配置")
    try:
        response = httpx.get(
            "https://api.weixin.qq.com/cgi-bin/token",
            params={
                "grant_type": "client_credential",
                "appid": settings.wechat_appid,
                "secret": settings.wechat_app_secret,
            },
            timeout=10,
        )
        response.raise_for_status()
        data = response.json()
    except (httpx.HTTPError, ValueError) as error:
        raise WechatPlatformError("连接微信小程序平台失败") from error
    token = str(data.get("access_token") or "")
    if not token:
        raise WechatPlatformError(f"获取微信接口凭证失败：{data.get('errmsg') or data.get('errcode') or '未知错误'}")
    _access_token = token
    _access_token_expires_at = monotonic() + max(60, int(data.get("expires_in") or 7200) - 300)
    return token


def _post(path: str, payload: dict) -> dict:
    token = _get_access_token()
    try:
        response = httpx.post(
            f"https://api.weixin.qq.com{path}",
            params={"access_token": token},
            json=payload,
            timeout=10,
        )
        response.raise_for_status()
        data = response.json()
    except (httpx.HTTPError, ValueError) as error:
        raise WechatPlatformError("连接微信订单管理服务失败") from error
    if int(data.get("errcode") or 0) != 0:
        raise WechatPlatformError(f"微信订单管理失败：{data.get('errmsg') or data.get('errcode')}")
    return data


def exchange_phone_number(code: str) -> str:
    """Exchange the one-time code emitted by the WeChat phone-number button."""
    token = _get_access_token()
    try:
        response = httpx.post(
            "https://api.weixin.qq.com/wxa/business/getuserphonenumber",
            params={"access_token": token},
            json={"code": code},
            timeout=10,
        )
        response.raise_for_status()
        data = response.json()
    except (httpx.HTTPError, ValueError) as error:
        raise WechatPlatformError("连接微信手机号服务失败") from error
    if int(data.get("errcode") or 0) != 0:
        raise WechatPlatformError(f"手机号授权失败：{data.get('errmsg') or data.get('errcode')}")
    phone_info = data.get("phone_info") or {}
    phone = str(phone_info.get("purePhoneNumber") or phone_info.get("phoneNumber") or "").strip()
    if not phone or not phone.isdigit() or len(phone) not in {11, 12, 13, 14, 15}:
        raise WechatPlatformError("微信未返回有效手机号")
    return phone


def _express_code(name: str) -> str:
    normalized = name.strip().upper()
    aliases = {
        "顺丰": "SF",
        "顺丰速运": "SF",
        "圆通": "YTO",
        "圆通速递": "YTO",
        "申通": "STO",
        "申通快递": "STO",
        "中通": "ZTO",
        "中通快递": "ZTO",
        "韵达": "YD",
        "韵达快递": "YD",
        "京东": "JD",
        "京东物流": "JD",
        "邮政": "EMS",
        "中国邮政": "EMS",
    }
    return aliases.get(name.strip(), normalized)


def upload_order_shipping(session: Session, order: Order) -> None:
    if settings.wx_pay_mock or order.total_cents == 0 or order.platform_shipping_uploaded_at:
        return
    user = session.get(User, order.user_id)
    if not user or not user.wechat_openid:
        raise WechatPlatformError("订单缺少支付用户 OpenID，无法同步发货信息")
    payment = session.exec(
        select(PaymentIntent)
        .where(PaymentIntent.order_id == order.id, PaymentIntent.status == PaymentStatus.succeeded)
        .order_by(PaymentIntent.created_at.desc())
    ).first()
    if not payment:
        raise WechatPlatformError("订单缺少成功支付流水，无法同步发货信息")
    items = session.exec(select(OrderItem).where(OrderItem.order_id == order.id)).all()
    item_desc = "、".join(f"{item.product_name}×{item.quantity}" for item in items)[:120]
    logistics_type = 4 if order.fulfillment_type == "pickup" else 1
    shipping = {"item_desc": item_desc}
    if logistics_type == 1:
        shipping.update(
            {
                "tracking_no": order.tracking_no,
                "express_company": _express_code(order.logistics_company),
                "contact": {"receiver_contact": order.receiver_phone[:3] + "****" + order.receiver_phone[-4:]},
            }
        )
    order_key = (
        {"order_number_type": 2, "transaction_id": payment.transaction_id}
        if payment.transaction_id
        else {
            "order_number_type": 1,
            "mchid": settings.wx_pay_mch_id,
            "out_trade_no": payment.out_trade_no,
        }
    )
    _post(
        "/wxa/sec/order/upload_shipping_info",
        {
            "order_key": order_key,
            "logistics_type": logistics_type,
            "delivery_mode": 1,
            "shipping_list": [shipping],
            "upload_time": datetime.now(timezone.utc).astimezone().isoformat(timespec="milliseconds"),
            "payer": {"openid": user.wechat_openid},
        },
    )
    order.platform_shipping_uploaded_at = datetime.now(timezone.utc)
    session.add(order)
