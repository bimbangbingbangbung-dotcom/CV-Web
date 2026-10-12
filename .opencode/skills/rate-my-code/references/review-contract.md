# Review contract

Load this contract for every review. It is the canonical definition of targets, evidence, findings, vetoes, verdicts, and re-review identity. Role references add emphasis; they do not redefine this contract.

## Contents

- [Target ladder](#target-ladder)
- [Evidence states](#evidence-states)
- [Evidence lanes](#evidence-lanes)
- [Review record interfaces](#review-record-interfaces)
- [Plain-language verdict interface](#plain-language-verdict-interface)
- [Target-scoped veto contract](#target-scoped-veto-contract)
- [Decision order](#decision-order)
- [Re-review identity](#re-review-identity)

## Target ladder

| Target ID | Supported use | Minimum evidence expected |
|---|---|---|
| `internal-demo` | Controlled demonstration | Golden path runs and failure is recoverable in the controlled environment |
| `private-beta` | Limited real users | Critical journeys, access boundaries, and recovery are tested |
| `public-launch` | Public availability | Runtime evidence covers critical journeys, abuse boundaries, and operations |
| `real-money` | Money or sensitive data | Payment/data invariants, retries, authorization, recovery, and monitoring are verified |
| `high-stakes` | Regulated or consequential use | Domain review, compliance controls, rollback, auditability, and incident response are verified |
| `venture-case` | Venture judgment | Product and market evidence matches the diligence depth; do not treat this as a software release tier |

When even `internal-demo` is unsupported, say `no supported release tier` or describe the narrower fixture actually proven. Never rename an unrun golden path an internal demo.

Every `skeptical-vc` review uses `venture-case`. Its degree maps to an exact stage: `quick-check` → `screening`, `strict-review` → `structured-diligence`, `launch-gate` → `partner-review`, `real-stakes` → `full-diligence`, and `life-or-death` → `investment-committee`.

## Evidence states

| State | Meaning | Typical support |
|---|---|---|
| `E3 REPRODUCED` | Direct, repeatable observation | Browser or network trace, database before/after, exact failing request, repeated runtime test |
| `E2 INSTRUMENTED` | Independent machine-produced support | Automated test, log, metric, trace, persisted state |
| `E1 STATIC` | Reachable code, configuration, or document fact with runtime consequence still inferred | Missing ownership predicate, charge retry without an idempotency control, conflicting current documentation text |
| `E0 UNVERIFIED` | Claim, guess, generic concern, or unavailable evidence | Founder statement, documentation promise, checklist speculation |

Severity and evidence strength are independent. An E1 defect may fail a required check and make a target `NOT_READY`, but activate a runtime veto only with E3/E2 evidence or complete deployment evidence that rules out a compensating layer. An E3 cosmetic failure can remain low severity.

Evidence is fresh only when it was produced against the exact artifact or deployment manifest named by the verdict's immutable `sha256:<64 lowercase hex>` `release_ref`. A persistent record also names an explicit identity root, inclusions, exclusions, and one symlink policy: reject all, hash link metadata, or follow only within the root. A recent run against another revision is stale, and a mutable alias such as `latest` is not a release identity. Repository CI, JSON/schema validation, and fixture-shape checks prove structure only; never describe them as proof that the reviewed product or an LLM evaluator behaved correctly.

Calibrate severity by consequence: `BLOCKER` means an active veto or the target's core use is unsafe or impossible; `HIGH` means material user, money, data, or release harm; `MEDIUM` means a bounded but real product failure; `LOW` means limited impact that still has a concrete product consequence.

## Evidence lanes

Keep these four lanes separate in every verdict:

```text
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
```

- Use `deterministic-checks` for current code, type, unit, contract, schema, or other exact checks.
- Use `critical-journey-e2e` only for an exercised user journey on the identified artifact, build, or deployment. Structural repository checks cannot pass it.
- Use `probabilistic-eval` only when the product contains LLM, agent, or RAG behavior. A `PASS` or `FAIL` needs at least two total runs under one immutable model, prompt, eval-set, judge, applicable tool/retrieval system, and predeclared threshold policy. Record observed pass rate and standard deviation. The minimum pass rate must be at least 50/65/75/85/90 for internal demo/private beta/public launch/real money/high stakes, and the maximum standard deviation at most 30/25/20/15/10 points respectively. A `PASS` must meet both recorded thresholds; a `FAIL` needs at least one observed pass-rate or variance threshold miss.
- Use `continuous-evidence` for logs, metrics, traces, or alerts from the identified running release.

`PASS` and `FAIL` require fresh reproducible evidence that explicitly declares the same lane. `PASS` cannot hide a cited or uncited fresh same-lane fail, mixed, or inconclusive result; any fresh current fail or mixed record forces that lane to `FAIL`. `UNVERIFIED` and `N/A` carry no evidence IDs. Never reuse one evidence record across lanes or let one passing lane stand in for another. A failing required lane makes the release not ready; an unverified required lane limits the verdict to insufficient evidence.

Required software-release lanes apply only to non-VC targets:

| Scope | Required lane |
|---|---|
| Every non-VC target | `critical-journey-e2e` |
| `private-beta` and above | `deterministic-checks` |
| `public-launch` and above | `continuous-evidence` |
| Non-VC LLM, agent, RAG, or mixed behavior | `probabilistic-eval` |

For non-VC reviews, mark probabilistic eval `N/A` with a reason when `ai_behavior` is `none`; otherwise it cannot be `N/A`. For `venture-case`, mark all four software-release lanes `N/A`, each with a reason, regardless of `ai_behavior`; judge real users, retention, and repeatable distribution through separate venture signals. Record a separately requested software-release judgment in a separate review.

## Review record interfaces

```text
Finding = {
  id: F-###,
  severity: BLOCKER | HIGH | MEDIUM | LOW,
  title,
  promise_or_invariant,
  preconditions,
  reproduction_steps,
  expected,
  actual,
  evidence: {id: E-###, state: E1 | E2 | E3, exact_artifact_or_observation}[1..],
  impact,
  suspected_cause: explicitly_labeled_inference,
  minimum_fix_or_agent_prompt,
  acceptance_test,
  adjacent_regression_check
}

Unknown = {
  id: U-###,
  unresolved_condition,
  why_it_matters,
  missing_evidence,
  resolving_test
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
  scorecard_ref: immutable_sha256 | null
}

VentureAssessment = {
  stage: screening | structured-diligence | partner-review |
         full-diligence | investment-committee,
  evidence_maturity: claims-only | single-signal | multi-signal | complete,
  strongest_proven_signal: none | real_users | retention | repeatable_distribution,
  largest_unsupported_leap,
  signals: {
    real_users: {status: present | missing | unknown, evidence_ids: unique E-###[]},
    retention: {status: present | missing | unknown, evidence_ids: unique E-###[]},
    repeatable_distribution: {status: present | missing | unknown, evidence_ids: unique E-###[]}
  }
}
```

A generic warning is not a `Finding`. Connect it to a reachable product state, an invariant, an observed or static fact, and a consequence. Keep hypotheses as `Unknown` until resolved. Use `WorkflowBlocker` only after the artifact gate passes, for missing access, dependencies, environments, or external decisions that prevent required work or verification. The absence of any resolved review subject is a pre-review input gap, not a workflow blocker; do not create a verdict or ledger for it. An active blocker has no resolution evidence, while a resolved blocker needs fresh current passing non-E0 proof bound to that blocker. Bind blocker, release-check, and venture-signal evidence to the named record, and never reuse one record across siblings. The persistent field-level rules are in `references/audit-ledger.md`.

For cross-surface documentation review, the observed words and their semantic contradiction may be an E1 `document` fact even though each surface's promise about runtime behavior remains E0. Confirm the misleading conflict as a finding when it has a concrete consequence. If no declared source resolves the intended contract, preserve that question as an `Unknown`; regardless of the intended contract, keep actual runtime behavior unknown until fresh E2/E3 evidence resolves it. An unavailable surface is missing evidence, never proof of consistency.

## Plain-language verdict interface

```text
IssueLine = [severity · finding.id · lifecycle_status] what_happens: why_it_matters.
UnknownLine = [UNKNOWN · unknown.id · UNVERIFIED] what_is_not_yet_known: why_it_matters.
BlockerLine = [BLOCKER · blocker.id · ACTIVE] what_prevents_work: what_is_missing.

Verdict = {
  issues: {
    confirmed_findings: IssueLine[],
    pending_verification: (IssueLine | UnknownLine | BlockerLine)[]
  },
  evidence_lanes: EvidenceLanes,
  workflow_blockers: WorkflowBlocker[],
  release_checks: ReleaseCheck[],
  scoring: Scoring,
  venture_assessment?: VentureAssessment,
  release_ref,
  requested_target,
  maximum_safe_target,
  decision,
  product_score?: numeric_score_only_if_requested,
  evidence_coverage,
  confidence,
  active_gates,
  blocking_gates,
  detailed_findings: Finding[],
  detailed_unknowns: Unknown[],
  priority_actions: Action[0..3],
  retest_plan
}
```

Render `issues` first, in the user's language. Put every confirmed finding in one globally sorted list, including accepted risks, verified fixes, and findings whose current fix status is unverifiable; do not split it into lifecycle buckets. Begin every finding line with severity, stable ID, and lifecycle status, then give exactly one ordinary-language sentence describing what happens and why it matters. Sort by `BLOCKER`, `HIGH`, `MEDIUM`, `LOW`, then stable ID. Never cap, merge, or omit findings for brevity, and omit fixes, steps, evidence, causes, and jargon from these lines.

Immediately follow that list with one `Pending verification` subsection containing only `unverifiable` findings, open unknowns, and active workflow blockers, phrased as unresolved rather than factual. An unverifiable finding remains in the confirmed list because the original problem was confirmed, and also appears here because its current fix status is unknown. Explicitly state when either list is empty. Show the four-lane evidence panel next.

When cross-surface documentation consistency ran, follow the four evidence lanes with the compact `Documentation consistency` coverage block defined in `references/documentation-consistency.md`, including mode, scope, canonical source, sanitized source snapshots, complete or partial coverage, comparison rows, and linked check/finding/unknown IDs. In a canonical saved-ledger rendering, use the `documentation-contract-consistency` release check and its bound sanitized evidence to carry the same result; do not invent an unvalidated top-level ledger field.

The three-item limit applies only to `priority_actions`. Keep distinct IDs when causes, fixes, or retests differ. `skeptical-vc` may replace the release-oriented body with its stage-aware body, but never the complete opening issue groups.

## Target-scoped veto contract

These gate IDs are fixed:

- `authorization-bypass`
- `sensitive-data-exposure`
- `irreversible-data-loss`
- `duplicate-real-charge`
- `critical-flow-false-success`

```text
Gate = {
  id: fixed_gate_id,
  state: active | fixed,
  evidence_ids: unique E-###[],
  retest_evidence_ids: unique E-###[],
  affected_targets?: nonempty_unique_software_target_id[]
}
```

`affected_targets` uses only the five software target IDs: `internal-demo`, `private-beta`, `public-launch`, `real-money`, and `high-stakes`. List every affected target explicitly; omission means all five for backward compatibility. Never include `venture-case`; VC safety belongs in a separate software-release review. A gate blocks and caps only when it is active and the requested target is in its scope. Preserve out-of-scope active gates in the report because they may constrain another release target.

`active_gates` contains every active gate and its normalized scope; `blocking_gates` is the subset affecting the requested target.

Activate a gate only from fail/mixed evidence meeting the E3/E2 rule above or from complete deployment evidence with no plausible compensating layer. Gate evidence declares the matching gate ID. A fixed gate requires fresh passing runtime or test evidence bound to that same gate and reproduction path; an unrelated green test cannot close it. Do not waive or average away an in-scope active gate; explicit risk acceptance does not turn it into a technical pass.

## Decision order

For a non-VC review, apply the first matching rule:

1. In-scope active gate, `blocked` finding, or active top-level workflow blocker → `BLOCKED`.
2. Failed required evidence lane or release check, or unresolved `BLOCKER` or `HIGH` finding → `NOT_READY`.
3. Unverified required lane or release check, `unverifiable` finding, or open unknown → `INSUFFICIENT_EVIDENCE`.
4. Readiness below the applicable threshold when scoring is requested → `NOT_READY`.
5. Any other non-verified finding, non-passing optional release check, or out-of-scope active gate remains → `READY_WITH_CONDITIONS`.
6. Otherwise → `READY`.

For a `skeptical-vc` review, keep software-release gates and checks in a separate review, set `maximum_safe_target` to `not-assessed`, and apply the first matching rule:

1. Active workflow blocker, `blocked` finding, open unknown, or an `unknown` venture signal → `INSUFFICIENT_EVIDENCE`.
2. Requested numeric scoring below its threshold → `NOT_INVESTABLE_YET`.
3. All three venture signals `present` → `INVESTABLE`.
4. At least one signal `present` and the rest `missing` → `INTERESTING_BUT_UNPROVEN`.
5. Otherwise → `NOT_INVESTABLE_YET`.

Report the requested target and the maximum safe target separately. For non-VC reviews, the maximum cannot exceed the request; a ready decision supports the requested target exactly, and a non-ready decision must name a lower tier or `no-supported-release-tier`. A high-quality artifact with weak evidence can have a strong product assessment and an insufficient-evidence release decision.

## Re-review identity

Preserve the prior target, every finding and unknown ID, reproduction steps, acceptance tests, rubric ID, dimension IDs, weights, and whether numeric scoring was requested. Re-run the same path and adjacent checks. Classify each prior record as `FIXED`, `PARTIALLY_FIXED`, `NOT_FIXED`, `REGRESSED`, or `UNVERIFIABLE`; repeat only `UNVERIFIABLE` under pending verification. Do not treat a code diff as proof, change the rubric to reward the new implementation, or add/remove numeric scoring inside an existing snapshot chain.

The same defect class found at a second location is a new finding, not a reopening of the first. Two instances of one flaw — the same missing predicate on a second page, the same unguarded retry in a second worker — carry different reproduction paths and different acceptance tests, so merging them under one ID means fixing the first silently closes the second. Give the second instance its own ID even when the root cause is identical; group them with a shared `RC-###` if that helps sequencing, and never renumber or delete an existing finding to make the set look tidier.

That rule assumes the second instance was found. Finding it is a separate obligation, and it splits into two questions that behave differently:

- **Extent of condition** — where else does this same defect sit? Broad but shallow, usually one re-runnable expression, and it terminates. Do it when the root cause is formed, before authorizing a fix: three call sites and forty call sites deserve different fixes, and the user is authorizing a different amount of work in each case. Discovering the count after hand-editing three of forty means the fix was designed on a false premise and now adds a second inconsistency.
- **Extent of cause** — what *else* did this same cause produce? Narrow but deep, judgment-bound, and it expands without a natural boundary. Do it after the root cause is established, and only where the consequence justifies the cost.

Keep them apart. They are answered at different times, cost different amounts, and drive different actions: the first bounds the current batch, the second opens new ones. Collapsing them is what turns a bounded sweep into an unbounded one.

Record the sweep as a re-runnable expression with the scope it covered, never as a prose claim of thoroughness. An expression can be re-run by someone who doubts it; "I checked" cannot. When no expression can enumerate the class — the defect is semantic, or the instances share no mechanical signature — say so and name what was attempted. A class nobody can enumerate is a class nobody can prove closed, which is itself a finding at a release-blocking degree.

A class closes by one of four routes, and converting every instance is only the first: convert them all; build a chokepoint that makes the remaining ones unreachable; install a ratchet that freezes the count under enforcement so it can only decrease; or name the remainder and have the user accept it. The ratchet is what makes a forty-instance class tractable without pretending it is gone.

Identity rules constrain how prior records are re-scored; they never limit discovery. A fix batch's re-review also opens the changed surface — the diff between the prior and new `release_ref` — as fresh audit surface under the same role rubric, because fix code is new, written under closure pressure, and audited by no earlier pass. File its defects as new findings with new IDs under the same evidence rules; never declare a batch closed while its delta audit is unrun or has open findings.

Delta audit and class sweep look similar and cover opposite ground. The delta audit reads what the batch changed; the class sweep reads what it did not. A batch can pass its delta audit cleanly while leaving every unfiled instance of its own defect untouched, so neither substitutes for the other.
