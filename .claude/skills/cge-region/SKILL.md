---
name: cge-region
description: Use whenever code touches NJ region logic in CGE Tools — the `region` field on events, parsing regions from a sheet, tagging cities as North/Central/South, region-column mapping, region warnings in Review, or a Union County city being tagged CENTRAL when the operator expects NORTH. Trigger on any mention of "region", "North/Central/South", "Union County", "parseRegion", or any pipe/output that has to emit a `region` value (calendar send, guide publish, newsletter). Codifies the operator's NJ convention (Union County is locally NORTH, not CENTRAL), the region parser's tolerances, the "flag, don't rewrite" rule, and the "Region NJ" format the website expects.
---

# CGE Region Convention

CGE Tools handles NJ event data. Region is one of the fields the operator
cares about most because it drives sorting, grouping, and the audience each
event reaches. The rules aren't obvious from geography alone — they follow a
local convention that overrides what a maps tool would say.

## The three regions

Every event resolves to one of exactly three regions:

- **North**
- **Central**
- **South**

There's no "New Jersey" catch-all. Any event that can't be resolved to one of
the three is FLAGGED in Review with `NO REGION`, not silently defaulted. The
operator's judgement is the tiebreaker; the tool's job is to surface the
uncertainty, not to hide it.

## The Union County override

Union County straddles the North/Central line by geography, but the operator
treats every Union County city as **North** because of how the local scene
works. If a sheet says CENTRAL for a Union County city, the tool must FLAG
the mismatch — do not rewrite it.

The canonical list lives in `NJ_NORTH_OVERRIDE_CITIES` at the top of
`src/pages/ReviewQueue.jsx`:

```
elizabeth, union, hillside, clark, linden, rahway, kenilworth, roselle,
roselle park, cranford, summit, berkeley heights, garwood, mountainside,
new providence, plainfield, scotch plains, springfield, westfield
```

If you're editing region logic anywhere else in the codebase and need this
list, import it from `ReviewQueue.jsx` or lift it into a shared module —
don't inline a second copy that can drift.

## The parser

`parseRegion(raw)` in `src/shared/parseEvents.js` is tolerant on the way in:
it accepts full names ("North", "north jersey", "North New Jersey"),
abbreviations ("N", "N.", "NNJ"), and common misspellings, and normalizes to
exactly one of "North" / "Central" / "South". Anything else becomes empty
(triggers `NO REGION` in Review).

- Use `parseRegion(x)` at every ingestion point (CSV/XLSX import, booking
  import, scraper intake). Never trust a raw string as a region.
- On output (calendar send, guide publish, CSV export), emit the canonical
  three-word form.

## The website format

The website expects region as `"North NJ"` / `"Central NJ"` / `"South NJ"` —
one string with the state suffix, not two fields. Every pipe mapper needs to
add the `" NJ"` suffix and guard against double-suffixing:

```js
const region = ev.region ? `${ev.region} NJ`.replace(/ NJ NJ$/, " NJ") : "";
```

The `.replace(/ NJ NJ$/, " NJ")` guard exists because at least once, an event
made it into the store with `"North NJ"` already in the region field. The
guard is one line; deleting it will produce a real bug the second time a
downstream mapper accidentally applies the suffix twice.

## The "flag, don't rewrite" rule

When the tool disagrees with the sheet, it flags — it does not overwrite.
This is a load-bearing principle:

- Wrong region on a Union County city → `REGION? (city is locally NORTH)`
  warning pill in Review
- No region at all → `NO REGION` pill
- Ambiguous input → best-effort parse to canonical form, or empty (which
  triggers `NO REGION`)

Silent rewrites erode operator trust: the moment the tool "helpfully" changes
a region the operator typed on purpose, they stop trusting every other field
too. Flagging preserves the sheet as the source of truth and puts the human
in the loop for the edge cases.

The exception is trivial normalization — "north jersey" → "North" is a format
change, not a semantic override. Trivial normalization is fine; overriding
the operator's declared region is not.

## Downstream uses

Region flows into:

- **Sort/group in the calendar view** — events grouped by region within each day
- **Newsletter section headers** — "This weekend in Central NJ"
- **Website calendar** — region is a first-class filter
- **Guide publish** — each listing carries a region so the guide can be
  filtered per-region on the site

That's why an unnoticed region error compounds. It surfaces in three or four
places on the operator side, plus every visitor to the website's calendar.
The Review warning is the last chance to catch it before it multiplies.

## Adding a new city to the override list

If the operator says a new Union County (or otherwise) city should be treated
as North:

- Add it (lowercase, exact tokenization) to `NJ_NORTH_OVERRIDE_CITIES`
- Note the addition in the commit body (this list is a policy statement, not
  a technical detail; the "why" matters for future readers)
- If the override starts covering non-Union counties too, RENAME the constant
  and split the list — don't quietly overload one list with two policies

## The mistakes worth naming

- **Silently rewriting the sheet's region.** Even if the tool is confident,
  flag instead. The operator wants to see disagreements.
- **Adding "NJ" without the double-suffix guard.** One-liner today, silent
  `"North NJ NJ"` in the website Postgres tomorrow.
- **Treating region as free-form** — anywhere in the pipeline that touches
  region should go through `parseRegion()` on the way in and emit canonical
  form on the way out.
- **Case-sensitive comparisons** — the operator types both "North" and
  "north"; parsers and comparisons must lowercase before matching.
- **Copying `NJ_NORTH_OVERRIDE_CITIES`** into a second file. The list will
  drift; policy needs one source of truth. Import or lift instead.
- **Ignoring the flag in Review because it "looks fine"** — the flag exists
  because the sheet's region disagreed with the operator's convention. Even
  if the answer is "the sheet is right this time," the operator makes that
  call, not the tool.
