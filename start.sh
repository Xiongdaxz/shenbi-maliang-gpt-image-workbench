#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PORT="${PORT:-8787}"
HOST="${HOST:-0.0.0.0}"
LOCAL_BUN="$ROOT/runtime/bun/bun"
BUN_CMD="${BUN_CMD:-bun}"

echo
echo "========================================"
echo " GPT Image Workbench start / update"
echo "========================================"
echo " Project: $ROOT"
echo " Host:    $HOST"
echo " Port:    $PORT"
echo

if [[ -x "$LOCAL_BUN" ]]; then
  BUN_CMD="$LOCAL_BUN"
  echo "Using bundled Bun: $LOCAL_BUN"
  echo
elif ! command -v "$BUN_CMD" >/dev/null 2>&1; then
  echo "[WARN] Bun was not found."
  echo "This machine needs Bun before the project can start."
  echo
  if [[ -t 0 ]]; then
    read -r -p "Install Bun now? [y/N] " answer
    case "$answer" in
      y|Y|yes|YES)
        echo
        echo "Installing Bun..."
        curl -fsSL https://bun.sh/install | bash
        export PATH="$HOME/.bun/bin:$PATH"
        ;;
      *)
        echo
        echo "Install Bun manually, then run this script again:"
        echo "curl -fsSL https://bun.sh/install | bash"
        exit 1
        ;;
    esac
  else
    echo "Install Bun manually, then run this script again:"
    echo "curl -fsSL https://bun.sh/install | bash"
    exit 1
  fi
fi

if ! command -v "$BUN_CMD" >/dev/null 2>&1; then
  echo
  echo "[ERROR] Bun is still unavailable in this shell."
  echo "Close this terminal, reopen it, and run this script again."
  exit 1
fi

echo "[1/4] Installing dependencies..."
if ! "$BUN_CMD" install --frozen-lockfile; then
  if [[ -d "node_modules" ]]; then
    echo
    echo "[WARN] Dependency install failed, but node_modules exists."
    echo "Continuing with existing node_modules."
  else
    echo
    echo "[ERROR] Dependency install failed."
    echo "If package.json and bun.lock were changed intentionally, run:"
    echo "bun install"
    exit 1
  fi
fi

echo
echo "[2/4] Building frontend..."
"$BUN_CMD" run build

echo
echo "[3/4] Stopping old process on port $PORT..."
if command -v lsof >/dev/null 2>&1; then
  pids="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  for pid in $pids; do
    if [[ -n "$pid" ]]; then
      echo "Stopping PID $pid"
      kill "$pid" 2>/dev/null || true
    fi
  done
elif command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
else
  echo "[WARN] Could not find lsof or fuser. If startup fails, check whether the port is occupied."
fi

echo
echo "[4/4] Starting server..."
if [[ "$HOST" == "0.0.0.0" ]]; then
  echo "Main app:      http://127.0.0.1:$PORT"
  echo "Config app:    http://127.0.0.1:$PORT/config"
  echo "Health check:  http://127.0.0.1:$PORT/api/health"
  echo "LAN app:       http://YOUR-LAN-IP:$PORT"
else
  echo "Main app:      http://$HOST:$PORT"
  echo "Config app:    http://$HOST:$PORT/config"
  echo "Health check:  http://$HOST:$PORT/api/health"
fi
echo
echo "Keep this terminal open while the service is running."
echo "Press Ctrl+C to stop."
echo

exec "$BUN_CMD" server/index.ts
