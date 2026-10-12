# Skeptical-VC review

Review evidence of a business, not the founder's confidence or the code's elegance. Code matters only when it affects learning speed, cost, trust, defensibility, or compliance.

## Evidence hierarchy

Prefer:

1. observed user behavior and payment
2. cohort retention and repeated use
3. reproducible acquisition and conversion data
4. experiments with recorded outcomes
5. interviews, letters of intent, and waitlists
6. founder claims, market narratives, and imagined personas

Do not invent TAM, retention, willingness to pay, or distribution. Mark absent evidence as a hypothesis.

## Diligence depth

Use `venture-case` for every VC review and map the five review degrees without changing that target:

| Degree | VC depth |
|---|---|
| `quick-check` | `screening` |
| `strict-review` | `structured-diligence` |
| `launch-gate` | `partner-review` |
| `real-stakes` | `full-diligence` |
| `life-or-death` | `investment-committee` |

## VC rubric

| Dimension | Weight | Core question |
|---|---:|---|
| Problem pull | 15 | Is the problem specific, frequent, and costly enough to change behavior? |
| Behavioral evidence | 20 | What did users actually do, repeat, or pay for? |
| Retention and habit | 15 | Does value persist after novelty and founder assistance? |
| Wedge and alternatives | 10 | Why this narrow entry point versus the current workaround? |
| Distribution | 15 | Is there a repeatable path to the next users? |
| Economics and dependencies | 10 | Can the value support acquisition, serving cost, and platform risk? |
| Defensibility and expansion | 5 | What compounds, and what adjacent claim remains plausible? |
| Learning velocity | 10 | Can the team run the next falsifiable experiment quickly and honestly? |

## Stage-aware verdict

When real-user, retention, or repeatable-distribution evidence is absent, do not pretend the company has failed. Return:

- current hypothesis maturity
- strongest proven signal
- largest unsupported leap
- the next cheapest falsifiable experiment
- what result would change the verdict

Keep `product readiness` separate from `venture evidence`. A reliable app can still have no proven demand; early demand can coexist with an unsafe product. Mark all four software evidence lanes `N/A` with individual reasons, regardless of `ai_behavior`. Keep VC `gates` and `release_checks` empty and `maximum_safe_target` as `not-assessed`.

Begin with the canonical `Verdict` opening from `references/review-contract.md`. Then use this stage-aware body instead of the software-release body:

```text
Venture stage: degree-derived exact stage
Investability: INVESTABLE | INTERESTING_BUT_UNPROVEN | NOT_INVESTABLE_YET | INSUFFICIENT_EVIDENCE
Evidence maturity: claims-only | single-signal | multi-signal | complete

Strongest proven signal:
Largest unsupported leap:
Behavioral evidence:
Missing evidence:
Top 3 experiments:
What would change the verdict:
```

Persist the body as `venture_assessment`: use the exact degree-derived `stage` above; derive `evidence_maturity` from the number of present signals as zero → `claims-only`, one → `single-signal`, two → `multi-signal`, and three → `complete`; and set `strongest_proven_signal` to `none` or the ID of an actually present signal. Also record the largest unsupported leap and the three separate signals `real_users`, `retention`, and `repeatable_distribution`. Each signal is `present`, `missing`, or `unknown`. `present` requires fresh, reproducible, passing, non-claim evidence on the current artifact and bound to that exact signal; `missing` and `unknown` cite no evidence. Do not reuse one evidence record across signals.

Apply the first matching rule: an active workflow blocker, `blocked` finding, open unknown, or `unknown` venture signal gives `INSUFFICIENT_EVIDENCE`; a requested numeric score below threshold gives `NOT_INVESTABLE_YET`; all three signals `present` gives `INVESTABLE`; a mix of `present` and `missing` gives `INTERESTING_BUT_UNPROVEN`; otherwise give `NOT_INVESTABLE_YET`. Do not infer any venture decision from code quality alone.

If the artifact also handles money, sensitive data, or consequential actions, run a separate software-release review and ledger when requested. Do not invent or append a release target merely because the VC rubric is being used.

## Evidence traps

- Compliments are not behavior.
- Signups are not retention.
- Founder-led sales are not automatically a repeatable channel.
- A giant market does not prove a reachable wedge.
- AI-generated implementation speed is not a moat by itself.
- One user's intense need may be valuable evidence, but it does not establish segment size.
