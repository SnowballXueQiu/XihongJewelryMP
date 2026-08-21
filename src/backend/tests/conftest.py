import os
import shutil
import tempfile
from pathlib import Path


_test_data_dir: Path | None = None


def pytest_configure() -> None:
    global _test_data_dir
    _test_data_dir = Path(tempfile.mkdtemp(prefix="xihong-backend-tests-"))
    os.environ["DATABASE_URL"] = f"sqlite:///{_test_data_dir / 'test.sqlite3'}"
    os.environ["UPLOADS_DIR"] = str(_test_data_dir / "uploads")
    os.environ["WX_PAY_MOCK"] = "true"
    os.environ["ALLOW_MOCK_USER"] = "true"
    os.environ["ADMIN_BOOTSTRAP_EMAIL"] = "admin@xihong.local"
    os.environ["ADMIN_BOOTSTRAP_PASSWORD"] = "XihongAdmin123!"


def pytest_unconfigure() -> None:
    if _test_data_dir and _test_data_dir.exists():
        shutil.rmtree(_test_data_dir)
