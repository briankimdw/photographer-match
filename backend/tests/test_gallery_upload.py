from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from dependencies.auth import AuthUser, get_current_user, get_supabase
from main import app

BOOKING_ID = "00000000-0000-0000-0000-0000000000b1"
URL = f"/bookings/{BOOKING_ID}/gallery"


class FakeQuery:
    """Supabase query builder stand-in: every filter returns itself, execute() the table's row."""

    def __init__(self, rows: dict[str, Any], table: str) -> None:
        self.rows = rows
        self.table = table

    def select(self, *args: Any, **kwargs: Any) -> "FakeQuery":
        return self

    def eq(self, *args: Any, **kwargs: Any) -> "FakeQuery":
        return self

    def maybe_single(self) -> "FakeQuery":
        return self

    async def execute(self) -> SimpleNamespace:
        return SimpleNamespace(data=self.rows.get(self.table))


@pytest.fixture
def rows() -> Iterator[dict[str, Any]]:
    data: dict[str, Any] = {
        "bookings": {"id": BOOKING_ID, "provider_id": "p1", "status": "confirmed"},
        "providers": {"id": "p1"},
    }
    app.dependency_overrides[get_current_user] = lambda: AuthUser(id="u1", claims={})
    app.dependency_overrides[get_supabase] = lambda: SimpleNamespace(
        table=lambda name: FakeQuery(data, name)
    )
    yield data
    app.dependency_overrides.clear()


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def photo(name: str, content: bytes = b"x", content_type: str = "image/jpeg") -> tuple:
    return ("photos", (name, content, content_type))


def test_example_receipt(rows: dict[str, Any], client: TestClient) -> None:
    files = [
        photo("a.jpg", b"x" * 10, "image/jpeg"),
        photo("b.heic", b"y" * 5, "application/octet-stream"),
    ]
    r = client.post(URL, files=files)
    assert r.status_code == 200, r.text
    assert r.json() == {
        "booking_id": BOOKING_ID,
        "received": 2,
        "total_bytes": 15,
        "stored": False,
        "photos": [
            {"filename": "a.jpg", "content_type": "image/jpeg", "size_bytes": 10},
            {"filename": "b.heic", "content_type": "application/octet-stream", "size_bytes": 5},
        ],
    }


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
    assert r.status_code == 200, r.text


def test_hundred_photos_ok(rows: dict[str, Any], client: TestClient) -> None:
    r = client.post(URL, files=[photo(f"{i}.jpg") for i in range(100)])
    assert r.status_code == 200, r.text
    assert r.json()["received"] == 100


def test_too_many_photos(rows: dict[str, Any], client: TestClient) -> None:
    r = client.post(URL, files=[photo(f"{i}.jpg") for i in range(101)])
    assert r.status_code == 422
    assert r.json()["detail"] == "Upload between 1 and 100 photos"


def test_unsupported_type(rows: dict[str, Any], client: TestClient) -> None:
    r = client.post(URL, files=[photo("ok.jpg"), photo("anim.gif", content_type="image/gif")])
    assert r.status_code == 422
    assert "anim.gif" in r.json()["detail"]


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
