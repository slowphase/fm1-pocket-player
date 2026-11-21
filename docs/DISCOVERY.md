# Discovery

FM-1 Pocket is a firmware discovery and auditioning tool. Both players (web and Mac) find firmware the same way,
from data Pocket already has: no analytics, no telemetry, no new service.

## Sorting

- **Latest release** (the default): newest release first. A firmware whose release date is unknown goes after every
  dated one, never first.
- **A–Z** by name. The Mac also keeps Author and Category.
- A search puts the best name matches first, whatever the sort.

## Dates

- **Released** is the firmware's latest release as its maker published it: The Firmware Hub's `published` for each
  firmware on its list, or for the few it does not list, the maker's GitHub release of the version Pocket has
  (`pocket/releases.mjs`). Never a catalogue refresh, package rebuild or commit date. If a version has no release,
  the date is unknown and says so. When the build a player runs is older than the latest release, both versions
  are shown.
- **New to Library** means first listed in the last 14 days: the day The Firmware Hub added it, or for firmware it
  does not list, the day Pocket first saw it. A new release of an old firmware is not new to the library.
- In `catalog-v2.json` these are each entry's `release` {version, date, source[, url]} and `listed` (additive;
  `catalog.json` and existing fields are untouched).

An old release date says nothing about whether a firmware is maintained or good: nothing is ever labelled abandoned
or inactive.

## Not done (deliberately)

- **Filtering by release age** (last 3 months, last 12 months): deferred. Every release in the catalogue is from
  October or November 2026, so it would change nothing yet.
- **Popularity.** The Hub's list has an `installs` field (247 of 273 firmwares), but the Hub's documentation of its
  list does not mention or define it, and it appears to count only installs through the Hub's own installer
  (firmware installed elsewhere has none). Not used unless its meaning is confirmed. GitHub stars measure interest
  in code, not use, and are not used either. No page of the Hub is ever read for metrics.

## Confidence

Compatibility confidence (listened to, automated checks only, known issue) stays off the cards: it is in each
firmware's details (Mac) and preview (web), and the Mac footer tallies it. Cards carry only the existing short tags.

## Pictures

Every firmware has a picture in both players:

- an **.rfm1 build's screen**, from Pocket's own boot test (as before);
- else, for a firmware whose original package Pocket may host, **its screen as the emulator showed it**: the busiest
  frame before its keys are played in the nightly's scripted session (`pocket/emu/bench.py --shots`), kept in the
  `pocket-packages` release as `shot-<hub>-<sha8>.png` and published as `data/shots/<hub>-emu-<sha8>.png`
  (`imageKind: "emulator screen"` in `catalog-v2.json`);
- else a **name tile**: the firmware's name and maker on a steady colour of its own, drawn by the app (no file).
  Firmware Pocket may not host (closed licences, excluded by policy, or released off GitHub) gets the tile.

No picture is ever copied from The Firmware Hub (its rule: copy no card texts or pictures).

## The Mac details pane

The main pane is for choosing and playing firmware: description, Maker, Version, Released, one Compatibility line
("Plays · automated checks only", "Plays · listened to in FM-1 Pocket", "May not work fully · …" or "Known issue: …"),
the Engine selector where both engines run it, and Source; with Play, Stop and Favourite. Everything else (category,
licence, size, download, engine details, the automated checks and where they ran, the listening tests) is under a
collapsed "Technical details". The Hub credit stays visible. Nothing says a firmware was tested on the user's own Mac:
automated checks run on GitHub's test machines, and listening tests name a role and a machine class (`Pocket
maintainer`, `Apple Silicon Mac`).
