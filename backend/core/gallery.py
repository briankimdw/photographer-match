"""Validation rules for booking gallery uploads (mirrored in frontend/src/lib/galleryRules.js)."""

from fastapi import status

MAX_PHOTOS = 100
MAX_FILE_BYTES = 50 * 1024 * 1024

UPLOAD_STATUSES = {"confirmed", "in_progress", "delivered"}

PHOTO_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"}
PHOTO_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif")


def is_photo(filename: str, content_type: str | None) -> bool:
    kind = (content_type or "").split(";")[0].strip().lower()
    if kind in ("", "application/octet-stream"):
        # Browsers often send HEIC without a usable type, so trust the extension.
        return filename.lower().endswith(PHOTO_EXTENSIONS)
    return kind in PHOTO_TYPES


def check_photo(filename: str, content_type: str | None, size: int) -> tuple[int, str] | None:
    """Return (status_code, detail) for the first problem with one file, or None."""
    if size <= 0:
        return status.HTTP_422_UNPROCESSABLE_CONTENT, f"{filename} is empty"
    if size > MAX_FILE_BYTES:
        return status.HTTP_413_CONTENT_TOO_LARGE, f"{filename} is larger than 50 MB"
    if not is_photo(filename, content_type):
        return (
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"{filename} isn't a supported photo type. Use JPEG, PNG, WebP or HEIC.",
        )
    return None
