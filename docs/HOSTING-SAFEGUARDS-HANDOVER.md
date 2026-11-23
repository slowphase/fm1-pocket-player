# FM-1 Pocket: hosting-safeguards handover

**Final decisions: 23 November 2026.** The next normal sync is scheduled for
**24 November, 4:23 pm Brisbane**. No extra sync, app build, release, version tag
or deployment was authorised for this close-out.

## What happened and what is protected

Uncleared packages had reached public downloads. The five held packages and
screenshots were removed with verified backups. The last watched
[sync](https://github.com/slowphase/fm1-pocket-player/actions/runs/45132572134)
passed all six jobs and deployed the website.

- [PR #32](https://github.com/slowphase/fm1-pocket-player/pull/32) checks finished
  publication archives and previews before upload. A test inserts a held package
  and must reject it; failed checks block uploads. Accepted originals stay pinned
  to their exact fingerprints. The RemoteFM1FW approval gate remains.
- [PR #33](https://github.com/slowphase/fm1-pocket-player/pull/33) prevents mass
  cleanup: no deletion with an empty keep list, a package-count fall over 10%, or
  removal of over 20% of existing packages or screenshots.
- This close-out removes raw firmware caching altogether. Only three validated
  JSON information files may enter the new Actions cache; firmware, screenshots,
  archives and temporary candidate builds cannot. Restore uses a new cache name,
  so it cannot fall back to the old binary caches. Tests inject held/uncleared
  files and disguise firmware as metadata; none reaches a cache save.

All fourteen raw-package caches were purged. Verified private backups are kept;
the user explicitly waived the one missing ARTIHIVE 2.0.5 backup, retaining its
accepted older version. Both repositories now require workflow approval for
**all external contributors**, including first-time contributors.

The rolling store has 235 accepted originals: no Araminta, SHIFL, Bass Something 2,
Sillage, Volna or their screenshots. Restricted SLOOP and NOIZ DEMONS' uncleared
original are absent from live releases and the website. The artifact audit
inspected 355 archives and removed 27 unsafe copies after backup; retained
artifacts and later diagnostic outputs passed. The merged safeguard branches
were deleted; reference and parked branches remain.

## Decisions now settled

**A22 and CHORDISM are approved for their existing `.rfm1` builds**, the format
Pocket already supports. Both passed file, browser and native-engine smoke
checks. Tomorrow's normal sync will repeat its usual checks before hosting.
No original `.fwsc` mirrors are approved; the original-package acceptance list
is unchanged.

| Firmware | What it is and its licences |
|---|---|
| [A22](https://github.com/abektes/a22) 0.1.0 | A synth/drum workstation with sequencers and effects. Main code MIT; MPL-2.0 components, openly licensed fonts and CC0 drums. |
| [CHORDISM](https://github.com/charlesvestal/fm1-chordism) 0.9 | One key plays a chord, with arpeggiator and effects. MPL-2.0, with an MIT sound engine and other included component/font notices. |

**h1 is closed:** code MIT, recordings CC0, confirmed against its
[licence](https://github.com/jakehandy/h1/blob/main/LICENSE) and
[sample notices](https://github.com/jakehandy/h1/blob/main/docs/SAMPLES.md).
Hosted builds include the full MIT notice. Old Git metadata does not change the
author's licence; Git distributions also include Jake Handy's MIT notice.
No history was rewritten.

**No seven-night trial now.** Player [#31](https://github.com/slowphase/fm1-pocket-player/pull/31),
Mac [#13](https://github.com/slowphase/fm1-pocket-mac/pull/13) and draft Player
[#6](https://github.com/slowphase/fm1-pocket-player/pull/6) remain parked and
unmerged. Existing comments record the prerequisites for any separately approved
trial. No automatic qualification or visibility change is enabled.

## Checking tomorrow's run

Open **Actions → Pocket sync** on Player main. Check every job, the Hub
refresh/reuse message, archive checks, metadata-cache guard and cleanup decision.
Review the explicit uploads/deletions and upstream updates; preserve the original
285 IDs and attribution/restrictions. The two approved builds must pass before
appearing as playable. Confirm the website loads and held packages remain absent
from releases, artifacts and caches. No FM1 Editor reads, app releases or version
tags are authorised. No further work is planned unless the nightly fails.
