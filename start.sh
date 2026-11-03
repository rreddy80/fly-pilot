#!/bin/sh
# Serves Fly Pilot at http://localhost:8765 (the brain data must be loaded over http, not file://).
cd "$(dirname "$0")"
PORT="${PORT:-8765}"
echo "Fly Pilot → http://localhost:$PORT"
( sleep 1; open "http://localhost:$PORT" 2>/dev/null ) &
exec python3 -m http.server "$PORT"
