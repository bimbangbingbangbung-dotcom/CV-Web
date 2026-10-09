# Numeric scoring

Load this file only when the user explicitly requests a numeric grade, comparison, release score, or score delta. The score supplements the decision contract in `references/review-contract.md`; it never replaces evidence or vetoes.

## Contents

- [Default rubric and anchors](#default-rubric-and-anchors)
- [Scorecard interface](#scorecard-interface)
- [Validation rules](#validation-rules)
- [Scorer output and policy](#scorer-output-and-policy)
- [Same-rubric comparison](#same-rubric-comparison)

## Default rubric and anchors

Use these weights for `ship-fast` unless a dimension is truly inapplicable. Explain and redistribute any removed weight before scoring. Other modes take their weights from their route reference.

| Dimension | Weight | Credit |
|---|---:|---|
| Product promise and scope | 10 | Built behavior matches the claimed job and target |
| Critical user journeys | 20 | Golden, failure, retry, refresh, and recovery paths close correctly |
| UX and accessibility | 10 | Users can understand, operate, and recover through core flows |
| Data and state integrity | 15 | Invariants survive duplicate, concurrent, partial, and out-of-order actions |
| Security and privacy | 15 | Identity, role, ownership, tenant, secret, and data boundaries hold |
| Reliability and operations | 10 | Dependencies, deployment, rollback, monitoring, and support are proportionate |
| Change safety | 10 | Design is understandable, testable, and appropriate to the stage |
| Verification quality | 10 | Evidence targets actual risks rather than vanity coverage |

Score each dimension from 0–100:

- 90–100: independently verified, resilient, and appropriate for the target
- 75–89: credible with bounded conditions or minor gaps
- 60–74: suitable only for a narrower target; material risks remain
- 40–59: fragile, substantially unverified, or missing a critical property
- 0–39: broken, misleading, or unsafe in this dimension

Default readiness thresholds are `internal-demo: 50`, `private-beta: 65`, `public-launch: 75`, `real-money: 85`, `high-stakes: 90`, and `venture-case: 70`. Treat them as calibration points. State justified adjustments in prose; never lower a threshold to turn an observed failure into a pass.

## Scorecard interface

Create UTF-8 JSON with this shape:

```text
Scorecard = {
  schema_version: "2",
  mode: ship-fast | product-lead | staff-engineer | staff-frontend-engineer | hostile-user | skeptical-vc | oral-defense,
  rubric_id: nonempty_string,
  release_target: internal-demo | private-beta | public-launch | real-money | high-stakes | venture-case,
  release_ref: sha256_of_the_exact_artifact_or_deployment_manifest,
  ai_behavior: none | llm | agent | rag | mixed,
  dimensions: Dimension[1..32],
  evidence: Evidence[0..512],
  evidence_lanes: EvidenceLanes,
  coverage: {runtime, critical_paths: {total, tested}},
  gates: Gate[],
  release_checks: ReleaseCheck[1..],
  vc_signals?: VCSignals
}

Dimension = {
  id,
  weight: integer_1_to_100,
  score: integer_0_to_100,
  verification: verified | partial | unverified,
  evidence_ids: unique_known_id[]
}

Evidence = {
  id,
  kind: runtime | test | code | log | metric | eval | interview | document | claim,
  lane: deterministic-checks | critical-journey-e2e | probabilistic-eval | continuous-evidence | vc-real-users | vc-retention | vc-repeatable-distribution | other,
  result: pass | fail | mixed | inconclusive,
  reproducible: boolean,
  fresh: boolean,
  release_ref: sha256:<64_lowercase_hex>,
  gate_id?: fixed_gate_id,
  runs?: integer,
  provenance?: {model, prompt, eval_set, judge, system?},
  eval_metrics?: {
    minimum_pass_rate,
    observed_pass_rate,
    maximum_standard_deviation,
    observed_standard_deviation
  }
}

EvidenceLanes = {
  deterministic-checks: EvidenceLane,
  critical-journey-e2e: EvidenceLane,
  probabilistic-eval: EvidenceLane,
  continuous-evidence: EvidenceLane
}

EvidenceLane = {
  status: PASS | FAIL | UNVERIFIED | N/A,
  evidence_ids: unique_known_id[],
  reason?: required_only_for_N/A
}

Gate = canonical Gate from references/review-contract.md

ReleaseCheck = {
  id,
  required: boolean,
  status: pass | fail | unverified,
  evidence_ids: unique_known_id[]
}
```

`skeptical-vc` requires `release_target: venture-case` and all three `vc_signals`: `real_users`, `retention`, and `repeatable_distribution`, each with `{status: present | missing | unknown, evidence_ids}`. A present signal needs fresh passing evidence with its matching `vc-*` assertion class; one evidence item cannot substitute across signals. Other modes reject `venture-case` and `vc_signals`.

## Validation rules

- Dimension weights total exactly 100.
- `verified` needs fresh reproducible non-claim evidence whose `release_ref` equals the scorecard; `partial` needs at least one evidence item.
- The root and every evidence item use the same immutable `sha256:<64 lowercase hex>` release identity. Mutable aliases such as `latest`, `main`, or `production` are rejected.
- Passing checks need only fresh reproducible passing non-claim evidence whose `release_ref` equals the scorecard; failing checks need fresh same-release fail/mixed evidence.
- Gate evidence declares the matching `gate_id`. Active gates need fresh same-release fail/mixed runtime, test, log, or metric evidence bound to that gate. Fixed gates need fresh passing runtime or test evidence bound to the same gate; an unrelated green test cannot close it.
- Every evidence item declares its assertion lane. Each lane's `PASS` or `FAIL` may cite only fresh reproducible same-release evidence whose declared lane and kind match: `test|code`, `runtime`, `eval`, or `log|metric`, respectively. A `PASS` rejects cited or omitted fresh same-lane fail, mixed, or inconclusive evidence. An evidence ID cannot appear in multiple lanes. `UNVERIFIED` and `N/A` cite none; `N/A` requires a reason.
- When `ai_behavior` is `none`, `probabilistic-eval` must be `N/A`. Otherwise it cannot be `N/A`; eval evidence requires at least two runs sharing one immutable model/prompt/eval-set/judge/system identity and one predeclared threshold policy. Agent/RAG evidence records the tool or retrieval system version. The minimum pass rate cannot be below the selected release-readiness threshold; the maximum standard deviation is capped at 30/25/20/15/10 points for internal demo/private beta/public launch/real money/high stakes. A `PASS` must meet both thresholds.
- For non-VC readiness, critical-journey E2E is required at every target, deterministic checks from private beta onward, and continuous evidence from public launch onward. Probabilistic eval is required only for products with LLM, agent, or RAG behavior.
- `affected_targets` is optional for old scorecards. When supplied it must be nonempty, contain no duplicates, and use supported release-target IDs. Omission expands to all targets.
- `static` or `none` runtime requires zero tested critical paths. `partial` requires at least one but fewer than all declared critical paths; `e2e` requires every declared critical path to be tested.

Run the deterministic standard-library scorer:

```bash
python3 <skill-directory>/scripts/score_review.py [--pretty] path/to/scorecard.json
```

Scorecard schema `2` adds release-bound evidence lanes and AI-evaluation provenance. Schema `1` inputs are intentionally rejected; regenerate them against the reviewed release before scoring rather than silently carrying old evidence forward.

## Scorer output and policy

The scorer returns:

- `scores.raw_product`: weighted artifact quality before evidence limits
- `scores.readiness`: value after confidence, venture-evidence, and in-scope safety caps
- evidence and critical-path coverage plus confidence
- the four non-substitutable evidence lanes and their required-lane gaps
- `active_gates`: every active gate with its affected-target scope
- `blocking_gates`: the active subset affecting the requested target
- applied caps, release checks, decision, and `vetoed`
- policy/schema versions and a rubric fingerprint

Only `blocking_gates` add safety caps, cause `BLOCKED`, and set `vetoed: true`. Out-of-scope active gates remain visible without changing the requested-target decision. The confidence ceiling limits readiness, not raw product quality. Venture-evidence caps apply only to missing/unknown VC signals.

The rubric fingerprint hashes `rubric_id`, mode, release target, and sorted dimension IDs/weights. It detects rubric drift; it intentionally does not encode observations, scores, evidence, gate state, or gate scope. The separate `release_ref` binds readiness evidence to the reviewed artifact, build, or deployment.

## Same-rubric comparison

Preserve the prior scorecard, target, rubric ID, dimension IDs, and weights. Re-run the same reproduction and acceptance paths. Compare raw-product and readiness deltas separately: stronger evidence can raise readiness without changing the underlying artifact score.
