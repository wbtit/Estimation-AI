"""Worker configuration from environment variables (root .env is loaded by load_config)."""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT_ENV = Path(__file__).resolve().parents[2] / ".env"


@dataclass(frozen=True)
class WorkerConfig:
    database_url: str
    poll_interval_seconds: float
    lock_timeout_seconds: float
    worker_id: str
    upload_dir: Path
    glyph_font_id: str = "default"
    ocr_crosscheck_enabled: bool = False


def resolve_upload_dir(value: str | None) -> Path:
    """UPLOAD_DIR, relative paths resolved against the repository root. Default: <repo>/uploads."""
    repo_root = ROOT_ENV.parent
    return (repo_root / (value or "uploads")).resolve()


def load_config() -> WorkerConfig:
    """Read config. Fails fast if DATABASE_URL is missing; there are no credential defaults."""
    load_dotenv(ROOT_ENV)
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is not set (see .env.example)")
    return WorkerConfig(
        database_url=database_url,
        poll_interval_seconds=float(os.environ.get("WORKER_POLL_INTERVAL_SECONDS", "2")),
        lock_timeout_seconds=float(os.environ.get("WORKER_LOCK_TIMEOUT_SECONDS", "600")),
        worker_id=os.environ.get("WORKER_ID", f"worker-{os.uname().nodename}-{os.getpid()}"),
        upload_dir=resolve_upload_dir(os.environ.get("UPLOAD_DIR")),
        glyph_font_id=os.environ.get("GLYPH_FONT_ID", "default"),
        # Optional local OCR cross-check. Off unless explicitly enabled; needs `make setup-ocr`.
        ocr_crosscheck_enabled=os.environ.get("OCR_CROSSCHECK_ENABLED", "false").lower() == "true",
    )
