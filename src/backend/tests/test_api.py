from fastapi.testclient import TestClient
from datetime import datetime, timedelta, timezone
import re

from sqlmodel import Session, select

from app import wechat_platform
from app.database import engine
from app.main import app
from app.models import Order, PaymentIntent, PaymentStatus, User


client = TestClient(app)


def test_api_responses_disable_shared_caching():
    with client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.headers["cache-control"] == "private, no-store, max-age=0, must-revalidate"

        products = client.get("/api/products")
        assert products.status_code == 200
        assert products.headers["cache-control"] == "private, no-store, max-age=0, must-revalidate"


def test_products_and_pet_flow():
    with client:
        products = client.get("/api/products").json()
        assert products
        assert any(item["supports_ar"] for item in products)

        pet = client.post("/api/pet/action", json={"action": "feed"}).json()
        assert pet["exp"] >= 0


def test_order_payment_and_query_flow():
    with client:
        product = client.get("/api/products").json()[0]
        order = client.post(
            "/api/orders",
            json={"items": [{"product_id": product["id"], "quantity": 1}]},
        ).json()
        assert order["status"] == "pending_payment"
        assert order["order_no"].startswith("XH")
        assert order["payment"] is None

        payment = client.post(f"/api/orders/{order['id']}/pay").json()
        assert payment["provider"] == "wechat_pay"
        assert payment["mock"] is True

        paid = client.post(f"/api/orders/{order['id']}/mock-pay").json()
        assert paid["status"] == "paid"
        status = client.get(f"/api/orders/{order['id']}/payment-status").json()
        assert status["order_status"] == "paid"


def test_cart_crud_flow():
    with client:
        client.delete("/api/cart")
        product = client.get("/api/products").json()[0]

        cart = client.post("/api/cart", json={"product_id": product["id"], "quantity": 2}).json()
        assert len(cart) == 1
        assert cart[0]["product"]["id"] == product["id"]
        assert cart[0]["quantity"] == 2

        cart = client.put(f"/api/cart/{cart[0]['id']}", json={"quantity": 3}).json()
        assert cart[0]["quantity"] == 3

        cart = client.delete(f"/api/cart/{cart[0]['id']}").json()
        assert cart == []


def test_addresses_favorites_and_coupons():
    with client:
        addresses = client.get("/api/addresses").json()
        assert addresses and addresses[0]["is_default"] is True

        product = client.get("/api/products").json()[0]
        favorite = client.put(f"/api/favorites/{product['id']}").json()
        assert "active" in favorite
        listed = client.get("/api/favorites").json()
        assert isinstance(listed, list)

        coupons = client.get("/api/coupons").json()
        assert coupons and coupons[0]["amount_cents"] > 0


def test_pickup_and_invoice_order_flow():
    with client:
        product = client.get("/api/products").json()[0]
        pickup = client.post(
            "/api/orders",
            json={
                "items": [{"product_id": product["id"], "quantity": 1}],
                "fulfillment_type": "pickup",
                "pickup_slot": "8月23日 周日 14:00–16:00",
                "invoice_type": "company",
                "invoice_title": "天津玺鸿珠宝贸易有限公司",
                "invoice_tax_number": "91120101TEST123456",
                "invoice_email": "invoice@example.com",
            },
        )
        assert pickup.status_code == 200
        order = pickup.json()
        assert order["fulfillment_type"] == "pickup"
        assert order["shipping_fee_cents"] == 0
        assert order["pickup_slot"] == "8月23日 周日 14:00–16:00"
        assert re.match(r"^\d{3}\. .+", order["pickup_code"])
        assert order["invoice_type"] == "company"
        assert order["invoice_tax_number"] == "91120101TEST123456"

        missing_company_tax = client.post(
            "/api/orders",
            json={
                "items": [{"product_id": product["id"], "quantity": 1}],
                "fulfillment_type": "pickup",
                "pickup_slot": "8月23日 周日 17:00–19:00",
                "invoice_type": "company",
                "invoice_title": "缺少税号的公司",
            },
        )
        assert missing_company_tax.status_code == 400


def test_invoice_title_book_crud():
    with client:
        initial = client.get("/api/invoice-titles")
        assert initial.status_code == 200
        created = client.post(
            "/api/invoice-titles",
            json={
                "invoice_type": "company",
                "title": "天津玺鸿珠宝贸易有限公司",
                "tax_number": "91120101TEST123456",
                "email": "invoice@example.com",
                "is_default": True,
            },
        )
        assert created.status_code == 200
        assert created.json()["is_default"] is True
        listed = client.get("/api/invoice-titles").json()
        assert listed[0]["id"] == created.json()["id"]

        updated = client.put(
            f"/api/invoice-titles/{created.json()['id']}",
            json={
                "invoice_type": "company",
                "title": "天津玺鸿珠宝贸易有限公司（电子票）",
                "tax_number": "91120101TEST123456",
                "email": "finance@example.com",
                "is_default": True,
            },
        )
        assert updated.status_code == 200
        assert updated.json()["email"] == "finance@example.com"
        assert client.delete(f"/api/invoice-titles/{created.json()['id']}").status_code == 200


def test_order_creation_is_idempotent_and_zero_order_is_free():
    with client:
        products = client.get("/api/products").json()
        paid_product = next(item for item in products if item["price_cents"] > 0)
        before_stock = paid_product["stock"]
        payload = {
            "items": [{"product_id": paid_product["id"], "quantity": 1}],
            "client_request_id": "checkout_idempotency_test",
        }
        first = client.post("/api/orders", json=payload)
        second = client.post("/api/orders", json=payload)
        assert first.status_code == 200
        assert second.status_code == 200
        assert first.json()["id"] == second.json()["id"]
        refreshed = client.get(f"/api/products/{paid_product['id']}").json()
        assert refreshed["stock"] == before_stock - 1

        free_product = next(item for item in products if item["name"] == "零元下单流程测试商品")
        free_order = client.post(
            "/api/orders",
            json={
                "items": [{"product_id": free_product["id"], "quantity": 1}],
                "client_request_id": "checkout_free_order_test",
            },
        )
        assert free_order.status_code == 200
        assert free_order.json()["total_cents"] == 0
        assert free_order.json()["status"] == "paid"
        assert free_order.json()["can_pay"] is False
        assert client.post(f"/api/orders/{free_order.json()['id']}/pay").status_code == 400


def test_shipping_upload_uses_successful_payment_transaction(monkeypatch):
    with client:
        product = next(item for item in client.get("/api/products").json() if item["price_cents"] > 0)
        created = client.post(
            "/api/orders",
            json={"items": [{"product_id": product["id"], "quantity": 1}]},
        ).json()
        client.post(f"/api/orders/{created['id']}/pay")
        client.post(f"/api/orders/{created['id']}/mock-pay")

    captured: dict = {}

    def capture(path: str, payload: dict) -> dict:
        captured.update({"path": path, "payload": payload})
        return {"errcode": 0, "errmsg": "ok"}

    monkeypatch.setattr(wechat_platform.settings, "wx_pay_mock", False)
    monkeypatch.setattr(wechat_platform, "_post", capture)
    with Session(engine) as session:
        order = session.get(Order, created["id"])
        user = session.get(User, order.user_id)
        user.wechat_openid = "openid_shipping_test"
        payment = session.exec(
            select(PaymentIntent)
            .where(PaymentIntent.order_id == order.id, PaymentIntent.status == PaymentStatus.succeeded)
        ).first()
        payment.transaction_id = "4200000000000000000000000000"
        order.logistics_company = "顺丰速运"
        order.tracking_no = "SF1234567890"
        session.add_all([user, payment, order])
        session.commit()
        wechat_platform.upload_order_shipping(session, order)

    assert captured["path"] == "/wxa/sec/order/upload_shipping_info"
    assert captured["payload"]["order_key"] == {
        "order_number_type": 2,
        "transaction_id": "4200000000000000000000000000",
    }
    assert captured["payload"]["logistics_type"] == 1
    assert captured["payload"]["shipping_list"][0]["express_company"] == "SF"


def test_admin_product_and_banner_flow():
    with client:
        login = client.post(
            "/api/admin/auth/login",
            json={"email": "admin@xihong.local", "password": "XihongAdmin123!"},
        )
        assert login.status_code == 200
        token = login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        me = client.get("/api/admin/me", headers=headers).json()
        assert me["role"] == "super_admin"

        category = client.get("/api/admin/categories", headers=headers).json()[0]
        product_payload = {
            "name": "后台测试戒指",
            "subtitle": "测试",
            "description": "后台创建商品",
            "category_slug": category["slug"],
            "material": "18K金",
            "price_cents": 1000,
            "stock": 5,
            "image_color": "#B89A63",
            "free_shipping": True,
            "supports_ar": False,
            "status": "draft",
            "gallery_urls": [],
        }
        product = client.post("/api/admin/products", headers=headers, json=product_payload).json()
        assert product["name"] == "后台测试戒指"
        assert product["status"] == "draft"

        product_payload["status"] = "active"
        updated = client.put(f"/api/admin/products/{product['id']}", headers=headers, json=product_payload).json()
        assert updated["status"] == "active"
        assert updated["free_shipping"] is True

        free_shipping_order = client.post(
            "/api/orders",
            json={"items": [{"product_id": product["id"], "quantity": 1}]},
        ).json()
        assert free_shipping_order["shipping_fee_cents"] == 0
        assert free_shipping_order["total_cents"] == product_payload["price_cents"]

        banner = client.post(
            "/api/admin/banners",
            headers=headers,
            json={"title": "后台轮播", "placement": "home_hero", "image_color": "#111111"},
        ).json()
        assert banner["title"] == "后台轮播"

        public_banners = client.get("/api/banners?placement=home_hero").json()
        assert any(item["title"] == "后台轮播" for item in public_banners)


def test_admin_fulfillment_coupon_and_refund_flow():
    with client:
        login = client.post(
            "/api/admin/auth/login",
            json={"email": "admin@xihong.local", "password": "XihongAdmin123!"},
        )
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        dashboard = client.get("/api/admin/dashboard", headers=headers)
        assert dashboard.status_code == 200
        assert "today_revenue_cents" in dashboard.json()

        now = datetime.now(timezone.utc)
        coupon = client.post(
            "/api/admin/coupons",
            headers=headers,
            json={
                "code": f"TEST{int(now.timestamp())}",
                "name": "自动化测试礼券",
                "description": "后台优惠券流程",
                "amount_cents": 100,
                "minimum_cents": 1000,
                "total_quantity": 20,
                "valid_from": now.isoformat(),
                "valid_until": (now + timedelta(days=7)).isoformat(),
                "is_active": True,
            },
        )
        assert coupon.status_code == 200
        assert coupon.json()["total_quantity"] == 20
        store_config = client.get("/api/store/config")
        assert store_config.status_code == 200
        assert store_config.json()["free_shipping_threshold_cents"] > 0
        first_claim = client.post(f"/api/coupons/{coupon.json()['id']}/claim")
        assert first_claim.status_code == 200
        duplicate_claim = client.post(f"/api/coupons/{coupon.json()['id']}/claim")
        assert duplicate_claim.status_code == 400

        product = client.get("/api/products").json()[0]
        order = client.post("/api/orders", json={"items": [{"product_id": product["id"], "quantity": 1}]}).json()
        invalid = client.put(
            f"/api/admin/orders/{order['id']}/status",
            headers=headers,
            json={"status": "preparing"},
        )
        assert invalid.status_code == 400

        client.post(f"/api/orders/{order['id']}/pay")
        paid = client.post(f"/api/orders/{order['id']}/mock-pay").json()
        preparing = client.put(
            f"/api/admin/orders/{paid['id']}/status",
            headers=headers,
            json={"status": "preparing"},
        )
        assert preparing.status_code == 200
        no_tracking = client.put(
            f"/api/admin/orders/{paid['id']}/status",
            headers=headers,
            json={"status": "shipped"},
        )
        assert no_tracking.status_code == 400
        shipped = client.put(
            f"/api/admin/orders/{paid['id']}/status",
            headers=headers,
            json={"status": "shipped", "logistics_company": "顺丰速运", "tracking_no": "SF123456789"},
        )
        assert shipped.status_code == 200
        assert shipped.json()["tracking_no"] == "SF123456789"

        refund = client.post(
            f"/api/admin/orders/{paid['id']}/refund",
            headers=headers,
            json={"reason": "自动化退款验证"},
        )
        assert refund.status_code == 200
        assert refund.json()["status"] == "success"
        refunded = client.get(f"/api/orders/{paid['id']}").json()
        assert refunded["status"] == "refunded"
