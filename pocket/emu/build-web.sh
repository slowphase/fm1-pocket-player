#!/usr/bin/env bash
# Evaluation: puts upstream fm1-emu's browser engine into a built site, unchanged: its crates/fm1-web as
# OUT/emu/fm1_web.wasm (built with upstream's own web/build.sh) and its web/jit.js. src/emu-core.js loads them.
#   pocket/emu/build-web.sh UPSTREAM_CHECKOUT OUT_SITE_DIR
set -euo pipefail
up=$1 out=$2
tmp=$(mktemp -d)
bash "$up/web/build.sh" "$tmp" > /dev/null
mkdir -p "$out/emu"
cp "$tmp/fm1_web.wasm" "$up/web/jit.js" "$out/emu/"
cp "$up/LICENSE" "$out/emu/LICENSE-fm1-emu.txt"
ls -la "$out/emu"
