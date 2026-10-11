import asyncio
import io
from types import SimpleNamespace
from typing import Any, cast

import pillow_heif
import pytest
from PIL import Image
from supabase import AsyncClient

from worker.imaging import PREVIEW_MAX, THUMB_MAX, Rendered, UnreadableImage, render
from worker.jobs import ORIGINALS_BUCKET, PREVIEWS_BUCKET, output_paths, run_once

pillow_heif.register_heif_opener()

ORIGINAL = "u1/b1/ph1.heic"
JOB = {"job_id": "j1", "photo_id": "ph1", "attempts": 1, "original_path": ORIGINAL}


def jpeg(size: tuple[int, int], color: tuple[int, int, int] = (200, 30, 30), **save: Any) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, color).save(out, "JPEG", **save)
    return out.getvalue()


def camera_exif(with_altitude: bool = False) -> Image.Exif:
    exif = Image.Exif()
    exif[0x010F] = "Canon"
    exif[0x0110] = "EOS R6"
    sub = exif.get_ifd(0x8769)
    sub[0x9003] = "2026:09:14 17:03:22"
    sub[0x829D] = 2.8
    sub[0x829A] = 0.004
    sub[0x8827] = 400
    sub[0x920A] = 50.0
    sub[0xA434] = "RF24-70mm F2.8 L IS USM"
    gps = exif.get_ifd(0x8825)
    gps[1] = "S"
    gps[2] = (34.0, 1.0, 33.24)
    gps[3] = "W"
    gps[4] = (118.0, 46.0, 47.28)
    if with_altitude:
        gps[5] = 1
        gps[6] = 12.0
    return exif


# render()


def test_render_jpeg_sizes_and_no_metadata() -> None:
    r = render(jpeg((3000, 2000), exif=camera_exif()))
    assert isinstance(r, Rendered)
    assert (r.width, r.height) == (3000, 2000)
    preview = Image.open(io.BytesIO(r.preview))
    thumb = Image.open(io.BytesIO(r.thumb))
    assert preview.format == "JPEG" and preview.size == (PREVIEW_MAX, 1365)
    assert thumb.format == "JPEG" and max(thumb.size) == THUMB_MAX
    assert not preview.getexif() and not thumb.getexif()


def test_render_north_west_gps_without_altitude() -> None:
    exif = Image.Exif()
    exif[0x010F] = "Canon"
    gps = exif.get_ifd(0x8825)
    gps[1] = "N"
    gps[2] = (34.0, 1.0, 33.24)
    gps[3] = "W"
    gps[4] = (118.0, 46.0, 47.28)
    r = render(jpeg((3000, 2000), exif=exif))
    assert r.gps is not None and "alt_m" not in r.gps
    assert r.gps["lat"] == pytest.approx(34.0259, abs=1e-3)
    assert r.gps["lon"] == pytest.approx(-118.7798, abs=1e-3)
    data = Image.open(io.BytesIO(r.preview)).convert("RGB").tobytes()
    changed = sum(
        1
        for i in range(0, len(data), 3)
        if max(abs(data[i] - 200), abs(data[i + 1] - 30), abs(data[i + 2] - 30)) > 40
    )
    assert changed > 0.01 * len(data) / 3


def test_render_watermarks_preview() -> None:
    r = render(jpeg((1200, 800)))
    data = Image.open(io.BytesIO(r.preview)).convert("RGB").tobytes()
    changed = sum(
        1
        for i in range(0, len(data), 3)
        if max(abs(data[i] - 200), abs(data[i + 1] - 30), abs(data[i + 2] - 30)) > 40
    )
    assert changed > 0.01 * len(data) / 3


def test_render_camera_exif_without_gps() -> None:
    r = render(jpeg((600, 400), exif=camera_exif()))
    assert r.exif["make"] == "Canon" and r.exif["model"] == "EOS R6"
    assert r.exif["lens"] == "RF24-70mm F2.8 L IS USM"
    assert r.exif["taken_at"] == "2026-09-14T17:03:22"
    assert r.exif["f_number"] == pytest.approx(2.8)
    assert r.exif["focal_length_mm"] == pytest.approx(50.0)
    assert r.exif["exposure_time"] == "1/250"
    assert r.exif["iso"] == 400
    assert not any("gps" in key for key in r.exif)


def test_render_gps_signs_and_altitude() -> None:
    r = render(jpeg((600, 400), exif=camera_exif(with_altitude=True)))
    assert r.gps is not None
    assert r.gps["lat"] == pytest.approx(-34.0259, abs=1e-3)
    assert r.gps["lon"] == pytest.approx(-118.7798, abs=1e-3)
    assert r.gps["alt_m"] == pytest.approx(-12.0)


def test_render_without_gps() -> None:
    r = render(jpeg((600, 400)))
    assert r.gps is None
    assert r.exif == {}


def test_render_heic_not_upscaled() -> None:
    out = io.BytesIO()
    Image.new("RGB", (640, 480), (20, 120, 220)).save(out, format="HEIF")
    r = render(out.getvalue())
    preview = Image.open(io.BytesIO(r.preview))
    assert (r.width, r.height) == (640, 480)
    assert preview.format == "JPEG" and preview.size == (640, 480)


def test_render_applies_orientation() -> None:
    exif = Image.Exif()
    exif[0x0112] = 6
    r = render(jpeg((400, 300), (0, 0, 0), exif=exif))
    assert (r.width, r.height) == (300, 400)
    assert Image.open(io.BytesIO(r.preview)).size == (300, 400)


def test_render_png_with_alpha() -> None:
    out = io.BytesIO()
    Image.new("RGBA", (300, 200), (0, 0, 0, 0)).save(out, "PNG")
    r = render(out.getvalue())
    assert Image.open(io.BytesIO(r.preview)).mode == "RGB"


@pytest.mark.parametrize("bad", [b"not an image", b"", jpeg((50, 50))[:40]])
def test_render_unreadable(bad: bytes) -> None:
    with pytest.raises(UnreadableImage):
        render(bad)


def test_output_paths() -> None:
    assert output_paths("u1/b1/ph1.heic") == ("u1/b1/ph1.jpg", "u1/b1/ph1_thumb.jpg")
    assert output_paths("u1/b1/ph1.jpg") == ("u1/b1/ph1.jpg", "u1/b1/ph1_thumb.jpg")


# run_once()


class FakeRpc:
    def __init__(self, db: "FakeWorkerDb", name: str, params: dict[str, Any] | None) -> None:
        self.db = db
        self.name = name
        self.params = params

    async def execute(self) -> SimpleNamespace:
        self.db.calls.append((self.name, self.params))
        if self.name == "claim_gallery_job":
            return SimpleNamespace(data=self.db.claimed)
        if self.name == "complete_gallery_job":
            return SimpleNamespace(data=self.db.completed)
        return SimpleNamespace(data=None)


class FakeBucket:
    def __init__(self, db: "FakeWorkerDb", bucket: str) -> None:
        self.db = db
        self.bucket = bucket

    async def download(self, path: str, *args: Any, **kwargs: Any) -> bytes:
        self.db.downloads.append((self.bucket, path))
        if isinstance(self.db.original, Exception):
            raise self.db.original
        return self.db.original

    async def upload(self, path: str, file: bytes, *args: Any, **kwargs: Any) -> None:
        self.db.uploads[(self.bucket, path)] = bytes(file)

    async def remove(self, paths: list[str]) -> list[Any]:
        self.db.removed.append((self.bucket, list(paths)))
        return []


class FakeWorkerDb:
    def __init__(self) -> None:
        self.claimed: list[dict[str, Any]] = [dict(JOB)]
        self.completed = True
        self.original: bytes | Exception = jpeg((800, 600), (0, 128, 255))
        self.calls: list[tuple[str, dict[str, Any] | None]] = []
        self.downloads: list[tuple[str, str]] = []
        self.uploads: dict[tuple[str, str], bytes] = {}
        self.removed: list[tuple[str, list[str]]] = []
        self.storage = SimpleNamespace(from_=lambda bucket: FakeBucket(self, bucket))

    def rpc(self, name: str, params: dict[str, Any] | None = None, **kwargs: Any) -> FakeRpc:
        return FakeRpc(self, name, params)


@pytest.fixture
def db() -> FakeWorkerDb:
    return FakeWorkerDb()


def run(db: FakeWorkerDb) -> bool:
    return asyncio.run(run_once(cast(AsyncClient, db)))


def test_run_once_success(db: FakeWorkerDb) -> None:
    assert run(db) is True
    assert db.downloads == [(ORIGINALS_BUCKET, ORIGINAL)]
    assert set(db.uploads) == {
        (PREVIEWS_BUCKET, "u1/b1/ph1.jpg"),
        (PREVIEWS_BUCKET, "u1/b1/ph1_thumb.jpg"),
    }
    preview = Image.open(io.BytesIO(db.uploads[(PREVIEWS_BUCKET, "u1/b1/ph1.jpg")]))
    assert preview.size == (800, 600)
    name, params = db.calls[-1]
    assert name == "complete_gallery_job"
    assert params == {
        "p_job_id": "j1",
        "p_preview_path": "u1/b1/ph1.jpg",
        "p_thumb_path": "u1/b1/ph1_thumb.jpg",
        "p_width": 800,
        "p_height": 600,
        "p_exif": {},
        "p_gps": None,
    }
    assert db.removed == []


def test_run_once_passes_gps(db: FakeWorkerDb) -> None:
    db.original = jpeg((800, 600), exif=camera_exif())
    run(db)
    _, params = db.calls[-1]
    assert params is not None and params["p_gps"] is not None
    assert params["p_gps"]["lat"] == pytest.approx(-34.0259, abs=1e-3)
    assert params["p_exif"]["make"] == "Canon"


def test_run_once_photo_deleted_mid_processing(db: FakeWorkerDb) -> None:
    db.completed = False
    assert run(db) is True
    assert len(db.removed) == 1
    bucket, paths = db.removed[0]
    assert bucket == PREVIEWS_BUCKET
    assert sorted(paths) == ["u1/b1/ph1.jpg", "u1/b1/ph1_thumb.jpg"]


def test_run_once_unreadable_fails_permanently(db: FakeWorkerDb) -> None:
    db.original = b"not an image"
    assert run(db) is True
    name, params = db.calls[-1]
    assert name == "fail_gallery_job"
    assert params is not None
    assert params["p_job_id"] == "j1" and params["p_permanent"] is True
    assert isinstance(params["p_error"], str) and params["p_error"]
    assert db.uploads == {}


def test_run_once_other_error_is_retryable(db: FakeWorkerDb) -> None:
    db.original = RuntimeError("x" * 900)
    assert run(db) is True
    name, params = db.calls[-1]
    assert name == "fail_gallery_job"
    assert params is not None
    assert params["p_permanent"] is False
    assert 0 < len(params["p_error"]) <= 500


def test_run_once_empty_queue(db: FakeWorkerDb) -> None:
    db.claimed = []
    assert run(db) is False
    assert [c[0] for c in db.calls] == ["claim_gallery_job"]
    assert db.downloads == []
