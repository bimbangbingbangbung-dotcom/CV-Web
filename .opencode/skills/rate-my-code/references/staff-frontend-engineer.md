# Staff Frontend engineer review

Review the shipped client experience as a Staff Frontend engineer: correct, inclusive, resilient, measurable, and safe across the product's supported browsers and devices. Judge observable contracts and user consequences, not framework fashion or personal taste.

## Questions the artifact must answer

- Do critical journeys survive clean load, hard refresh, deep links, back/forward navigation, session expiry, resource failure, and offline/online transitions?
- Are URL, local, cached, and server state reconciled predictably under cancellation, retry, optimistic updates, duplicate actions, multi-tab use, and out-of-order responses?
- Does component state survive the things that should not disturb it and reset for the things that should? Name the failures rather than the principle: an effect reading a value captured on an earlier render, state holding something derived from a source that later changes without it, an effect whose own write re-triggers it, a list rendered without stable keys so a reorder remounts rows and drops what was typed into them, and state that outlives a route change it should have been cleared by.
- Can critical tasks be completed with keyboard, screen reader, zoom/reflow, touch, and reduced motion, with correct semantics, focus, announcements, contrast, and error association?
- Is loading, responsiveness, and visual stability acceptable on representative devices and networks, based on a reproducible trace or product metric rather than intuition?
- Do supported browsers, viewport sizes, orientation changes, pointer types, virtual keyboards, safe areas, long content, and localized text preserve every critical control?
- Does text hold together as set at every supported width: no last line stranded with a single word or character, no punctuation pushed to a line start, a readable measure and leading, and line-breaking correct for every script the product ships?
- Does every data-driven surface have a defined behavior in every state it can be in — not requested yet, loading, empty, error, stale over old data, partially failed, loaded? A skeleton, a shimmer, an empty state and an optimistic value are placeholders in the professional sense and are correct engineering; the defect is a state with nothing designed for it, or a placeholder that never resolves.
- Is there anything behind what the user can reach? The other kind of placeholder is leftover work — TODO, not implemented, an empty catch, a handler that does nothing, copy that still says coming soon, a key that still says your-key-here. Finding them is a search; the judgement is whether a user can reach one, and what happens when they do.
- Did the data on screen come from anywhere? For every value that varies by account, user, or time, a first load must show a request that produced it, the value must differ across two accounts, and it must move when the underlying record changes. A screen that renders numbers with no request behind them is not displaying data; it is asserting one.
- - Does the hierarchy survive without the words? Blur a screenshot to about five pixels and drop the colour: what remains is what a reader takes in before reading anything. The dominant element should be the one you meant, section boundaries should still be findable, and an aside should not outweigh what it annotates. Repeat with only the text masked and the boxes kept, and grouping and reading order should still be legible from position and mass alone.
- - Do components, tokens, variants, states, and interaction conventions form one coherent system, with justified exceptions rather than parallel one-offs?
- Are forms, pending states, validation, duplicate submission, partial failure, destructive actions, and retry or undo paths safe and recoverable?
- Is interaction feedback immediate and predictable? Is motion purposeful for its frequency, interruptible, performant, input-aware, and respectful of reduced motion?
- Are authorization and sensitive-data boundaries enforced beyond the client? Can untrusted content reach unsafe rendering, navigation, storage, messaging, upload, or telemetry paths?
- Can production failures, degraded performance, and regressions be detected, reproduced, attributed to a release, tested deterministically, and rolled back safely?

## Frontend review matrix

Rate only dimensions that apply to the product and target. For numeric scoring, use these weights and the anchors in `references/numeric-scoring.md`:

| Dimension | Weight |
|---|---:|
| Browser and runtime correctness | 12 |
| Real data and real behavior | 12 |
| State and data flow | 10 |
| Accessibility and inclusive input | 12 |
| Performance and perceived responsiveness | 9 |
| Responsive and cross-browser behavior | 3 |
| Design-system consistency | 3 |
| Typography and text setting | 3 |
| Forms, errors, and recovery | 9 |
| Interaction and motion craft | 3 |
| Client security and privacy boundaries | 9 |
| Testability | 7 |
| Observability | 3 |
| Change safety | 5 |

A hardcoded value is the defect this audience ships most and the one a review is least likely to catch: it renders, it never crashes, every test passes, and it looks exactly like the real thing. Three checks, cheapest first. Load the screen fresh and watch the network — data on screen with no request behind it is fabricated. Open the same screen as a second account and compare; a real value differs, an invented one does not. Change the underlying record and reload; a real value moves.

Hierarchy has a check and does not have to be argued about. Human vision reads mass, contrast and grouping before it reads a word, so blurring a screenshot shows what the first glance actually receives; greyscale removes colour as a crutch and leaves only whether the structure carries itself. What it catches is what normal reading hides, because a reader's eye skips decoration to reach the text while a first glance does not: everything weighted the same so there is no entry point, emphasis landing on something you did not intend, a group that exists in your head but not on the page, and an annotation heavier than the thing it annotates. Treat a failure as a finding about the surface, with the blurred capture as its evidence.

A loading placeholder is judged by what happens when it goes away, not by how it looks. Swap it for real content and measure the shift: a skeleton whose rows, line counts, and column widths match what arrives produces none, and one that does not throws the page down as the data lands. That is Cumulative Layout Shift and it has a published threshold, so "how many rows" and "how is it aligned" both reduce to one observable question. Four more are mechanical. A shimmer is an infinite animation and must stop under `prefers-reduced-motion`. The loading region must be announced, or a screen-reader user gets silence and then sudden content. A skeleton shown for a response that returns in fifty milliseconds is a flash, so the loading state is normally delayed a couple of hundred milliseconds and then held long enough not to flicker. And a skeleton over data you already have — a title carried in from the previous screen — hides something you could show.

Two things share the word placeholder and only one of them is a defect. A skeleton screen, a shimmer, an empty state, a spinner, an optimistic value, a suspense fallback — these are the vocabulary a competent frontend uses to say "not yet", and flagging them is a false positive that costs the review its credibility on exactly the codebases that got this right. What goes wrong with them is a missing state rather than a present placeholder: enumerate the surface's states — not requested, loading, empty, error, stale over old data, partially failed, loaded — and find the one nobody designed. A generated frontend typically ships loading and loaded and leaves the rest to render as though nothing were wrong. A placeholder that never resolves is the same fault seen from the other end.

Leftover work is the cheaper half and is graded here too. A search finds the markers in seconds; every codebase has some, so presence is not the finding. Trace each one to a path a user can reach and say what happens when they arrive — a TODO in a build script is nothing, a no-op handler on the button that deletes an account is a blocker. The subclass worth hunting deliberately is the one that does not announce itself: an empty catch, or an error folded into a default, is a placeholder wearing the costume of handling, and it makes the failure invisible rather than visible.

Bound it to what should vary. Server-rendered and statically generated data legitimately arrives without a client request, so read the first response rather than the request list. A repeat visit may be served from cache, so test the first load. Pricing copy and legal text are supposed to be fixed and are not findings. The rule covers what varies by account, user, or time.

File it as a finding, not a proposal: a screen that shows a number asserts that number is true, and that is a promise the product makes by behaving that way — `promise_source` is `implied-by-behavior`, with the locator naming the screen and the value.

For every scored finding, name the exact journey, environment, browser or device when relevant, state and data preconditions, expected versus actual behavior, user consequence, evidence locator, confidence, and a falsifiable acceptance check. Prefer a real-browser reproduction, accessibility tree, network capture, runtime trace, or product metric. Static code may explain an observed failure but is not automatically runtime proof.

Use representative targets from the product's declared support contract. If that contract is absent, record the matrix as an unknown and test a minimal risk-based sample without pretending it is complete. Automated accessibility scans, one desktop browser, a fast developer laptop, or a synthetic performance score never prove the whole dimension.

Typography is judged as set text, not as taste. The defect is script-independent: a paragraph whose last line
carries a single word, or a heading broken into a long line and a stub. Latin and CJK differ only in what counts as
stranded — one word in Latin, one or two characters in CJK, where a single character is a complete morpheme — and in
the extra rules each script brings, such as the CJK convention that punctuation must not open a line.

Check whether the page uses the remedies that are now standard practice rather than hand-tuned line breaks:
`text-wrap: balance` on headings and other short blocks, `text-wrap: pretty` on body copy, a non-breaking space
binding the final two words where the algorithm cannot reach, and a measure held near 45–75 characters. Their absence
is not itself a finding; a stranded line at a supported width is.

Measure in a real browser at real widths, and beware two traps that produce false results. A paragraph that sets
correctly at one viewport can strand a word at another, so a single width proves nothing. And an inline element with
a different font size — `code`, `sub`, a smaller badge — produces a line box whose top differs from the surrounding
text on the same visual line; grouping rendered rectangles by exact position will report a phantom last line
containing only that element. Cluster line positions with a tolerance near the line height before judging.

Do not file font preference, exact leading values, a hyphenated compound breaking at its hyphen, or a house style the
product never declared.

To measure it rather than eyeball it, walk the text nodes of each block, take a rectangle per character, group those
rectangles into lines with a tolerance, and read the last group:

```js
// last-line content of one block, tolerant of smaller inline elements
const lh = parseFloat(getComputedStyle(el).lineHeight) || 24;
const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
const chars = [];
for (let n; (n = walker.nextNode()); )
  for (let i = 0; i < n.length; i++) {
    const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1);
    const b = r.getBoundingClientRect();
    if (b.width > 0) chars.push({ c: n.data[i], y: Math.round(b.bottom) });
  }
const rows = [...new Set(chars.map(c => c.y))].sort((a, b) => a - b)
  .reduce((g, y) => (g.length && y - g.at(-1).at(-1) <= lh * 0.6 ? g.at(-1).push(y) : g.push([y]), g), []);
const last = new Set(rows.at(-1));
const text = chars.filter(c => last.has(c.y)).map(c => c.c).join('').trim();
```

Score `text` by units, not by width: words for Latin, characters for CJK. A last line whose ratio to the block width
looks small is not automatically stranded — fifteen characters of code on a wide measure is fine. Repeat across the
product's supported widths; the same block can set correctly at one and strand at another.

## Judgment boundaries

Use the finding, severity, decision, and target-scoped veto protocol in `references/review-contract.md`. A core journey that is unusable for a required input mode or supported browser may be a release blocker by consequence, but only when verified and in scope. A missing preferred library, code style, component taste, or alternate architecture is not a finding.

Treat visual and motion craft as product quality only when it changes comprehension, responsiveness, accessibility, consistency, trust, or maintainability. Do not require animation merely because a surface is static. For frequent actions, responsiveness beats spectacle. Test gestures on a real touch device when they matter, gate hover behavior to hover-capable pointers, respect reduced-motion preferences, avoid broad transitions that hide unintended property changes, and prefer interruptible motion that does not delay repeated input.

Do not claim Core Web Vitals, accessibility, cross-browser support, or mobile readiness without direct evidence. Do not prescribe React, Vue, a state library, a design system, or an animation library unless the artifact's own contract makes it relevant.

## Expected deliverable

In addition to the shared verdict, include:

- strongest frontend engineering decision and why it is appropriate
- most expensive user-facing defect or hidden browser-state assumption
- one component, token, state, or interaction convention to preserve
- one change that most improves future frontend iteration speed

Keep unscored polish suggestions separate from release findings.
