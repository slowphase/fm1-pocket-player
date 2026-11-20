# Evaluation: fm1-emu as the engine for both players

Evaluation only. Nothing here is published, merged or deployed. Drafts: this PR (slowphase/fm1-pocket-player#7,
coverage, benchmarks, web prototype, pipeline prototype) and slowphase/fm1-pocket-mac#8 (Mac prototype).

**Snapshot:** The Firmware Hub catalogue read 2026-11-20T06:05:37Z (273 firmwares; Pocket's saved copy, not
re-read); makers' releases read 2026-11-20T09:16Z; catalog-v2.json of 2026-11-20T07:47Z; upstream
joakimeriksson/fm1-emu at **09aeae3e9d78db52c3b9f5ceed93bd1120ccf444** (MIT), used unchanged. Per-firmware results:
`docs/emu-evaluation-results.json`. Benchmark run: Actions run 44708980456.

## What upstream is (verified from its repository)

- An emulator of the FM-1's chip (JieLi AC791N, two pi32v2 cores) with models of its timers, flash, screen, key
  matrix, encoders, MASTER, audio and MIDI UART. It runs an author's ordinary update package (`.fwsc`) unchanged,
  M-VAVE's stock firmware included, and the SMK-37 board.
- A browser engine (`crates/fm1-web`, WebAssembly, with a JIT to WebAssembly; `web/` is its page with an
  AudioWorklet, flash saves and `.fm1save` backups), a native player (`fm1-live`, JIT to AArch64 and x86-64 on
  macOS, Linux and Windows), a DAW plugin (AU, VST3, CLAP) and a batch runner. All MIT; the crates used here pull in
  no third-party crates.
- Its catalogue (`web/firmwares.json`): 203 entries, 198 of them Hub firmwares, plus 2 Hub firmwares held back with
  reasons (VIBE FM Link crashes; LSDJ Burrito needs a song sent over USB). The other 73 Hub firmwares are not in it:
  its page lists them last, "not yet run here".
- What upstream calls tested: `tools/catalog_check.py` plays each catalogue firmware for 8 s with a script and fails
  on a JIT/interpreter difference, a short run, or an audio hash that moved (`tests/catalog.json`: 202 hashed, all
  but M-VAVE's bring-your-own). That is a regression check of the emulator, not a statement that a firmware is
  audible or usable.

## 1. Coverage

| | Count |
| --- | --- |
| Hub firmwares | 273 |
| Original package found in the maker's GitHub release, SHA-256 equal to the Hub's | **252** (130 under another file name than the Hub's) |
| Maker release not on GitHub (a site of their own): fetch rule per host, or local import | 21 |
| Upstream lists as running / holds back / does not list | 198 / 2 / 73 |
| Of the 252, played the scripted session with sound (all three machines alike) | **230** |
| Ran the whole session silent | 22 |
| Stopped (the emulated FM-1 halted) | 0 |

The 22 silent ones are mostly silent by design or need something the script does not do: audio-input routers
(DUB-BOX, FM1 Audio Router), MIDI tools (MIDIMON, Fernbedienung, Beiwagen, tether), trackers that need a song
(BEETLE, BEETLE BLUE, LSDJ Burrito), and firmwares already documented as silent in Pocket's own checks
(Berlinan, Etch, Modelar, Pigeon). **SIDJ** plays in the `.rfm1` engine but was silent here: it needs a closer look.
VIBE FM Link ran without halting, though upstream reports a crash screen after boot.

**Against Pocket's catalogue:**

| Group | Total | On the Hub | Package found | Upstream lists |
| --- | --- | --- | --- | --- |
| Downloadable (.rfm1) | 95 | 88 | 83 (5 makers not on GitHub) | 66 |
| Source-only | 184 | 184 | 168 (16 not on GitHub) | 132 (2 held back) |
| Unsupported (not FM-1) | 2 | 0 | 0 | 0 |

Seven of the 95 have no Hub entry and so no package (Aurora, Dubwise, James OS, Modular Koi, SLOOP3, Speak37,
Viscera). **Version differences:** of the 88 on the Hub, the Hub's package is the same version as our `.rfm1` for
58 and a different one for 30 (RemoteFM1FW and the Hub update on their own schedules).

**Restrictions:** 20 firmwares are excluded from Pocket's hosting by `pocket/policy.json` (RemoteFM1FW's † marks,
material their licences do not let anyone freely redistribute) and 2 are not FM-1 firmware. Those reasons hold
whatever the format, so Pocket would not serve their packages either. 18 of them have a package in the maker's
release, which the Mac app can fetch from the maker at the user's request.

**Per-player coverage** (`pocket/emu/annotate.py`; playable = sound in the session, or a documented silence, at 1.2x
real time or more on that player's measuring machine):

| | Web | Mac (Apple Silicon) |
| --- | --- | --- |
| Playable with the `.rfm1` engine today | 95 | 92 |
| Playable with the emulator | 196 | 221 (206 that Pocket would publish) |
| Playable with both | 74 | 75 |
| Playable with either | **217** | **238** (223 publishable) |
| Only with the emulator | 122 | 146 |
| Only with the `.rfm1` engine | 21 | 17 |

The 21 web firmwares playable only as `.rfm1`: 7 with no Hub package, 5 whose maker hosts the package outside
GitHub (Carnacos, HYP-1, JIANT, Tonitor, Vector37), SIDJ (silent above), and 8 that ran below 1.2x real time (DUELL,
Matryoshka and Rupture in the native engine; Melodee, Penumbra, MONO2K, CSFM1 and Hadal-1 in the browser engine).

## 2. Playback

**Boot checks** (nobody listening): every package in upstream's own native player (`fm1-live --bench`, headless)
for 20 s of emulated time with a scripted session: a chord at 2 s, single keys, MIDI notes on the MIDI IN jack, PLAY,
two encoders and HOME, PLAY again (`pocket/emu/bench.py`); and every package in upstream's browser engine in Node's V8
(`web/bench.mjs`, the page's audio schedule).

| Machine | CPU | Median speed | Below 1.0x | Below 1.2x | Packages with audio drop-outs |
| --- | --- | --- | --- | --- | --- |
| Linux x86-64 (GitHub runners) | AMD EPYC 7763 / 9V74, Intel Xeon 6975P-C; 4 vCPUs | 2.84x | 2 | 9 | 2 |
| macOS Apple Silicon (GitHub runner) | Apple M1 (Virtual), 3 vCPUs | 2.99x | 5 | 12 | 2 (FiMba 7, FM Larynx 22 half-buffers) |
| macOS Intel (GitHub runner) | Core i7-8700B, 4 cores | 1.55x | **40** | **67** | 2 |
| Browser engine (V8 in Node 22, Linux) | as Linux | 2.25x | 10 | 25 | n/a |

Shared CI machines vary from run to run; a recent Apple Silicon Mac is faster than the virtual M1.

**Against the `.rfm1` engine** (the same Linux runner type, the 83 firmwares both can run): `.rfm1` median 4.7x,
emulator 2.65x. The emulator is slower for light firmwares and much faster for heavy ones, so it is far more even:

| Firmware | `.rfm1` Linux | Emulator Linux | `.rfm1` macOS (individual) | Emulator macOS Apple Silicon | Emulator macOS Intel | Browser engine |
| --- | --- | --- | --- | --- | --- | --- |
| Hortator | 0.6x | 2.94x | 0.9x | 3.99x | 2.05x | 2.84x |
| MNM-1 | 0.6x | 2.16x | 0.9x | 3.19x | 1.34x | 1.71x |
| OBS Synth | 0.6x | 2.92x | 1.0x | 4.46x | 1.43x | 3.01x |
| Fizz | 1.6x | 1.75x | 2.5x | **1.41x** | 0.95x | 1.46x |
| Morse (light) | 91.7x | 2.3x | | 2.91x | 1.11x | 1.65x |

(`.rfm1` macOS: the latest nightly's individual macOS run. Speeds from different jobs on shared machines.) Fizz is
the counter-example: slower in the emulator on Apple Silicon than as an `.rfm1`.

Hortator, MNM-1 and OBS Synth, the three that "may stutter" on the Mac today, all play at 3x or more on Apple
Silicon in the emulator, and Hortator and MNM-1 sound after PLAY (they are silent until set up in Pocket's own
check).

**Interactive verification** (CI, not by ear):
- Web prototype in Chromium 159 headless (Pocket's own page, `src/emu-core.js`): 13 of 15 original packages booted,
  drew, sounded from keys, MIDI or PLAY, and kept a save across a reload; BEETLE (tracker, no song) and ChoralRoot
  were silent there. ChoralRoot is a slow starter: in the same engine it plays once given about 8 s of emulated time,
  and that test pressed keys after 3 s; the tests now wait 8 s. After them, the built-in `.rfm1` still ran on the
  existing engine.
- Mac prototype (`EmuCore`, upstream's engine linked into the app): Swift tests on Apple Silicon boot Felucca, draw,
  sound a key and keep a save across a reboot; `--selftest-fwsc` runs 25 original packages inside the packaged app
  (results in fm1-pocket-mac#8's run summary).

**Still needs Dean's Mac** (nothing above listened):
- whether it sounds right (against the `.rfm1` and, where possible, a real FM-1), and whether keys, knobs and buttons
  feel right, with latency, in the Mac app's emulator mode and on upstream's page;
- a MIDI keyboard through the emulated MIDI IN jack;
- saves made with each firmware's own SAVE command, surviving a relaunch;
- 10 minutes or more of a heavy firmware (FM-1 Dock, B3 Organ, Hortator) for drop-outs, CPU and battery;
- upstream's own page in Safari and Chrome on the Mac (https://joakimeriksson.github.io/fm1-emu/), and its
  `fm1-live` release.

## 3. The prototypes

**Web** (`src/emu-core.js`, `pocket/emu/build-web.sh`): upstream's `fm1_web.wasm` (built by its own `web/build.sh`)
and `web/jit.js`, unchanged, behind the same interface as `src/rfm1.js`'s Core. The page opens an `.fwsc` from the file
picker and runs it in the same panel; an `.rfm1` still runs on `src/rfm1.js`. Saves: upstream's sector records under
`fm1-emu:ID:SHA16`, never an `.rfm1` save's key. Gaps: Pocket's page runs the engine on the main thread
(ScriptProcessor) where upstream uses an AudioWorklet; live labels, knob values and accent colours come from the
`.rfm1` extensions and are absent.

**Mac** (fm1-pocket-mac#8): `Emu/` builds upstream's `crates/fm1-web` at the pinned commit, unchanged, as a universal
static library (its C functions, native JIT); `EmuCore` behind a `PlayerEngine` protocol that `FirmwareCore` also
adopts, so the SwiftUI faceplate is unchanged. **Firmware > Open Firmware Package (.fwsc)…**. Saves keyed
`fm1-emu+VERSION@SHA12`. Upstream keeps one machine per process: one emulator at a time (fine for one player window).
Key velocity goes through upstream's own input script (its C API has no other velocity call: a small upstream change).

## 4. A simpler pipeline

What changes, in the existing nightly (`pocket-sync.yml`), with no per-firmware builds:

1. **Discover**: unchanged: the Hub's saved copy (read at most once a day, attribution kept) and RemoteFM1FW.
2. **Fetch** (`pocket/emu/packages.mjs`): for each Hub firmware, the maker's release through the GitHub API; the file
   whose SHA-256 is the Hub's (the Hub's rule: from the makers, never from the Hub, sha256 matching). Cached in
   `pocket-current` like today's `.rfm1` builds; fetched again only when the Hub's sha256 changes.
3. **Host where allowed**: the web player cannot fetch a maker's GitHub asset (no CORS on the redirect), so Pocket
   serves its verified copy only where it would publish the firmware anyway (an open licence, not excluded by
   `policy.json`): 232 of the 251. The Mac app fetches from the maker directly. Everything else: local import.
4. **Test** (`pocket/emu/bench.py`, `wasm_bench.sh`): new or changed packages, and all of them when the upstream pin
   moves, on Linux, macOS Apple Silicon and the browser engine; results kept in the compatibility ledger by package
   SHA-256 and engine commit, as today.
5. **Publish** (`pocket/emu/annotate.py`): an additive `emu` block per catalog-v2.json entry (package, whether Pocket
   hosts it, per-player state, measured speed, machine, engine commit, package SHA-256). v2 clients that do not know it
   ignore it; `catalog.json` (v1) and released clients are untouched.

**Hardware the emulator or the apps do not provide:** an audio input (USB or Bluetooth audio in: the routers and
samplers that record), USB host and device (LSDJ Burrito's song transfer, USB-MIDI to a computer; `fm1-live --usb`
has it natively, the apps do not expose it), Bluetooth MIDI and Bluetooth audio, WiFi, the SD card, the newer flash
chip some firmwares know (upstream can model it; the apps use the stock one), M-VAVE's DX7 bank (bring a `.syx`).

## 5. Recommendation

The evidence supports **making the emulator the primary engine on the web and on Apple Silicon Macs, with the
`.rfm1` engine kept as a fallback**, not a full replacement yet, and not a Mac-wide switch.

- **Coverage:** playable firmware roughly doubles: web 95 to 217 (either engine), Mac 92 to 238 (223 that Pocket
  would publish), with no per-firmware build or glue.
- **Performance:** on Apple Silicon and the web it is even and sufficient for nearly everything (median about 3x;
  12 of 252 below 1.2x on the virtual M1), and it rescues the three heavy firmwares that stutter today. On **Intel
  Macs** it regresses badly (median 1.55x, 40 below real time): there the `.rfm1` engine should stay first where a
  build exists. The app ships for Apple Silicon only today; the engine itself builds for both.
- **Integration effort:** both prototypes reuse upstream unchanged and were small (one adapter per app). A full
  migration still needs: the web engine on an AudioWorklet (as upstream does), catalogue integration in both apps
  (download, cache, offline, per-entry engine choice), the emulator in the macOS nightly ledger, and parity work for
  the `.rfm1` extras (live labels, knob values).
- **Licence obligations:** fm1-emu is MIT: keep its notice in the app (THIRD-PARTY-NOTICES.md) and the site
  (`emu/LICENSE-fm1-emu.txt`). Hosted packages carry the same obligations as today's `.rfm1` files (GPL: the source,
  the Hub gives each package's source at its tag and a source mirror). The Hub's attribution and fetch limits stay
  as they are.
- **Maintenance:** one pinned upstream commit for both players instead of RemoteFM1FW's per-firmware builds; each pin
  bump re-runs the package benchmarks (upstream runs its own audio-hash checks too). Risk: one upstream, one person;
  MIT and the pin keep a working copy whatever happens.

**Staged plan, if approved:**
1. Ship the emulator beside `.rfm1` behind a setting (both apps), playing only firmwares with no `.rfm1`; v1 and
   released apps untouched.
2. Publish the `emu` block in catalog-v2.json and host the 232 publishable packages; the Mac fetches from makers.
3. For firmwares both engines play, prefer the emulator where it measures well (Apple Silicon, web), keep `.rfm1`
   first on Intel Macs and where the emulator is silent or slow; users can switch per firmware. Saves stay per
   engine: nothing is converted or claimed compatible.
4. After a release cycle with no regressions, retire per-firmware `.rfm1` work for firmwares the emulator covers.

**What could eventually be retired:** RemoteFM1FW's per-firmware `.rfm1` builds and Pocket's `.rfm1` sync and smoke
for covered firmwares, the native `.rfm1` checks on Linux and macOS, Phase B's fm1-base builds and FM1VST glue (not
needed), and in time the wasm3 host and `src/rfm1.js`. Keep them while any firmware is playable only as `.rfm1`
(21 on the web, 17 on the Mac today) and while Intel Macs depend on them.
