from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class WorkerSettings(BaseSettings):
    model_config = SettingsConfigDict(
        # Same backend/.env as the API (config.py), wherever the worker is started from.
        env_file=Path(__file__).parent.parent / ".env",
        extra="ignore",
    )

    supabase_url: str
    # Bypasses RLS: worker only, never the API or the frontend.
    supabase_service_role_key: str = ""
