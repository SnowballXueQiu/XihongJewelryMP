import json
from datetime import datetime, timezone
from time import monotonic

import httpx
from sqlmodel import Session, select

from app.models import Order, OrderItem, OrderStatus, PaymentIntent, PaymentStatus, User
from app.settings import settings


class WechatPlatformError(RuntimeError):
    pass


DEFAULT_ORDER_DETAIL_PATH = "pages/order-detail/index?orderNo=${商品订单号}"


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
        raise WechatPlatformError(
            f"微信订单管理失败（{data.get('errcode')}）：{data.get('errmsg') or '未知错误'}"
        )
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


def _successful_payment(session: Session, order: Order) -> PaymentIntent:
    payment = session.exec(
        select(PaymentIntent)
        .where(PaymentIntent.order_id == order.id, PaymentIntent.status == PaymentStatus.succeeded)
        .order_by(PaymentIntent.created_at.desc())
    ).first()
    if not payment:
        raise WechatPlatformError("订单缺少成功支付流水，无法调用微信平台订单服务")
    return payment


def _query_key(payment: PaymentIntent) -> dict:
    if payment.transaction_id:
        return {"transaction_id": payment.transaction_id}
    return {"merchant_id": settings.wx_pay_mch_id, "merchant_trade_no": payment.out_trade_no}


def _apply_platform_order(order: Order, platform_order: dict) -> None:
    order.platform_order_state = int(platform_order.get("order_state") or 0)
    order.platform_order_state_updated_at = datetime.now(timezone.utc)
    order.platform_order_payload = json.dumps(platform_order, ensure_ascii=False, separators=(",", ":"))
    order.platform_shipping_error = ""
    if order.platform_order_state in {3, 4} and order.status == OrderStatus.shipped:
        order.status = OrderStatus.completed
        order.completed_at = datetime.now(timezone.utc)
        order.updated_at = order.completed_at


def upload_order_shipping(session: Session, order: Order) -> dict:
    if settings.wx_pay_mock or order.total_cents == 0 or order.platform_shipping_uploaded_at:
        return {}
    user = session.get(User, order.user_id)
    if not user or not user.wechat_openid:
        raise WechatPlatformError("订单缺少支付用户 OpenID，无法同步发货信息")
    payment = _successful_payment(session, order)
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
    payload = {
        "order_key": order_key,
        "logistics_type": logistics_type,
        "delivery_mode": 1,
        "shipping_list": [shipping],
        "upload_time": datetime.now().astimezone().isoformat(timespec="milliseconds"),
        "payer": {"openid": user.wechat_openid},
    }
    try:
        data = _post("/wxa/sec/order/upload_shipping_info", payload)
    except WechatPlatformError as error:
        order.platform_shipping_error = str(error)
        session.add(order)
        raise
    order.platform_shipping_uploaded_at = datetime.now(timezone.utc)
    order.platform_order_state = 2
    order.platform_order_state_updated_at = order.platform_shipping_uploaded_at
    order.platform_shipping_error = ""
    session.add(order)
    return data


def query_order_shipping(session: Session, order: Order) -> dict:
    if settings.wx_pay_mock or order.total_cents == 0:
        return {}
    payment = _successful_payment(session, order)
    data = _post("/wxa/sec/order/get_order", _query_key(payment))
    platform_order = data.get("order") or {}
    if platform_order:
        _apply_platform_order(order, platform_order)
        session.add(order)
    return platform_order


def query_order_list(
    *,
    order_state: int | None = None,
    openid: str = "",
    begin_time: int | None = None,
    end_time: int | None = None,
    last_index: str = "",
    page_size: int = 100,
) -> dict:
    payload: dict = {"page_size": max(1, min(100, page_size))}
    if order_state:
        payload["order_state"] = order_state
    if openid:
        payload["openid"] = openid
    if begin_time is not None or end_time is not None:
        payload["pay_time_range"] = {
            **({"begin_time": begin_time} if begin_time is not None else {}),
            **({"end_time": end_time} if end_time is not None else {}),
        }
    if last_index:
        payload["last_index"] = last_index
    return _post("/wxa/sec/order/get_order_list", payload)


def trade_management_status() -> dict:
    managed = _post("/wxa/sec/order/is_trade_managed", {"appid": settings.wechat_appid})
    confirmation = _post(
        "/wxa/sec/order/is_trade_management_confirmation_completed",
        {"appid": settings.wechat_appid},
    )
    return {
        "is_trade_managed": bool(managed.get("is_trade_managed")),
        "confirmation_completed": bool(confirmation.get("completed")),
    }


def get_order_detail_path() -> str:
    data = _post("/wxa/sec/order/get_order_detail_path", {})
    return str(data.get("path") or "")


def set_order_detail_path(path: str = DEFAULT_ORDER_DETAIL_PATH) -> str:
    normalized = path.strip()
    if not normalized.startswith("pages/") or ".html" in normalized.split("?", 1)[0]:
        raise WechatPlatformError("微信购物订单详情路径必须使用小程序页面路径，不能包含 .html")
    if "orderNo=${商品订单号}" not in normalized:
        raise WechatPlatformError("微信购物订单详情路径必须通过 orderNo 传入 ${商品订单号}")
    _post("/wxa/sec/order/update_order_detail_path", {"path": normalized})
    return normalized


def set_message_jump_path(path: str) -> None:
    _post("/wxa/sec/order/set_msg_jump_path", {"path": path})


def notify_confirm_receive(session: Session, order: Order, received_time: int) -> None:
    if order.platform_confirm_receive_reminded_at:
        raise WechatPlatformError("该订单已经发送过确认收货提醒")
    payment = _successful_payment(session, order)
    _post(
        "/wxa/sec/order/notify_confirm_receive",
        {**_query_key(payment), "received_time": received_time},
    )
    order.platform_confirm_receive_reminded_at = datetime.now(timezone.utc)
    session.add(order)


def report_special_order(session: Session, order: Order, special_type: int, delay_to: int | None = None) -> None:
    if special_type not in {1, 2}:
        raise WechatPlatformError("特殊订单类型只能为预售订单或测试订单")
    payment = _successful_payment(session, order)
    order_id = payment.transaction_id or payment.out_trade_no
    payload = {"order_id": order_id, "type": special_type}
    if special_type == 1:
        if not delay_to:
            raise WechatPlatformError("预售订单必须填写预计发货时间")
        payload["delay_to"] = delay_to
    _post("/wxa/sec/order/opspecialorder", payload)
    order.platform_special_order_type = special_type
    order.platform_special_order_delay_to = (
        datetime.fromtimestamp(delay_to, tz=timezone.utc) if delay_to else None
    )
    session.add(order)
