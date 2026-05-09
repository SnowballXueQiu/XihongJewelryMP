from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "sqlite:///./data/xihong.sqlite3"
    wechat_original_id: str = ""
    wechat_appid: str = ""
    wechat_app_secret: str = ""
    contact_email: str = ""
    company_name_zh: str = "天津玺鸿珠宝贸易有限公司"
    company_name_en: str = "Xihong Jewelry & Gold Trading Co., Ltd"
    wx_pay_appid: str = ""
    wx_pay_mch_id: str = ""
    wx_pay_api_v3_key: str = ""
    wx_pay_serial_no: str = ""
    wx_pay_private_key_path: str = ""
    wx_pay_notify_url: str = "http://127.0.0.1:8000/api/payments/wechat/notify"
    admin_jwt_secret: str = "dev-change-this-admin-secret"
    admin_bootstrap_email: str = "admin@xihong.local"
    admin_bootstrap_password: str = "XihongAdmin123!"
    uploads_dir: str = "./uploads"
    public_base_url: str = "http://127.0.0.1:8000"


settings = Settings()
