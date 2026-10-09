# Audit ledger and fix loop

Load this reference when the user asks to save an audit, generate a durable report, receive fix prompts, authorize direct fixes, or continue a prior audit-to-fix loop. The review contract remains authoritative for findings, evidence, vetoes, decisions, and re-review identity. The ledger preserves that work across snapshots; it does not replace the verdict or optional numeric scorecard.

## Contents

- [Choose the post-audit route](#choose-the-post-audit-route)
- [Persist a snapshot chain](#persist-a-snapshot-chain)
- [Bind artifact and review identity](#bind-artifact-and-review-identity)
- [Use the exact ledger schema](#use-the-exact-ledger-schema)
- [Record blockers, checks, scoring, and venture evidence](#record-blockers-checks-scoring-and-venture-evidence)
- [Bind evidence and evidence lanes](#bind-evidence-and-evidence-lanes)
- [Apply the decision order](#apply-the-decision-order)
- [Finding lifecycle](#finding-lifecycle)
- [Authorization and independent verification](#authorization-and-independent-verification)
- [Root-cause batches](#root-cause-batches)
- [Render and close the loop](#render-and-close-the-loop)

## Choose the post-audit route

After delivering the complete verdict, use an already stated preference or offer exactly these outcomes in the user's language:

1. `report-only` — stop after the verdict; do not edit code, and save files only when explicitly requested.
2. `fix-prompts` — return copy-ready prompts for selected findings; do not edit code, and save files only when explicitly requested.
3. `fix-and-retest` — after explicit authorization, persist the ledger, fix selected findings, and re-run the same acceptance and adjacent regression paths. Also use this mode to record and independently re-review an `external-change`; observing an external change does not retroactively create authorization for it.

This is a post-audit action, not a third review setting. Do not delay the initial verdict to ask it. If the user already requested a saved audit, fix prompts, or direct fixes, keep that route and do not ask again.

## Persist a snapshot chain

When persistence is requested or `fix-and-retest` is authorized, create a canonical UTF-8 JSON ledger and generate its Markdown view with the bundled standard-library tool:

```bash
# First snapshot
python3 <skill-directory>/scripts/audit_ledger.py validate path/to/initial.json

# Every later snapshot: verify both the new file and its continuity from the exact prior file
python3 <skill-directory>/scripts/audit_ledger.py validate \
  --prior path/to/initial.json path/to/current.json
python3 <skill-directory>/scripts/audit_ledger.py render \
  --prior path/to/initial.json --language en \
  --output path/to/audit-report.md path/to/current.json
```

Use `--language zh-CN` for Chinese headings. Resolve the script relative to this `SKILL.md`. Keep JSON as the source of truth; regenerate Markdown rather than manually maintaining two records. Do not create either file during a read-only review unless the user explicitly asked to save the audit.

Keep every snapshot, not just the newest one. Choose project-local paths with the user, or default an authorized local fix loop to a retained series:

```text
.rate-my-code/ledger/0001.json   root snapshot, written from the verdict before the first edit
.rate-my-code/ledger/0002.json   after the first fix batch
.rate-my-code/audit-report.md    regenerated view of the newest snapshot
```

Overwriting one `audit-ledger.json` in place destroys the chain: `previous_ledger_ref` still holds the SHA-256 of bytes that no longer exist anywhere, so `--prior` has nothing to check and continuity becomes unprovable. Numbering the files instead keeps every prior byte available and makes the history queryable by itself — which round found a finding, which release identity each piece of evidence was produced against, and what closed it.

Schema versions coexist. The validator keeps the rules of every supported version and judges each document under the one it declares, because a chain whose whole claim is that prior bytes stand cannot also require those bytes to be rewritten whenever the rules move. Version 3 snapshots stay valid without the fields version 4 added, and carrying a version 4 field in a version 3 document is refused just as firmly as omitting one — the declared version has to describe the document. Write new snapshots at the current version; a chain may move forward across versions and never back, since older rules cannot judge newer records.

Bump the version on any change to a required field, not only on a large one. Before this rule existed, version 3 silently meant four different field sets inside one day, so the number stopped carrying information and a document written that morning was refused that evening for lacking fields that had not existed when it was written. Decide the evolution strategy while the chain is short: rebuilding every snapshot under new rules works for two or three of them and stops working the moment the chain is itself the evidence, because regenerating an old snapshot means inventing results for checks that were never run.

Each snapshot carries `snapshot_index`, an integer starting at 1 that must be exactly one greater than the prior snapshot's. A root snapshot is the only one allowed to pair index 1 with a null `previous_ledger_ref`. The pair makes a lost or skipped snapshot detectable: a hash mismatch says the prior file changed, while an index gap says a whole round went missing. The `recorded_at` field is required; its value is either null or an RFC 3339 UTC timestamp such as `2026-07-31T04:05:06Z`. It is caller-supplied context for reading history, never evidence of when anything ran.

The first snapshot sets `previous_ledger_ref` to `null`. Before writing each later snapshot, preserve the prior JSON file and set `previous_ledger_ref` to `sha256:` plus the SHA-256 digest of that file's exact bytes. Whitespace and key-order changes therefore create a different prior reference. Pass the preserved file through `--prior`; the CLI rejects a non-null `previous_ledger_ref` when the prior file is absent because current-file validation alone cannot prove continuity.

Continuity validation keeps the same `ledger_id`, artifact name and initial release identity, identity method and scope, complete review identity, and initial decision. It preserves every prior evidence record unchanged after normalization and enforces these append-only identities:

- Prior findings cannot be deleted, and every non-lifecycle field stays fixed. Lifecycle changes must follow the allowed state transitions. A `verified-fixed` finding can leave that state only for `regressed`, `accepted-risk`, or `blocked`, with a fresh independent non-`FIXED` retest.
- Prior unknowns cannot be deleted, and their condition, rationale, missing evidence, and resolving test stay fixed. A promoted unknown remains linked to the same finding. Reopening a cleared unknown requires fresh, reproducible, current-release fail or mixed `unknown-resolution` evidence.
- Prior root causes cannot be deleted; their title and summary stay fixed, and finding links may only be appended.
- Prior gates cannot be deleted; their scope and finding links stay fixed, and evidence or retest references may only be appended. Reopening a fixed gate requires fresh current evidence that qualifies the gate failure.
- Prior workflow blockers cannot be deleted; their reason, missing requirement, and resolving action stay fixed. A resolved blocker cannot reopen; create a new `B-###` if the condition recurs.
- Prior release checks cannot be deleted, and their `required` policy stays fixed. Create a new check ID for a new policy.
- `scoring.requested` stays fixed. Changing whether numeric scoring was requested starts a new review chain; only the current threshold result and immutable scorecard reference may advance within the existing chain.

The current release, current decision, maximum safe target, evidence-lane statuses, scoring state, venture assessment, and permitted lifecycle/check/blocker statuses describe the current snapshot and may change only when its evidence warrants it. New evidence and newly discovered records may be appended. Do not edit the preserved prior file or rewrite history to make the current result look cleaner.

This SHA-256 snapshot chain detects accidental or unacknowledged record replacement only when the trusted prior file or digest is retained separately. It is not a signature, trusted timestamp, actor identity proof, or tamper-proof audit system.

## Bind artifact and review identity

Both release references use `sha256:<64 lowercase hex>`. `initial_release_ref` identifies the first audited artifact and never changes within a chain. Recompute `current_release_ref` after every recorded change. Choose one method and record its exact coverage in the structured `identity_scope`; continuity validation forbids silently changing the method or any scope field later.

- `sha256-file` — hash the exact raw bytes of one file or immutable archive. Set `root` to its explicit containing scope, list the exact file under `included`, and make clear through the artifact name whether it is submitted, built, or deployed.
- `sha256-tree` — create a deterministic manifest of the reviewed regular files. The default format is one UTF-8 line per file, `<file-sha256><two ASCII spaces><normalized POSIX relative path><LF>`, with paths sorted by their UTF-8 bytes and line breaks forbidden inside paths; hash the exact concatenated manifest bytes. Set an explicit `root`, list at least one inclusion, and list every exclusion. Exclude `.git`, `.rate-my-code` ledger/report files, caches, irrelevant generated outputs, and secrets unless they are deliberately part of the reviewed artifact. Never hash the ledger into the release it identifies.
- `sha256-deployment-manifest` — hash the exact raw bytes of an immutable deployment manifest that enumerates the deployed artifact digests and relevant immutable configuration. Set `root` to the deployment identity scope and list the exact manifest under `included`.

When a documentation-consistency review combines independently mutable files or live pages, include a sanitized immutable comparison manifest in this deployment manifest. The comparison manifest records mode, scope, declared canonical source, source locators and versions, access states, content digests, and a claim-matrix or byte-pair reference. Store its sanitized reference in evidence rather than adding an unvalidated top-level ledger field; never include credentials, cookies, authorization headers, signed query parameters, or confidential full text.

For every method, choose `symlink_policy` exactly: `reject-all` rejects every symlink; `hash-link-metadata` hashes the link identity without following it; `follow-within-root` may resolve only targets inside the declared root and must reject root escape and cycles. Never leave the root or symlink behavior implicit.

Do not substitute a mutable branch, tag, URL, `latest`, timestamp, or prose version label for a release digest. If the source tree and deployed artifact differ, identify the artifact the evidence actually exercised.

The review identity is also immutable across the snapshot chain:

```text
review = {
  role: product-lead | hostile-user | staff-engineer | staff-frontend-engineer | skeptical-vc | oral-defense,
  degree: quick-check | strict-review | launch-gate | real-stakes | life-or-death,
  requested_target,
  rubric_id,
  ai_behavior: none | llm | agent | rag | mixed
}
```

For non-VC reviews, map degree to target exactly: `quick-check` → `internal-demo`, `strict-review` → `private-beta`, `launch-gate` → `public-launch`, `real-stakes` → `real-money`, and `life-or-death` → `high-stakes`. A `skeptical-vc` review always uses `venture-case`; map its five degrees to exact stages `screening`, `structured-diligence`, `partner-review`, `full-diligence`, and `investment-committee` in the same order. Use a stable, versioned rubric ID such as `rate-my-code/staff-engineer/launch-gate/v1`. When numeric scoring is present, use or include the scorer's immutable rubric fingerprint rather than inventing a new rubric during re-review. `rubric_id` and actor/reviewer IDs may contain only letters, digits, `:._/@-` and must be 1–128 characters.

Set `ai_behavior` from behavior actually in scope, not from the implementation language: ordinary deterministic software is `none`; products whose reviewed behavior depends on an LLM, agent, RAG pipeline, or a combination use the matching value. This choice controls whether probabilistic evidence is required for a non-VC release review; a venture ledger keeps every software lane `N/A` regardless.

## Use the exact ledger schema

The bundled validator rejects missing and undeclared fields. Include nullable fields as `null`. The interfaces below are the exact version 4 contract for new snapshots. Preserved version 3 snapshots omit only `Retest.revert_mutation` and `ConditionSweep.seeded_write`; keep those snapshots at version 3 rather than rewriting history.

```text
AuditLedger = {
  schema_version: "5",
  snapshot_index: integer_1_or_more,
  recorded_at: RFC_3339_UTC_timestamp | null,
  ledger_id,
  previous_ledger_ref: sha256:<64 lowercase hex> | null,
  artifact: {
    name,
    initial_release_ref,
    current_release_ref,
    identity_method: sha256-file | sha256-tree | sha256-deployment-manifest,
    identity_scope: {
      root,
      included: unique string[1..],
      excluded: unique string[],
      symlink_policy: reject-all | hash-link-metadata | follow-within-root
    }
  },
  review: {role, degree, requested_target, rubric_id, ai_behavior},
  loop_mode: report-only | fix-prompts | fix-and-retest,
  verdict: {initial_decision, current_decision, maximum_safe_target},
  workflow_blockers: WorkflowBlocker[],
  release_checks: ReleaseCheck[],
  scoring: Scoring,
  venture_assessment: VentureAssessment | null,
  root_causes: RootCause[],
  proposals: Proposal[],
  evidence: LedgerEvidence[],
  evidence_lanes: EvidenceLanes,
  gates: Gate[],
  findings: LedgerFinding[],
  unknowns: LedgerUnknown[]
}
```

Use these exact child interfaces:

```text
RootCause = {
  id: RC-###,
  title,
  summary,
  finding_ids: unique F-###[1..],
  condition_sweep: ConditionSweep,
  cause_sweep: CauseSweep | null
}

PromiseSource = {
  kind: ui-copy | documentation | api-contract | implied-by-behavior |
        user-stated | regulatory,
  locator
}

Proposal = {
  id: P-###,
  title,
  absent_capability,
  who_would_use_it,
  why_not_a_finding,
  status: proposed | scheduled | declined,
  note: string | null
}

ConditionSweep = {
  state: unswept | unsweepable | swept | closed,
  method: none | text-search | static-query | type-check | manual-enumeration,
  expression: string | null,
  scope: string | null,
  denominator: structural | pattern | null,
  population: string | null,
  instances_found: integer_0_or_more,
  instances_converted: integer_0_or_more,
  instances_unconvertible: integer_0_or_more,
  closure: converted | chokepoint | ratchet | accepted-risk | null,
  closure_ref: string | null,
  closure_evidence_id: E-### | null,
  note: string | null,
  seeded_check: SeededCheck | null,
  seeded_write: SeededWrite | null
}

SeededCheck = {
  status: killed | survived | not-applicable,
  seed_description: string | null,
  reason: string | null
}

SeededWrite = {
  status: unwritable | written | not-attempted,
  attempt_description: string | null
}

CauseSweep = {
  state: pending | done,
  summary,
  finding_ids: unique F-###[0..]
}

LedgerEvidence = {
  id: E-###,
  state: E0 | E1 | E2 | E3,
  kind: runtime | test | code | log | metric | eval | interview | document | claim,
  lane: deterministic-checks | critical-journey-e2e | probabilistic-eval |
        continuous-evidence | other,
  result: pass | fail | mixed | inconclusive,
  reproducible: boolean,
  fresh: boolean,
  release_ref: sha256:<64 lowercase hex>,
  summary,
  locator,
  subject_id: F-### | U-### | null,
  procedure: reproduction | acceptance | adjacent-regression | mutation |
             unknown-resolution | release-lane | class-sweep,
  gate_id?: fixed_gate_id,
  workflow_blocker_id?: B-###,
  release_check_id?: stable_check_id,
  venture_signal_id?: real_users | retention | repeatable_distribution,
  deployment_coverage?: {
    scope_complete: boolean,
    compensating_layer_ruled_out: boolean
  },
  runs?: integer_1_to_100000,
  provenance?: {
    model: immutable_versioned_ref,
    prompt: immutable_versioned_ref,
    eval_set: immutable_versioned_ref,
    judge: immutable_versioned_ref,
    system?: immutable_versioned_ref
  },
  eval_metrics?: {
    minimum_pass_rate: integer_1_to_100,
    observed_pass_rate: integer_0_to_100,
    maximum_standard_deviation: integer_0_to_100,
    observed_standard_deviation: integer_0_to_100
  }
}

EvidenceLane = {
  status: PASS | FAIL | UNVERIFIED | N/A,
  evidence_ids: unique E-###[],
  reason?: required only for N/A
}

EvidenceLanes = {
  deterministic-checks: EvidenceLane,
  critical-journey-e2e: EvidenceLane,
  probabilistic-eval: EvidenceLane,
  continuous-evidence: EvidenceLane
}

LedgerFinding = {
  id: F-###,
  severity: BLOCKER | HIGH | MEDIUM | LOW,
  title,
  promise_or_invariant,
  promise_source: PromiseSource,
  preconditions: string[1..],
  reproduction_steps: string[1..],
  expected,
  actual,
  evidence_ids: unique E-###[1..],
  impact,
  suspected_cause: explicitly_labeled_inference,
  minimum_fix_or_agent_prompt,
  acceptance_test,
  adjacent_regression_check,
  root_cause_id: RC-### | null,
  gate_id: fixed_gate_id | null,
  status: finding_lifecycle_state,
  fix_authorization: FixAuthorization | null,
  fix: Fix | null,
  retest: Retest | null,
  risk_acceptance: RiskAcceptance | null,
  blocker: Blocker | null
}

FixAuthorization = {authorized_by: "user", statement, scope}
Fix = {
  origin: authorized-agent | external-change,
  actor_id,
  change_ref: git:<40 hex> | patch-sha256:<64 hex> | sha256:<64 hex>,
  summary
}
Retest = {
  classification: FIXED | PARTIALLY_FIXED | NOT_FIXED | REGRESSED | UNVERIFIABLE,
  reviewer_id,
  reviewer_context: fresh-context | independent-agent | external-reviewer,
  release_ref: sha256:<64 lowercase hex>,
  evidence_ids: unique E-###[],
  acceptance_test: pass | fail | unverified,
  adjacent_regression_check: pass | fail | unverified,
  mutation_test: {status: killed | survived} |
                 {status: not-applicable, reason},
  revert_mutation: RevertMutation
}
RevertMutation = {
  status: killed | survived | not-applicable,
  reason: string | null
}
RiskAcceptance = {
  accepted_by: "user",
  statement,
  scope,
  rationale?: optional user-supplied context
}
Blocker = {reason, missing_requirement, resolving_action}

LedgerUnknown = {
  id: U-###,
  unresolved_condition,
  why_it_matters,
  missing_evidence,
  resolving_test,
  status: open | cleared | promoted-to-finding,
  resolution_evidence_ids: unique E-###[],
  finding_id: F-### | null
}

Gate = {
  id: fixed_gate_id,
  state: active | fixed,
  evidence_ids: unique E-###[1..],
  retest_evidence_ids: unique E-###[],
  affected_targets: unique software_target_id[1..],
  finding_ids: unique F-###[1..]
}

WorkflowBlocker = {
  id: B-###,
  status: active | resolved,
  reason,
  missing_requirement,
  resolving_action,
  resolution_evidence_ids: unique E-###[]
}

ReleaseCheck = {
  id: stable_check_id,
  required: boolean,
  status: pass | fail | unverified,
  evidence_ids: unique E-###[]
}

Scoring = {
  requested: boolean,
  threshold_met: boolean | null,
  scorecard_ref: sha256:<64 lowercase hex> | null
}

VentureSignal = {
  status: present | missing | unknown,
  evidence_ids: unique E-###[]
}

VentureAssessment = {
  stage: screening | structured-diligence | partner-review |
         full-diligence | investment-committee,
  evidence_maturity: claims-only | single-signal | multi-signal | complete,
  strongest_proven_signal: none | real_users | retention | repeatable_distribution,
  largest_unsupported_leap,
  signals: {
    real_users: VentureSignal,
    retention: VentureSignal,
    repeatable_distribution: VentureSignal
  }
}
```

The review contract accepts an omitted gate `affected_targets` as shorthand for all software-release targets for backward compatibility. The ledger does not: when converting a verdict into a ledger, normalize an omitted scope into the explicit, ID-sorted set (`high-stakes`, `internal-demo`, `private-beta`, `public-launch`, `real-money`). Never use an empty list or `venture-case`. Keep this normalized scope stable in later snapshots.

For `open`, keep authorization, fix, retest, risk, and blocker records `null`. A recorded fix requires a new `current_release_ref`. A `blocked` finding requires all three blocker fields and no risk acceptance. `cleared` unknowns need current passing evidence; `promoted-to-finding` unknowns retain their `U-###` and point to a new `F-###`. Every root-cause and gate link is bidirectional. Once activated, a gate remains `active` across code changes and `fixed-pending-retest` snapshots; the preserved failure does not become stale merely because the release changed. It becomes `fixed` only after adding current, same-gate passing acceptance runtime or test evidence under `retest_evidence_ids` for every linked finding.

## Record blockers, checks, scoring, and venture evidence

Use a top-level `WorkflowBlocker` for a missing permission, dependency, environment, or external decision that blocks required work or verification but does not belong to one finding. Keep `resolution_evidence_ids` empty while it is `active`. Mark it `resolved` only with fresh, reproducible, non-E0, passing evidence on the current release whose `workflow_blocker_id` matches the blocker. Every blocker-bound record must appear in that blocker's resolution list. Do not reuse one record to resolve multiple blockers, and preserve the old snapshot rather than erasing the blocker. A finding-specific blocker remains in `LedgerFinding.blocker` with finding status `blocked`.

Give each `ReleaseCheck` a stable unique ID using the same 1–128-character principal-ID alphabet as `rubric_id`. An `unverified` check has no evidence. A `pass` or `fail` cites non-E0, fresh, reproducible evidence on the current release whose `release_check_id` matches the check. Every check-bound record must appear in that check. A passing check may cite only passes and cannot hide other fresh current non-passing evidence bound to the same check; a failing check needs at least one fail or mixed result. Do not reuse one evidence record across release checks. Required checks participate in the fail-closed decision; a non-passing optional check is an optional gap. A `skeptical-vc` ledger must keep `release_checks` empty and place any software-release judgment in a separate ledger.

`Scoring.requested` is `true` only when the user explicitly asked for numeric scoring. In that case, record the immutable scorecard file digest and whether its applicable threshold was met. When scoring was not requested, set both `threshold_met` and `scorecard_ref` to `null`. Evaluate a false threshold only at its place in the role-specific decision order; never let a score override blockers, failed required proof, or unresolved evidence.

`venture_assessment` is required for `skeptical-vc` and must be `null` for every other role. Set `stage` from the five degree mappings above. Derive `evidence_maturity` from the number of `present` signals: zero → `claims-only`, one → `single-signal`, two → `multi-signal`, three → `complete`. Set `strongest_proven_signal` to `none` when none is present; otherwise name one actually present signal. Also record the largest unsupported leap and all three signals. A `present` signal needs at least one non-E0, fresh, reproducible, passing current-artifact record whose `venture_signal_id` matches the signal. `real_users` accepts runtime, log, or metric evidence; `retention` accepts log or metric evidence; `repeatable_distribution` accepts log, metric, or document evidence. `missing` and `unknown` cite no evidence, and one evidence record cannot substitute across signals.

## Bind evidence and evidence lanes

Every evidence record answers both “what record does this support?” and “what procedure produced it?”:

| Procedure | Required subject |
|---|---|
| `reproduction` | Its `F-###` |
| `acceptance` | Its `F-###` |
| `adjacent-regression` | Its `F-###` |
| `mutation` | Its `F-###` |
| `unknown-resolution` | Its `U-###` |
| `release-lane` | `null` |
| `class-sweep` | A non-null `F-###` or `U-###` |

Original finding evidence must be `reproduction` evidence bound to that finding. A confirmed finding needs at least one E1/E2/E3 `fail` or `mixed` record; E0 never proves a finding, clears an unknown, resolves a workflow blocker, closes a fix, closes a gate, passes a release check, proves a venture signal, or passes a lane. Unknown clearance requires fresh current-release E2/E3 passing runtime, test, log, metric, or eval evidence. A gate-bound record must name the gate, point to one of its linked findings, and appear in that gate's evidence or retest list. A workflow-blocker, release-check, or venture-signal record must use `procedure: release-lane`, a null `subject_id`, and its matching optional binding field, and it must appear in the named blocker, check, or signal. One evidence record may carry at most one of `gate_id`, `workflow_blocker_id`, `release_check_id`, and `venture_signal_id`; do not cite unrelated proof merely because its result is favorable.

`deployment_coverage` is allowed only on `code` or `document` evidence. Both booleans must be true before complete inspected deployment evidence can activate a gate without direct runtime reproduction: the evidence must cover the entire deployed path and rule out a compensating layer. A claim, partial search, or E0 record is not complete deployment evidence. Fixed gates still require fresh E2/E3 passing `acceptance` runtime or test evidence on the current release; deployment inspection cannot close them.

Lane status is release-level evidence, not a finding status. `PASS` and `FAIL` require non-E0, fresh, reproducible evidence from the same lane and current release. Critical-journey, probabilistic, and continuous lanes require E2/E3 machine or runtime evidence; deterministic checks may use E1 static facts. `PASS` may cite only passes and cannot hide any non-E0 current same-lane fail, mixed, or inconclusive record. Any fresh, reproducible, non-E0 current-release fail or mixed record forces the matching lane to `FAIL`; `FAIL` must cite at least one such record. `UNVERIFIED` and `N/A` use no evidence IDs; only `N/A` has a reason. Do not reuse one evidence ID across lanes. A `claim` record must be E0; an `eval` record must be E2 or E3 and include all three eval-only fields: `runs`, `provenance`, and `eval_metrics`.

For a probabilistic lane `PASS` or `FAIL`, cite at least two total runs with one identical immutable model, prompt, eval-set, judge, and threshold policy. Include `system` provenance for `agent`, `rag`, or `mixed` behavior. Set the predeclared minimum pass rate no lower than the target threshold and the maximum standard deviation no higher than the target cap:

| Target | Minimum pass rate | Maximum standard deviation |
|---|---:|---:|
| `internal-demo` | 50 | 30 |
| `private-beta` | 65 | 25 |
| `public-launch` | 75 | 20 |
| `real-money` | 85 | 15 |
| `high-stakes` | 90 | 10 |

A probabilistic `PASS` also requires each cited record's observed pass rate to meet its predeclared minimum and its observed standard deviation not to exceed its predeclared maximum. A probabilistic `FAIL` requires at least one cited record whose observed pass rate is below its minimum or whose observed standard deviation exceeds its maximum; a fail label without an observed threshold miss is invalid.

Required lanes are fail-closed:

| Review target or behavior | Required lane |
|---|---|
| Every non-VC target, including `internal-demo` | `critical-journey-e2e` |
| `private-beta`, `public-launch`, `real-money`, `high-stakes` | `deterministic-checks` |
| `public-launch`, `real-money`, `high-stakes` | `continuous-evidence` |
| Any non-VC `llm`, `agent`, `rag`, or `mixed` behavior | `probabilistic-eval` |

For non-VC reviews, probabilistic eval must be `N/A` with a reason when `ai_behavior` is `none`; otherwise it cannot be `N/A`. A `READY` or `READY_WITH_CONDITIONS` non-VC decision requires every target-required lane to be `PASS`. For `venture-case`, set all four software-release lanes to `N/A` with individual reasons regardless of `ai_behavior`, and use `venture_assessment` for the venture decision.

## Apply the decision order

For a non-VC ledger, apply the first matching rule exactly:

1. An active gate whose normalized `affected_targets` includes the requested target, a `blocked` finding, or an active top-level workflow blocker → `BLOCKED`.
2. A failed required lane or release check, or an unresolved `BLOCKER` or `HIGH` finding → `NOT_READY`.
3. An unverified required lane or release check, an `unverifiable` finding, or an open unknown → `INSUFFICIENT_EVIDENCE`.
4. Readiness below the requested threshold when numeric scoring is requested → `NOT_READY`.
5. Any other non-verified finding, non-passing optional release check, or active gate outside the requested target remains → `READY_WITH_CONDITIONS`.
6. Otherwise → `READY`.

Use the exact non-VC decision tokens in JSON: `READY`, `READY_WITH_CONDITIONS`, `NOT_READY`, `BLOCKED`, or `INSUFFICIENT_EVIDENCE`. An unresolved high-severity accepted risk remains `NOT_READY`; a lower-severity accepted risk remains a condition. Risk acceptance cannot waive an active gate. The maximum safe target cannot exceed the requested target; `READY` and `READY_WITH_CONDITIONS` require it to equal the requested target, while every non-ready decision requires a lower target or `no-supported-release-tier`.

For `skeptical-vc`, keep both `gates` and `release_checks` empty, set `maximum_safe_target` to `not-assessed`, and apply the first matching rule exactly:

1. Active workflow blocker, `blocked` finding, open unknown, or any venture signal with status `unknown` → `INSUFFICIENT_EVIDENCE`.
2. Numeric scoring was requested and its threshold was not met → `NOT_INVESTABLE_YET`.
3. All three venture signals are `present` → `INVESTABLE`.
4. At least one signal is `present` and the remaining non-present signals are `missing` → `INTERESTING_BUT_UNPROVEN`.
5. Otherwise → `NOT_INVESTABLE_YET`.

These are the only venture decision tokens. Neither investability nor lack of it may be inferred from code quality alone.

## Finding lifecycle

Use these states:

| State | Meaning | Technically closed? |
|---|---|---|
| `open` | Confirmed and not being changed | No |
| `fixing` | A user-authorized agent fix is in progress | No |
| `fixed-pending-retest` | A change exists but has not passed an independent same-path retest | No |
| `verified-fixed` | Acceptance and adjacent checks passed on the current release in a fresh review context | Yes |
| `partially-fixed` | Re-review classified the finding `PARTIALLY_FIXED` | No |
| `not-fixed` | Re-review classified the finding `NOT_FIXED` | No |
| `regressed` | Re-review classified the finding `REGRESSED` | No |
| `unverifiable` | Re-review classified the finding `UNVERIFIABLE`; render under pending verification | No |
| `blocked` | The fix or required verification cannot proceed; a `Blocker` names why, what is missing, and how to resume | No |
| `accepted-risk` | The user explicitly chose to stop work on an unresolved risk | No |

```text
open ──authorized-agent──> fixing ──change──> fixed-pending-retest
open ──observed external change────────────────> fixed-pending-retest
fixed-pending-retest ──independent retest──> verified-fixed
                       ├────────────────────> partially-fixed
                       ├────────────────────> not-fixed
                       ├────────────────────> regressed
                       └────────────────────> unverifiable

any work or verification state ──missing requirement──> blocked
any technically unresolved state ──explicit user choice──> accepted-risk
```

A diff by itself moves a finding only to `fixed-pending-retest`. Map re-review classifications exactly: `FIXED` to `verified-fixed`, `PARTIALLY_FIXED` to `partially-fixed`, `NOT_FIXED` to `not-fixed`, `REGRESSED` to `regressed`, and `UNVERIFIABLE` to `unverifiable`. When a blocker clears, move to the state supported by the complete current snapshot; `blocked` may advance directly to `verified-fixed` only when that snapshot contains the authorized fix and complete independent passing retest.

Across a validated snapshot chain, apply these transition limits in addition to each state's evidence requirements:

| Prior state | Allowed next state |
|---|---|
| `open` | Any lifecycle state |
| `fixing`, `partially-fixed`, `not-fixed`, `regressed`, `unverifiable`, `blocked`, or `accepted-risk` | Any state except `open` |
| `fixed-pending-retest` | Any state except `open` or `fixing` |
| `verified-fixed` | `verified-fixed`, `regressed`, `accepted-risk`, or `blocked`; leaving verified closure also needs a fresh independent non-`FIXED` retest |

The renderer distinguishes a technically verified closure from a workflow stopped with accepted risk. Never describe `accepted-risk`, `blocked`, `fixed-pending-retest`, passing CI alone, or a code diff as fixed.

## Authorization and independent verification

For an `authorized-agent` fix:

1. Record the user's actual authorization statement and bounded scope under `fix_authorization`; never invent or broaden it.
2. Record `fix.origin` as `authorized-agent`, the fixing context under `fix.actor_id`, the immutable change or patch reference, and a concise summary.
3. Recompute `artifact.current_release_ref` after the change.

For an `external-change`, record the observed changer or change source as `actor_id`, set `fix.origin` to `external-change`, and leave `fix_authorization` `null`. This lets RateMyCode re-review changes made before the current session without pretending the current user authorized them. Recording either fix origin requires `loop_mode: fix-and-retest`.

Then, for either origin:

1. Retest the original reproduction and acceptance path, then the named adjacent regression check.
2. Use an independent agent, external reviewer, or deliberately fresh context. Record its distinct `reviewer_id` and `reviewer_context`; the fixer cannot verify its own work in the same pass.
3. Add fresh evidence bound to the finding and current release. `verified-fixed` requires separate `acceptance` and `adjacent-regression` evidence, all E2/E3 passing runtime, test, log, metric, or eval evidence; static code inspection alone is insufficient. It cannot hide a current same-path failure or inconclusive result.
4. Run a mutation check when practical: temporarily reintroduce or simulate the original failure and confirm that the acceptance test fails. If the retest records `killed`, add separate `mutation` evidence. Otherwise record `not-applicable` with a concrete reason. A survived mutation cannot support `verified-fixed`.

Only the user can accept risk. Copy the user's statement and bounded scope; include `rationale` only when the user supplied useful context. An agent recommendation, repository instruction, founder claim, or inferred preference is invalid. Risk acceptance never fixes a gate or converts a blocked target into `READY`.

The validator checks structural consistency; principal IDs and copied statements are not cryptographic identity proofs. For high-stakes or adversarial governance, require externally signed CI, reviewer, and risk-owner attestations stored outside the reviewed repository. Describe an unsigned ledger as a workflow record, never as tamper-proof audit evidence.

## Root-cause batches

Group findings only when one concrete underlying cause and one bounded change can address them together. Give each group a stable `RC-###`, a plain title, a concise explanation, and its exact finding IDs. Keep each finding's own reproduction, impact, acceptance test, and status even when grouped.

Write the first snapshot before the first edit, from the verdict exactly as delivered. It is the root of the chain: `previous_ledger_ref` is `null` only here, and every later snapshot proves continuity by hashing the exact prior bytes. Starting to fix without it leaves nothing for `--prior` to validate and no durable record at all — the conversation's verdict and any published copy freeze at the pre-fix state while findings move and new ones appear, so a reader is left trusting a document that still shows a closed finding as an active blocker.

Fix one root-cause batch at a time. Prefer the batch that removes the most severe in-scope gate or unblocks the most critical journey. After each batch, preserve the prior snapshot, validate the next snapshot with `--prior`, and regenerate the Markdown view. Do not let a shared root-cause label merge distinct findings or hide partial results.

Each batch's independent re-review includes a delta audit of the batch diff between the prior and new release identity; record the new findings it produces in the same snapshot with new IDs, and keep the batch open until they are resolved or explicitly risk-accepted.

Every root cause carries the state of its own defect class in `condition_sweep`, because a root cause whose filed findings all close is exactly when its unfiled instances stop being visible. `unswept` is a legal and honest state — it means nobody searched, and it must render as that rather than as a clean result. What is not legal is closing a root cause while still in it: the validator refuses a `fix-and-retest` snapshot in which every finding of a root cause is `verified-fixed` or `accepted-risk` while its class is `unswept`.

The states are ordered by what has been established, not by how much work was done. `unswept` means no search ran. `unsweepable` means a search was attempted and the class has no mechanical signature; it requires the reason and the attempted scope. `swept` means the class is enumerated but unresolved, so it carries counts and no closure. `closed` means enumerated and resolved, so it carries exactly one closure route: `converted` requires every found instance converted; `chokepoint` and `ratchet` require the location that enforces them in `closure_ref`; `accepted-risk` requires the remaining exposure named in `note`. A class may legitimately reopen when a later delta audit surfaces instances the first expression missed, but it can never return to `unswept` — that is always a bookkeeping error, and continuity validation rejects it.

`cause_sweep` covers the separate, expanding question of what else the same cause produced, and stays `null` where it was not performed.

Because the sweep hangs off the root cause, a finding with no root cause would skip it. A `verified-fixed` finding therefore requires a `root_cause_id`, and a root cause holding one finding is legal — the lone observed instance is the likeliest of all to have unobserved siblings, so it is the last case that should be exempt. Assigning a previously ungrouped finding to a root cause in a later snapshot is expected; the existing bidirectional link and preserved-finding-links rules already prevent regrouping it afterwards.

A finding says the product broke a promise, and that assertion needs a source like any other. `promise_source` names where the promise lives — the words on a screen, a line of documentation, an API contract, a regulation, something the user said, or the product's own behaviour — and the locator has to point at it. An inferred promise is legal and says so; an unsourced one is not, because a finding nobody can trace back to a promise is a request wearing a defect's clothes.

That distinction has a second half. A capability the product never promised is not a defect, and calling it one asserts a promise that does not exist — which is the same unverified claim this record refuses everywhere else. Those belong in `proposals`, and they behave differently on purpose: no severity, since severity measures the consequence of a broken promise; no ability to activate a gate; and they close by being `scheduled` or `declined` rather than fixed or risk-accepted, because "we never built that" is not a risk anyone accepted. `why_not_a_finding` is required, so the promise test is on the record with its answer rather than left to taste. The rendered report gives them their own section, well away from the issue list, and the summary counts them apart from findings.

The test is one question: can you point at something the product itself says or does that this contradicts? A signup form a screen-reader user cannot complete contradicts a public product's offer to sign up — a finding. A list that stops at a hundred items contradicts nothing unless the product claimed to show them all — a proposal. The line is not always obvious, and the point is that answering it is now part of filing, rather than something the reader has to reconstruct.

A mutation check proves the acceptance test can see the defect. It does not prove the shipped change is what makes that test pass — a guard computing an identity, or a value folded straight back by a default, satisfies every rule above and can be deleted with nothing going red. `retest.revert_mutation` records what happened when the change was taken back out. `survived` means the change is not load-bearing and cannot support `verified-fixed`; `not-applicable` needs a reason and is refused outright at `launch-gate` and above. The retest records it, never the pass that wrote the fix.

`chokepoint` and `ratchet` claim that new instances cannot get in, and evidence that the control ran is not evidence that it holds. `seeded_write` records an attempt to write one anyway: `unwritable` means the attempt was refused — the type system would not express it, or the gate would not let it land — and both enforced closures require it. `written` means the control can be routed around and does not close the class. State what was attempted, because the claim is only as strong as the attempt behind it, and it is bounded by the attacker's imagination rather than proof that no route exists.

Thoroughness cannot be measured, but narrowness can be refuted. `seeded_check` records what happened when a deliberately different-looking instance of the class was planted and the recorded expression was run against it: `killed` means the expression found it, `survived` means the expression is proven too narrow and cannot close the class, `not-applicable` requires a reason no instance could be planted. The seed must differ from the filed defect in the ways real instances differ — another file, another accessor name, another call shape — which is why `seed_description` is required and why a copy of the original teaches nothing. Plant it in a disposable working copy; never mutate the artifact under review, and never commit the seed. Every degree records the result before a class closes — `not-applicable` with a reason is a legal answer at lower degrees, and an absent `seeded_check` is not — while `launch-gate` and above require a `killed` seed. Degree grades how strong the answer must be, never whether the question is on the record.

A count means nothing without saying what it was counted against, and this is where a sweep most often goes wrong — not by searching too narrowly within the class, but by conceiving the class wrongly in the first place. `denominator` records which kind of count `instances_found` is. `structural` enumerates a population the code itself defines — the call sites of an API, the entries in a router, the tables in a schema, the exported components — and `population` must name it. `pattern` counts occurrences of a shape the reviewer invented, which is a symptom count, not a class size. The difference is not stylistic: a structural count cannot be lowered by rewriting the search, while a pattern count falls the moment the same defect is written a different way. Prefer a structural denominator whenever the class has one, and expect the two to disagree — a symptom search and a population enumeration over the same code routinely return different numbers, and the population is the one that means something.

This is also the limit of `seeded_check`. Planting an instance tests whether the expression is too narrow for the class as conceived; it cannot detect a class conceived against the wrong population, because a seed shaped like the author's idea of the defect will be found by an expression fitted to that same idea. The seeded check defends the expression; the denominator defends the class boundary. Neither substitutes for the other, and neither is self-proving: `denominator` is the author's declaration about their own count, so a symptom search labelled `structural` passes every rule here. Nothing in the schema can read intent. What actually catches a wrongly conceived class is the independent sweep challenge — a second context, never shown the first expression, enumerating the same class its own way — and the two counts disagreeing is the signal. Treat a declared denominator as a claim to be attacked, not a property that was verified.

`instances_unconvertible` counts instances that cannot be converted without restructuring — a value that is destructured at the point of use and so has no identifier to pass to a guard, a call site inside generated code, a path owned by another team. Needing a rewrite is a different cost from not having got to it yet, and one number for both hides which kind of work remains. Converted plus unconvertible may not exceed found, and any unconvertible instance blocks a `converted` closure because the class was not exhausted.

`converted` closes a class by exhausting it, but `chokepoint` and `ratchet` claim an ongoing control, and a control nobody observed is a claim. Both therefore require `closure_ref` to be a relative path inside the artifact's identity scope — not absolute, no parent traversal, and not under an excluded path, because a control outside the audited tree is not part of what was audited — and a `closure_evidence_id` pointing at an E2 or E3 passing record bound to the current release. `converted` additionally requires a structural denominator: claiming the class was exhausted is a claim about the whole population, which a symptom count cannot support. A pattern count may still close a class under an enforced control or explicit acceptance, and the report labels it as a symptom count so the number is not read as a class size. Use `procedure: class-sweep` for evidence that ran the sweep expression or demonstrated a chokepoint or ratchet refusing a new instance.

Only the snapshot chain forces serial work. `previous_ledger_ref` hashes the exact prior bytes and `snapshot_index` must be exactly one past the prior, so two batches completing at once would both claim the same index and fork the chain; the same applies to recomputing `release_ref` while another batch edits the same tree. Everything downstream of one batch's release identity is independent: per-finding acceptance and adjacent-regression checks, the delta audit, and the sweep challenge all read one immutable release and share no state, so they should run as separate contexts that fan in at the single snapshot write.

Prefer separate contexts for reasons stronger than speed. A serial reviewer that verifies one finding, then the next, becomes monotonically less independent as it absorbs each fix and its rationale, so `reviewer_context: fresh-context` is only honestly true at the start of a batch. The sweep challenge is the sharpest case: a context that just ran the recorded expression is anchored by it and cannot invent a genuinely different angle, so the second angle must come from a context that never saw the first. Grade the fan-out by degree like everything else — a `quick-check` may use one context and say so, while a release-blocking degree gives each mandate its own.

Know what this validation does not do. It checks that the record is internally consistent, not that the sweep was any good: an expression narrow enough to match only the original defect satisfies every rule above and renders as `1/1 instances converted, closed by converted`. No schema can distinguish a thorough search from a token one, for the same reason a ledger is a workflow record rather than an attestation. The control for that is not structural — it is the independent re-review's mandate to re-run the recorded expression and attack the class from a deliberately different angle, and the fact that the expression is written down at all is what makes that attack possible. Treat a recorded sweep as a falsifiable claim, never as proof.

Degree grades the formality of the sweep, not whether it happens. Every degree records a state; `launch-gate` and above additionally require each closing root cause to reach `closed` — an unenumerable class cannot pass a release gate — and to carry a completed `cause_sweep`. A `quick-check` may close a class with most instances unconverted, provided the remainder is named and accepted; the rendered report then shows `1/7 instances converted` rather than an unqualified fixed count.

When a batch settles a convention worth keeping — a single source of truth, a canonical expression of one state, a naming or interaction rule — update the project's conventions document in the same batch and list it in the batch's change references, so later maintainers and agents inherit the decision instead of re-forking it.

`validate` prints a machine-readable summary to stdout, and that summary is what a CI gate reads instead of the Markdown. It therefore reports the defect-class state alongside the finding counts — `defect_classes`, `classes_open`, `classes_unswept`, `instances_unconverted`, `instances_unconvertible` — because a gate that sees only `unresolved: 0` would pass a release with a class still open, which is the same failure this record exists to prevent, one layer down. Read the two together: findings closing and classes closing are different facts.

## Render and close the loop

The generated Markdown deliberately leads with the answer rather than metadata. Its order is:

1. one globally severity-sorted, uncapped list of every confirmed finding, with stable ID and lifecycle status;
2. one pending-verification subsection containing `unverifiable` findings, open unknowns, and active workflow blockers;
3. four-lane evidence panel, then workflow blockers, release checks, scoring, and the venture assessment when present;
4. ledger, prior snapshot, artifact, review, rubric, AI-behavior, loop-mode, verdict, and release identity;
5. progress, root causes, gates, detailed findings, unknowns, and evidence.

Keep an `unverifiable` finding in the confirmed-finding list because the original problem remains confirmed, and repeat it under pending verification because its current fix status is unknown. Keep every `F-###` and open or resolved `U-###`; never reduce the ledger report to only the top three actions.

Stop only when one of these conditions is explicit:

- every finding is `verified-fixed`, every root cause's defect class is `closed` or its remaining instances are explicitly accepted, every unknown is cleared or promoted to a finding, required evidence lanes are satisfied, and the same-rubric verdict supports the target;
- the user explicitly accepts named remaining risks, while the report continues to show the resulting technical limits and any active gate;
- work is `blocked` by a named missing permission, dependency, environment, or external decision, with a concrete resolving action.

For the final pass, preserve and validate the snapshot chain, regenerate the report, and lead with its complete one-line issue list. Then show the current decision, verified-fix count, accepted-risk count, unresolved count, open unknowns, root-cause progress, exact change references, and retest evidence. If numeric scoring was requested, keep the scorecard separate and report raw-product and readiness deltas alongside the ledger.
