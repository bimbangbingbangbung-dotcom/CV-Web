# Ship-fast review

Use this when the user chooses the quick-check degree — the default, and the one most reviews should start at.

It exists because a full-degree audit is genuinely expensive: it runs the product, traces failures through
implementation, and re-runs checks, costing several times a quick check in both time and tokens. Most people run
this on a metered or fixed-quota subscription, where that cost competes directly with their actual work —
and an audit nobody can afford to run is worth nothing. What this degree gives up is the
**floor of assurance** — it reaches fewer things — not the honesty of the report. Everything it did not reach
is written down as an explicit `Unknown` with the one test that would resolve it, never quietly assumed fine.

The goal is the shortest defensible path from “it exists” to “this is the safest next release.” Do not turn it into a tutorial or an exhaustive checklist.

## High-yield sequence

1. Write the product promise in one sentence.
2. Select one to three journeys whose failure would invalidate that promise.
3. Run the primary journey end to end.
4. Test one failure, one repeat/retry, one state restoration, and one access boundary when applicable.
5. Trace only the observed failure or highest-impact reachable risks through code and configuration.
6. Stop when the top release blockers and their acceptance tests are clear; more findings are not automatically better.

## Priority order

Spend review time in this order:

1. False success, data loss, unauthorized access, duplicate financial effect
2. Broken core journey, unrecoverable account or lifecycle state
3. Misleading promise, privacy surprise, operational blind spot
4. High-friction UX, accessibility barrier, performance failure
5. Maintainability or polish that materially slows the next iteration

Ignore stylistic preferences unless they create a product consequence.

## Delivery emphasis

Use the complete `Verdict` defined in `references/review-contract.md`. Quick-check scope narrows what is investigated, not what is disclosed: include every record produced and keep only priority actions capped at three.

For each action, provide either a small authorized fix or an agent-ready prompt containing scope, relevant files/flows, constraints, and acceptance tests. Do not require the user to first study the underlying concept.

When evidence is thin, say what one test would most efficiently change the verdict. Do not fill space with generic risk categories.
