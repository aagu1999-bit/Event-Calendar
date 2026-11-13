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

// --- Scheduled per-day posting -----------------------------------------
// Operator wants each slide to auto-post on the day it corresponds to.
// Fri slide → Fri 11:00 AM (local), Sat → Sat 9:00 AM, Sun → Sun 9:00 AM.
// Any schedule target already in the past means "post as soon as the
// scheduler fires" (we don't make the operator wait a week for a Monday
// backfill). All times are operator-local — NJ operator sees ET, and
// the Unix ms timestamp we store is timezone-free so the server can
// compare against Date.now() directly.
export const SLIDE_SCHEDULE_DEFAULTS = {
  Fri: { hour: 11, minute: 0, offsetDays: 0 },
  Sat: { hour:  9, minute: 0, offsetDays: 1 },
  Sun: { hour:  9, minute: 0, offsetDays: 2 },
};

// Parse the Calendar's "MM/DD" friDate string into a Date at local
// midnight of this year (or next year if the month is well past us —
// handles the Dec → Jan edge).
export function friDateToLocalMidnight(friDateStr, now = new Date()) {
  const parts = String(friDateStr || "").split("/");
  if (parts.length !== 2) return null;
  const m = parseInt(parts[0], 10);
  const d = parseInt(parts[1], 10);
  if (!Number.isFinite(m) || !Number.isFinite(d)) return null;
  const year = now.getFullYear();
  const candidate = new Date(year, m - 1, d, 0, 0, 0, 0);
  // If the computed Fri is more than 90 days in the past, roll to next
  // year. Covers "I'm scheduling Jan 3 in late December."
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  if (candidate.getTime() < now.getTime() - ninetyDaysMs) {
    return new Date(year + 1, m - 1, d, 0, 0, 0, 0);
  }
  return candidate;
}

// Returns { scheduledAt, immediate } for a given slide day.
// scheduledAt  : Unix ms the slide should fire at
// immediate    : true when scheduledAt is already in the past — scheduler
//                should run it ASAP rather than wait 7 days for the next
//                occurrence of that weekday.
export function computeSlideSchedule({ day, friDate, now = new Date() }) {
  const dayKey = String(day || "").trim().slice(0, 3);
  const def = SLIDE_SCHEDULE_DEFAULTS[dayKey.charAt(0).toUpperCase() + dayKey.slice(1).toLowerCase()];
  if (!def) return { scheduledAt: now.getTime(), immediate: true, invalid: true };
  const friMidnight = friDateToLocalMidnight(friDate, now);
  if (!friMidnight) return { scheduledAt: now.getTime(), immediate: true, invalid: true };
  const target = new Date(friMidnight.getTime());
  target.setDate(target.getDate() + def.offsetDays);
  target.setHours(def.hour, def.minute, 0, 0);
  const t = target.getTime();
  const nowMs = now.getTime();
  return {
    scheduledAt: t <= nowMs ? nowMs : t,
    immediate: t <= nowMs,
    invalid: false,
  };
}

// Human label for a scheduled time. "Fri Nov 8, 11:00 AM" / "in 2 hours"
// style — we just do the absolute form here, caller can decorate.
export function formatScheduleTime(ms) {
  if (!Number.isFinite(ms)) return "—";
  const d = new Date(ms);
  const day = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day}, ${time}`;
}

// Instagram rejects a whole media container when any one tagged username
// isn't a reachable public account, e.g. "Invalid user id - The following
// user(s) cannot be accessed: heythere, otherhandle". Pull those usernames
// out of the error text, keeping only ones we actually sent so a retry
// without them is guaranteed to make progress.
export function parseRejectedTagUsernames(message, sentTags) {
  const m = String(message || "").match(/cannot be accessed:\s*([^\n]+)/i);
  if (!m) return [];
  const sent = new Set((sentTags || []).map((t) => String(t?.username || "").toLowerCase()));
  return m[1]
    .split(/[\s,;]+/)
    .map((u) => u.replace(/^@+/, "").replace(/[.)"'\]]+$/g, "").toLowerCase())
    .filter((u) => u && sent.has(u));
}

// Instagram carousels hold at most 10 items.
export const IG_CAROUSEL_MAX = 10;

// Splits items into the fewest carousels of at most `max`, as evenly as
// possible, keeping order: 13 → [7, 6], 11 → [6, 5], 10 → [10]. Even
// sizes avoid a lonely 1-slide tail like 10 + 1.
export function splitIntoCarousels(items, max = IG_CAROUSEL_MAX) {
  const list = Array.isArray(items) ? items : [];
  if (list.length <= max) return list.length ? [list] : [];
  const parts = Math.ceil(list.length / max);
  const base = Math.floor(list.length / parts);
  const extra = list.length % parts;
  const out = [];
  let at = 0;
  for (let i = 0; i < parts; i++) {
    const size = base + (i < extra ? 1 : 0);
    out.push(list.slice(at, at + size));
    at += size;
  }
  return out;
}

// Drops tags for blocked accounts (kinnectnj, CGE itself) from a user_tags
// array. The modal already filters, but the server calls this too so no
// client — or a stale cached copy of the app — can tag them.
export function removeBlockedUserTags(tags, exclude = IG_PUBLISH_BLOCKLIST) {
  if (!Array.isArray(tags)) return [];
  const blocked = new Set((exclude || []).map((h) => String(h || "").toLowerCase()));
  return tags.filter((t) => {
    const h = String(t?.username ?? "").trim().replace(/^@+/, "").toLowerCase();
    return !blocked.has(h);
  });
}

// Splits what an operator types into the tag box ("@a, b  @c") into handles.
// Validation and the blocklist still happen in buildPublishPlan.
export function parseHandleInput(text) {
  return String(text || "")
    .split(/[\s,;]+/)
    .map((h) => h.replace(/^@+/, ""))
    .filter(Boolean);
}

const TAG_ERROR_RE =/invalid user|user_tags|usertag|cannot be accessed|cannot be tagged|tagged|tagging/i;

// True when an Instagram error reads like it is about tagged accounts.
export function looksLikeTagError(message) {
  return TAG_ERROR_RE.test(String(message || ""));
}

// Creates a media container, surviving bad tags. `create(body)` makes one
// container call; `dropped` is a Set that collects every username skipped.
//   1. Instagram names the rejected users → retry without exactly those.
//   2. It rejects the tags without naming anyone → try each tag alone, keep
//      the ones that work, drop the ones that don't.
//   3. Even the surviving tags fail together → post that slide untagged.
// Errors that aren't about tags are rethrown untouched.
export async function createWithTagFallback({ create, payload, dropped }) {
  let tags = Array.isArray(payload.user_tags) ? payload.user_tags : [];
  const bodyFor = (t) => {
    const b = { ...payload };
    if (t.length) b.user_tags = t; else delete b.user_tags;
    return b;
  };
  const nameOf = (t) => String(t?.username || "").toLowerCase();
  let probed = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await create(bodyFor(tags));
    } catch (err) {
      if (!tags.length) throw err;
      const named = parseRejectedTagUsernames(err?.message, tags);
      if (named.length) {
        for (const u of named) dropped.add(u);
        tags = tags.filter((t) => !named.includes(nameOf(t)));
        continue;
      }
      if (!looksLikeTagError(err?.message)) throw err;
      if (!probed) {
        probed = true;
        const good = [];
        for (const t of tags) {
          try { await create(bodyFor([t])); good.push(t); }
          catch { dropped.add(nameOf(t)); }
        }
        tags = good;
        continue;
      }
      for (const t of tags) dropped.add(nameOf(t));
      tags = [];
    }
  }
  throw new Error("Instagram kept rejecting tagged accounts");
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
