# Artifact-grounded question generator

Load this file only when oral defense is ready to generate its first question, or when the user explicitly asks for a short explanation of a finding. Generate from the reviewed artifact; do not administer a preset curriculum.

## Question interface

```text
Question = {
  artifact_fact: exact route, state transition, component, or observed behavior,
  invariant: property this product must preserve,
  failure_event: one reachable disturbance or competing event,
  prompt: ask where the control lives and what evidence or acceptance test would falsify the answer
}
```

Build one question at a time:

1. Select a concrete artifact fact from a decision, finding, or high-impact unknown.
2. Infer the product invariant that fact must protect; do not reveal the expected mechanism.
3. Introduce one plausible failure event such as timeout, retry, overlap, stale state, partial completion, role change, deployment skew, or dependency loss.
4. Ask the author to trace the path, locate the control, and name observable evidence or an acceptance test.
5. Wait for the answer before generating the next question. Credit correct reasoning without requiring textbook vocabulary.

## Compact routing hints

| Artifact signal | Invariant family | Useful failure events and fundamentals |
|---|---|---|
| Multi-step state change, checkout, or external API | One durable effect and truthful outcome | partial commit, timeout, retry, reconciliation; transactions, idempotency, authority |
| Shared record, concurrent action, or check-then-act | No lost, duplicated, or invalid transition | overlap, reordered completion, stale read; atomicity, locking/versioning |
| Login, object ID, tenant, session, JWT, or client-side check | Correct identity, ownership, role, and trust boundary | identifier swap, expiry, revocation, role change; authentication versus authorization |
| HTTP endpoint, queue, job, cache, or index-backed query | Correct semantics under delivery and scale | duplicate/out-of-order delivery, poison work, stale cache, stampede, skewed data; API semantics and query evidence |
| Frontend request, optimistic UI, navigation, or submit | UI reflects authoritative state once | overlap, late response, rollback, double submit; cancellation, sequencing, reconciliation |
| Upload, rich input, or accessibility-critical journey | Same safe, comprehensible outcome for valid users | oversized or disguised input, unsafe rendering, keyboard/focus/error recovery |
| Migration, deployment, logging, monitoring, backup, or restore | Versions coexist and operators can detect and recover | rollback, schema skew, dependency outage, missing/sensitive telemetry, failed restore |

Choose only a signal present in the artifact. If no product-grounded fact exists yet, gather evidence instead of asking generic fundamentals.
