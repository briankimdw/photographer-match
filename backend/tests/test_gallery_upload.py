import uuid
from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from dependencies.auth import AuthUser, get_current_user, get_supabase
from main import app

BOOKING_ID = "00000000-0000-0000-0000-0000000000b1"
PHOTO_ID = "00000000-0000-0000-0000-0000000000f1"
URL = f"/bookings/{BOOKING_ID}/gallery"
PHOTO_URL = f"{URL}/{PHOTO_ID}"


class FakeQuery:
    """Supabase query builder stand-in: every filter returns itself, execute() the table's row."""

    def __init__(self, db: "FakeDb", table: str) -> None:
        self.db = db
        self.table = table

    def select(self, *args: Any, **kwargs: Any) -> "FakeQuery":
        return self

    def eq(self, *args: Any, **kwargs: Any) -> "FakeQuery":
        return self

    def maybe_single(self) -> "FakeQuery":
        return self

    def insert(self, data: Any, *args: Any, **kwargs: Any) -> "FakeQuery":
        self.db.inserts.append((self.table, data))
        return self

    def delete(self, *args: Any, **kwargs: Any) -> "FakeQuery":
        self.db.deletes.append(self.table)
        return self

    async def execute(self) -> SimpleNamespace:
        if self.table in self.db.failing_tables:
            raise RuntimeError("db down")
        return SimpleNamespace(data=self.db.rows.get(self.table))


class FakeBucket:
    def __init__(self, db: "FakeDb", bucket: str) -> None:
        self.db = db
        self.bucket = bucket

    async def upload(self, path: str, file: bytes, *args: Any, **kwargs: Any) -> None:
        self.db.uploads.append((self.bucket, path, bytes(file), args, kwargs))
        if len(self.db.uploads) == self.db.fail_upload_at:
            raise RuntimeError("storage down")

    async def remove(self, paths: list[str]) -> list[Any]:
        self.db.removed.append((self.bucket, list(paths)))
        if self.db.fail_remove:
            raise RuntimeError("storage down")
        return []


class FakeDb:
    def __init__(self) -> None:
        self.rows: dict[str, Any] = {
            "bookings": {"id": BOOKING_ID, "provider_id": "p1", "status": "confirmed"},
            "providers": {"id": "p1"},
            "gallery_photos": {
                "id": PHOTO_ID,
                "original_path": f"u1/{BOOKING_ID}/{PHOTO_ID}.jpg",
                "preview_path": f"u1/{BOOKING_ID}/{PHOTO_ID}.jpg",
                "thumb_path": f"u1/{BOOKING_ID}/{PHOTO_ID}_thumb.jpg",
            },
        }
        self.inserts: list[tuple[str, Any]] = []
        self.deletes: list[str] = []
        self.uploads: list[tuple[str, str, bytes, Any, Any]] = []
        self.removed: list[tuple[str, list[str]]] = []
        self.failing_tables: set[str] = set()
        self.fail_upload_at = 0
        self.fail_remove = False
        self.storage = SimpleNamespace(from_=lambda bucket: FakeBucket(self, bucket))

    def table(self, name: str) -> FakeQuery:
        return FakeQuery(self, name)


@pytest.fixture
def db() -> Iterator[FakeDb]:
    fake = FakeDb()
    app.dependency_overrides[get_current_user] = lambda: AuthUser(id="u1", claims={})
    app.dependency_overrides[get_supabase] = lambda: fake
    yield fake
    app.dependency_overrides.clear()


@pytest.fixture
def rows(db: FakeDb) -> dict[str, Any]:
    return db.rows


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def photo(name: str, content: bytes = b"x", content_type: str = "image/jpeg") -> tuple:
    return ("photos", (name, content, content_type))


def test_example_receipt(db: FakeDb, client: TestClient) -> None:
    files = [
        photo("a.jpg", b"x" * 10, "image/jpeg"),
        photo("b.heic", b"y" * 5, "application/octet-stream"),
    ]
    r = client.post(URL, files=files)
    assert r.status_code == 202, r.text
    body = r.json()
    ids = [p["id"] for p in body["photos"]]
    for value in [*ids, body["upload_id"]]:
        uuid.UUID(value)
    assert body == {
        "booking_id": BOOKING_ID,
        "upload_id": body["upload_id"],
        "received": 2,
        "total_bytes": 15,
        "stored": True,
        "photos": [
            {
                "id": ids[0],
                "filename": "a.jpg",
                "content_type": "image/jpeg",
                "size_bytes": 10,
                "status": "queued",
            },
            {
                "id": ids[1],
                "filename": "b.heic",
                "content_type": "application/octet-stream",
                "size_bytes": 5,
                "status": "queued",
            },
        ],
    }


def test_originals_stored_at_user_booking_photo_paths(db: FakeDb, client: TestClient) -> None:
    files = [
        photo("a.JPEG", b"x" * 10, "image/jpeg"),
        photo("b.heic", b"y" * 5, "application/octet-stream"),
        photo("scan", b"z" * 3, "image/png"),
    ]
    r = client.post(URL, files=files)
    assert r.status_code == 202, r.text
    ids = [p["id"] for p in r.json()["photos"]]
    assert [(b, p, data) for b, p, data, _, _ in db.uploads] == [
        ("gallery-originals", f"u1/{BOOKING_ID}/{ids[0]}.jpeg", b"x" * 10),
        ("gallery-originals", f"u1/{BOOKING_ID}/{ids[1]}.heic", b"y" * 5),
        ("gallery-originals", f"u1/{BOOKING_ID}/{ids[2]}.png", b"z" * 3),
    ]
    content_types = [
        (args[0] if args else kwargs["file_options"])["content-type"]
        for _, _, _, args, kwargs in db.uploads
    ]
    assert content_types == ["image/jpeg", "image/heic", "image/png"]


def test_upload_and_photo_rows_inserted(db: FakeDb, client: TestClient) -> None:
    files = [photo("a.jpg", b"x" * 10), photo("b.png", b"y" * 5, "image/png")]
    r = client.post(URL, files=files)
    assert r.status_code == 202, r.text
    body = r.json()
    ids = [p["id"] for p in body["photos"]]
    assert [t for t, _ in db.inserts] == ["gallery_uploads", "gallery_photos"]
    assert db.inserts[0][1] == {
        "id": body["upload_id"],
        "booking_id": BOOKING_ID,
        "provider_id": "p1",
        "uploaded_by": "u1",
        "photo_count": 2,
    }
    assert db.inserts[1][1] == [
        {
            "id": ids[0],
            "booking_id": BOOKING_ID,
            "upload_id": body["upload_id"],
            "provider_id": "p1",
            "position": 0,
            "filename": "a.jpg",
            "content_type": "image/jpeg",
            "size_bytes": 10,
            "original_path": f"u1/{BOOKING_ID}/{ids[0]}.jpg",
        },
        {
            "id": ids[1],
            "booking_id": BOOKING_ID,
            "upload_id": body["upload_id"],
            "provider_id": "p1",
            "position": 1,
            "filename": "b.png",
            "content_type": "image/png",
            "size_bytes": 5,
            "original_path": f"u1/{BOOKING_ID}/{ids[1]}.png",
        },
    ]
    assert db.removed == [] and db.deletes == []


def test_storage_failure_cleans_up(db: FakeDb, client: TestClient) -> None:
    db.fail_upload_at = 2
    r = client.post(URL, files=[photo("a.jpg"), photo("b.jpg"), photo("c.jpg")])
    assert r.status_code == 502
    assert r.json()["detail"] == "Couldn't save the photos. Try again."
    assert db.removed == [("gallery-originals", [db.uploads[0][1]])]
    assert db.deletes == ["gallery_uploads"]
    assert [t for t, _ in db.inserts] == ["gallery_uploads"]


def test_first_upload_failure_skips_storage_cleanup(db: FakeDb, client: TestClient) -> None:
    db.fail_upload_at = 1
    r = client.post(URL, files=[photo("a.jpg")])
    assert r.status_code == 502
    assert db.removed == []
    assert db.deletes == ["gallery_uploads"]


def test_photo_insert_failure_cleans_up(db: FakeDb, client: TestClient) -> None:
    db.failing_tables = {"gallery_photos"}
    db.fail_remove = True
    r = client.post(URL, files=[photo("a.jpg"), photo("b.jpg")])
    assert r.status_code == 502
    assert db.removed == [("gallery-originals", [u[1] for u in db.uploads])]
    assert db.deletes == ["gallery_uploads"]


def test_upload_row_failure_returns_502(db: FakeDb, client: TestClient) -> None:
    db.failing_tables = {"gallery_uploads"}
    r = client.post(URL, files=[photo("a.jpg")])
    assert r.status_code == 502
    assert db.uploads == [] and db.removed == []


def test_requires_token(client: TestClient) -> None:
    r = client.post(URL, files=[photo("a.jpg")])
    assert r.status_code == 401


def test_unknown_booking(rows: dict[str, Any], client: TestClient) -> None:
    rows["bookings"] = None
    r = client.post(URL, files=[photo("a.jpg")])
    assert r.status_code == 404
    assert r.json()["detail"] == "Booking not found"


def test_not_the_provider(rows: dict[str, Any], client: TestClient) -> None:
    rows["providers"] = None
    r = client.post(URL, files=[photo("a.jpg")])
    assert r.status_code == 403
    assert r.json()["detail"] == "Only the booking's provider can upload its gallery"


@pytest.mark.parametrize("booking_status", ["requested", "accepted", "completed", "refunded"])
def test_status_not_open(rows: dict[str, Any], client: TestClient, booking_status: str) -> None:
    rows["bookings"]["status"] = booking_status
    r = client.post(URL, files=[photo("a.jpg")])
    assert r.status_code == 409


@pytest.mark.parametrize("booking_status", ["confirmed", "in_progress", "delivered"])
def test_status_open(rows: dict[str, Any], client: TestClient, booking_status: str) -> None:
    rows["bookings"]["status"] = booking_status
    r = client.post(URL, files=[photo("a.jpg")])
    assert r.status_code == 202, r.text


def test_hundred_photos_ok(rows: dict[str, Any], client: TestClient) -> None:
    r = client.post(URL, files=[photo(f"{i}.jpg") for i in range(100)])
    assert r.status_code == 202, r.text
    assert r.json()["received"] == 100


def test_too_many_photos(db: FakeDb, client: TestClient) -> None:
    r = client.post(URL, files=[photo(f"{i}.jpg") for i in range(101)])
    assert r.status_code == 422
    assert r.json()["detail"] == "Upload between 1 and 100 photos"
    assert db.uploads == [] and db.inserts == []


def test_unsupported_type(db: FakeDb, client: TestClient) -> None:
    r = client.post(URL, files=[photo("ok.jpg"), photo("anim.gif", content_type="image/gif")])
    assert r.status_code == 422
    assert "anim.gif" in r.json()["detail"]
    assert db.uploads == [] and db.inserts == []


def test_octet_stream_needs_photo_extension(rows: dict[str, Any], client: TestClient) -> None:
    r = client.post(URL, files=[photo("notes.txt", content_type="application/octet-stream")])
    assert r.status_code == 422
    assert "notes.txt" in r.json()["detail"]


def test_empty_file(rows: dict[str, Any], client: TestClient) -> None:
    r = client.post(URL, files=[photo("e.png", b"", "image/png")])
    assert r.status_code == 422
    assert r.json()["detail"] == "e.png is empty"


def test_file_too_large(rows: dict[str, Any], client: TestClient) -> None:
    r = client.post(URL, files=[photo("big.jpg", b"x" * (50 * 1024 * 1024 + 1))])
    assert r.status_code == 413
    assert r.json()["detail"] == "big.jpg is larger than 50 MB"


def test_missing_photos_field(rows: dict[str, Any], client: TestClient) -> None:
    r = client.post(URL, data={"x": "1"})
    assert r.status_code == 422


# Delete


def test_delete_removes_row_and_objects(db: FakeDb, client: TestClient) -> None:
    db.rows["bookings"]["status"] = "delivered"
    r = client.delete(PHOTO_URL)
    assert r.status_code == 204, r.text
    assert r.content == b""
    assert db.deletes == ["gallery_photos"]
    photo_row = db.rows["gallery_photos"]
    assert sorted(db.removed) == [
        ("gallery-originals", [photo_row["original_path"]]),
        ("gallery-previews", [photo_row["preview_path"], photo_row["thumb_path"]]),
    ]


def test_delete_unprocessed_photo_skips_previews(db: FakeDb, client: TestClient) -> None:
    db.rows["gallery_photos"]["preview_path"] = None
    db.rows["gallery_photos"]["thumb_path"] = None
    r = client.delete(PHOTO_URL)
    assert r.status_code == 204, r.text
    assert db.removed == [("gallery-originals", [db.rows["gallery_photos"]["original_path"]])]


def test_delete_ignores_storage_errors(db: FakeDb, client: TestClient) -> None:
    db.fail_remove = True
    r = client.delete(PHOTO_URL)
    assert r.status_code == 204, r.text
    assert len(db.removed) == 2


def test_delete_unknown_photo(db: FakeDb, client: TestClient) -> None:
    db.rows["gallery_photos"] = None
    r = client.delete(PHOTO_URL)
    assert r.status_code == 404
    assert r.json()["detail"] == "Photo not found"
    assert db.deletes == []


@pytest.mark.parametrize("booking_status", ["completed", "requested", "refunded"])
def test_delete_status_not_open(db: FakeDb, client: TestClient, booking_status: str) -> None:
    db.rows["bookings"]["status"] = booking_status
    r = client.delete(PHOTO_URL)
    assert r.status_code == 409
    assert r.json()["detail"] == (
        "Gallery photos can only be changed while the booking is confirmed, in progress "
        "or delivered"
    )
    assert db.deletes == [] and db.removed == []


def test_delete_not_the_provider(db: FakeDb, client: TestClient) -> None:
    db.rows["providers"] = None
    r = client.delete(PHOTO_URL)
    assert r.status_code == 403
    assert r.json()["detail"] == "Only the booking's provider can upload its gallery"


def test_delete_unknown_booking(db: FakeDb, client: TestClient) -> None:
    db.rows["bookings"] = None
    r = client.delete(PHOTO_URL)
    assert r.status_code == 404
    assert r.json()["detail"] == "Booking not found"


def test_delete_bad_photo_id(db: FakeDb, client: TestClient) -> None:
    r = client.delete(f"{URL}/nope")
    assert r.status_code == 422


def test_delete_requires_token(client: TestClient) -> None:
    r = client.delete(PHOTO_URL)
    assert r.status_code == 401
