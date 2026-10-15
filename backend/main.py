from __future__ import annotations

import json
import os
import re
import time
from io import BytesIO

import psycopg
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account
from PIL import Image, ImageDraw, ImageFont
from pydantic import BaseModel, Field

app = FastAPI(title="Keepers")

DEFAULT_GREETING = (
    "Hi Vanessa,\n\n"
    "Thank you again for the session. We would like to keep the following photos:"
)
DEFAULT_SIGNOFF = "Thank you,"
NAME_RE = re.compile(r"^IMG_(\d+)\.jpg$", re.IGNORECASE)
DRIVE_API = "https://www.googleapis.com/drive/v3/files"
CATALOG_TTL_SECONDS = 300
SESSION_USERS = {"half", "karolina"}

_catalog_cache: tuple[float, dict, dict[str, dict]] | None = None


class SessionBody(BaseModel):
    version: int = 1
    target: int = 20
    stage: str = "strip"
    burstIndex: int = 0
    decisions: dict = Field(default_factory=dict)
    keepers: list[str] = Field(default_factory=list)
    greeting: str = DEFAULT_GREETING
    signoff: str = DEFAULT_SIGNOFF


def _env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _session_user(user: str) -> str:
    normalized = user.strip().lower()
    if normalized not in SESSION_USERS:
        raise HTTPException(400, "Unknown session user")
    return normalized


def _db_connect():
    return psycopg.connect(_env("DATABASE_URL"), connect_timeout=10)


def _ensure_sessions_table(conn) -> None:
    with conn.cursor() as cursor:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS keepers_sessions (
                user_id text PRIMARY KEY CHECK (user_id IN ('half', 'karolina')),
                payload jsonb NOT NULL,
                updated_at timestamptz NOT NULL DEFAULT now()
            )
            """
        )


def _load_session(user: str) -> dict:
    with _db_connect() as conn:
        _ensure_sessions_table(conn)
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT payload FROM keepers_sessions WHERE user_id = %s",
                (user,),
            )
            row = cursor.fetchone()
    if not row:
        return SessionBody().model_dump()
    payload = row[0]
    if isinstance(payload, str):
        payload = json.loads(payload)
    return SessionBody.model_validate(payload).model_dump()


def _save_session(user: str, body: SessionBody) -> dict:
    payload = body.model_dump()
    with _db_connect() as conn:
        _ensure_sessions_table(conn)
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO keepers_sessions (user_id, payload, updated_at)
                VALUES (%s, %s::jsonb, now())
                ON CONFLICT (user_id) DO UPDATE
                SET payload = EXCLUDED.payload,
                    updated_at = now()
                """,
                (user, json.dumps(payload)),
            )
    return payload


def _drive_session() -> AuthorizedSession:
    private_key = _env("GOOGLE_PRIVATE_KEY").replace("\\n", "\n")
    credentials = service_account.Credentials.from_service_account_info(
        {
            "type": "service_account",
            "client_email": _env("GOOGLE_CLIENT_EMAIL"),
            "private_key": private_key,
            "token_uri": "https://oauth2.googleapis.com/token",
        },
        scopes=["https://www.googleapis.com/auth/drive.readonly"],
    )
    return AuthorizedSession(credentials)


def _camera_number(name: str) -> int:
    match = NAME_RE.match(name)
    if not match:
        raise ValueError(f"Unsupported proof filename: {name}")
    return int(match.group(1))


def _burst(photos: list[dict], index: int) -> dict:
    start = photos[0]["number"]
    end = photos[-1]["number"]
    return {
        "id": f"{start:04d}-{end:04d}",
        "index": index,
        "start": start,
        "end": end,
        "filenames": [photo["filename"] for photo in photos],
        "size": len(photos),
    }


def _list_drive_photos() -> list[dict]:
    folder_id = _env("GOOGLE_DRIVE_FOLDER_ID")
    session = _drive_session()
    files: list[dict] = []
    page_token: str | None = None

    while True:
        params = {
            "q": f"'{folder_id}' in parents and trashed = false and mimeType = 'image/jpeg'",
            "fields": "nextPageToken,files(id,name,mimeType,size,imageMediaMetadata(width,height),modifiedTime)",
            "pageSize": 1000,
            "supportsAllDrives": "true",
            "includeItemsFromAllDrives": "true",
        }
        if page_token:
            params["pageToken"] = page_token

        response = session.get(DRIVE_API, params=params, timeout=20)
        if response.status_code == 403:
            raise HTTPException(
                503,
                "Google Drive access denied. Share the proof folder with the service account as Viewer.",
            )
        if not response.ok:
            raise HTTPException(502, f"Google Drive API error ({response.status_code})")

        payload = response.json()
        files.extend(payload.get("files", []))
        page_token = payload.get("nextPageToken")
        if not page_token:
            break

    return files


def _build_catalog_bundle() -> tuple[dict, dict[str, dict]]:
    drive_files = _list_drive_photos()
    photos: list[dict] = []
    by_name: dict[str, dict] = {}

    for item in drive_files:
        name = item.get("name", "")
        if not NAME_RE.match(name):
            continue

        metadata = item.get("imageMediaMetadata") or {}
        width = int(metadata.get("width") or 0)
        height = int(metadata.get("height") or 0)
        number = _camera_number(name)
        photo = {
            "filename": name,
            "number": number,
            "width": width,
            "height": height,
            "orientation": "portrait" if height > width else "landscape",
            "bytes": int(item.get("size") or 0),
        }
        photos.append(photo)
        by_name[name] = item

    photos.sort(key=lambda photo: photo["number"])

    bursts: list[dict] = []
    current: list[dict] = []
    for photo in photos:
        if current and photo["number"] == current[-1]["number"] + 1:
            current.append(photo)
        else:
            if current:
                bursts.append(_burst(current, len(bursts)))
            current = [photo]
    if current:
        bursts.append(_burst(current, len(bursts)))

    burst_by_filename = {
        filename: burst["id"] for burst in bursts for filename in burst["filenames"]
    }
    enriched_photos = [
        {**photo, "burstId": burst_by_filename[photo["filename"]]} for photo in photos
    ]
    return {"count": len(enriched_photos), "photos": enriched_photos, "bursts": bursts}, by_name


def _catalog_bundle() -> tuple[dict, dict[str, dict]]:
    global _catalog_cache
    now = time.monotonic()
    if _catalog_cache and now - _catalog_cache[0] < CATALOG_TTL_SECONDS:
        return _catalog_cache[1], _catalog_cache[2]

    catalog, by_name = _build_catalog_bundle()
    _catalog_cache = (now, catalog, by_name)
    return catalog, by_name


def _drive_file(name: str) -> dict:
    if not NAME_RE.match(name):
        raise HTTPException(404, "Unknown photo")
    _, by_name = _catalog_bundle()
    item = by_name.get(name)
    if not item:
        raise HTTPException(404, "Unknown photo")
    return item


def _download_original(name: str) -> bytes:
    item = _drive_file(name)
    session = _drive_session()
    response = session.get(
        f"{DRIVE_API}/{item['id']}",
        params={"alt": "media", "supportsAllDrives": "true"},
        timeout=30,
    )
    if not response.ok:
        raise HTTPException(502, f"Failed to download {name} from Google Drive")
    return response.content


def _image_variant(name: str, long_edge: int) -> bytes:
    source = _download_original(name)
    with Image.open(BytesIO(source)) as image:
        image = image.convert("RGB")
        scale = long_edge / max(image.width, image.height)
        if scale < 1:
            image = image.resize(
                (
                    max(1, int(image.width * scale)),
                    max(1, int(image.height * scale)),
                ),
                Image.Resampling.LANCZOS,
            )
        output = BytesIO()
        image.save(output, "JPEG", quality=84, optimize=True)
        return output.getvalue()


def _image_headers() -> dict[str, str]:
    return {"Cache-Control": "public, max-age=3600, s-maxage=604800"}


def _font(size: int):
    try:
        return ImageFont.truetype("DejaVuSans.ttf", size)
    except OSError:
        return ImageFont.load_default()


@app.get("/api/health")
def health():
    drive_configured = all(
        os.getenv(name)
        for name in ("GOOGLE_DRIVE_FOLDER_ID", "GOOGLE_CLIENT_EMAIL", "GOOGLE_PRIVATE_KEY")
    )
    return {
        "ok": True,
        "backend": "google-drive",
        "driveConfigured": drive_configured,
        "sessionStorage": "neon" if os.getenv("DATABASE_URL") else "unconfigured",
    }


@app.get("/api/catalog")
def catalog():
    catalog_data, _ = _catalog_bundle()
    return catalog_data


@app.get("/api/session")
def get_session(user: str = "half"):
    return _load_session(_session_user(user))


@app.put("/api/session")
def put_session(body: SessionBody, user: str = "half"):
    if body.target not in (20, 40):
        raise HTTPException(400, "Target must be 20 or 40")
    return _save_session(_session_user(user), body)


@app.get("/api/thumb/{name}")
def thumb(name: str):
    return Response(
        _image_variant(name, 480),
        media_type="image/jpeg",
        headers=_image_headers(),
    )


@app.get("/api/large/{name}")
def large(name: str):
    return Response(
        _image_variant(name, 1400),
        media_type="image/jpeg",
        headers=_image_headers(),
    )


@app.get("/api/original/{name}")
def original(name: str):
    return Response(
        _download_original(name),
        media_type="image/jpeg",
        headers=_image_headers(),
    )


@app.get("/api/contact-sheet")
def contact_sheet():
    image = Image.new("RGB", (1200, 800), "#f4f1ea")
    draw = ImageDraw.Draw(image)
    title_font = _font(44)
    body_font = _font(26)
    draw.text(
        (70, 70),
        "Keepers · contact sheet pending",
        fill="#16181a",
        font=title_font,
    )
    draw.text(
        (70, 150),
        "Shared selection state is stored in Neon.",
        fill="#494641",
        font=body_font,
    )
    output = BytesIO()
    image.save(output, "JPEG", quality=88, optimize=True)
    return Response(
        output.getvalue(),
        media_type="image/jpeg",
        headers={"Content-Disposition": 'attachment; filename="keepers-contact-sheet.jpg"'},
    )
