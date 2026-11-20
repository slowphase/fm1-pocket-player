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
