"""Gallery image processing: watermarked preview + thumbnail, camera EXIF and GPS.

Originals are never changed (GPS stays in them); the previews are new JPEGs
without any metadata.
"""

import io
import math
from typing import Any, NamedTuple

import pillow_heif
from PIL import Image, ImageDraw, ImageFont, ImageOps, UnidentifiedImageError

pillow_heif.register_heif_opener()

PREVIEW_MAX = 2048
THUMB_MAX = 400
PREVIEW_QUALITY = 85
THUMB_QUALITY = 80

WATERMARK = "PREVIEW"
_WATERMARK_ALPHA = 89  # ~35% opacity
_WATERMARK_SHARE = 0.7  # text width as a share of the diagonal

# EXIF tags.
_IFD_EXIF = 0x8769
_IFD_GPS = 0x8825
_MAKE = 0x010F
_MODEL = 0x0110
_DATETIME = 0x0132
_EXPOSURE_TIME = 0x829A
_F_NUMBER = 0x829D
_ISO = 0x8827
_DATETIME_ORIGINAL = 0x9003
_FOCAL_LENGTH = 0x920A
_LENS_MODEL = 0xA434


class UnreadableImage(ValueError):
    """The bytes aren't an image Pillow can decode (retrying won't help)."""


class Rendered(NamedTuple):
    preview: bytes
    thumb: bytes
    width: int
    height: int
    exif: dict[str, Any]
    gps: dict[str, float] | None


def _text(value: Any) -> str | None:
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    if not isinstance(value, str):
        return None
    value = value.replace("\x00", "").strip()
    return value or None


def _number(value: Any) -> float | None:
    if isinstance(value, tuple | list):
        value = value[0] if value else None
    try:
        number = float(value)
    except (TypeError, ValueError, ZeroDivisionError):
        return None
    return number if math.isfinite(number) else None


def _taken_at(value: Any) -> str | None:
    text = _text(value)
    if text is None or len(text) < 19:
        return None
    # "2026:09:14 17:03:22" -> "2026-09-14T17:03:22"
    date, _, time = text[:19].partition(" ")
    if len(date) != 10 or len(time) != 8:
        return None
    return f"{date.replace(':', '-')}T{time}"


def _exposure(value: Any) -> str | None:
    seconds = _number(value)
    if seconds is None or seconds <= 0:
        return None
    if seconds >= 1:
        return f"{seconds:g}"
    return f"1/{round(1 / seconds)}"


def _camera(exif: Image.Exif) -> dict[str, Any]:
    """Camera fields only (never GPS); keys appear only when the file has them."""
    sub = exif.get_ifd(_IFD_EXIF)
    out: dict[str, Any] = {}
    fields: dict[str, Any] = {
        "taken_at": _taken_at(sub.get(_DATETIME_ORIGINAL) or exif.get(_DATETIME)),
        "make": _text(exif.get(_MAKE)),
        "model": _text(exif.get(_MODEL)),
        "lens": _text(sub.get(_LENS_MODEL)),
        "focal_length_mm": _number(sub.get(_FOCAL_LENGTH)),
        "f_number": _number(sub.get(_F_NUMBER)),
        "exposure_time": _exposure(sub.get(_EXPOSURE_TIME)),
        "iso": _number(sub.get(_ISO)),
    }
    for key, value in fields.items():
        if value is None:
            continue
        if key == "iso":
            value = int(value)
        elif isinstance(value, float):
            value = round(value, 4)
        out[key] = value
    return out


def _degrees(value: Any) -> float | None:
    if not isinstance(value, tuple | list) or len(value) != 3:
        return None
    d, m, s = (_number(v) for v in value)
    if d is None or m is None or s is None:
        return None
    return d + m / 60 + s / 3600


def _gps(exif: Image.Exif) -> dict[str, float] | None:
    gps = exif.get_ifd(_IFD_GPS)
    lat = _degrees(gps.get(2))
    lon = _degrees(gps.get(4))
    if lat is None or lon is None:
        return None
    if (_text(gps.get(1)) or "N").upper().startswith("S"):
        lat = -lat
    if (_text(gps.get(3)) or "E").upper().startswith("W"):
        lon = -lon
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    out = {"lat": round(lat, 6), "lon": round(lon, 6)}
    alt = _number(gps.get(6))
    if alt is not None:
        ref = gps.get(5)
        if isinstance(ref, tuple | list):
            ref = ref[0] if ref else 0
        if isinstance(ref, bytes):
            ref = ref[0] if ref else 0
        if ref == 1:
            alt = -alt
        out["alt_m"] = round(alt, 6)
    return out


def _rgb(image: Image.Image) -> Image.Image:
    if image.mode in ("RGBA", "LA", "PA") or "transparency" in image.info:
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        return Image.alpha_composite(background, rgba).convert("RGB")
    return image.convert("RGB")


def _fit(image: Image.Image, longest: int) -> Image.Image:
    """Scale down so the long edge is at most `longest` (never up)."""
    width, height = image.size
    scale = longest / max(width, height)
    if scale >= 1:
        return image.copy()
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    return image.resize(size, Image.Resampling.LANCZOS)


def _watermark(image: Image.Image) -> Image.Image:
    """Draw PREVIEW once, centred along the diagonal, white with a dark outline."""
    width, height = image.size
    diagonal = math.hypot(width, height)
    probe = ImageFont.load_default(size=100)
    left, _, right, _ = probe.getbbox(WATERMARK)
    size = max(8, int(100 * _WATERMARK_SHARE * diagonal / max(1, right - left)))
    font = ImageFont.load_default(size=size)
    stroke = max(1, size // 30)
    left, top, right, bottom = font.getbbox(WATERMARK, stroke_width=stroke)

    label_size = (max(1, math.ceil(right - left)), max(1, math.ceil(bottom - top)))
    label = Image.new("RGBA", label_size, (0, 0, 0, 0))
    ImageDraw.Draw(label).text(
        (-left, -top),
        WATERMARK,
        font=font,
        fill=(255, 255, 255, _WATERMARK_ALPHA),
        stroke_width=stroke,
        stroke_fill=(0, 0, 0, _WATERMARK_ALPHA),
    )
    angle = math.degrees(math.atan2(height, width))
    label = label.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)

    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    overlay.paste(label, ((width - label.width) // 2, (height - label.height) // 2))
    return Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")


def _jpeg(image: Image.Image, quality: int) -> bytes:
    out = io.BytesIO()
    image.save(out, "JPEG", quality=quality, exif=b"")
    return out.getvalue()


def render(original: bytes) -> Rendered:
    try:
        opened = Image.open(io.BytesIO(original))
        opened.load()
    except Image.DecompressionBombError as exc:
        raise UnreadableImage("This image is too large to process") from exc
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, EOFError) as exc:
        raise UnreadableImage("This file isn't a readable image") from exc

    with opened:
        # Broken metadata shouldn't cost the photo its preview.
        try:
            exif = opened.getexif()
            camera = _camera(exif)
            gps = _gps(exif)
        except Exception:
            camera, gps = {}, None
        try:
            image = ImageOps.exif_transpose(opened)
        except Exception:
            image = opened.copy()

    width, height = image.size
    preview = _watermark(_fit(_rgb(image), PREVIEW_MAX))
    thumb = _fit(preview, THUMB_MAX)
    return Rendered(
        preview=_jpeg(preview, PREVIEW_QUALITY),
        thumb=_jpeg(thumb, THUMB_QUALITY),
        width=width,
        height=height,
        exif=camera,
        gps=gps,
    )
