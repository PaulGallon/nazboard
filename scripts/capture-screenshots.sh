#!/bin/sh

set -eu

script_directory=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd)
repository_root=$(dirname -- "$script_directory")
cd -- "$repository_root"

server_pid=""

cleanup() {
  if [ -n "$server_pid" ]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
}

trap cleanup 0
trap 'exit 1' HUP INT TERM

PORT=8080 NAZBOARD_FIXTURE_DIR=tests npm start &
server_pid=$!

attempt=1
while [ "$attempt" -le 15 ]; do
  if curl --fail --silent http://127.0.0.1:8080/healthz >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$server_pid" 2>/dev/null; then
    printf '%s\n' "Fixture server exited before becoming ready." >&2
    exit 1
  fi
  if [ "$attempt" -eq 15 ]; then
    printf '%s\n' "Fixture server did not become ready." >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 1
done

chrome=""
for candidate in google-chrome-stable google-chrome chromium chromium-browser; do
  if command -v "$candidate" >/dev/null 2>&1; then
    chrome=$candidate
    break
  fi
done

if [ -z "$chrome" ]; then
  printf '%s\n' "A Chrome or Chromium executable is required." >&2
  exit 1
fi

capture() {
  "$chrome" \
    --headless=new \
    --disable-gpu \
    --hide-scrollbars \
    --force-dark-mode \
    --disable-features=WebContentsForceDark \
    --force-device-scale-factor=1 \
    --run-all-compositor-stages-before-draw \
    --virtual-time-budget=10000 \
    --window-size=1440,400 \
    --screenshot="$1" \
    "$2"
}

capture docs/screenshot-overview.png http://127.0.0.1:8080/
capture docs/screenshot-pool.png 'http://127.0.0.1:8080/?pool=storage01'
capture docs/screenshot-dataset.png 'http://127.0.0.1:8080/?dataset=storage01%2Fbackup'
