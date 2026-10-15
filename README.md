# Keepers

A local browser app for cutting a photographer’s proof set down to the files you actually want. Sit together, pick the best frame in each burst, trim the wall to 20 or 40, then copy an email with exact filenames and thumbnails.

Photos never leave the machine. The GitHub repo is the app; your proofs stay in `pics/` on disk.

## Run it

You need Python 3.11+ and Node 20+.

```bash
git clone https://github.com/haschdl/pics-selector.git
cd pics-selector
# drop the proof JPEGs into pics/
./start.sh
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The script creates a venv, installs dependencies, then starts a FastAPI backend on port 8765 and the Vite UI on 5173.

Put the proofs in `pics/` as `IMG_0795.jpg`-style filenames (Canon/Sony numbering). Subfolders are not scanned.

## How you work through a shoot

**Strip** — one camera burst at a time. A film strip along the bottom, a large preview above. Keep up to two frames per pose, or skip the pose.

| Key | Action |
| --- | --- |
| `←` `→` | Previous / next frame in the burst |
| `Shift` + `←` `→` | Previous / next pose |
| `K` or `Enter` | Keep / unpin this frame |
| `X` | Skip this pose |
| `N` | Next pose |

**Shortlist** — every pinned frame on one wall. Toggle a target of 20 or 40. Click a print to cut it; click again to bring it back. The email page stays closed while you are over the target.

**Email** — a paste-ready letter. Edit the greeting and sign-off, then:

- **Copy for email** — HTML with thumbnails (works in Gmail if the client keeps images)
- **Copy as text** — greeting, numbered filenames, sign-off
- **Copy filenames** — one name per line
- **Download contact sheet** — a single JPEG of the keepers

Progress is written to `data/session.json`. Close the laptop and pick up later.

## How “poses” are detected

There is no vision model. A pose is a run of consecutive camera file numbers: `IMG_0912.jpg`, `IMG_0913.jpg`, `IMG_0914.jpg` is one burst. A gap in the numbering starts a new pose. That matches how a photographer holds the shutter on one moment, then moves.

## Stack

- **Frontend** — Vite + React
- **Backend** — FastAPI. Scans `pics/`, builds a thumbnail cache in `.cache/`, serves originals, saves the session
- **Start** — `./start.sh`

## What is not in git

`pics/` is gitignored on purpose: proof JPEGs are personal and this repository is public. Also ignored: `.venv/`, `node_modules/`, `.cache/`, and `data/` (your ranking session).
