"""The gallery job loop: claim -> download -> render -> upload -> complete/fail.

The queue lives in Postgres (gallery_jobs); the claim/complete/fail functions
are service-role only. Logs carry ids, attempts and outcomes, never filenames,
EXIF/GPS or keys.
"""

import asyncio
import contextlib
import logging
import signal
from typing import Any, cast

from storage3.types import FileOptions
from supabase import AsyncClient

from worker.imaging import UnreadableImage, render

PREVIEWS_BUCKET = "gallery-previews"
ORIGINALS_BUCKET = "gallery-originals"
MAX_ERROR_CHARS = 500
ERROR_SLEEP_SECONDS = 5.0

log = logging.getLogger("worker")


def output_paths(original_path: str) -> tuple[str, str]:
    """Preview and thumbnail paths: the original's path with a .jpg / _thumb.jpg ending."""
    folder, _, name = original_path.rpartition("/")
    stem = name.rsplit(".", 1)[0] if "." in name else name
    base = f"{folder}/{stem}" if folder else stem
    return f"{base}.jpg", f"{base}_thumb.jpg"


def _error_text(exc: BaseException) -> str:
    return (str(exc) or type(exc).__name__)[:MAX_ERROR_CHARS]


async def _fail(db: AsyncClient, job: dict[str, Any], exc: Exception, permanent: bool) -> None:
    await db.rpc(
        "fail_gallery_job",
        {"p_job_id": job["job_id"], "p_error": _error_text(exc), "p_permanent": permanent},
    ).execute()
    log.warning(
        "job %s photo %s attempt %s failed (%s): %s",
        job["job_id"],
        job["photo_id"],
        job["attempts"],
        "permanent" if permanent else "will retry",
        type(exc).__name__,
    )


async def run_once(db: AsyncClient) -> bool:
    """Process one job. False when the queue was empty."""
    claimed = await db.rpc("claim_gallery_job", {}).execute()
    data = cast(Any, claimed.data)
    rows: list[dict[str, Any]] = [data] if isinstance(data, dict) else list(data or [])
    if not rows:
        return False
    job = rows[0]
    preview_path, thumb_path = output_paths(job["original_path"])

    try:
        original = await db.storage.from_(ORIGINALS_BUCKET).download(job["original_path"])
        rendered = await asyncio.to_thread(render, original)
        previews = db.storage.from_(PREVIEWS_BUCKET)
        options: FileOptions = {"content-type": "image/jpeg", "upsert": "true"}
        await previews.upload(preview_path, rendered.preview, options)
        await previews.upload(thumb_path, rendered.thumb, options)
        completed = await db.rpc(
            "complete_gallery_job",
            {
                "p_job_id": job["job_id"],
                "p_preview_path": preview_path,
                "p_thumb_path": thumb_path,
                "p_width": rendered.width,
                "p_height": rendered.height,
                "p_exif": rendered.exif,
                "p_gps": rendered.gps,
            },
        ).execute()
    except UnreadableImage as exc:
        await _fail(db, job, exc, permanent=True)
        return True
    except Exception as exc:
        await _fail(db, job, exc, permanent=False)
        return True

    if completed.data is False:
        # The photo was deleted while we worked: drop the outputs we just made.
        log.info("job %s photo %s deleted mid-processing", job["job_id"], job["photo_id"])
        try:
            await db.storage.from_(PREVIEWS_BUCKET).remove([preview_path, thumb_path])
        except Exception as exc:
            log.warning("job %s cleanup failed: %s", job["job_id"], type(exc).__name__)
        return True

    log.info("job %s photo %s attempt %s done", job["job_id"], job["photo_id"], job["attempts"])
    return True


async def run_forever(db: AsyncClient, poll_seconds: float = 2.0) -> None:
    """Work through the queue until Ctrl-C / SIGTERM (finishing the current job first)."""
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        with contextlib.suppress(NotImplementedError, RuntimeError):
            loop.add_signal_handler(sig, stop.set)

    log.info("Gallery worker started")
    while not stop.is_set():
        try:
            worked = await run_once(db)
            delay = 0.0 if worked else poll_seconds
        except Exception:
            log.exception("Worker loop error; retrying in %.0f s", ERROR_SLEEP_SECONDS)
            delay = ERROR_SLEEP_SECONDS
        if delay:
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), timeout=delay)
    log.info("Gallery worker stopped")
