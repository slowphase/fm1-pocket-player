# Hosting safeguards only

This change does not enable automatic playback qualification, option B visibility,
FM1 Editor discovery, app releases or new tags. The wider Player #31 and Mac #13
remain unmerged. The RemoteFM1FW approval map and engine pins are unchanged.

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

The publisher remains paused until the user approves resuming it. No workflow run
that writes release assets or deploys Pages is invoked as part of the checks.
Existing rolling assets that no longer satisfy the hosting policy are pruned by
the normal guarded publisher, after successful verification. This code requires the
two existing rolling releases and cannot silently create new release tags.
