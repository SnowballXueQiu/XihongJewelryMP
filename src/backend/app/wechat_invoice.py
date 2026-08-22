import hashlib
from typing import Any
from urllib.parse import urlencode

from app import wechat_pay
from app.settings import settings


class WechatInvoiceError(wechat_pay.WechatPayError):
    pass


def is_configured() -> bool:
    return wechat_pay.is_configured() and bool(settings.wx_pay_invoice_notify_url)


def get_development_config() -> dict[str, Any]:
    return wechat_pay.request("GET", "/v3/new-tax-control-fapiao/merchant/development-config")


def configure_development(*, callback_url: str, show_fapiao_cell: bool) -> dict[str, Any]:
    return wechat_pay.request(
        "PATCH",
        "/v3/new-tax-control-fapiao/merchant/development-config",
        {"callback_url": callback_url, "show_fapiao_cell": show_fapiao_cell},
    )


def create_card_template(*, card_appid: str, logo_url: str, payee_name: str) -> dict[str, Any]:
    if not card_appid.strip():
        raise WechatInvoiceError("请先配置用于插入发票卡券的公众号 AppID")
    if not logo_url.strip():
        raise WechatInvoiceError("请先配置微信电子发票卡券 Logo 素材 URL")
    return wechat_pay.request(
        "POST",
        "/v3/new-tax-control-fapiao/card-template",
        {
            "card_appid": card_appid,
            "card_template_information": {
                "payee_name": payee_name[:32],
                "logo_url": logo_url,
            },
        },
    )


def get_user_title(fapiao_apply_id: str, *, scene: str = "WITH_WECHATPAY") -> dict[str, Any]:
    query = urlencode({"fapiao_apply_id": fapiao_apply_id, "scene": scene})
    return wechat_pay.request("GET", f"/v3/new-tax-control-fapiao/user-title?{query}")


def query_invoice(fapiao_apply_id: str, fapiao_id: str = "") -> dict[str, Any]:
    query = f"?{urlencode({'fapiao_id': fapiao_id})}" if fapiao_id else ""
    return wechat_pay.request(
        "GET",
        f"/v3/new-tax-control-fapiao/fapiao-applications/{fapiao_apply_id}{query}",
    )


def upload_invoice_file(filename: str, content: bytes) -> str:
    if not content or len(content) > 2 * 1024 * 1024:
        raise WechatInvoiceError("电子发票 PDF 必须小于 2MB")
    if not filename.lower().endswith(".pdf"):
        raise WechatInvoiceError("微信电子发票文件接口仅接受 PDF 文件")
    digest = hashlib.new("sm3", content).hexdigest()
    data = wechat_pay.request_multipart(
        "/v3/new-tax-control-fapiao/fapiao-applications/upload-fapiao-file",
        meta={"file_type": "PDF", "digest_alogrithm": "SM3", "digest": digest},
        filename=filename,
        content=content,
        content_type="application/pdf",
    )
    media_id = str(data.get("fapiao_media_id") or "")
    if not media_id:
        raise WechatInvoiceError("微信支付未返回电子发票文件 ID")
    return media_id


def insert_cards(
    *,
    fapiao_apply_id: str,
    buyer_information: dict[str, Any],
    card_information: dict[str, Any],
) -> None:
    wechat_pay.request(
        "POST",
        f"/v3/new-tax-control-fapiao/fapiao-applications/{fapiao_apply_id}/insert-cards",
        {
            "scene": "WITH_WECHATPAY",
            "buyer_information": buyer_information,
            "fapiao_card_information": [card_information],
        },
    )
