#!/usr/bin/env bash
# The browser engine's speed: upstream's own web/bench.mjs (the page's audio schedule, its WebAssembly JIT) in
# Node's V8, for each package, with bench.py's scripted session. Node is not a browser: no AudioWorklet thread,
# no tab throttling. It measures the engine, not the page.
#   pocket/emu/wasm_bench.sh UPSTREAM_DIR PKGS_DIR OUT.json SHARD(I/N) SECONDS
set -euo pipefail
up=$1 pkgs=$2 out=$3 shard=${4:-1/1} secs=${5:-8}
script=$(python3 "$(dirname "$0")/bench.py" --print-script)
i=${shard%/*} n=${shard#*/}
ls "$pkgs"/*.fwsc | sort | awk -v i="$i" -v n="$n" 'NR % n == i % n' > /tmp/wasm-list.txt
echo "[" > "$out"; first=1
while read -r f; do
  id=$(basename "$f" .fwsc)
  if FM1_FWSC="$f" FM1_BENCH_KEYS="$script" FM1_BENCH_JSON=/tmp/wb.json timeout 300 node "$up/web/bench.mjs" 240 "$secs" > /tmp/wb.log 2>&1; then
    r=$(node -e 'const r=require("/tmp/wb.json");console.log(JSON.stringify({realtime:+r.realtime.toFixed(2),audioRealtime:+(r.audioRealtime||0).toFixed(2),steadyOver:r.steadyOver,steadyQuanta:r.steadyQuanta}))')
  else r='{"error":true}'; fi
  [ $first = 1 ] || echo "," >> "$out"; first=0
  echo "{\"id\":\"$id\",\"wasm\":$r}" >> "$out"; echo "$id $r"
done < /tmp/wasm-list.txt
echo "]" >> "$out"
