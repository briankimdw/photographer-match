from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api import auth, bookings, users
from config import get_settings

settings = get_settings()

app = FastAPI(title="Photographer Match API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(bookings.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
