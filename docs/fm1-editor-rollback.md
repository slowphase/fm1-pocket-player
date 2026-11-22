# FM1 Editor rollback preparation

## Approved cutover — 22 November 2026

Mac PR #12 and Player PR #19 are merged. Player PRs #17 and #18 are closed without merging; their branches and Mac's `editor-attribution` branch are preserved. The published 285-record catalogue remains byte-identical to the saved baseline.

The live `editor-directory.json` asset was refreshed into the compatibility-audit archive, verified against GitHub's SHA-256 `80c310c3ac9fe53539b3c32621bba3d66ddf088abd49410c515a324c0bcabc9a`, and then removed under explicit user approval. Its temporary prune safeguard is removed with this follow-up. Archived evidence and snapshots remain intact.

Pocket sync remains paused pending the user's approval to resume the normal Hub/RemoteFM1FW nightly. No release, tag or deployment is part of the cutover. The text below records the original preparation boundaries.

This branch reverts PR #16's combined commit `0c65ad5af99cdac17d19a7379977b241c44b08a4`, then restores its independent Phase 0 golden tests and frozen fixtures. The catalogue reads The Firmware Hub and RemoteFM1FW. Editor collection, parser, parser fixtures and active adapter documentation are removed.

PRs #17 (`catalog-phase2`) and #18 (`catalog-phase3`) remain unmerged and open during preparation. Closing them and merging this PR need separate approval. Preserve both branches and Mac's `editor-attribution` branch.

## Existing state and safeguards

- The published 285-entry catalogue is outside this change. Keep all existing IDs, fields, attribution, restrictions and package hashes.
- `89838ed133acdd7f9b46ef72bc53678c70144bdb` and its NOIZ DEMONS correction tooling are retained unchanged. That tooling uses the pre-existing `pocket/emu/catalog.py`, existing release state and standard Python libraries; it does not call the Editor adapter. Do not run its publishing workflow as part of rollback.
- Preserve all compatibility-audit reports and evidence. A dated copy of the live `editor-directory.json` belongs in the external `compatibility-audit-2026-11-22` archive, with its source, time and hash.
- The separately approved live-asset cleanup is complete. `STATE_ASSETS` contains only the original Hub/RemoteFM1FW pipeline state; no Editor snapshot collection or safeguard remains.

## Later merge session — not authorised by preparing this branch

1. Obtain approval before pausing Pocket sync or merging either rollback PR. Check for publishing runs already in flight.
2. Keep the pause brief: merge the approved PRs, confirm the catalogue is unchanged, and ask to resume the normal two-source nightly in that same session. Resume only after approval.
3. Deleting the stored Editor release asset is a separate, explicitly approved action. Refresh its archive immediately before deletion; never delete a newer snapshot that has not been archived and checked.
4. Close PRs #18 and #17 without merging or deleting branches only when authorised.

Preparation must not deploy Pages, create/update a public release, upload catalogue/package state, change publication switches or disable scheduled jobs. Normal pull-request test artifacts are not production deployments.
