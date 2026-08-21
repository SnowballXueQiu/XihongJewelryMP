import base64
import json
from time import time

import pytest
import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app import wechat_pay
from app.settings import settings


def test_decrypt_callback_resource(monkeypatch: pytest.MonkeyPatch):
    key = b"0123456789abcdef0123456789abcdef"
    nonce = b"0123456789ab"
    associated_data = b"transaction"
    expected = {"out_trade_no": "XH202608210001", "transaction_id": "4200000000"}
    ciphertext = AESGCM(key).encrypt(nonce, json.dumps(expected).encode(), associated_data)
    monkeypatch.setattr(settings, "wx_pay_api_v3_key", key.decode())

    result = wechat_pay.decrypt_callback_resource({
        "resource": {
            "algorithm": "AEAD_AES_256_GCM",
            "nonce": nonce.decode(),
            "associated_data": associated_data.decode(),
            "ciphertext": base64.b64encode(ciphertext).decode(),
        }
    })
    assert result == expected


def test_rejects_stale_callback_before_signature_validation():
    stale = str(int(time()) - 600)
    with pytest.raises(wechat_pay.WechatPayError, match="时间戳已过期"):
        wechat_pay.verify_callback(
            b"{}",
            {
                "Wechatpay-Timestamp": stale,
                "Wechatpay-Nonce": "nonce",
                "Wechatpay-Signature": "invalid",
                "Wechatpay-Serial": "serial",
            },
        )


def test_error_response_is_verified_before_it_is_trusted(monkeypatch: pytest.MonkeyPatch):
    verified = {"value": False}
    response = httpx.Response(
        400,
        json={"code": "ORDER_NOT_EXIST", "message": "订单不存在"},
        request=httpx.Request("GET", "https://api.mch.weixin.qq.com/test"),
    )
    monkeypatch.setattr(wechat_pay, "is_configured", lambda: True)
    monkeypatch.setattr(wechat_pay, "_authorization", lambda *_: "signed")
    monkeypatch.setattr(wechat_pay.httpx, "request", lambda *_, **__: response)
    monkeypatch.setattr(wechat_pay, "_validate_response", lambda _: verified.__setitem__("value", True))

    with pytest.raises(wechat_pay.WechatPayError, match="订单不存在"):
        wechat_pay.request("GET", "/test")
    assert verified["value"] is True
