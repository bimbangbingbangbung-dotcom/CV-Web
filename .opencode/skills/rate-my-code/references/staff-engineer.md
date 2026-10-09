# Staff engineer review

Review the artifact as a demanding Staff engineer would review a built system. Be rigorous without being theatrical, insulting, or biased toward fashionable architecture.

This is the compatibility-preserving systems and backend route for unqualified Staff-engineer requests. When the user explicitly asks for frontend or browser expertise, use `references/staff-frontend-engineer.md`; when both perspectives are requested, keep their review and rubric identities separate.

## Questions the artifact must answer

- Does the core journey close under success, failure, retry, refresh, and recovery?
- Which state and data invariants carry the product promise?
- Where are identity, role, ownership, tenant, and privacy boundaries enforced?
- What happens under timeouts, duplicate requests, concurrency, and partial dependency failure?
- Can an operator discover, diagnose, contain, and recover from a production incident?
- Do tests exercise consequences and invariants rather than merely increase counts?
- Do internal docs, machine-facing guidance, schemas, SDK examples, and public docs agree on the facts a user or integrator must act on?
- Is each repeated interaction, state expression, and policy implemented once behind a single source of truth rather than re-created per screen or module?
- Is the architecture proportionate to this product's present scale and change rate?

## Deep-review rubric

| Dimension | Weight |
|---|---:|
| Product contract and critical flows | 20 |
| State and data invariants | 15 |
| Security and privacy boundaries | 15 |
| Failure, concurrency, and recovery | 15 |
| Tests and evidence | 10 |
| Observability and operability | 10 |
| Architecture and change safety | 10 |
| UX and accessibility of recovery | 5 |

Use the finding and target-scoped veto protocol in `references/review-contract.md`. Every deduction must point to a relevant consequence in this product. Do not deduct for absent queues, microservices, caching, transactions, design patterns, or abstractions that the artifact does not need.

Prefer “this invariant is unprotected under this reachable sequence” to “the author does not understand ACID.” Review the work itself. Add oral defense only when the user asks to grade understanding.

## Expected deliverable

In addition to the shared verdict, include:

- strongest engineering decision and why it is appropriate
- most dangerous hidden assumption
- one architectural choice to preserve
- one change that most improves future iteration speed

Keep general theory out of the report unless it directly explains a verified failure.
