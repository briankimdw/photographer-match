import contextlib
import uuid
from typing import Annotated, Any, cast

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from supabase import AsyncClient

from core.gallery import (
    MAX_PHOTOS,
    UPLOAD_STATUSES,
    check_photo,
    extension_for,
    storage_content_type,
)
from dependencies.auth import AuthUser, CurrentUser, SupabaseDep

router = APIRouter(prefix="/bookings", tags=["bookings"])

ORIGINALS_BUCKET = "gallery-originals"
PREVIEWS_BUCKET = "gallery-previews"


def _size(file: UploadFile) -> int:
    if file.size is not None:
        return file.size
    # Measure the spooled file without reading it into memory.
    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(0)
    return size


async def _provider_booking(
    db: AsyncClient, booking_id: uuid.UUID, user: AuthUser
) -> dict[str, Any]:
    """The booking row, if the user is its provider (404 / 403 otherwise)."""
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
    return row


@router.post("/{booking_id}/gallery", status_code=status.HTTP_202_ACCEPTED)
async def upload_gallery(
    booking_id: uuid.UUID,
    photos: Annotated[list[UploadFile], File()],
    user: CurrentUser,
    db: SupabaseDep,
):
    # Originals go to Storage and each photo gets a processing job (created by a
    # trigger); the worker makes the previews later.
    row = await _provider_booking(db, booking_id, user)

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
    sizes: list[int] = []
    for photo in photos:
        size = _size(photo)
        problem = check_photo(photo.filename or "", photo.content_type, size)
        if problem is not None:
            raise HTTPException(*problem)
        sizes.append(size)

    upload_id = str(uuid.uuid4())
    uploaded: list[str] = []
    records: list[dict[str, Any]] = []
    try:
        await (
            db.table("gallery_uploads")
            .insert(
                {
                    "id": upload_id,
                    "booking_id": str(booking_id),
                    "provider_id": row["provider_id"],
                    "uploaded_by": user.id,
                    "photo_count": len(photos),
                }
            )
            .execute()
        )
        for position, (photo, size) in enumerate(zip(photos, sizes, strict=True)):
            filename = photo.filename or ""
            photo_id = str(uuid.uuid4())
            path = f"{user.id}/{booking_id}/{photo_id}{extension_for(filename, photo.content_type)}"
            # One file in memory at a time.
            data = await photo.read()
            await db.storage.from_(ORIGINALS_BUCKET).upload(
                path,
                data,
                {"content-type": storage_content_type(filename, photo.content_type)},
            )
            uploaded.append(path)
            records.append(
                {
                    "id": photo_id,
                    "booking_id": str(booking_id),
                    "upload_id": upload_id,
                    "provider_id": row["provider_id"],
                    "position": position,
                    "filename": filename,
                    "content_type": photo.content_type or "",
                    "size_bytes": size,
                    "original_path": path,
                }
            )
        await db.table("gallery_photos").insert(records).execute()
    except Exception:
        # Best effort: undo what this request wrote, then report the failure.
        if uploaded:
            with contextlib.suppress(Exception):
                await db.storage.from_(ORIGINALS_BUCKET).remove(uploaded)
        with contextlib.suppress(Exception):
            await db.table("gallery_uploads").delete().eq("id", upload_id).execute()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Couldn't save the photos. Try again.")

    return {
        "booking_id": str(booking_id),
        "upload_id": upload_id,
        "received": len(records),
        "total_bytes": sum(sizes),
        "stored": True,
        "photos": [
            {
                "id": r["id"],
                "filename": r["filename"],
                "content_type": r["content_type"],
                "size_bytes": r["size_bytes"],
                "status": "queued",
            }
            for r in records
        ],
    }


@router.delete("/{booking_id}/gallery/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_gallery_photo(
    booking_id: uuid.UUID,
    photo_id: uuid.UUID,
    user: CurrentUser,
    db: SupabaseDep,
) -> None:
    row = await _provider_booking(db, booking_id, user)

    if row["status"] not in UPLOAD_STATUSES:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Gallery photos can only be changed while the booking is confirmed, in progress "
            "or delivered",
        )

    found = (
        await db.table("gallery_photos")
        .select("id, original_path, preview_path, thumb_path")
        .eq("id", str(photo_id))
        .eq("booking_id", str(booking_id))
        .maybe_single()
        .execute()
    )
    if found is None or found.data is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Photo not found")
    photo = cast(dict[str, Any], found.data)

    # The job and location rows cascade; a trigger sends the batch message if
    # this was the last unfinished photo.
    await (
        db.table("gallery_photos")
        .delete()
        .eq("id", str(photo_id))
        .eq("booking_id", str(booking_id))
        .execute()
    )

    # Orphaned objects are accepted in v1, so storage errors don't fail the delete.
    with contextlib.suppress(Exception):
        await db.storage.from_(ORIGINALS_BUCKET).remove([photo["original_path"]])
    previews = [p for p in (photo.get("preview_path"), photo.get("thumb_path")) if p]
    if previews:
        with contextlib.suppress(Exception):
            await db.storage.from_(PREVIEWS_BUCKET).remove(previews)
