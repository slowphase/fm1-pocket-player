# Catalogue v2 and the firmware audit

FM-1 Pocket publishes two catalogues side by side under `https://slowphase.github.io/fm1-pocket-player/data/`:

| File | Schema | Who reads it | What it lists |
| --- | --- | --- | --- |
| `catalog.json` | 1 | every client, including released Mac builds up to 19 | only firmware that may be downloaded and played. Unchanged by v2: same schema, same eligibility rules (`policy.json`, smoke test). Its builds keep updating normally. |
| `catalog-v2.json` | 2 | the web picker and the Mac app from Phase A on (each falls back to `catalog.json`) | everything discovered, with each player's status |

Old clients download every entry in `catalog.json`, so anything that must not be downloaded lives only in v2.

## Snapshot this audit is tied to

Counts below are from the catalogue published **2026-11-19T08:40:52Z** (`catalog.json` sha256 `bb1d822f…b0b6`),
RemoteFM1FW at commit `3da321a`, and the radar's last Hub reading of **2026-11-19T10:30Z**. The nightly job prints
fresh counts every run (job summary, and `counts` inside `catalog-v2.json`).

| | Count |
| --- | --- |
| Firmware **discovered** (RemoteFM1FW + The Firmware Hub, deduplicated by identity) | 118 from RemoteFM1FW alone; about 278 once the Hub's 269 are merged (160 Hub entries have no RemoteFM1FW match) (exact only after the first nightly v2 run) |
| Firmware with an **available build** (`.rfm1`) | 115 in RemoteFM1FW (plus h1, built in) |
| Builds Pocket may redistribute, **downloadable** | 95 (= `catalog.json`) |
| **Tested** in the web runtime | 95: 87 pass, 8 pass with a documented exception |
| **Tested** in the Mac's native engine (on Linux) | 95: 87 pass, 8 with an exception, same firmware as the web |
| **Tested** on macOS | none at this snapshot; see the latest nightly summary for current counts |

Why the other firmware are not downloadable (RemoteFM1FW side): 20 are restricted (licence does not allow
redistribution, or no licence), 2 are not FM-1 firmware. On the Hub side, about 158 firmware have no browser build
at all and 2 are not open source. Coverage is limited by missing builds, not by licensing, review or tests.

## Per-player statuses

- **playable**: a build exists, Pocket may redistribute it, and it passed this player's checks.
- **experimental**: downloadable, but not confirmed: either macOS has not verified the current engine version, or
  the build ran slower than real time in the native engine and may stutter.
- **unsupported**: not FM-1 firmware, or failed this player's checks.
- **source-only**: no build Pocket may supply. Shown with the reason and a link to its source; never downloaded.
  "Manual import" is not used until a player has a working import interface.

For the Mac, `status.mac.verification` says how the status was established, and the Mac app shows it in the
details pane:

| `verification` | Meaning |
| --- | --- |
| `macos` | this exact build (same sha256) was run individually on macOS in the Mac app's engine |
| `representative` | passed the Mac app's engine on Linux; not run on macOS itself, but the representative sample passed on macOS with the same engine version |
| `linux` | the Mac app's engine on Linux only; macOS has not verified this engine version |

`status.mac.performance` is `may-stutter` when the build ran below 1.2x real time (measured on macOS when the build
was run there, otherwise on Linux). Those builds stay experimental and the Mac app tags them MAY STUTTER. A
playable Mac status needs a passing Linux run, a verified engine version, and no stutter risk.

The macOS job runs the representative set plus every build that ran below 2x real time on Linux, so slow and
borderline builds are always timed on macOS itself. A macOS result only counts for the exact build it ran.

Every status carries the test behind it: build sha256, runtime id, environment, date and outcome.

## Where the pieces are

- `pocket/hub.mjs`: reads The Firmware Hub's `catalog.json` at most once a day, with an identifying User-Agent, and
  keeps a cached copy (`hub-catalog.json` in the `pocket-current` release). Only the nightly sync calls it; the
  radar and pull-request checks read the cached copy. A failed or empty read keeps the old copy.
- `pocket/compat.mjs`: the compatibility ledger (`compat.json`). Re-tests a build only when its sha256 or the
  runtime changes. Web: `src/rfm1.js` in Node. Native: the Mac app's C engine (`Tests/ctest/native_smoke` at the
  commit pinned in `pocket/native.json`), built and run **on Linux x64**; the environment is recorded with every
  result. The `native-macos` job then runs the representative set, plus every build under 2x real time on Linux, on
  macOS 15 (Apple Silicon); native results become playable only once the representative set passes for the same
  engine commit. Its results are used by the next night's v2.
- `pocket/discover.mjs`: builds `catalog-v2.json`. Its downloadable entries must equal `catalog.json`'s fields
  exactly, and nothing else may be downloadable; the build fails otherwise.
- Publishing v2 is switched off until the repository variable `POCKET_PUBLISH_V2` is `true`. Until then the nightly
  builds it and attaches it to the run as an artifact only.

## The Firmware Hub's terms

The compilation is CC BY 4.0. Both players show "Firmware list: The Firmware Hub – thefirmwarehub.com" linked to the
Hub, with the licence linked, whenever v2 used the Hub's list, and say what was changed (merged with RemoteFM1FW,
statuses added). Makers' own texts and pictures are not covered by that licence, so v2 copies none of them from the
Hub: it names the makers and links their repositories. Packages are never downloaded from the Hub.

## Known issue left alone

`pocket/sync.mjs`'s `normaliseCategory("Drums")` returns "Other" (the plural is stripped before comparing). v1 is
left as it is so its contents do not change in this work; v2 maps Hub categories itself.
