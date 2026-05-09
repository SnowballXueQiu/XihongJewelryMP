import base64
import hashlib
import hmac
from secrets import token_hex


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 160_000)
    return f"pbkdf2_sha256${salt}${base64.urlsafe_b64encode(digest).decode()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, salt, _ = stored_hash.split("$", 2)
    except ValueError:
        return False
    if algorithm != "pbkdf2_sha256":
        return False
    return hmac.compare_digest(hash_password(password, salt), stored_hash)
