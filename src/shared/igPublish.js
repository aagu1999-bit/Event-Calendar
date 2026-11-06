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

// IG's own cap per image is 20 user tags. We cap at 20 TOTAL across
// the carousel so a 10-slide post never ships with 200 tags (spammy
// and the first-slide preview on feed gets drowned). Operator asked
// for 20 total — if that moves, bump here.
export const IG_PUBLISH_DEFAULT_MAX_TOTAL = 20;

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

// Spread handles across slides as evenly as the count allows. Front-loads
// the "extra" ones onto the earliest slides so the first-slide preview
// on feed carries the biggest tagged roster (where it's most likely to
// drive profile hops). Returns handles[slideIndex] = [h, h, ...].
//
//   7 handles, 4 slides → [2, 2, 2, 1]
//   3 handles, 5 slides → [1, 1, 1, 0, 0]
//   20 handles, 5 slides → [4, 4, 4, 4, 4]
export function distributeTagsAcrossSlides({
  handles,
  slideCount,
  maxTotal = IG_PUBLISH_DEFAULT_MAX_TOTAL,
} = {}) {
  const slides = Math.max(1, Number(slideCount) || 1);
  const list = Array.from(new Set((handles || []).map((h) => String(h || "").toLowerCase()).filter(Boolean)))
    .slice(0, Math.max(0, Number(maxTotal) || 0));
  const base = Math.floor(list.length / slides);
  const extra = list.length % slides;
  const result = [];
  let i = 0;
  for (let s = 0; s < slides; s++) {
    const take = base + (s < extra ? 1 : 0);
    result.push(list.slice(i, i + take));
    i += take;
  }
  return result;
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
export function buildPublishPlan({
  events,
  slideCount,
  maxTotal = IG_PUBLISH_DEFAULT_MAX_TOTAL,
  exclude = IG_PUBLISH_BLOCKLIST,
} = {}) {
  const uniqueHandles = collectHandlesFromEvents(events, { exclude });
  const perSlide = distributeTagsAcrossSlides({
    handles: uniqueHandles,
    slideCount,
    maxTotal,
  });
  const totalTagged = perSlide.reduce((n, arr) => n + arr.length, 0);
  const droppedForCap = Math.max(0, uniqueHandles.length - totalTagged);
  return {
    uniqueHandles,
    perSlide,
    userTagsPerSlide: perSlide.map(buildSlideUserTags),
    totalTagged,
    droppedForCap,
    cap: maxTotal,
    blocked: exclude,
  };
}
