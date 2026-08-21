import base64
import json
from pathlib import Path
from secrets import token_hex
from time import time
from typing import Any, Mapping

import httpx
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.settings import settings


class WechatPayError(RuntimeError):
    pass


def is_configured() -> bool:
    return bool(
        not settings.wx_pay_mock
        and settings.wx_pay_appid
        and settings.wx_pay_mch_id
        and settings.wx_pay_serial_no
        and settings.wx_pay_private_key_path
        and settings.wx_pay_public_key_path
        and settings.wx_pay_api_v3_key
        and settings.wx_pay_notify_url
        and settings.wx_pay_refund_notify_url
    )


def _private_key():
    try:
        return serialization.load_pem_private_key(Path(settings.wx_pay_private_key_path).read_bytes(), password=None)
    except (OSError, ValueError) as error:
        raise WechatPayError("无法读取微信支付商户私钥") from error


def _public_key():
    try:
        return serialization.load_pem_public_key(Path(settings.wx_pay_public_key_path).read_bytes())
    except (OSError, ValueError) as error:
        raise WechatPayError("无法读取微信支付公钥") from error


def _sign(message: str) -> str:
    signature = _private_key().sign(message.encode(), padding.PKCS1v15(), hashes.SHA256())
    return base64.b64encode(signature).decode()


def _verify(message: str, signature: str) -> None:
    try:
        _public_key().verify(base64.b64decode(signature), message.encode(), padding.PKCS1v15(), hashes.SHA256())
    except (InvalidSignature, ValueError) as error:
        raise WechatPayError("微信支付签名验证失败") from error


def _authorization(method: str, request_target: str, body: str) -> str:
    timestamp = str(int(time()))
    nonce = token_hex(16)
    signature = _sign(f"{method}\n{request_target}\n{timestamp}\n{nonce}\n{body}\n")
    return (
        'WECHATPAY2-SHA256-RSA2048 '
        f'mchid="{settings.wx_pay_mch_id}",nonce_str="{nonce}",'
        f'signature="{signature}",timestamp="{timestamp}",serial_no="{settings.wx_pay_serial_no}"'
    )


def _validate_response(response: httpx.Response) -> None:
    timestamp = response.headers.get("Wechatpay-Timestamp", "")
    nonce = response.headers.get("Wechatpay-Nonce", "")
    signature = response.headers.get("Wechatpay-Signature", "")
    serial = response.headers.get("Wechatpay-Serial", "")
    if not timestamp or not nonce or not signature:
        raise WechatPayError("微信支付响应缺少验签头")
    if settings.wx_pay_public_key_id and serial != settings.wx_pay_public_key_id:
        raise WechatPayError("微信支付响应公钥 ID 不匹配")
    _verify(f"{timestamp}\n{nonce}\n{response.text}\n", signature)


def request(method: str, request_target: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    if not is_configured():
        raise WechatPayError("微信支付生产参数未完整配置")
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) if payload is not None else ""
    headers = {
        "Accept": "application/json",
        "Authorization": _authorization(method, request_target, body),
    }
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if settings.wx_pay_public_key_id:
        headers["Wechatpay-Serial"] = settings.wx_pay_public_key_id
    try:
        response = httpx.request(
            method,
            f"https://api.mch.weixin.qq.com{request_target}",
            headers=headers,
            content=body.encode() if body else None,
            timeout=10,
        )
    except httpx.HTTPError as error:
        raise WechatPayError("连接微信支付失败，请稍后重试") from error
    _validate_response(response)
    if response.status_code < 200 or response.status_code >= 300:
        try:
            data = response.json()
            detail = data.get("message") or data.get("code")
        except ValueError:
            detail = response.text[:200]
        raise WechatPayError(f"微信支付请求失败：{detail or response.status_code}")
    if not response.content:
        return {}
    try:
        return response.json()
    except ValueError as error:
        raise WechatPayError("微信支付返回了无效数据") from error


def create_jsapi_prepay(
    *,
    out_trade_no: str,
    description: str,
    total_cents: int,
    openid: str,
    goods_detail: list[dict[str, Any]],
) -> str:
    data = request(
        "POST",
        "/v3/pay/transactions/jsapi",
        {
            "appid": settings.wx_pay_appid,
            "mchid": settings.wx_pay_mch_id,
            "description": description[:127],
            "out_trade_no": out_trade_no,
            "notify_url": settings.wx_pay_notify_url,
            "amount": {"total": total_cents, "currency": "CNY"},
            "payer": {"openid": openid},
            "detail": {"goods_detail": goods_detail},
            "attach": out_trade_no,
        },
    )
    prepay_id = data.get("prepay_id")
    if not prepay_id:
        raise WechatPayError("微信支付未返回 prepay_id")
    return str(prepay_id)


def build_miniprogram_params(prepay_id: str) -> dict[str, str]:
    timestamp = str(int(time()))
    nonce = token_hex(16)
    package = f"prepay_id={prepay_id}"
    pay_sign = _sign(f"{settings.wx_pay_appid}\n{timestamp}\n{nonce}\n{package}\n")
    return {
        "appId": settings.wx_pay_appid,
        "timeStamp": timestamp,
        "nonceStr": nonce,
        "package": package,
        "signType": "RSA",
        "paySign": pay_sign,
    }


def query_order(out_trade_no: str) -> dict[str, Any]:
    return request("GET", f"/v3/pay/transactions/out-trade-no/{out_trade_no}?mchid={settings.wx_pay_mch_id}")


def close_order(out_trade_no: str) -> None:
    request("POST", f"/v3/pay/transactions/out-trade-no/{out_trade_no}/close", {"mchid": settings.wx_pay_mch_id})


def create_refund(*, out_trade_no: str, out_refund_no: str, total_cents: int, refund_cents: int, reason: str) -> dict[str, Any]:
    return request(
        "POST",
        "/v3/refund/domestic/refunds",
        {
            "out_trade_no": out_trade_no,
            "out_refund_no": out_refund_no,
            "reason": reason,
            "notify_url": settings.wx_pay_refund_notify_url,
            "amount": {"refund": refund_cents, "total": total_cents, "currency": "CNY"},
        },
    )


def verify_callback(raw_body: bytes, headers: Mapping[str, str]) -> dict[str, Any]:
    timestamp = headers.get("wechatpay-timestamp") or headers.get("Wechatpay-Timestamp") or ""
    nonce = headers.get("wechatpay-nonce") or headers.get("Wechatpay-Nonce") or ""
    signature = headers.get("wechatpay-signature") or headers.get("Wechatpay-Signature") or ""
    serial = headers.get("wechatpay-serial") or headers.get("Wechatpay-Serial") or ""
    if not timestamp or not nonce or not signature or not serial:
        raise WechatPayError("回调缺少验签头")
    try:
        if abs(int(time()) - int(timestamp)) > 300:
            raise WechatPayError("回调时间戳已过期")
    except ValueError as error:
        raise WechatPayError("回调时间戳无效") from error
    if signature.startswith("WECHATPAY/SIGNTEST/"):
        raise WechatPayError("拒绝微信支付签名探测流量")
    if settings.wx_pay_public_key_id and serial != settings.wx_pay_public_key_id:
        raise WechatPayError("回调公钥 ID 不匹配")
    body = raw_body.decode()
    _verify(f"{timestamp}\n{nonce}\n{body}\n", signature)
    try:
        return json.loads(body)
    except json.JSONDecodeError as error:
        raise WechatPayError("回调 JSON 无效") from error


def decrypt_callback_resource(payload: dict[str, Any]) -> dict[str, Any]:
    resource = payload.get("resource") or {}
    if resource.get("algorithm") != "AEAD_AES_256_GCM":
        raise WechatPayError("不支持的回调加密算法")
    key = settings.wx_pay_api_v3_key.encode()
    if len(key) != 32:
        raise WechatPayError("APIv3 密钥必须为 32 字节")
    try:
        plaintext = AESGCM(key).decrypt(
            str(resource["nonce"]).encode(),
            base64.b64decode(resource["ciphertext"]),
            str(resource.get("associated_data") or "").encode(),
        )
        return json.loads(plaintext)
    except (KeyError, ValueError, json.JSONDecodeError) as error:
        raise WechatPayError("微信支付回调解密失败") from error
