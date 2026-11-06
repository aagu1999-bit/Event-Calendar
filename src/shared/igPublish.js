// Instagram carousel publish — tag distribution + handle collection.
//
// Pure logic, no React / no fetch. The modal consumes these helpers to
// build the plan it previews, and the server uses them again in
// /api/instagram/publish-carousel to re-verify the plan before it hits
// Composio (never trust the client's blocklist for a thing that would
// actually post).

// Accounts we never tag:
// - kinnectnj  : operator's audience account; tagging it on our own post
//                is noise and spam-adjacent
// - centralgroupevents : the CGE publishing account itself; you can't
//                "tag yourself on your own post" without looking like
//                a bot
export const IG_PUBLISH_BLOCKLIST = ["kinnectnj", "centralgroupevents"];

// IG's per-image hard cap. We never exceed this on a single slide because
// Meta's API will outright reject the create-container call otherwise.
// An individual slide with more than 20 unique venues (rare — usually
// means a packed Saturday) picks the first 20 in event order.
export const IG_MAX_TAGS_PER_SLIDE = 20;

// IG handle hygiene: strip @, lowercase, drop anything non-alphanum
// except _ and . (those are legal IG chars). Empty string in → null out.
export function normalizeIgHandle(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/^@+/, "").toLowerCase();
  if (!s) return null;
  // IG usernames are 1-30 chars, [a-z0-9._]. Anything else is almost
  // certainly a typo or the user pasted a URL — drop it rather than
  // send bad tags to the API.
  if (!/^[a-z0-9._]{1,30}$/.test(s)) return null;
  return s;
}

// Walk a list of events, collect igHandles. Dedupe. Applies blocklist.
// Preserves first-seen order so the tags attach to the slides that
// most prominently feature the venue (the one the operator typed first).
export function collectHandlesFromEvents(events, { exclude = IG_PUBLISH_BLOCKLIST } = {}) {
  const excludeSet = new Set((exclude || []).map((h) => String(h || "").toLowerCase()));
  const seen = new Set();
  const out = [];
  for (const ev of events || []) {
    const h = normalizeIgHandle(ev?.igHandle);
    if (!h) continue;
    if (excludeSet.has(h)) continue;
    if (seen.has(h)) continue;
    seen.add(h);
    out.push(h);
  }
  return out;
}

// Collect handles for a SINGLE slide from the events actually shown on
// that slide. Dedupes within the slide (two events at the same venue
// only earn one tag), applies the blocklist, caps at IG's per-image
// hard cap. Does NOT dedupe across slides — a venue hosting Fri AND
// Sat gets tagged on both slides, because the whole point is that
// each slide's tags correspond to the events shown on that slide.
export function handlesForSlideEvents(slideEvents, { exclude = IG_PUBLISH_BLOCKLIST, max = IG_MAX_TAGS_PER_SLIDE } = {}) {
  const excludeSet = new Set((exclude || []).map((h) => String(h || "").toLowerCase()));
  const seen = new Set();
  const out = [];
  for (const ev of slideEvents || []) {
    const h = normalizeIgHandle(ev?.igHandle);
    if (!h) continue;
    if (excludeSet.has(h)) continue;
    if (seen.has(h)) continue;
    seen.add(h);
    out.push(h);
    if (out.length >= max) break;
  }
  return out;
}

// Position helper — tags live in the bottom-third (y=0.85) and spread
// across the width (x). Keeps the tags out of the visually important
// center of the slide so the design reads cleanly and viewers tap-to-
// reveal rather than seeing them baked into the picture.
//
// 1 tag  → [0.5]
// 2 tags → [0.33, 0.67]
// 3 tags → [0.25, 0.5, 0.75]
// 4 tags → [0.2, 0.4, 0.6, 0.8]
// n tags → evenly spaced across the width
export function tagPositionsForSlide(count) {
  const n = Math.max(0, Math.floor(count) || 0);
  if (!n) return [];
  return Array.from({ length: n }, (_, i) => ({
    x: Number(((i + 1) / (n + 1)).toFixed(4)),
    y: 0.85,
  }));
}

// Compose the user_tags payload a Composio INSTAGRAM_POST_IG_USER_MEDIA
// call expects, per slide. Only used by the server, but lives here so
// the modal preview can show the exact same shape.
export function buildSlideUserTags(handlesForSlide) {
  const positions = tagPositionsForSlide(handlesForSlide.length);
  return handlesForSlide.map((username, i) => ({
    username,
    x: positions[i].x,
    y: positions[i].y,
  }));
}

// End-to-end plan builder. Called BOTH client-side (to render the
// preview) and server-side (to re-verify before Composio). Returning
// the same shape from both keeps "what you see is what gets posted."
//
// slideEvents : array of event arrays, one per slide — slideEvents[i]
//               is the events SHOWN on slide i. Tags on slide i come
//               ONLY from events shown on slide i (this is the fix for
//               the "tags didn't match the slide" regression).
export function buildPublishPlan({
  slideEvents,
  exclude = IG_PUBLISH_BLOCKLIST,
  maxPerSlide = IG_MAX_TAGS_PER_SLIDE,
} = {}) {
  const perSlide = (slideEvents || []).map((evs) =>
    handlesForSlideEvents(evs, { exclude, max: maxPerSlide })
  );
  // Flatten + dedupe to show operator the unique-roster count without
  // double-counting a venue that repeats across slides. That number is
  // how many DIFFERENT accounts the whole post touches.
  const uniqueAcrossSlides = Array.from(new Set(perSlide.flat()));
  const totalTagPlacements = perSlide.reduce((n, arr) => n + arr.length, 0);
  return {
    perSlide,
    userTagsPerSlide: perSlide.map(buildSlideUserTags),
    uniqueAcrossSlides,
    totalTagPlacements,
    maxPerSlide,
    blocked: exclude,
  };
}
