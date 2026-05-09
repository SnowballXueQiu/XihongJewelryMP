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

        banner = client.post(
            "/api/admin/banners",
            headers=headers,
            json={"title": "后台轮播", "placement": "home_hero", "image_color": "#111111"},
        ).json()
        assert banner["title"] == "后台轮播"

        public_banners = client.get("/api/banners?placement=home_hero").json()
        assert any(item["title"] == "后台轮播" for item in public_banners)
