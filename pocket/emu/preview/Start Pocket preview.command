#!/bin/bash
# Serves the test build of FM-1 Pocket Player on this Mac only (http://localhost:8765/) and opens it.
cd "$(dirname "$0")/site" || exit 1
PORT=8765
echo "FM-1 Pocket Player test build: http://localhost:$PORT/"
echo "Leave this window open while you test. Close it to stop."
( sleep 2; open "http://localhost:$PORT/" ) &
exec python3 -m http.server "$PORT" --bind 127.0.0.1
