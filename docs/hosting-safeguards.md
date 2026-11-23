# Hosting safeguards only

This change does not enable automatic playback qualification, option B visibility,
FM1 Editor discovery, app releases or new tags. The wider Player #31 and Mac #13
remain unmerged. The RemoteFM1FW approval gate and engine pins remain in place.

## Holds and accepted bytes

Araminta and SHIFL remain unavailable for automatic maker downloads and Pocket
hosting. Bass Something 2, Sillage and Volna retain their hosting holds; the existing
Mac direct-maker download route is not blocked for those three. SLOOP's existing
restriction is unchanged. Holds are recorded with permanent IDs/aliases, repositories,
known package fingerprints and references to the archived compatibility evidence.

The original-package hosting list records the exact 235 packages already accepted
for web delivery. It grants no rights to new versions. Until the wider qualification
policy is approved, uncleared originals receive no hosted copy. Already accepted
versions remain pinned when a new original awaits clearance, preserving working
downloads. Ordinary Hub metadata and approved RemoteFM1FW updates continue through
their existing rules. The accepted package list is not a new exhaustive legal audit;
all existing restrictions and the five audit holds override it.

Identical original bytes may belong to distinct permanent IDs (Argo/Felucca 8).
Both names and file paths are preserved. No catalogue records are deleted by the
hosting guard. The historical 285-record golden tests are unchanged and still pass.

## Finished archives, not just staging filters

`hosting_guard.py` inspects the actual completed ZIP or TAR. It checks every firmware
payload against its identity and fingerprint, rejects unknown original bytes,
checks the existing RFM1 approval/validated-catalogue binding, and recognises the
built-in h1 only by its exact repository bytes. Holds override accepted hashes.
Nested archives, path traversal, links, renamed binaries and incomplete site
catalogue references are checked too. Reports/metadata are not hosting grants.

The publisher checks its completed site ZIP, extracts only verified bytes, and
checks the actual final Pages TAR. The current/package rolling-release updates
are also built as ZIPs and verified; uploads read only their verified extraction.
No firmware-bearing upload can run without a successful guard result.

The PR emulator preview checks its finished `pocket-preview.zip`. Packaging and
upload no longer use `always()`: failed playback/build/guard steps cannot upload a
firmware preview. Failure diagnostics may still upload JSON and test screenshots.

`test_hosting_guard.py` deliberately inserts a held package *after* staging, checks
rejection, and proves the subsequent fake upload command does not execute. It also
checks the real workflow conditions, unknown bytes, renamed identity/fingerprints,
nested archives, Pages TARs, missing files, identical-package IDs and last-accepted
selection. Restricted upstream binaries are not committed as test fixtures.

The last accepted originals and their already-published screenshots are restored
by fingerprint into a local store when needed. The pipeline never attaches a new
version's screenshot to a retained older package fingerprint.

## Operational boundary

The normal publisher is scheduled; close-out checks do not dispatch a sync or
write release assets or deploy Pages.
Existing rolling assets that no longer satisfy the hosting policy are pruned by
the normal guarded publisher, after successful verification. This code requires the
two existing rolling releases and cannot silently create new release tags.

## Bounded rolling cleanup

Cleanup snapshots the current release assets before uploading. Missing/empty keep
directories, an expected package-count drop greater than 10%, or removal of more
than 20% of existing packages or existing screenshots produces an empty deletion
list and a visible warning. New filenames cannot hide a mass replacement. Only
the guard's explicit deletion list is consumed; metadata is never pruned. The
plan and successful uploads/deletions are recorded in the run summary. Tests
cover outages, short lists, threshold boundaries, renamed replacements, screenshot
loss and ordinary small cleanups.

`POCKET_SCHEDULE_PAUSED=true` suppresses scheduled/push syncs while allowing a
watched manual dispatch; downstream jobs cannot publish after a skipped sync.
This supports verifying a manual run before restoring the normal schedule.

## Final cache boundary and approvals

The user approved A22 (MIT) and CHORDISM (MPL-2.0) for the ordinary RemoteFM1FW
RFM1 route only, after the existing checks. No original hosting grant was added.
The parked qualification/visibility/source-build PRs remain unmerged.

All firmware cache saves/restores are removed. Only validated hub-catalog.json,
compat.json and native-macos.json enter a new metadata-only cache namespace. A
fresh staging directory receives only the validated bytes, and its successful
guard output is mandatory before saving. Legacy raw cache prefixes are not
restored. Tests inject held/uncleared files, archives, temporary candidates and
raw firmware disguised as JSON; the finished cache contains only metadata.
The fourteen raw-package caches were purged after the user explicitly waived
one missing ARTIHIVE 2.0.5 backup. Contributor workflow approvals are set to all
external contributors in both repositories.
