# Storytelling plan — content & editorial carousels

Status: **approved as a starting point (Oct 14, 2026).** Phase 1 is built
(#240). Everything else is not built yet. Each phase has a gate: the next
one does not start until the gate is met or the operator waives it.
Decisions are recorded at the end.

## The problem, in one paragraph

The Club Zanzibar carousel is the reference failure. Eleven slides, each a
true fact about a different source (exhibition, dissertation, research
guide, press piece, oral history project), none of them depending on the
one before. Two causes. **Research** returns documents *about* the subject
— no person, no scene, no quote, no where/when — so there is nothing to
tell. **Generate** then files one source per card (Cover + one News per
`IN START` + Done, length locked), so the deck becomes a reading list. On
top of that, two cards were visibly broken by the renderer and the schema.

## What success looks like

On a frozen set of desks, judged blind by the operator against today's
output:

- New decks win most pairs on "which one tells a story".
- No increase in unsupported claims.
- No clipped or overflowing text.
- Deck length follows the material, not the source count.
- Promo, roundup, and directory carousels are unchanged.

## Scope

- **In:** content and editorial registers (Feature tier, Editorial Insight,
  the Fuel → desk → Generate path).
- **Out:** promo, roundups, directories, Feature Drop, calendar, newsletter,
  website pipes. One card per item stays correct there.

## Ground rules for every phase

1. Behind a switch (`storyMode`, per matrix, default off) until Phase 3's
   gate is met.
2. Deterministic pieces get `node:test` coverage next to the existing
   `*.test.js` files. Model output is judged by the Phase 0 harness, not by
   unit tests.
3. Fresh `vite build` before every push (see `cge-ship`).
4. Warnings over silent rewrites. When a check fails, the operator sees it.
5. Removing a rule happens only after the thing that replaces it has
   passed its gate.

---

## Phase 0 — Measure first (harness + baseline)

Nothing changes in the product. This is how every later phase is judged.

**Build**

- `scripts/story-eval.mjs`, modeled on `scripts/run-gst-pipeline.mjs`:
  - Reads frozen desks from `evals/desks/*.json` (topic, hook, POV, lens,
    desk lines, citations — exactly what Generate receives).
  - Runs a named pipeline (`current`, later `story`) 3 times per desk.
  - Writes `evals/runs/<pipeline>/<desk>/<n>.json` plus rendered PNGs.
- Automatic checks, per deck:
  - **Unsupported names**: existing `detectPhantomEntities`.
  - **Restatement**: pairs of cards making the same claim (token overlap
    + an LLM judge, reported separately).
  - **Clipping**: any title field at its cap (`headlineLooksCut` logic), any
    line wider than the canvas.
  - **Source-dump cards**: card whose body only introduces a document.
  - **Deletion test**: remove each card, ask a judge whether the next card
    still reads. A card nobody misses was not connected.
  - Length vs. number of desk lines.
- Blind review export: `evals/review/<id>.html`, two decks side by side,
  shuffled, unlabeled, with three questions per pair (which tells a story;
  which slide could go; post as-is / light edit / reject). Answers save to
  JSON.

**Desk set**: Zanzibar plus 10–15 content/editorial desks, weighted toward
ones you rejected (reasons are already stored per matrix).

**Gate**: baseline numbers recorded for `current`. You agree the review
questions and the win bar *before* any new pipeline runs.

**Decision for you**: which desks; what counts as a win (proposed: new wins
≥ 60% of pairs and unsupported-claim count does not rise).

---

## Phase 1 — Fix the broken cards (independent, small) — built in #240

These are bugs. They ship regardless of the rest.

- **Clipped headlines.** `newsHeadline` has a 60-character schema cap; the
  model wrote a sentence and the cap chopped it ("…PUTS A SPECIFI"). Fix:
  when a title field is at the cap or reads as a sentence, move the sentence
  to the body and derive a short name instead of shipping the chop. Touches
  the fill schema / post-processing in `aiContent.js` and
  `slideRedoJob.js` (`headlineLooksCut` already detects it).
- **Closer overflow.** The CTA renderer in `MediaTool.jsx` shrinks the big
  centre line down to 44px and then lets it run off both edges. Fix: wrap
  at the floor instead of overflowing; reflow the divider, subtitle and
  link below the real block height so `@handle` cannot sit on the body.
- **Empty image half.** News/Text cards reserve the top half for a photo
  and render solid black without one. Fix: a no-photo layout that uses the
  space (text block moves up) until Phase 6 supplies images.

**Gate**: Phase 0 clipping check reports zero on the baseline desks.

---

## Phase 2 — Research for story material (Fuel)

The biggest upstream change. Today Fuel asks for atomic facts sorted by
source desk. Add the material a story is made of, as labeled desk lines.

**New desk line types** (alongside `START` / `GAP` / `DOCUMENT` /
`ARGUMENT`):

| Prefix | What it is | Rule |
|---|---|---|
| `LOCATE —` | where / when / who runs it (exhibition venue + dates, club address + years open) | warn before Generate when a live subject has none |
| `SCENE —` | a sourced moment with people in a place | must cite the page it came from |
| `VOICE —` | a short quote from a named person | verbatim + URL; otherwise rejected |
| `CHANGE —` | then → now, with both ends sourced | |
| `IMAGE —` | a usable picture: URL, credit, rights note | feeds Phase 6 |

**Build**

- `perplexityResearch.js`: scout and dive prompts ask for these alongside
  the brief; the response schema carries the prefix; "pull from inside the
  holding" (what the oral history / memoir / exhibition actually contains),
  not just the holding's title.
- Server validation in `/api/matrix/research`: `VOICE —` without a URL and
  quote marks is dropped to `UNVERIFIED —`.
- Matrix UI (`CuratorialMatrixModal.jsx`): show the line type as a chip so
  you can see at a glance whether a desk has a scene, a voice, a locate.
- `matrixEnums.js`: `BULLETS_MAX` stays 24; new types count toward it.

**Risks**: invented quotes and scenes. Mitigation is the URL + verbatim rule
and a spot-check of every `VOICE —` in the eval set.

**Gate**: on the eval desks, re-run Fuel: most desks gain at least one
`LOCATE` and one of `SCENE` / `VOICE`; spot-check finds zero fabricated
quotes.

**Decided**: a missing `LOCATE —` is a warning, not a requirement.

---

## Phase 3 — Story check (replaces the coherence question)

Today `checkArgumentCoherence` (`matrixCompass.js`) asks whether every
`IN START` can carry its own News card. A pile of on-topic sources passes.

**Change the question** to: given the hook and POV, write one **focus
sentence**; can this desk carry it; what is missing to tell it?

- New verdicts: `ready` · `needs` (names the missing pieces: "no scene",
  "no where/when for the exhibition") · `not-a-carousel-yet` (all secondary
  sources, no scene, no locate — suggest a short post or more research).
  All three are warnings; none blocks Generate.
- `needs` items feed the existing gap search (`coherenceGapSearches` /
  `researchGapScoutRequest`) as targeted hunts, not another full Fuel run.
- Keep the old verdict fields so non-story paths are untouched.

**Gate**: on the eval desks, the check flags Zanzibar as `needs` (scene,
locate) and does not flag desks you previously approved.

---

## Phase 4 — The moves step (the writing change)

Behind `storyMode`. Content/editorial only.

**What you see**: a panel above the slide strip in `AiTemplateFillModal`:

- **Focus** — one sentence.
- **Moves** — 4–7 numbered sentences, each with a job (open, turn, scene,
  caveat, who holds it, next question) and the desk lines it cites.
- **Parked** — desk lines that did not earn a sentence.

You can reword, reorder, delete, park, or un-park. Then Generate cuts cards.

**Build**

- `src/shared/storyMoves.js`: one model call, desk in → `{ focus, moves[],
  parked[] }` out. Rules: every move cites ≥1 desk line; a `SCENE` /
  `VOICE` line is preferred for the open or turn when one exists; a caveat
  appears once; no move only introduces a source.
- Deterministic move → card mapping: one move = one card; body = the
  sentence(s); headline = a short name for the move's job, fit to the
  canvas; card type from the job (cover / news / text / cta).
- **Precedence** (written down so prompts stop contradicting each other):
  named slide jobs (`SLIDE_PLAN_KEYS`) > moves > anything else. When moves
  exist they set the slide count.
- **Replaced on this path only** (old code stays for other paths):
  - "Cover + one News per `IN START` + Done" → count comes from moves.
  - `lockLength` means "don't drop a move", not "render every START".
  - Spine `proofAssignments` no longer routes; spine becomes a post-check
    (every desk citation real, no two cards with the same job).
  - GST's fixed 10 is not used when `storyMode` is on.

**Gate** (the main one): Phase 0 blind review — new pipeline meets the win
bar; unsupported claims do not rise; clipping zero. Only then can
`storyMode` default on for content/editorial.

---

## Phase 5 — Keep the story through the later passes

- **Voice pass** (`generateVoicePass`): receives focus + moves; may change
  wording, may not drop a move's turn or merge two moves.
- **Polish** (`polishCarousel`): checks each card against its move and
  each seam against the next move, instead of against beat labels.
- **Claim check on connecting sentences** (new, `storyMoves.js`): for each
  move, does the cited desk line support the sentence? Flag causal verbs
  ("led to", "shaped", "because", "birthplace") that the source does not
  state. Output is a warning on the card, not a rewrite.

**Gate**: claim check catches seeded false-causal sentences in a test
fixture; no rise in warnings on approved desks.

---

## Phase 6 — Redo, caption, images

- **Redo** (`slideRedoJob.js`): with moves present, Redo edits the move,
  then re-checks the neighbouring seams and warns if card N+1 no longer
  follows.
- **Caption** (`aggregateCarouselContext` → `generateCaptions` in
  `MediaTool.jsx`): pass focus + parked lines so material cut from the deck
  can live in the caption with its source.
- **Images**: each move can carry an `IMAGE —` line; the card uses it
  (credit line rendered small). Falls back to the Phase 1 no-photo layout.
  Rights note shown before export; nothing auto-downloads an image with an
  unknown licence.

**Gate**: Redo on a middle card produces a seam warning when it should;
captions include parked sources; image credits render.

---

## Phase 7 — Prompt cleanup

Only after Phase 4 passes. Remove the retired theories from the
content/editorial writer prompts (Paradox → Friction → Mechanism → Gate,
CONTRAST → CAUSE → EXPLAIN → NEXT, one-News-per-START, the GST arc on this
path). Rewrite the stack of "don't" rules into: one claim the piece stands
behind, stated plainly; caveats placed once; never invent.

**Measure**: prompt length before/after; re-run Phase 0. Cleanup must not
lower the win rate or raise unsupported claims.

---

## Phase 8 — Learning across pieces

- **Lessons that accumulate**: rejection reasons and moves-panel edits
  become proposed lessons ("caveat repeated", "opened on a document").
  You approve a lesson before it applies to all desks.
- **Series**: parked lines can seed a new matrix ("part two").
- **Audience note**: optional per-matrix field (who this is for, what they
  already know) read by the story check and the moves step.

**Gate**: you approve the first batch of lessons; each one, applied, does
not lower the eval win rate.

---

## Order and dependencies

```
Phase 0 (measure) ──┬─> Phase 1 (bugs, ships on its own)
                    ├─> Phase 2 (research) ─> Phase 3 (story check)
                    │                                │
                    └────────────> Phase 4 (moves) <─┘
                                        │
                                   Phase 5 (later passes, claim check)
                                        │
                                   Phase 6 (redo, caption, images)
                                        │
                                   Phase 7 (prompt cleanup)
                                        │
                                   Phase 8 (learning)
```

Phase 4 can be prototyped on today's desks before Phase 2 lands, but its
gate is judged on desks re-run through Phase 2. Moves without story
material make tidier decks out of the same documents.

## Risks

| Risk | Where | Mitigation |
|---|---|---|
| False causal claims in connecting sentences | Phase 4–5 | sentence-level claim check; warnings visible |
| Fabricated quotes / scenes | Phase 2 | verbatim + URL rule; spot-check |
| Story too neat (single origin myth) | Phase 4 | caveat move kept when desk has one; claim check |
| Operator workload rises | Phase 4 | track how many moves you rewrite; if most, the step failed |
| Rules colliding | Phase 4 | written precedence; Phase 7 cleanup |
| Redo breaks the chain | Phase 6 | seam re-check on Redo |
| Parked material lost | Phase 6 | caption + series |
| Image rights | Phase 6 | credit + rights note; no auto-use of unknown licences |
| Small judge pool | Phase 0 | 3 runs per desk; bar set before running |
| Regressions on promo / roundups | all | `storyMode` scoped to content/editorial; eval includes 2 promo desks as controls |

## Decisions (operator, Oct 14, 2026)

1. **Phase order:** approved as a starting point.
2. **Eval desks:** agent picks. Zanzibar plus 10–15 content/editorial
   desks weighted toward rejected ones, plus 2 promo desks as controls.
3. **Win bar:** ≥ 60% of blind pairs, no rise in unsupported claims.
4. **`LOCATE —`:** warning, not a requirement.
5. **`not-a-carousel-yet`:** warning only; never blocks Generate. It fires
   when a desk is all secondary material (documents *about* the subject)
   with no scene, no voice, and no where/when — the shape the Zanzibar
   desk had. The warning names what is missing so the gap search can hunt
   it.
6. **Phase 1:** ships first, on its own (#240).
