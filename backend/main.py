from __future__ import annotations

import json
import re
import threading
from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from PIL import Image, ImageDraw, ImageFont
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
PICS_DIR = ROOT / "pics"
CACHE_DIR = ROOT / ".cache"
THUMB_DIR = CACHE_DIR / "thumb"
LARGE_DIR = CACHE_DIR / "large"
DATA_DIR = ROOT / "data"
SESSION_PATH = DATA_DIR / "session.json"
CATALOG_PATH = CACHE_DIR / "catalog.json"

THUMB_EDGE = 480
LARGE_EDGE = 1400
NAME_RE = re.compile(r"^IMG_\d+\.jpg$", re.IGNORECASE)

DEFAULT_GREETING = (
    "Hi Vanessa,\n\n"
    "Thank you again for the session. We would like to keep the following photos:"
)
DEFAULT_SIGNOFF = "Thank you,"


class SessionBody(BaseModel):
    version: int = 1
    target: int = 20
    stage: str = "strip"
    burstIndex: int = 0
    decisions: dict = Field(default_factory=dict)
    keepers: list[str] = Field(default_factory=list)
    greeting: str = DEFAULT_GREETING
    signoff: str = DEFAULT_SIGNOFF


def jpeg_size(path: Path) -> tuple[int, int]:
    with Image.open(path) as im:
        return im.size


def camera_number(name: str) -> int:
    return int(Path(name).stem.split("_")[1])


def build_catalog() -> dict:
    files = sorted(
        f for f in PICS_DIR.iterdir() if f.is_file() and NAME_RE.match(f.name)
    )
    photos: list[dict] = []
    for f in files:
        width, height = jpeg_size(f)
        photos.append(
            {
                "filename": f.name,
                "number": camera_number(f.name),
                "width": width,
                "height": height,
                "orientation": "portrait" if height > width else "landscape",
                "bytes": f.stat().st_size,
            }
        )

    bursts: list[dict] = []
    current: list[dict] = []
    for photo in photos:
        if current and photo["number"] == current[-1]["number"] + 1:
            current.append(photo)
        else:
            if current:
                bursts.append(_burst_from(current, len(bursts)))
            current = [photo]
    if current:
        bursts.append(_burst_from(current, len(bursts)))

    by_file = {p["filename"]: i for i, b in enumerate(bursts) for p in b["photos"]}
    for photo in photos:
        photo["burstId"] = bursts[by_file[photo["filename"]]]["id"]

    return {
        "count": len(photos),
        "photos": photos,
        "bursts": [
            {
                "id": b["id"],
                "index": b["index"],
                "start": b["start"],
                "end": b["end"],
                "filenames": [p["filename"] for p in b["photos"]],
                "size": len(b["photos"]),
            }
            for b in bursts
        ],
    }


def _burst_from(photos: list[dict], index: int) -> dict:
    start = photos[0]["number"]
    end = photos[-1]["number"]
    return {
        "id": f"{start:04d}-{end:04d}",
        "index": index,
        "start": start,
        "end": end,
        "photos": photos,
    }


def load_catalog() -> dict:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    pics_mtime = max(f.stat().st_mtime for f in PICS_DIR.glob("IMG_*.jpg"))
    if CATALOG_PATH.exists():
        try:
            cached = json.loads(CATALOG_PATH.read_text())
            if cached.get("picsMtime") == pics_mtime:
                return cached["catalog"]
        except (json.JSONDecodeError, OSError, KeyError):
            pass
    catalog = build_catalog()
    CATALOG_PATH.write_text(json.dumps({"picsMtime": pics_mtime, "catalog": catalog}))
    return catalog


def safe_pic(name: str) -> Path:
    if not NAME_RE.match(name) or "/" in name or "\\" in name:
        raise HTTPException(404, "Unknown photo")
    path = (PICS_DIR / name).resolve()
    if path.parent != PICS_DIR.resolve() or not path.is_file():
        raise HTTPException(404, "Unknown photo")
    return path


def ensure_variant(src: Path, dest: Path, long_edge: int) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_mtime >= src.stat().st_mtime:
        return dest
    with Image.open(src) as im:
        im = im.convert("RGB")
        w, h = im.size
        scale = long_edge / max(w, h)
        if scale < 1:
            im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)
        tmp = dest.with_suffix(".tmp.jpg")
        im.save(tmp, "JPEG", quality=82, optimize=True)
        tmp.replace(dest)
    return dest


def default_session() -> dict:
    return SessionBody().model_dump()


def load_session() -> dict:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not SESSION_PATH.exists():
        session = default_session()
        SESSION_PATH.write_text(json.dumps(session, indent=2))
        return session
    try:
        data = json.loads(SESSION_PATH.read_text())
    except (json.JSONDecodeError, OSError):
        return default_session()
    merged = default_session()
    merged.update(data)
    return merged


def prewarm_thumbs() -> None:
    try:
        catalog = load_catalog()
        for photo in catalog["photos"]:
            src = PICS_DIR / photo["filename"]
            ensure_variant(src, THUMB_DIR / photo["filename"], THUMB_EDGE)
    except Exception:
        pass


@asynccontextmanager
async def lifespan(_app: FastAPI):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=prewarm_thumbs, daemon=True).start()
    yield


app = FastAPI(title="Keepers", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/catalog")
def catalog():
    return load_catalog()


@app.get("/api/session")
def get_session():
    return load_session()


@app.put("/api/session")
def put_session(body: SessionBody):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    payload = body.model_dump()
    if payload["target"] not in (20, 40):
        raise HTTPException(400, "Target must be 20 or 40")
    SESSION_PATH.write_text(json.dumps(payload, indent=2))
    return payload


@app.get("/api/thumb/{name}")
def thumb(name: str):
    src = safe_pic(name)
    dest = ensure_variant(src, THUMB_DIR / name, THUMB_EDGE)
    return FileResponse(dest, media_type="image/jpeg")


@app.get("/api/large/{name}")
def large(name: str):
    src = safe_pic(name)
    dest = ensure_variant(src, LARGE_DIR / name, LARGE_EDGE)
    return FileResponse(dest, media_type="image/jpeg")


@app.get("/api/original/{name}")
def original(name: str):
    return FileResponse(safe_pic(name), media_type="image/jpeg")


@app.get("/api/contact-sheet")
def contact_sheet():
    session = load_session()
    keepers = session.get("keepers") or []
    if not keepers:
        raise HTTPException(400, "No keepers yet")
    cols = 4
    cell_w, cell_h = 420, 360
    pad = 28
    rows = (len(keepers) + cols - 1) // cols
    width = pad * 2 + cols * cell_w
    height = pad * 2 + 72 + rows * cell_h
    sheet = Image.new("RGB", (width, height), "#F4F1EA")
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("Arial.ttf", 18)
        title_font = ImageFont.truetype("Arial.ttf", 28)
    except OSError:
        font = ImageFont.load_default()
        title_font = font
    draw.text((pad, 22), f"Keepers · {len(keepers)} files", fill="#16181A", font=title_font)

    for i, name in enumerate(keepers):
        src = safe_pic(name)
        thumb_path = ensure_variant(src, THUMB_DIR / name, THUMB_EDGE)
        with Image.open(thumb_path) as im:
            im = im.convert("RGB")
            box_w, box_h = cell_w - 24, cell_h - 56
            scale = min(box_w / im.width, box_h / im.height)
            nw, nh = max(1, int(im.width * scale)), max(1, int(im.height * scale))
            im = im.resize((nw, nh), Image.Resampling.LANCZOS)
        col, row = i % cols, i // cols
        x = pad + col * cell_w + 12
        y = pad + 72 + row * cell_h
        ox = x + (box_w - nw) // 2
        oy = y + (box_h - nh) // 2
        sheet.paste(im, (ox, oy))
        draw.text((x, y + box_h + 8), f"{i + 1}. {name}", fill="#16181A", font=font)

    buf = BytesIO()
    sheet.save(buf, "JPEG", quality=88, optimize=True)
    return Response(
        buf.getvalue(),
        media_type="image/jpeg",
        headers={"Content-Disposition": 'attachment; filename="keepers-contact-sheet.jpg"'},
    )
