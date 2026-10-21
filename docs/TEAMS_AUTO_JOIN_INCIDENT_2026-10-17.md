# Regular-Chrome lecture incident: diagnosis in progress

## Observed evidence

The user reported that the real lecture neither auto-joined nor recorded.
A user-supplied screenshot shows this diagnostic at
`2026-10-17T19:32:33.660Z` (22:32:33 Cairo):

> Wrong team/channel. Open the configured channel in the authorized tab

Another screenshot shows the Advanced Artificial Intelligence team's General
channel with an active meeting Join button. The complete saved schedule settings
and regular-Chrome DOM were not retrieved. Therefore neither a configuration
mismatch nor a specific selector failure is established as the root cause.
This diagnostic belongs to the overtime period, not proof of what happened at
the main 20:31 occurrence. A session grant is not proof of working auto-join.

The earlier successful one-minute test in Chrome for Testing does not establish
regular-Chrome acceptance. The real-lecture failure supersedes any implication
that the whole migrated setup was verified.

## Confirmed implementation gaps and changes on October 20

- All team/title/sidebar mismatches previously produced one generic error.
  Errors now identify expected and observed names and which checks failed.
- Blocked joins were thrown before entering the retained join-event history.
  They now retain timestamp, schedule ID and reason (bounded to 100 events).
- There was no read-only check using the same authorized target and join logic.
  The new readiness button checks without clicking Join, changing microphone
  or camera, starting capture, or writing a joined-session state.
- Authorization status no longer describes the setup as unattended-start
  eligible without explaining that joining and recording are unverified.
- A controlled fixture reproduced rejection caused by nonbreaking versus normal
  spaces. Rendering whitespace is normalized while distinct names, ambiguity
  and unsafe/unverified prejoin states continue to be rejected. This is a
  defensive fix, not a confirmed explanation of the real lecture failure.

## Deployment and remaining gate

The regular-Chrome control helper still failed on October 20 with
`helper_unknown_error: setup refresh had errors`. No regular-Chrome settings,
browser profile, meeting or extension reload was manipulated during this repair.
The first staging build exposed another defect: copy plugins used a hardcoded
`dist` path even when Vite received a different output folder. It copied the new
Teams module into the loaded build's folder. That generated module was restored
to HEAD content immediately; the extension was not reloaded. Copy plugins now
honor the resolved output directory, with a regression test for relative and
absolute paths. The candidate is staged under ignored test artifacts. A file
hash comparison checks that the corrected staging build does not alter live dist.

After installing the candidate in an isolated profile, a person must authorize
the exact test tab once. Run the read-only check to obtain the missing evidence.
Fix the specific configuration or observed selector mismatch, then require a
scheduled test-channel join, capture, automatic stop, completed save and media
validation in regular Chrome before claiming resolution. Do not test by joining
a real lecture or replace the failure with a mock success.

The October 17 one-off entries are expired; do not silently replay them or turn
them into recurring schedules. No recording engine or stable-branch changes
are part of this patch. The incident remains **not resolved in real Chrome**.

## October 20 verification

- `npm test`: 215 passed, 0 failed, exit 0.
- Teams DOM fixtures: passed in headless Chromium, including read-only checks,
  whitespace normalization, mismatched names, ambiguous Join controls and safe
  prejoin controls. These are synthetic fixtures, not Teams media evidence.
- Readiness UI fixture: passed with mocked extension APIs; exact schedule
  routing, mismatch text, expired authorization, and no mutating message.
- Staged Vite production build: passed without build warnings, exit 0.
- Candidate manifest parses; service worker, automation and FFmpeg files exist.
  `node --check` passes for service worker and Teams adapter.
- Corrected staging build leaves the existing dist SHA256 inventory unchanged.
- No commit, push, merge, browser reload or real-meeting test performed.

Ignored evidence directory: `.test-artifacts/autojoin-diagnostics-2026-10-20/`
contains `regression.txt`, `build.txt`, `dom-fixtures.txt`, `ui-fixtures.txt`,
`preflight-ui-fixture.png`, `dist-isolation.txt`, and the candidate `dist/`.
The screenshot depicts a mocked UI fixture, not a live Teams meeting.

## Follow-up: live test-channel readiness result

The user subsequently supplied a regular-Chrome readiness screenshot for
`tEST / General`: `title=true`, `sidebar team=true`,
`selected channel=false (count=0)`, with a session authorization present.
This identifies the failed predicate in that test, not the precise HTML variant
or the original lecture's saved settings. The old detector required a selected
treeitem containing a separately marked channel-text descendant.

The detector now recognizes explicit ARIA selected/current-page markers on a
row, nested link or label, plus a selected tree row's accessible name when there
is no separate text label. It does not fall back to title-only matching or an
unselected channel label. Wrong and multiple selected channels still block.
Additional browser fixtures cover these variants, no-selection, explicit false
selection, ambiguity and wrong channels. All fixtures and 215 automated tests
pass; the experimental dist was backed up and rebuilt successfully.

Evidence: `.test-artifacts/teams-channel-selector-bee5969a57614303a0cc7ceff3328067/`.
The previous isolated browser's debugging port was closed. The current tab's
actual DOM could not be inspected; live readiness and scheduled join/capture/save
after reloading this follow-up remain unverified. No new recording was produced
by these fixture tests.

## User-supplied DOM establishes the selection discrepancy

The next video confirmed that the updated detector still found one visible
channel label but no selected name. The user then supplied the actual General
channel row: an anchor with `role="treeitem"`, `data-is-focusable="true"`,
`aria-selected="false"`, and the usual channel-list-item/text descendants.
The accompanying DevTools screenshot shows a matched atomic CSS rule applying
`background-color: var(--colorNeutralBackground4Selected)` to that same row.
The displayed channel is visually selected despite its false ARIA flag.

A sanitized fixture reproduces the discrepancy (without real channel IDs).
The adapter now accepts that specific visual-selection evidence only when the
row matches a simple class rule explicitly using the selected-background token
and its computed opaque background actually equals that token. It does not
hardcode generated class names or accept a matching color alone. Inaccessible
stylesheets fail closed; hover/focus selectors, overrides, transparent tokens,
wrong names, multiple selected rows and inconsistent title/team evidence do not
authorize a join. Existing exact title/team checks remain required.

The sanitized reproduction failed before this correction and passed afterward.
This explains the test-channel selected-count failure; successful joining,
capture and saving in the user's current browser still need live confirmation.
