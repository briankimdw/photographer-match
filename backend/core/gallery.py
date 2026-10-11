"""Validation rules for booking gallery uploads (mirrored in frontend/src/lib/galleryRules.js)."""

from fastapi import status

MAX_PHOTOS = 100
MAX_FILE_BYTES = 50 * 1024 * 1024

UPLOAD_STATUSES = {"confirmed", "in_progress", "delivered"}

PHOTO_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"}
PHOTO_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif")

_TYPE_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "image/heif": ".heif",
}
_EXTENSION_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".heif": "image/heif",
}


def _kind(content_type: str | None) -> str:
    return (content_type or "").split(";")[0].strip().lower()


def _suffix(filename: str) -> str:
    dot = filename.rfind(".")
    return filename[dot:].lower() if dot >= 0 else ""


def extension_for(filename: str, content_type: str | None) -> str:
    """Storage object extension: the filename's if it's a photo one, else from the type."""
    suffix = _suffix(filename)
    if suffix in PHOTO_EXTENSIONS:
        return suffix
    return _TYPE_EXTENSIONS.get(_kind(content_type), "")


def storage_content_type(filename: str, content_type: str | None) -> str:
    """Normalized content type for Storage; untyped uploads take it from the extension."""
    kind = _kind(content_type)
    if kind == "image/jpg":
        return "image/jpeg"
    if kind in ("", "application/octet-stream"):
        return _EXTENSION_TYPES.get(_suffix(filename), "application/octet-stream")
    return kind


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
