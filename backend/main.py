from __future__ import annotations

from io import BytesIO

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from PIL import Image, ImageDraw, ImageFont
from pydantic import BaseModel, Field

app = FastAPI(title="Keepers")

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


def _photo(filename: str, width: int, height: int) -> dict:
    number = int(filename.removeprefix("IMG_").removesuffix(".jpg"))
    return {
        "filename": filename,
        "number": number,
        "width": width,
        "height": height,
        "orientation": "portrait" if height > width else "landscape",
        "bytes": 0,
    }


PHOTOS = [
    _photo("IMG_0795.jpg", 4000, 6000),
    _photo("IMG_0796.jpg", 4000, 6000),
    _photo("IMG_0797.jpg", 6000, 4000),
    _photo("IMG_0801.jpg", 6000, 4000),
    _photo("IMG_0802.jpg", 4000, 6000),
    _photo("IMG_0803.jpg", 4000, 6000),
    _photo("IMG_0810.jpg", 4000, 6000),
    _photo("IMG_0811.jpg", 6000, 4000),
    _photo("IMG_0812.jpg", 6000, 4000),
]


def _build_catalog() -> dict:
    bursts: list[dict] = []
    current: list[dict] = []

    for photo in PHOTOS:
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
    photos = [
        {**photo, "burstId": burst_by_filename[photo["filename"]]}
        for photo in PHOTOS
    ]
    return {"count": len(photos), "photos": photos, "bursts": bursts}


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


CATALOG = _build_catalog()
PHOTO_BY_NAME = {photo["filename"]: photo for photo in PHOTOS}


def _default_session() -> dict:
    return SessionBody().model_dump()


def _font(size: int):
    try:
        return ImageFont.truetype("DejaVuSans.ttf", size)
    except OSError:
        return ImageFont.load_default()


def _placeholder_jpeg(name: str, edge: int) -> bytes:
    photo = PHOTO_BY_NAME.get(name)
    if not photo:
        raise HTTPException(404, "Unknown photo")

    if photo["orientation"] == "portrait":
        width, height = int(edge * 0.67), edge
    else:
        width, height = edge, int(edge * 0.67)

    image = Image.new("RGB", (width, height), "#dedbd3")
    draw = ImageDraw.Draw(image)
    draw.rectangle((18, 18, width - 18, height - 18), outline="#6f6b63", width=3)
    title_font = _font(max(18, edge // 18))
    note_font = _font(max(13, edge // 32))

    title_box = draw.textbbox((0, 0), name, font=title_font)
    title_width = title_box[2] - title_box[0]
    draw.text(
        ((width - title_width) / 2, height * 0.44),
        name,
        fill="#22211f",
        font=title_font,
    )

    note = "Vercel dummy proof"
    note_box = draw.textbbox((0, 0), note, font=note_font)
    note_width = note_box[2] - note_box[0]
    draw.text(
        ((width - note_width) / 2, height * 0.54),
        note,
        fill="#55524d",
        font=note_font,
    )

    output = BytesIO()
    image.save(output, "JPEG", quality=86, optimize=True)
    return output.getvalue()


@app.get("/api/health")
def health():
    return {"ok": True, "backend": "dummy", "storage": "none"}


@app.get("/api/catalog")
def catalog():
    return CATALOG


@app.get("/api/session")
def get_session():
    # Deliberately non-persistent until the Neon-backed session store is added.
    return _default_session()


@app.put("/api/session")
def put_session(body: SessionBody):
    if body.target not in (20, 40):
        raise HTTPException(400, "Target must be 20 or 40")
    # Echo the payload so the current frontend save contract works during the preview.
    return body.model_dump()


@app.get("/api/thumb/{name}")
def thumb(name: str):
    return Response(_placeholder_jpeg(name, 480), media_type="image/jpeg")


@app.get("/api/large/{name}")
def large(name: str):
    return Response(_placeholder_jpeg(name, 1400), media_type="image/jpeg")


@app.get("/api/original/{name}")
def original(name: str):
    return Response(_placeholder_jpeg(name, 1800), media_type="image/jpeg")


@app.get("/api/contact-sheet")
def contact_sheet():
    image = Image.new("RGB", (1200, 800), "#f4f1ea")
    draw = ImageDraw.Draw(image)
    title_font = _font(44)
    body_font = _font(26)
    draw.text(
        (70, 70),
        "Keepers · dummy contact sheet",
        fill="#16181a",
        font=title_font,
    )
    draw.text(
        (70, 150),
        "Neon persistence and Google Drive images are intentionally not wired yet.",
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
