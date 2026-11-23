# FM-1 Pocket: hosting-safeguards handover

**Checked 23 November 2026.** The catalogue remains at 298 records. No firmware
approval, visibility change or release is authorised here.

## What happened and what protects publishing now

Public downloads had included packages whose hosting clearance was unresolved.
The five held packages and their five screenshots were removed separately, with
verified local backups. The watched [sync](https://github.com/slowphase/fm1-pocket-player/actions/runs/45132572134)
then passed all six jobs and deployed the website.

- [PR #32](https://github.com/slowphase/fm1-pocket-player/pull/32) checks the actual
  finished publication archives and downloadable previews before uploading.
  Its deliberate held-package insertion test must reject the archive. Uploads
  cannot follow a failed check. Existing accepted original packages are pinned
  to their exact fingerprints; the RemoteFM1FW approval gate remains.
- [PR #33](https://github.com/slowphase/fm1-pocket-player/pull/33) prevents mass
  cleanup after an outage: no deletion with an empty keep list, a package-count
  fall over 10%, or removal of over 20% of existing packages or screenshots.

The rolling store has exactly 235 accepted originals. None of Araminta, SHIFL,
Bass Something 2, Sillage or Volna, or their screenshots, remains there.
Restricted SLOOP and NOIZ DEMONS' uncleared original are absent from the live
releases and website. Of 355 stored Actions artifacts inspected, 27 unsafe older
archives were removed after verified backup; the other 328 contained no held or
uncleared packages under the current approvals. The two merged safeguard branches
were deleted; reference and parked branches were retained.

## Unfinished safety checks

**The raw-package cache is a separate gap.** Fourteen Actions caches can retain
unfiltered originals. [GitHub allows forked pull requests to read base-branch caches](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching).
The archive checks do not cover these cache uploads. Permission to purge those
caches and pause publishing is pending; the nightly is currently still scheduled.
A separately approved cache-safety fix is needed to prevent recreation.

An earliest h1 binary in Git history also carries an all-rights-reserved marker;
its pinned source has no licence file. Current h1 is MIT. No retained artifact
contains that old binary. Historical permission needs clarification; no history
was rewritten.

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
started. Before it starts: update conflicting branches without losing safeguards,
refresh the baseline, agree success criteria and startup-test limitations, keep
reports free of uncleared binaries/caches, and recheck Mac favourites/saves.
New source builds need separate scope and source/licence clearance.

## Checking 24 November's 4:23 pm Brisbane run

If publishing is paused for the cache gap, expect no publishing run until a fix
is approved. Otherwise open **Actions → Pocket sync** on Player's main branch.
Check every job, the Hub refresh/reuse message, the finished-archive results and
the explicit cleanup decision; a green tick alone is insufficient. Compare the
listed uploads/deletions with the catalogue changes, retain all original 285 IDs
and attribution/restrictions except documented upstream updates, and check the
website loads. Held packages must remain absent from releases, artifacts **and
caches**. No FM1 Editor reads, app releases or new version tags are authorised.
