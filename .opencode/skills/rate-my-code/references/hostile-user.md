# Hostile-user review

Act hostile toward the product's assumptions, never toward the author. Begin black-box. Try plausible misuse and awkward states before reading implementation details.

## Test actors

| Actor | Behaviors to try |
|---|---|
| Impatient | double-click, repeat submit, simultaneous parallel submits, back, refresh, abandon and resume |
| Mistaken | empty, malformed, stale, expired, oversized, and contradictory input |
| Multi-state | multiple tabs, devices, sessions, roles, tenants, and out-of-order responses |
| Bad network | slow request, timeout, disconnect, retry, duplicated response, stale cache |
| Boundary seeker | change identifiers, cross ownership, bypass UI, inject input, access deleted/private state |
| Lifecycle user | sign up, upgrade, cancel, delete, restore, export, renew, and re-register |
| Consistency checker | meet the same state, action, status, or product fact across screens, dialogs, empty/loading/error surfaces, internal docs, machine-facing guidance, and public help |

Select only actors relevant to the product promise. Do not spray every payload at every field.

## Test design

For each selected journey:

1. State the invariant that must survive.
2. Capture clean baseline state.
3. Apply one controlled disturbance.
4. Observe UI/API response and durable state.
5. Repeat to check reproducibility.
6. Restore state or document why restoration is unavailable.

When the invariant is race-prone — one-per-user, exactly-once, balance, quota, unique claim — make the disturbance a true concurrent burst of parallel requests, not serial repetition, and pair the observation with a search for the guarding constraint.

Never run real charges, destructive deletion, mass messaging, load attacks, or tests against other people's data without explicit authorization and a sandbox or dedicated test account. If the safe test cannot be run, record it as unverified and provide an exact sandbox test.

After the selected journeys, compare surfaces. One state, status, action, or actionable product fact must keep compatible meaning everywhere it appears; file a consequential divergence — several expressions of one state, parallel implementations of one interaction, or contradictory instructions across documentation surfaces — as a finding that lists the affected surfaces. Follow `references/documentation-consistency.md` when two or more documentation surfaces overlap.

## Hostile-user rubric

| Dimension | Weight |
|---|---:|
| Core journey under misuse | 20 |
| State integrity under retry and concurrency | 20 |
| Identity, ownership, and privacy boundaries | 20 |
| Failure clarity and user recovery | 15 |
| Lifecycle completeness | 10 |
| Accessibility and input resilience | 10 |
| Cross-surface consistency | 5 |

Prioritize surprising failure chains over a high number of isolated defects. A polished UI with a cross-tenant leak is blocked; a rough but bounded prototype can still be suitable for a controlled beta.
