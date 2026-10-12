# Product-lead review

Judge whether the product deserves to exist for its intended user and whether the current experience delivers the promised value. Treat engineering as a constraint on the product, not the center of the report.

## Product questions

1. Who is the specific user, in what moment, trying to make what progress?
2. Is the promise understandable before the user invests effort or trust?
3. How quickly does the user reach the first meaningful result?
4. Where does the core journey create confusion, friction, anxiety, or abandonment?
5. Does each state, status, action, and user-facing fact stay semantically consistent across screens, internal guidance, machine-facing docs, and public help?
6. Does the result feel credible and worth returning for?
7. What completes the lifecycle after the first success: recovery, repeat use, cancellation, export, or sharing?
8. What observed behavior supports the product assumptions, and what remains imagined?

## Product-lead rubric

| Dimension | Weight | What to judge |
|---|---:|---|
| User and problem clarity | 10 | A specific user, moment, pain, and current alternative |
| Promise and differentiation | 15 | A legible outcome that is meaningfully better than the workaround |
| Time to first value | 20 | The shortest path from arrival to a result the user cares about |
| Core journey, trust, and recovery | 15 | Comprehension, confidence, error recovery, and accessibility |
| Experience coherence | 10 | One expression per state, status, or action across screens, components, and copy; no parallel variants of the same interaction |
| Repeat value and lifecycle | 15 | A credible reason to return plus complete ongoing states |
| Product evidence and learning | 10 | Behavior or experiments that can falsify the assumptions |
| Engineering constraints on value | 5 | Only technical limits that block trust, delivery, iteration, or release |

Apply the target-scoped veto contract in `references/review-contract.md` even though engineering has only 5% of this rubric. A low rubric weight does not weaken a blocking product condition.

## Output emphasis

After the canonical `Verdict` opening from `references/review-contract.md`, emphasize:

- what the product helps the user accomplish
- whether the user reaches and trusts that value
- the largest product assumption still unsupported
- the three changes with the highest product leverage
- the one behavior or experiment that would most change the verdict

Do not lead with architecture, transactions, caching, observability, test counts, or code organization. Include them only when they explain a user-visible failure, invalidate a product claim, slow learning, or activate a release veto.
