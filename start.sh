#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -q -r backend/requirements.txt

if [[ ! -d frontend/node_modules ]]; then
  (cd frontend && npm install --cache "$ROOT/.npm-cache")
fi

cleanup() {
  kill "${API_PID:-}" "${UI_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

python -m uvicorn backend.main:app --host 127.0.0.1 --port 8765 &
API_PID=$!

(cd frontend && npm run dev -- --host 127.0.0.1 --port 5173) &
UI_PID=$!

echo
echo "Keepers is starting."
echo "Open  http://127.0.0.1:5173"
echo

wait
