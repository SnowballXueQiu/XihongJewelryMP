from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_products_and_pet_flow():
    with client:
        products = client.get("/api/products").json()
        assert products
        assert any(item["supports_ar"] for item in products)

        pet = client.post("/api/pet/action", json={"action": "feed"}).json()
        assert pet["exp"] >= 0


def test_order_creates_payment_skeleton():
    with client:
        product = client.get("/api/products").json()[0]
        order = client.post(
            "/api/orders",
            json={"items": [{"product_id": product["id"], "quantity": 1}]},
        ).json()
        assert order["status"] == "pending_payment"
        assert order["payment"]["provider"] == "wechat_pay"
        assert order["payment"]["mock"] is True
