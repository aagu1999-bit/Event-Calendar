import { earnedSlideCount, essaySlideSequence } from "./matrixCompass.js";

// Conversation maps — Injustice / Explainer / Re-frame / Micro-doc.
//
// These are what KIND OF TALK the piece is, ranked after Fuel + Check
// and before Generate. They are not Content Clusters (which drawer),
// not GST's 10-slide storyboard, and not Fuel inputs. Fuel still
// hunts the LENS. The writer reads the rank as a conversation map:
// Cover + News in that talk. Secondary only if a claim already has
// a pointed source. Tertiary is caption or parked.

export const CONVERSATION_MAPS = {
  injustice: {
    key: "injustice",
    label: "Injustice / Hook-Led",
    talk: "Systemic critique. Hook → who paid → the rule that did it.",
    seed: "Write as Injustice / Hook-Led: cover names who paid; News names the rule, vote, closure, or cap. Not a festival listing.",
  },
  explainer: {
    key: "explainer",
    label: "Explainer / Fluency",
    talk: "Make a named trick legible. Status quo → catalyst → breakdown → what happens next. Only when THIS desk already named that trick.",
    seed: "Write as Explainer / Fluency: cover names the trick THIS desk already named; News breaks it down. If the desk only located, do not invent a mechanism.",
  },
  reframe: {
    key: "reframe",
    label: "Re-frame / Archive",
    talk: "Counter the headline. Named object + public log. Media-literacy read.",
    seed: "Write as Re-frame / Archive: cover counters a named public claim; News is the log. Do not write 'share this to change the conversation.'",
  },
  microdoc: {
    key: "microdoc",
    label: "Micro-doc / Narrative",
    talk: "One face, one room, over time. Person → incident → stakes.",
    seed: "Write as Micro-doc / Narrative: cover is a person or room over time; News is the incident and the stakes. No donate/afterparty closer.",
  },
};

export const CONVERSATION_MAP_ORDER = ["injustice", "explainer", "reframe", "microdoc"];

const MAP_KEYS = new Set(CONVERSATION_MAP_ORDER);

const SIGNAL = {
  injustice: [
    /\bordinance\b/i, /\bstatute\b/i, /\bvote[ds]?\b/i, /\bpassed\b/i,
    /\blicen[cs]e\b/i, /\bcap\b/i, /\bquota\b/i, /\bcurfew\b/i,
    /\bclosure\b/i, /\bclosed\b/i, /\bshut\b/i, /\bbann(?:ed|ing)\b/i,
    /\bblocked\b/i, /\bhome.?rule\b/i, /\bwho (?:paid|benefits|owns)\b/i,
    /\binjustice\b/i, /\bcan't pour\b/i, /\bfrozen tap\b/i, /\bpermit\b/i,
  ],
  explainer: [
    /\bmechanism\b/i, /\bhow it works\b/i, /\bbreakdown\b/i, /\bcatalyst\b/i,
    /\bstatus quo\b/i, /\blogistics\b/i, /\btax\b/i, /\bmath\b/i, /\bsplit\b/i,
    /\bthe trick\b/i, /\bfluency\b/i, /\bexplainer\b/i, /\bwhy the\b/i,
    /\bwhat happens next\b/i,
  ],
  reframe: [
    /\bre-?frame\b/i, /\bheadline\b/i, /\bthey said\b/i, /\bdebunk\b/i,
    /\barchive\b/i, /\bpublic log\b/i, /\bnot a vibe\b/i, /\binstead\b/i,
    /\bcounter(?:s|ed|ing)?\b/i, /\bmainstream\b/i, /\bnot the (?:story|headline)\b/i,
  ],
  microdoc: [
    /\bmicro-?doc\b/i, /\blineage\b/i, /\bover time\b/i, /\bthe room\b/i,
    /\bclosed (?:in )?(?:19|20)\d{2}\b/i, /\bclub [a-z]/i, /\bhall\b/i,
    /\bmotel\b/i, /\bprofile\b/i, /\bnarrative\b/i, /\byears of\b/i,
    /\bface of\b/i, /\bremnant\b/i,
  ],
};

export function conversationMapOf(key) {
  const k = String(key || "").trim().toLowerCase();
  return MAP_KEYS.has(k) ? CONVERSATION_MAPS[k] : null;
}

function haystackOf({ hook = "", pov = "", anchors = [], lens = "" } = {}) {
  const bits = [hook, pov, lens, ...(Array.isArray(anchors) ? anchors : [])];
  return bits.map((s) => String(s || "")).join(" \n ");
}

export function scoreConversationMaps(input = {}) {
  const hay = haystackOf(input);
  const scores = { injustice: 0, explainer: 0, reframe: 0, microdoc: 0 };
  for (const key of CONVERSATION_MAP_ORDER) {
    for (const re of SIGNAL[key]) {
      if (re.test(hay)) scores[key] += 1;
    }
  }
  return scores;
}

function rankedKeys(scores) {
  return CONVERSATION_MAP_ORDER
    .slice()
    .sort((a, b) => scores[b] - scores[a] || CONVERSATION_MAP_ORDER.indexOf(a) - CONVERSATION_MAP_ORDER.indexOf(b));
}

export function sanitizeConversationRank(raw = {}) {
  const src = raw && typeof raw === "object" ? raw : {};
  const pick = (v) => (conversationMapOf(v) ? conversationMapOf(v).key : "");
  let primary = pick(src.primary);
  let secondary = pick(src.secondary);
  let tertiary = pick(src.tertiary);
  if (secondary && secondary === primary) secondary = "";
  if (tertiary && (tertiary === primary || tertiary === secondary)) tertiary = "";
  const suggested = conversationMapOf(src.suggestedPrimary);
  return {
    primary,
    secondary,
    tertiary,
    suggestedPrimary: suggested ? suggested.key : "",
    suggestedReason: String(src.suggestedReason || "").trim().slice(0, 280),
    locked: !!src.locked,
  };
}

export function suggestConversationRank({ hook = "", pov = "", anchors = [], lens = "", argumentCheck = null } = {}) {
  const scores = scoreConversationMaps({ hook, pov, anchors, lens });
  const order = rankedKeys(scores);
  const primary = scores[order[0]] > 0 ? order[0] : "";
  const anchored = Array.isArray(argumentCheck?.claims)
    ? argumentCheck.claims.filter((c) => c && c.support === "anchored" && String(c.claim || "").trim())
    : [];
  let secondary = "";
  if (primary && anchored.length && scores[order[1]] > 0 && order[1] !== primary) {
    const secondHay = haystackOf({ hook: "", pov: "", anchors: anchored.map((c) => c.claim), lens: "" });
    const secondScores = scoreConversationMaps({ hook: "", pov: "", anchors: [secondHay], lens: "" });
    const secondOrder = rankedKeys(secondScores);
    if (secondScores[secondOrder[0]] > 0 && secondOrder[0] !== primary) {
      secondary = secondOrder[0];
    } else if (scores[order[1]] >= 2) {
      secondary = order[1];
    }
  }
  const map = primary ? CONVERSATION_MAPS[primary] : null;
  const reason = map
    ? `Primary ${map.label} — ${map.talk}`
    : "No statute, mechanism, headline, or person-over-time on the desk yet — pick a conversation after Fuel, or leave it empty.";
  return sanitizeConversationRank({
    primary,
    secondary,
    tertiary: "",
    suggestedPrimary: primary,
    suggestedReason: reason,
    locked: false,
  });
}

export function vetoConversationPrimary({ primary = "", hook = "", pov = "", anchors = [], argumentCheck = null } = {}) {
  const map = conversationMapOf(primary);
  if (!map) return null;
  const scores = scoreConversationMaps({ hook, pov, anchors });
  const anchored = Array.isArray(argumentCheck?.claims)
    ? argumentCheck.claims.filter((c) => c && c.support === "anchored")
    : [];
  const anchoredHay = haystackOf({ anchors: anchored.map((c) => c.claim) });
  const anchoredScores = anchored.length
    ? scoreConversationMaps({ hook: "", pov: "", anchors: [anchoredHay] })
    : { injustice: 0, explainer: 0, reframe: 0, microdoc: 0 };
  const deskHits = scores[map.key] + anchoredScores[map.key];
  if (deskHits > 0) return null;
  const missing = {
    injustice: "Injustice primary but the desk has no statute, vote, closure, cap, or who-paid receipt.",
    explainer: "Explainer primary but the desk has no mechanism, breakdown, or reusable trick.",
    reframe: "Re-frame primary but the desk has no named headline, public log, or claim to counter.",
    microdoc: "Micro-doc primary but the desk has no person, room, lineage, or incident over time.",
  };
  return { ok: false, reason: missing[map.key] };
}

export function formatConversationSeedLines(rank) {
  const clean = sanitizeConversationRank(rank);
  if (!clean.primary) return [];
  const primary = CONVERSATION_MAPS[clean.primary];
  const lines = [
    `CONVERSATION_RANK_KEYS: primary=${clean.primary}; secondary=${clean.secondary || "none"}; tertiary=${clean.tertiary || "none"}`,
    `CONVERSATION MAP: primary ${primary.label} — ${primary.talk}`,
    primary.seed,
    "Cover + News is the starting pair in this talk. Slide count comes from the anchored receipts on this desk (Auto 3–10) — not a default 3, not GST's locked stance arc. Do not write Stat, Spotlight, or 'share this to change the conversation.'",
  ];
  if (clean.secondary) {
    const sec = CONVERSATION_MAPS[clean.secondary];
    lines.push(`SECONDARY (${sec.label}): color only — a pointed source already on the desk. Do not hunt a second syllabus.`);
  }
  if (clean.tertiary) {
    const ter = CONVERSATION_MAPS[clean.tertiary];
    lines.push(`TERTIARY (${ter.label}): caption or parked. No slide. Fuel does not hunt this.`);
  }
  return lines;
}

export function parseConversationRankFromContext(text) {
  const s = String(text || "");
  const keyed = s.match(/CONVERSATION_RANK_KEYS:\s*primary=([a-z]+);\s*secondary=([a-z]+|none);\s*tertiary=([a-z]+|none)/i);
  if (keyed) {
    const none = (v) => (!v || v.toLowerCase() === "none" ? "" : v);
    return sanitizeConversationRank({
      primary: none(keyed[1]),
      secondary: none(keyed[2]),
      tertiary: none(keyed[3]),
    });
  }
  const labeled = s.match(/CONVERSATION MAP:\s*primary\s+([^—\n]+)/i);
  if (!labeled) return sanitizeConversationRank({});
  const blob = labeled[1].trim().toLowerCase();
  const primary = CONVERSATION_MAP_ORDER.find((key) => blob.includes(CONVERSATION_MAPS[key].label.split(" / ")[0].toLowerCase()));
  return sanitizeConversationRank({ primary: primary || "" });
}

// Writer / GST block. Ranked maps outrank GST's default who-benefits stance.
export function conversationWriterBlock(rankOrText) {
  const rank = typeof rankOrText === "string"
    ? parseConversationRankFromContext(rankOrText)
    : sanitizeConversationRank(rankOrText);
  const lines = formatConversationSeedLines(rank);
  if (!lines.length) return [];
  return [
    "═════════════════════════════",
    "CONVERSATION MAP — operator-selected. This is the talk. It outranks GST's default who-benefits stance and any cluster drawer.",
    ...lines,
    "PRIMARY is the piece. Write Cover + News in that talk, then only as many extra beats as this desk earned. SECONDARY colors one pointed source already on the desk — do not hunt a second syllabus. TERTIARY is caption or parked: no slide, Fuel does not hunt it.",
    "If primary is Explainer, Re-frame, or Micro-doc: do not invent who-owns / who-benefits / diaspora to make the brief feel like CGE or GST.",
    "If primary is Injustice: stance is who paid / the rule — only from SOURCE MATERIAL already on the desk.",
    "═════════════════════════════",
    "",
  ];
}

// Cover + News in the ranked talk. Extra text slides from this desk's
// receipts (or an operator pin). A selected map does not freeze length at 3.
export function conversationSlideSequence(rankOrText, targetCount = null) {
  const rank = typeof rankOrText === "string"
    ? parseConversationRankFromContext(rankOrText)
    : sanitizeConversationRank(rankOrText);
  if (!rank.primary) return null;
  const ctx = typeof rankOrText === "string" ? rankOrText : "";
  return essaySlideSequence(earnedSlideCount(ctx, targetCount));
}

export function applyConversationSuggestion(current, suggestion) {
  const now = sanitizeConversationRank(current);
  const next = sanitizeConversationRank(suggestion);
  if (now.locked && now.primary) {
    return {
      ...now,
      suggestedPrimary: next.primary,
      suggestedReason: next.suggestedReason,
    };
  }
  return {
    ...next,
    locked: false,
  };
}
