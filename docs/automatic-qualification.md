# Automatic qualification — report-only preparation

Prepared under the user's approval of option B, the retained RemoteFM1FW gate,
the five audit safeguards and NOIZ DEMONS requalification. This is not approval
to enable production changes, merge, publish, deploy, tag or release an app.

## What the policy does

Only The Firmware Hub and RemoteFM1FW supply catalogue information. No FM1 Editor
adapter, snapshot collection or discovery request is introduced.

The complete internal catalogue and permanent IDs remain intact. Each platform
shows a firmware only if at least one available engine qualifies. Experimental,
unknown, unavailable, restricted and unresolved known-issue routes do not qualify.
A passing alternative remains selectable; a saved preference cannot select a
hidden engine. Built-in firmware and user imports are outside catalogue filtering.
Hiding is a view decision, not deletion or withdrawal: favourites, downloaded
files, registry records, saves and attribution are preserved.

Qualification requires accepted provenance, a recognised permitted-use licence,
no applicable restriction/hold, exact package fingerprint, matching test evidence,
and a working delivery route. Original packages must still appear in an active
maker GitHub release, with source available at its tag. Downloaded bytes must
match the Hub fingerprint. Source commit, repository identity and release identity
are recorded; no upstream build scripts or source programs are executed.

The existing engine pin and speed threshold are retained. These are existing
automated startup/sound/speed checks, not a newly implemented settled-startup
musical-response test or a guarantee of every instrument feature. Historical silence
waivers remain recorded but do not qualify an unverified musical response. RUPTURE's
existing display-only waiver is retained only when its exact raw test confirms sound,
a drawn screen and no halt. The runner checks that this is still the existing production
allowance; it cannot create a new waiver. The report names the resulting differences.

RemoteFM1FW approval remains required for the same permanent ID and licence.
`pocket/policy.json`, its approved map and its review workflow are unchanged.
New IDs or changed licences cannot bypass that gate. The report job creates no
approval/review issues and applies no approvals.

An update that fails qualification does not replace a last-good route that still
has valid permission, matching tests and an available delivery. Its old fingerprint,
package and test status travel together in the proposal. A pulled release,
unavailable source or overriding permission restriction prevents that fallback.

## One-off audit safeguards

The machine-readable registry is `pocket/qualification-policy.json`. It records
project IDs/aliases, GitHub repository names and stable numeric repository IDs,
reasons and archive references. SHIFL also has its known package fingerprint.
These identifiers prevent a version change or rename from silently clearing a hold.

| Project | Mac | Web | Reason |
| --- | --- | --- | --- |
| Araminta | Hold | Hold | Selected binary/replacement-material permission remains unresolved. |
| SHIFL | Hold | Hold | Reserved compiled icon atlas remains unresolved. |
| Bass Something 2 | May qualify | Hosting hold | Chart licence/version/attribution and exact source mapping remain unresolved. |
| Sillage | May qualify | Delivery hold | Content question cleared; complete corresponding-source/notices delivery first. |
| Volna | May qualify | Delivery hold | Reserved signet removal checked; complete corresponding-source/notices delivery first. |

SLOOP's existing exclusion remains effective. The nightly consults the registry;
it does not repeat the full compatibility audit or request routine human decisions.
Uncertain cases remain hidden. Clearing a recorded hold requires recorded evidence;
a recognised licence label or a later version alone cannot clear it.

## Web delivery

`pocket/qualification-deliveries.json` freezes the exact previously accepted hosted
packages and their paths/fingerprints. This is continuity of existing delivery,
not a fresh full legal audit or permission for different binaries. Audit holds
always override it. The report re-downloads these existing files to verify bytes.

No newly discovered/new-version web package is authorised merely because its licence
label or browser playback passes. New hosting needs a separate exact-package clearance
covering redistribution, component notices and accessible corresponding source where
required, plus working supported browser delivery. This preparation grants none.
Mac direct-maker delivery does not grant Pocket hosting permission. No mirror,
proxy, hosting service, engine or new port is introduced.

Downloadable web test artifacts must respect the same boundary. The existing emulator
preview workflow filters its local package manifest before execution, screenshots or
packaging and uses a temporary web-preview policy. It cannot include the five held
projects or original-package fingerprints absent from the accepted delivery list.
This does not alter the production policy or the Mac-only qualification results.

## Report-only operation

`pocket/qualification_report.py --out DIRECTORY` reads the existing rolling
two-source snapshots, checks package/release/source availability and byte fingerprints,
uses the existing `pocket/emu/catalog.py`, and writes proposed decisions locally.
It does not refresh the Hub, contact Editor, change approvals, upload release assets,
push code, create tags or invoke a deployment.

`pocket/qualify.py` can replay saved evidence without any network access. Its input
checks protect all IDs and non-emulator catalogue fields, including attribution and
restrictions. The golden regression tests still reproduce the original 285-record
baseline exactly. Proposed `qualification` fields are additive and retain all records.

The separate `Qualification report (no publishing)` workflow has read-only repository
permissions and produces review artifacts on a relevant PR or manual dispatch. It
has no schedule and is not called by `pocket-sync.yml`. The existing normal nightly
and its publishing settings are untouched by this preparation. An approved future
rollout must wire the qualification stage before production catalogue publication;
the new client view alone is not a replacement for a publishing gate.

## Activation is a separate decision

Review the report, before/after counts, historical-exception differences and the Mac
build checks first. Production enablement requires an explicitly approved integration
of qualification into sync, a suitable report-only observation period and confirmation
that the new feed and clients agree. Publish the qualified data before a client that
requires it; legacy schema-1 data has no platform checks, so the prepared clients do
not infer a passing library result from it. Built-in and user-added files remain usable.

No app version or release/tag workflow is changed here. No production promotion or
visibility policy is active merely because the report code or a draft PR exists.
