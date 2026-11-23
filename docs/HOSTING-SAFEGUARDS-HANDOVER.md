# FM-1 Pocket: hosting-safeguards handover

**Checked 23 November 2026.** The catalogue remains at 298 records. No firmware
approval, visibility change or release is authorised here.

## What happened and what protects publishing now

Uncleared packages had reached public downloads. The five held packages and
their screenshots were removed with verified backups. The watched [sync](https://github.com/slowphase/fm1-pocket-player/actions/runs/45132572134)
then passed all six jobs and deployed the website.

- [PR #32](https://github.com/slowphase/fm1-pocket-player/pull/32) checks finished publication archives and
  previews before upload. A test deliberately inserts a held package and expects
  rejection; failed checks block upload. Accepted originals stay pinned to their
  exact fingerprints. The RemoteFM1FW approval gate remains.
- [PR #33](https://github.com/slowphase/fm1-pocket-player/pull/33) prevents mass
  cleanup after an outage: no deletion with an empty keep list, a package-count
  fall over 10%, or removal of over 20% of existing packages or screenshots.

The store has 235 accepted originals: no Araminta, SHIFL, Bass Something 2,
Sillage, Volna or their screenshots. Restricted SLOOP and NOIZ DEMONS' uncleared
original are absent from live releases and the website. All 355 stored Actions
artifacts were inspected: 27 unsafe archives were backed up and removed; the
remaining 328 passed. Both merged safeguard branches were deleted; reference
and parked branches remain.

## Unfinished safety checks

**The raw-package cache is a separate gap.** Fourteen Actions caches can retain
unfiltered originals. [GitHub allows forked pull requests to read base-branch caches](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching).
These uploads bypass archive checks. Cache purge/publishing pause awaits
approval; the nightly is still scheduled. A separately approved fix must prevent
recreation.

An old h1 binary in Git history has an all-rights-reserved marker and no licence
file at its source revision. Current h1 is MIT. No retained artifact contains
that old binary; historical permission needs clarification. No history was rewritten.

## Decisions still pending

Neither listing is approved. Their existing files and included notices were
inspected without execution.

| Firmware | Description and licence |
|---|---|
| [A22](https://github.com/abektes/a22) | A synth/drum workstation with sequencers and effects. Main code: MIT; MPL-2.0 components, openly licensed fonts and CC0 drums. |
| [CHORDISM](https://github.com/charlesvestal/fm1-chordism) | One key plays a chord, with arpeggiator and effects. MPL-2.0, with an MIT sound engine and other included component/font notices. |

I recommend approving their existing `.rfm1` routes subject to normal
file/playback checks and source/notices requirements. Approval would allow
Pocket hosting; until then both remain link-only. This does not approve mirroring
the original `.fwsc` packages.

Player [#31](https://github.com/slowphase/fm1-pocket-player/pull/31), Mac
[#13](https://github.com/slowphase/fm1-pocket-mac/pull/13) and draft Player
[#6](https://github.com/slowphase/fm1-pocket-player/pull/6) are parked, unmerged,
with comments. A **separately approved seven-night report-only trial** has not
started. First: resolve conflicts while preserving safeguards, refresh the baseline,
agree success criteria and startup-test limitations, prevent binary/cache leaks,
and recheck Mac favourites/saves. New builds need separate scope and clearance.

## Checking 24 November's 4:23 pm Brisbane run

If paused for the cache gap, expect no publishing until a fix is approved.
Otherwise open **Actions → Pocket sync** on Player main. Check every job, the
Hub refresh/reuse message, archive checks and cleanup decision; green alone is
insufficient. Review uploads/deletions and upstream changes; preserve the original
285 IDs and attribution/restrictions, and check the website loads. Held packages
must be absent from releases, artifacts **and caches**. No FM1 Editor reads, app
releases or new version tags are authorised.
