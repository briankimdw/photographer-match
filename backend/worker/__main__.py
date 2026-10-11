"""Run the gallery worker: `cd backend && .venv/bin/python -m worker`."""

import asyncio
import logging
import sys

from supabase import acreate_client

from worker.settings import WorkerSettings


async def _run(settings: WorkerSettings) -> None:
    # Imported here so the key check in main() doesn't need the imaging libraries loaded.
    from worker.jobs import run_forever

    db = await acreate_client(settings.supabase_url, settings.supabase_service_role_key)
    await run_forever(db)


def main() -> int:
    settings = WorkerSettings()
    if not settings.supabase_service_role_key:
        print("SUPABASE_SERVICE_ROLE_KEY is not set", file=sys.stderr)
        return 1
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    # httpx logs every request URL at INFO; keep the worker's own lines readable.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    asyncio.run(_run(settings))
    return 0


if __name__ == "__main__":
    sys.exit(main())
