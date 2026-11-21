#!/usr/bin/env python3
"""Runs each original package in upstream fm1-emu's native player (fm1-live --bench, headless) with a scripted
session like Pocket's own boot test, and measures it. A boot check, not interactive verification: nobody listens.

    python3 pocket/emu/bench.py --live PATH/fm1-live --pkgs DIR --out results.json [--ms 20000] [--shots DIR] [id ...]

With --shots, each firmware's screen is kept as DIR/<id>.png (240x240): the busiest frame before its keys are
played (the first 2 s), else the busiest before PLAY (9 s). Pocket shows it where a firmware has no other picture.

The session (emulated time): a chord at 2 s, eight single keys from 3.3 s, MIDI notes C3 C4 C5 from 6.5 s,
PLAY at 9 s, two encoders and HOME at 14-15 s, PLAY again at 19 s. Sound is measured in each window, so a
firmware that only sounds after PLAY is told apart from one that answers keys. Speed is fm1-live's own
(emulated time / wall time), "starved" its count of audio halves the firmware did not refill in time.
"""
import hashlib, json, math, os, platform, struct, subprocess, sys, tempfile

args = sys.argv[1:]
def opt(k, d=None):
    if k in args:
        i = args.index(k); v = args[i + 1]; del args[i:i + 2]; return v
    return d
LIVE, PKGS, OUT, MS = opt("--live"), opt("--pkgs"), opt("--out"), int(opt("--ms", "20000"))
SHARD = opt("--shard")
SHOTS = opt("--shots")                                      # I/N: every Nth firmware from the Ith

KEYS = [7, 11, 14, 12, 19, 9, 16, 7]                       # pocket/smoke.mjs's keys (0 = F, the leftmost)
SCRIPT = ",".join(["2000:n7@110", "2000:n11@110", "2000:n14@110", "3000:n7^", "3000:n11^", "3000:n14^"]
    + [f"{3300 + i * 350}:n{k}@115" for i, k in enumerate(KEYS)] + [f"{3550 + i * 350}:n{k}^" for i, k in enumerate(KEYS)]
    + ["6500:m90306e", "6900:m803000", "7000:m903c6e", "7400:m803c00", "7500:m90486e", "7900:m804800",
       "9000:PLAY", "9100:PLAY^", "14000:e0:+3", "14200:e1:+2", "15000:HOME", "15100:HOME^", "19000:PLAY", "19100:PLAY^"])
WIN = {"idle": (1.0, 2.0), "keys": (2.0, 6.3), "midi": (6.5, 8.9), "play": (9.2, 19.0)}
SILENT = 0.0002                                             # pocket/smoke.mjs's threshold

if "--print-script" in args:
    print(SCRIPT); sys.exit(0)

def windows(raw):
    d = open(raw, "rb").read(); n = len(d) // 2; a = struct.unpack(f"<{n}h", d[:n * 2]); out = {}
    for k, (t0, t1) in WIN.items():
        seg = a[int(t0 * 88200):int(t1 * 88200)]
        out[k] = round(math.sqrt(sum(x * x for x in seg) / len(seg)) / 32768, 4) if seg else None
    return out, len(a) / 88200

def lcd_changes(frames_dir):
    """how many distinct screens the session showed (the LCD only, one frame every 500 ms)"""
    seen = set()
    for f in sorted(os.listdir(frames_dir)):
        seen.add(hashlib.sha1(open(os.path.join(frames_dir, f), "rb").read()).hexdigest())
    return len(seen)

def read_ppm(path):
    d = open(path, "rb").read()
    parts = d.split(maxsplit=4)                               # P6 W H MAX DATA
    w, h = int(parts[1]), int(parts[2])
    return w, h, parts[4][-w * h * 3:]

# upstream's panel film draws the 240x240 LCD at 2x with its top left at (370, 42) (crates/fm1-live/src/panel.rs)
LCD_X, LCD_Y = 370, 42

def lcd(w, rgb):
    """the LCD out of a panel frame, at its own 240x240"""
    out = bytearray()
    for y in range(240):
        row = (LCD_Y + 2 * y) * w
        for x in range(240):
            o = (row + LCD_X + 2 * x) * 3
            out += rgb[o:o + 3]
    return bytes(out)

def busy(rgb):
    """how much is on the screen: pixels that differ from its most common colour"""
    px = [rgb[i:i + 3] for i in range(0, len(rgb), 3)]
    common = max(set(px[::7]), key=px[::7].count)
    return sum(1 for p in px if p != common)

def png(path, w, h, rgb):
    import zlib
    raw = b"".join(b"\x00" + rgb[y * w * 3:(y + 1) * w * 3] for y in range(h))
    def chunk(t, data): return struct.pack(">I", len(data)) + t + data + struct.pack(">I", zlib.crc32(t + data) & 0xffffffff)
    open(path, "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                           + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))

def shot(frames_dir, out):
    """the busiest frame before the keys (frames every 500 ms: 0 .. 2 s), else before PLAY (9 s); None if all blank"""
    files = sorted(f for f in os.listdir(frames_dir) if f.endswith(".ppm"))
    best = None
    for limit in (5, 19):
        for f in files[:limit]:
            w, h, rgb = read_ppm(os.path.join(frames_dir, f))
            if w < LCD_X + 480 or h < LCD_Y + 480: return False
            rgb = lcd(w, rgb); w = h = 240
            b = busy(rgb)
            if b >= w * h * 0.02 and (best is None or b > best[0]): best = (b, w, h, rgb)
        if best: break
    if not best: return False
    png(out, best[1], best[2], best[3])
    return True

def cpu():
    try:
        if platform.system() == "Darwin":
            return subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"], capture_output=True, text=True).stdout.strip()
        for l in open("/proc/cpuinfo"):
            if l.startswith("model name"): return l.split(":", 1)[1].strip()
    except Exception: pass
    return platform.processor()

ids = args or sorted(f[:-5] for f in os.listdir(PKGS) if f.endswith(".fwsc"))
if SHARD:
    i, n = map(int, SHARD.split("/")); ids = ids[i - 1::n]
host = {"system": platform.system(), "machine": platform.machine(), "cpu": cpu(), "cpus": os.cpu_count(),
        "runner": os.environ.get("RUNNER_NAME"), "image": os.environ.get("ImageOS"), "fm1live": LIVE}
res = []
for id in ids:
    pkg = os.path.join(PKGS, f"{id}.fwsc")
    t = tempfile.mkdtemp()
    env = dict(os.environ, FM1_BENCH_KEYS=SCRIPT, FM1_BENCH_JSON=f"{t}/b.json", FM1_BENCH_WAV=f"{t}/a.raw",
               FM1_BENCH_FRAMES=f"{t}/frames,500")
    row = {"id": id, "sha256": hashlib.sha256(open(pkg, "rb").read()).hexdigest()}
    try:
        r = subprocess.run([LIVE, "--fwsc", pkg, "--bench", str(MS), "--lcd-only"], env=env, capture_output=True, text=True, timeout=600)
        row["exit"] = r.returncode
        b = json.load(open(f"{t}/b.json"))
        row.update(speed=round(b["realtime"], 2), steady=round(b.get("steadyRealtime") or 0, 2), starved=b.get("starvedHalves"))
        row["rms"], secs = windows(f"{t}/a.raw")
        row["audioSeconds"] = round(secs, 2)
        row["screens"] = lcd_changes(f"{t}/frames") if os.path.isdir(f"{t}/frames") else None
        if SHOTS and os.path.isdir(f"{t}/frames"):
            os.makedirs(SHOTS, exist_ok=True)
            row["shot"] = shot(f"{t}/frames", os.path.join(SHOTS, f"{id}.png"))
        log = (r.stdout + r.stderr).lower()
        # fm1-live exits 1 (with "halt:" and no JSON) when the emulated FM-1 stops; a shorter audio stream on its own
        # is a firmware that started or paused its audio late, not a stop
        row["stopped"] = r.returncode != 0 or "halt:" in log
        loud = {k: v for k, v in row["rms"].items() if v and v > SILENT}
        row["soundFrom"] = [k for k in WIN if k in loud]
        row["outcome"] = ("stopped" if row["stopped"] else "silent" if not loud else "sounds") + ("" if (row["screens"] or 0) > 1 else ", screen did not change")
    except Exception as e:
        row["outcome"] = "error"; row["error"] = str(e)[:300]
    res.append(row)
    print(f"{id:16} {row.get('outcome'):32} {row.get('speed', 0):5}x starved={row.get('starved')} from={row.get('soundFrom')} screens={row.get('screens')}", flush=True)
json.dump({"host": host, "script": SCRIPT, "ms": MS, "firmwares": res}, open(OUT, "w"), indent=1)
