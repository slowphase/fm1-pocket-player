# Phase B: more firmware builds

Snapshot: The Firmware Hub catalogue read 2026-11-20T06:05:37Z (273 firmwares), catalog-v2.json of 2026-11-20T07:47:07Z.
At that snapshot, **164** Hub firmwares have no browser build anywhere Pocket looks (162 with no build, 2 not open
source). This file covers what can be built for them, and how.

Nothing here is published. Builds run in `.github/workflows/pocket-fm1base.yml` and are attached to its run as an
artifact. Adding any of them to the catalogue needs a separate approval (an entry in `pocket/policy.json`, and a
decision on where the files are hosted).

## 1. fm1-base firmware, built with the authors' own supported tool

fm1-base (charlesvestal/fm1-base, MPL-2.0) has a supported `.rfm1` build: `tools/build.py APP --rfm1`, with
Emscripten 6.0.10 as fm1-base's own release template pins it. 23 of the 164 firmwares use fm1-base: 7 vendor it, 16
link it as a git submodule.

`pocket/fm1base-builds.json` lists 20 of them, each at its author's release tag and commit. Where the author's own
release CI already makes an `.rfm1` (MOSS-1, PaperLagoon, Polly), the workflow takes the author's file from their
release instead of building one. The other 3 are left out, with reasons:

| Left out | Why |
| --- | --- |
| BLOP (OSR-Experiment/OSR-1) | its fm1-base (4587fda) predates `--rfm1`: the author would need to update fm1-base |
| delrio (jsopdebeeck/fm1-delrio) | its fm1-base (67a2ced) predates `--rfm1`: the same |
| playa (juan-ms2lab/playa) | its own Makefile around a forked fm1-base with SSH-only submodules: not the plain supported build |

Results (run 44704999537):

| Firmware | Tag | Source | Result | Web | Native engine (Linux) |
| --- | --- | --- | --- | --- | --- |
| Plissken | v0.14 | built here | passed | pass | pass 11.1x |
| SQ-80 | v0.14.0 | built here | passed | pass | pass 23.9x |
| XENOLITH | v1.0 | built here | passed | pass | pass 5.8x |
| ZENITH-1 | v1.0 | built here | passed | pass | pass 4.6x |
| CHOPPAH | v1.4.1 | built here | passed | pass | pass 17.2x |
| DEEP FIELD | 1.11 | built here | passed | pass | pass 3.2x |
| FM1 YOGA | v1.0 | built here | passed | pass | pass 6.5x |
| JAMTRACK | v0.2.3 | built here | passed | pass | pass 11x |
| METRONOME | v0.3 | built here | passed | pass | pass 96.3x |
| Tack | v0.15.0 | built here | passed | pass | pass 6.8x |
| MOSS-1 | v1.0 | author's release | passed | pass | pass 3.2x |
| PaperLagoon | v1.1 | author's release | passed | pass | pass 8.5x |
| Polly | v0.6.4 | author's release | passed | pass | pass 34.5x |
| VNL-1 | v0.9.2 | built here | passed (file named after its manifest id, vnl_1) | pass | pass 3.1x |
| DUB-BOX | v1.0.9 | built here | silent | no sound | no sound |
| FM1 Audio Router | v0.6.1 | built here | silent | no sound | no sound |
| FM-FAM | v0.3.1 | - | did not build | | |
| keySTEP ONE | v0.5.42 | - | did not build | | |
| MIDIMON | v0.5 | - | did not build | | |
| PING OS-1 | v1.0.0 | - | did not build | | |

None of these has been run on macOS yet. The Mac's verification would come from the nightly macOS job once a build
is published.

- **DUB-BOX and FM1 Audio Router** process audio coming in over USB or Bluetooth. Neither player has an audio
  input, so they are silent by design here. They draw and respond. They would be unsupported in both players
  rather than given a smoke exception.
- **The four that did not build** fail inside the firmware's own source at its release tag, each because the app
  uses a newer fm1-base than the one it ships with: FM-FAM calls Bluetooth-audio functions (`plat_bta_*`) its
  fm1-base's host platform does not define; keySTEP ONE calls `plat_usb_host_diag`; MIDIMON uses the tap API
  (`NTAPS`, `plat_tap_drops`); PING OS-1's fm1-base fork passes a device-only compiler flag
  (`-pi32v2-large-program`) into the host build. Fixing any of them means changing the author's code or fm1-base,
  so they are left for the authors.

### Upstream contribution, prepared (not submitted)

For an fm1-base app whose release workflow builds only the device package, the reusable change is fm1-base's own
template step, unchanged: install Emscripten 6.0.10 at emsdk commit a2b9277, then `./build.sh --rfm1 --release
"$version"` and attach `app/build/NAME-VERSION.rfm1` to the release (fm1-base `template/.github/workflows/release.yml`,
the lines after "Emscripten for the .rfm1"). With that in an author's workflow, their own releases carry the `.rfm1`,
which RemoteFM1FW's author sync (docs/AUTHOR-RFM1.md there) and Pocket can take as published. This would apply to the
10 apps above that Pocket built itself. Opening those pull requests on authors' repositories waits for approval.

## 2. Firmware families whose existing glue might be reused

The other 141 firmwares build only as device packages (M-VAVE's FM1 Open SDK, Felucca, Dinghy, SLOOP and their
forks). An `.rfm1` for them needs per-firmware glue in FM1VST (Quixotic7/FM1VST, GPL-3.0): an `fm1_add_core` glue
file and one `fm1_add_rfm1` line, which is how RemoteFM1FW's 87 FM1VST builds were made.

**Evidence of effort**, from FM1VST's own glue (main branch, commit 177e27a): once a family's glue exists, each further
firmware in it took a small per-firmware file set (`core_<id>.c`, `.cmake`, `_desc.c`, plus conformance and golden
tests). Measured in lines:

| Glue family | Shared family glue | Its original's own files | Each further firmware's own files |
| --- | --- | --- | --- |
| felucca_web (Felucca and forks with `web/emu/felucca_web.c`) | 3,031 | Felucca 666 | 35 to 86 (8 forks) |
| sloop | 1,718 | SLOOP 35 | 33 to 55 (3 forks) |
| dinghy | 1,696 | OberVave 173 | 107 to 230 (3 forks) |
| plat (X0X, FoMni and forks) | 2,157 | X0X 388 | 136 to 153 (3 forks) |
| choralroot | 2,592 | ChoralRoot 1,529 | 74 to 113 (2 forks) |
| fm1base (for apps without `--rfm1`) | 1,075 | AMB-1 275 | 401 (LOOM-8) |
| tonitor | 1,243 | Tonitor 211 | none yet |

(All glue also shares core-glue/common, 1,565 lines.)

FM1VST's plan (CORES-PLAN.md section 2) also shows the cost of drift: a fork that changed its HAL struct or moved
its engines broke the family glue at the next version. So each firmware needs its own check, not just a copy.

**The 141, by the family their source matches** (from file markers in each repository and the Hub's own `base`
field; not compiled). The full list is in `docs/phase-b-glue-candidates.json`.

| Family | With a host build upstream | Without | Estimate each | Estimate total |
| --- | --- | --- | --- | --- |
| felucca_web | 26 | 3 | 2 to 4 hours | 60 to 120 hours |
| sloop | 22 | 0 | 2 to 4 hours | 45 to 90 hours |
| dinghy | 31 | 4 | 4 to 8 hours | 140 to 280 hours |
| plat | 18 | 0 | 4 to 6 hours | 70 to 110 hours |
| choralroot | 2 | 0 | 3 to 6 hours | 6 to 12 hours |
| tonitor | 2 | 0 | 4 to 8 hours | 8 to 16 hours |
| no matching glue (own code) | 16 | 15 | 1 to 3 days with a host build; 3+ days without | 40 to 100+ days |

Estimates are for writing and testing the glue for one release of one firmware, by someone familiar with FM1VST,
and assume the fork has not drifted from its family. Three already have glue in FM1VST's main branch and are the
cheapest of all (one `fm1_add_rfm1` line and a build): Frodhes and FM-106 (dinghy; FM1VST's plan notes FM-106's
KR-106 port provenance is unchecked) and sloopDX (sloop).

**A different route.** FM1VST also bundles `fm1emu` (Joakim Eriksson's fm1-emu, MIT): an emulator of the FM-1's
chip that runs a firmware's ordinary update package (`.fwsc`) unchanged, as RemoteFM1 does in its web engine. It would
cover all 141 (and the stock firmware) at once with no per-firmware glue, but it is a third engine for both players
(a WebAssembly build for the web player, a Rust library for the Mac), it runs the device code instruction by
instruction (much slower than a host build), and the packages would be fetched from each author's release, as the
Hub's terms ask. That is a scope decision of its own.

## Decisions needed

1. Whether to publish any of the 13 fm1-base builds that passed (policy approval each, and hosting: a Pocket release
   or RemoteFM1FW).
2. Whether to offer the template change (section 1) to the authors as pull requests.
3. Which glue families, if any, to port, or whether to evaluate the emulator route instead.
