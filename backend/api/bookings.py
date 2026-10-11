import uuid
from typing import Annotated, Any, cast

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from core.gallery import MAX_PHOTOS, UPLOAD_STATUSES, check_photo
from dependencies.auth import CurrentUser, SupabaseDep

router = APIRouter(prefix="/bookings", tags=["bookings"])


def _size(file: UploadFile) -> int:
    if file.size is not None:
        return file.size
    # Measure the spooled file without reading it into memory.
    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(0)
    return size


@router.post("/{booking_id}/gallery")
async def upload_gallery(
    booking_id: uuid.UUID,
    photos: Annotated[list[UploadFile], File()],
    user: CurrentUser,
    db: SupabaseDep,
):
    # v1 only acknowledges the upload: nothing is stored, and the spooled
    # files are discarded with the request.
    # Runs as the signed-in user, so RLS hides other people's bookings.
    booking = (
        await db.table("bookings")
        .select("id, provider_id, status")
        .eq("id", str(booking_id))
        .maybe_single()
        .execute()
    )
    if booking is None or booking.data is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    row = cast(dict[str, Any], booking.data)

    provider = (
        await db.table("providers")
        .select("id")
        .eq("id", row["provider_id"])
        .eq("profile_id", user.id)
        .maybe_single()
        .execute()
    )
    if provider is None or provider.data is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only the booking's provider can upload its gallery"
        )

    if row["status"] not in UPLOAD_STATUSES:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Gallery uploads are only open for confirmed, in-progress or delivered bookings",
        )

    if not 1 <= len(photos) <= MAX_PHOTOS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"Upload between 1 and {MAX_PHOTOS} photos"
        )

    # All or nothing: the first bad file rejects the whole upload.
    received: list[dict[str, str | int]] = []
    total_bytes = 0
    for photo in photos:
        filename = photo.filename or ""
        size = _size(photo)
        problem = check_photo(filename, photo.content_type, size)
        if problem is not None:
            raise HTTPException(*problem)
        received.append(
            {"filename": filename, "content_type": photo.content_type or "", "size_bytes": size}
        )
        total_bytes += size

    return {
        "booking_id": str(booking_id),
        "received": len(received),
        "total_bytes": total_bytes,
        "stored": False,
        "photos": received,
    }
