# The emulator engine: integration

FM-1 Pocket Player and FM-1 Pocket for macOS can play a firmware two ways:

- its **.rfm1 build** (RemoteFM1FW), on the existing engine (`src/rfm1.js` on the web, the wasm3 host on the Mac), as
  today; and
- its maker's **original .fwsc package**, unchanged, on the emulator engine: upstream
  [fm1-emu](https://github.com/joakimeriksson/fm1-emu) by Joakim Eriksson (MIT; the emulator's licence, which never
  applies to the firmware).

The .rfm1 engine, its catalogue entries (`catalog.json`, untouched) and its saved states stay fully supported. Nothing
retires it. The evaluation that led here is in `docs/EMULATOR-EVALUATION.md`.

Status: integrated on branch `emu-eval` (Pocket PR #7) and `emu-prototype` (Mac PR #8), **not merged, not published**.
Publishing is behind the repository variable `POCKET_PUBLISH_EMU` (unset).

## How a firmware gets its emulator engine

1. **Packages** (`pocket/emu/packages.mjs`, nightly `emu` job). For each firmware on The Firmware Hub's list (Pocket's
   saved copy; the Hub is still read at most once a day), the package is fetched from the **maker's own GitHub
   release**, never from the Hub, and kept only if its SHA-256 matches the Hub's list. Incremental: a package already
   fetched with the same SHA-256 is not fetched again.
2. **Measurements** (`pocket/emu/ledger.py`, `emu-compat.json`). Each package is run in a scripted session (keys,
   MIDI, PLAY) on Linux and in the browser engine (`emu` job), and on macOS Apple Silicon (`emu-macos` job), with the
   pinned engine. Results are keyed by package SHA-256 and engine commit, so a package is measured again only when it
   or the pin changes. The first run starts from the evaluation's measurements (same commit, same packages).
3. **Hosting.** Pocket hosts a copy only if the firmware's licence passes the same open-licence check as the .rfm1
   builds and `pocket/policy.json` does not exclude it. The 20 excluded firmwares' reasons apply to their packages
   too. Hosted copies live in the rolling release `pocket-packages` and on the site under `data/pkg/<id>-<sha8>.fwsc`,
   byte-identical to the maker's asset, each with a link to the maker's source at that release. The web player needs
   them because browsers cannot read GitHub release downloads (no CORS). The Mac app never uses them: it downloads from
   the maker.
4. **The catalogue** (`pocket/emu/catalog.py`). Each `catalog-v2.json` entry gets an additive `emu` block:
   - `package`: the maker's `url`, `sha256`, `size`, `version`, `license`, `source`, and `file` (Pocket's copy) only
     where Pocket may host it; `excluded` when policy forbids distribution;
   - `web`, `mac`: `state` (playable, experimental, unsupported, unavailable), `reason`, and `tested`: the automated
     run (engine commit, machine, speed, where sound came from, package SHA-256, `kind: "automated boot check"`);
   - `listened`: real listening tests from `pocket/emu/listening.json`, recorded by hand, never mixed with `tested`;
   - `preferred`: per player, `fm1-emu` or `rfm1`, with the reason.
   `catalog.json` and every existing field stay as they are; v1 and Phase A clients see no change.

## Which engine plays a firmware

Per firmware and per player, the best-performing compatible engine:

- both engines fully playable: the **original package** (the maker's own, fingerprint-checked firmware, running with
  real-time headroom);
- only one fully playable: that one (for example Hortator, MNM-1 and OBS Synth on the Mac, where the .rfm1 build runs
  below real time and the package at 3 to 4.5x);
- both only experimental: the one with more measured headroom;
- only one available at all: that one.

The listener can override it wherever both run: a quiet "use the …" link under the firmware's preview on the web
(kept in this browser), an Engine menu in the details pane on the Mac (`UserData/engines.json`). Choosing the
recommended engine again clears the override. Each engine keeps its own saved state (web: `fm1-emu:<id>:<sha16>`
beside the .rfm1 save; Mac: `fm1-emu+<version>@<sha12>`), so switching never touches the other's.

## Automated checks versus listening tests

Everything the pipeline records is an **automated boot check**: a scripted session, measured by code, nobody
listening. It is labelled that way in the catalogue (`tested.kind`) and in both apps. Listening tests are recorded by
hand in `pocket/emu/listening.json` (firmware, engine and commit or app build, package SHA-256, machine, who, date,
verdict, notes) and appear separately as `emu.listened`. None are recorded yet.

## Upgrading the emulator

Pocket pins fm1-emu in `pocket/emu/upstream.json`; the Mac app pins it in `Emu/Cargo.toml`. They move independently.

1. Run **Pocket emulator upgrade check** (Actions, "Run workflow") with the candidate commit, or open a PR changing
   `upstream.json`. It runs every package in the pinned and the candidate engine side by side (Linux, macOS Apple
   Silicon, browser engine) and fails on any regression: a stop, a window that goes silent, a speed drop of more than
   15% to below 1.2x, a browser-engine failure (`pocket/emu/compare.py`). Known, reviewed differences can be accepted
   per commit in `pocket/emu/accepted.json`.
2. Listen to a few firmwares on the candidate; record them in `listening.json`.
3. Add the commit to `pocket/emu/verified.json`, then move the pin. The nightly re-measures every package with the new
   pin. The Mac build warns while its pin is not in that list.

## Known silent firmwares

Some packages are silent in the scripted session for a known reason; `policy.json`'s `emuNotes` keeps them
experimental with that reason instead of counting a failure. Examples: SIDJ (below), Beetle and Beetle Blue (trackers:
nothing plays until a song is written), LSDJ Burrito (needs a song sent over USB), DubBox and Audio Router (process
incoming audio), MIDI Monitor (shows MIDI, makes no sound), Vibe Link (upstream holds it back).

### SIDJ

The original package (1.5.1, `sidj-1.5.1.fwsc`, SHA-256 `4df5d3f1…`) boots correctly in the emulator at about 3x real
time, but its screen says *NO SONGS YET. ADD THEM AT thomasj.github.io/fm1-sidj IN CHROME OR EDGE, THE FM-1 ON USB*.
The package ships without tunes: they are sent to the device over USB (WebUSB) from the maker's page. Neither player
can do that, so it stays silent, which is the firmware working as designed, not an emulator fault. The .rfm1 build
(1.5.1) carries songs of its own and plays after PLAY, so SIDJ's preferred engine is the .rfm1 build in both apps. A
way to load songs into the emulated flash would need either a song-upload feature in the players or a package with
bundled tunes from the maker; neither is planned.

## Numbers (test build of 20 November 2026)

- 251 original packages found and fingerprint-checked; 232 hostable by Pocket; 21 Hub firmwares are released off
  GitHub (the apps cannot fetch them automatically; a user can open them from disk).
- Firmwares either engine can play: web 244 (95 today), Mac 245 (92 today).
- Preferred engine: web 223 emulator / 21 .rfm1; Mac 228 emulator / 17 .rfm1.
- Web test build: 12 of 12 automated page checks passed in Chromium (`pocket/emu/web-integration.mjs`). Site size with
  packages: about 207 MB (GitHub Pages allows 1 GB).
