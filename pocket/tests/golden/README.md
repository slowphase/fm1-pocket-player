# Golden catalogue baseline

The catalogue that the nightly of 21 Nov 2026 published (285 firmwares), kept as a regression baseline: the pipeline
must keep producing exactly this from exactly these inputs. Any change to an existing entry fails
`pocket/tests/golden.test.mjs` (discovery, `pocket/discover.mjs`) or the golden test in `pocket/emu/test_catalog.py`
(the emulator layer, `pocket/emu/catalog.py`).

| File | What |
| --- | --- |
| `discover-inputs.json.gz` | every input of `discover.mjs`'s `build()` that night: catalog.json, compat.json, the Hub copy, RemoteFM1FW's table and cards (its README and catalog at commit 3da321a, the one the nightly read), the review report, GitHub release dates, the previous `listed` dates, and the clock |
| `discover-expected.json.gz` | what `build()` makes of them; identical, entry for entry and field for field, to the production catalog-v2.json of that night before the emulator layer (checked when the baseline was recorded) |
| `emu-inputs.json.gz` | the emulator layer's inputs that night: packages.json and emu-compat.json from pocket-packages |
| `emu-expected.json.gz` | what `catalog.py` adds to `discover-expected` with those inputs, run without a package store (so no package is "hosted": the web player's emulator states read "unavailable"; everything else is as published) |

New sources must leave every existing entry exactly as it is here. They may only add entries, or add fields the
baseline does not have. The tests enforce both.

If a change to existing entries is intended (a deliberate fix), regenerate the expected files with
`node pocket/tests/golden/regenerate.mjs`, and explain the difference in the pull request.
