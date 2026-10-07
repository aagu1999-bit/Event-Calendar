// Audiovisual Science Communication for the Humanities —
// the wearegst / Pop Culture Detective pipeline.
//
// This replaces the old Feature/Content thesis + spine + flyer-shaped
// arranger for AI-arranged carousels. Pop culture / local culture is the
// trojan horse. The product is not a review and not an event listing.
//
// The full move is THREE gears, not pattern alone:
//   PATTERN — name the repeating structure
//   TEACH   — hand the reader a reusable lens
//   STANCE  — land: who benefits, who's blocked, what the system is doing
// under CHARGE (felt heat) + STAKES (what it costs someone).
// Omniscient stance = float above the specimen and read the map out loud.
//
// STAGE 1 — Critical Theory Parser: pattern + teach + stance + charge/stakes
// STAGE 2 — 10-Slide Storyboard Segmenter: hook → anatomy → cases → teach/epiphany → CTA
// STAGE 3 — Micro-Copy + Scan-Path: <35 words/slide, punchy fragments, bold entities
// STAGE 4 — Design tokens (layout contract for Figma/Canva — not a write path yet)

import { extractJson, extractResponseText } from "./aiJson.js";

const MODEL = "gemini-2.5-flash-lite";
const URL_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export const GST_SLIDE_COUNT = 10;
export const GST_MAX_WORDS = 35;

/** The three gears every GST carousel must turn. */
export const GST_GEARS = Object.freeze(["pattern", "teach", "stance"]);

/** Stage 4 design contract — what a programmatic layout engine should paint. */
export const GST_DESIGN_TOKENS = Object.freeze({
  layout: "flat-background",
  backgrounds: ["cream", "charcoal", "olive-desat"],
  typography: {
    header: "editorial-serif",
    body: "crisp-sans",
  },
  imagery: "desaturated-high-grain-documentary",
  slideRoles: [
    "hook",
    "anatomy-1",
    "anatomy-2",
    "anatomy-3",
    "case-1",
    "case-2",
    "case-3",
    "case-4",
    "epiphany",
    "cta",
  ],
});

/** Corporate / LLM sludge — Stage 3 must refuse these. */
export const GST_BANNED_PHRASES = [
  "delve",
  "testament",
  "moreover",
  "furthermore",
  "in today's world",
  "it is important to note",
  "at the end of the day",
  "landscape",
  "unpack",
  "nuanced",
  "multifaceted",
  "leverage",
  "elevate",
  "empower",
  "vibrant community",
  "hidden gem",
  "must-visit",
  "don't miss",
  "join us",
  "pull up",
  "link in bio",
  "game-changer",
  "revolutionize",
  "tapestry",
  "beacon",
  "underscores",
  "sheds light",
  "crucial",
  "pivotal",
  "seamless",
  "robust",
  "holistic",
  "both sides",
  "it's complicated",
  "make of it what you will",
];

const GST_VOICE = [
  "You write like wearegst (Goldsmiths Street Society) and Pop Culture Detective,",
  "for Central Group Events — Black New Jersey cultural infrastructure.",
  "Pop culture and local nightlife are the TROJAN HORSE. The real subject is the",
  "pressure THIS brief already named — power, class, a rule, a room — not a default",
  "who-owns-vs-who-programs hunt when the desk never said that.",
  "",
  "OMNISCIENT STANCE: float above the specimen. See the map. Read it out loud.",
  "You are not a reviewer and not a neutral newsroom. You teach a lens and take a side.",
  "",
  "THREE GEARS — every carousel must turn all three:",
  "  1. PATTERN — name the repeating structure (not one club, not one bad night).",
  "  2. TEACH — hand the reader a reusable lens for the next town / room / clip.",
  "  3. STANCE — land. Who benefits. Who's blocked. What the system is doing. No both-sides fog.",
  "",
  "CHARGE + STAKES:",
  "  - CHARGE = the felt heat that stops the thumb (shut Saturday, frozen tap, same three rooms).",
  "  - STAKES = what that heat costs someone (a restaurant that can't pour, a night with nowhere new).",
  "  Charge without stakes is vibes. Stakes without charge is a complaint. Take without both is a seminar.",
  "",
  "RULES:",
  "- Patterns + teach + stance — never plot review, never 'good'/'bad' scorekeeping.",
  "- Inverse hook: thesis in the first two sentences. Title answers an implicit question.",
  "- Show-don't-tell bridge: specific mundane moment → structural framework.",
  "- Ruthless brevity. No fluff. No long setup. Digital audience can look up context.",
  "- Sharp, direct, anti-establishment. Active voice only.",
  "- Kitchen-table wording. No statute numbers, no seminar speak, no grant-proposal tone.",
  `- BANNED phrases (never use): ${GST_BANNED_PHRASES.join(", ")}.`,
  "- Do not sell an event. Do not RSVP. Do not write a flyer.",
].join("\n");

async function geminiGenerate(apiKey, requestBody, { tries = 4 } = {}) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 800 * 2 ** (attempt - 1)));
    let res;
    try {
      res = await fetch(`${URL_BASE}?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
    } catch (e) {
      lastErr = e;
      continue;
    }
    if (res.ok) return res.json();
    const errText = await res.text();
    lastErr = new Error(`Gemini ${res.status}: ${errText.slice(0, 240)}`);
    if (!RETRYABLE.has(res.status)) throw lastErr;
  }
  throw lastErr;
}

async function geminiJson(apiKey, prompt, { temperature = 0.55 } = {}) {
  const data = await geminiGenerate(apiKey, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature },
  });
  return extractJson(extractResponseText(data));
}

export function wordCount(text) {
  return String(text || "")
    .replace(/\*\*/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function containsBannedPhrase(text) {
  const lower = String(text || "").toLowerCase();
  return GST_BANNED_PHRASES.filter((p) => lower.includes(p.toLowerCase()));
}

export function stripScanMarkers(text) {
  return String(text || "").replace(/\*\*([^*]+)\*\*/g, "$1");
}

export function extractScanPath(text) {
  const out = [];
  const re = /\*\*([^*]+)\*\*/g;
  let m;
  while ((m = re.exec(String(text || ""))) !== null) {
    const t = m[1].trim();
    if (t) out.push(t);
  }
  return out;
}

function subjectBlock(topic, context) {
  return [
    topic && topic.trim() ? `TOPIC: ${topic.trim()}` : "",
    context && context.trim() ? `SOURCE MATERIAL:\n${context.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * STAGE 1 — Critical Theory Parser
 * Pattern + teach + stance under charge/stakes. Not a summary. Not a review.
 */
export async function stage1CriticalTheory({ apiKey, topic, context }) {
  const prompt = [
    GST_VOICE,
    "",
    "STAGE 1 — CRITICAL THEORY PARSER",
    "Do NOT summarize the topic. Do NOT write carousel copy yet.",
    "Build the three gears: PATTERN, TEACH, STANCE — with CHARGE and STAKES named.",
    "",
    subjectBlock(topic, context),
    "",
    "Return JSON ONLY:",
    JSON.stringify({
      trope: "name the repeating formula in 3-8 words (PATTERN)",
      powerStructure: "who benefits / who is blocked — one sentence (feeds STANCE)",
      academicLens: "urban planning / gender / class / media studies lens in a few words",
      teachLens: "one reusable way of seeing the reader should leave with — portable to the next town/room/clip (TEACH)",
      stance: "the side you take, said plain — not both-sides, not 'it's complicated' (STANCE)",
      charge: "the felt heat that stops the thumb — one concrete beat",
      stakes: "what that heat costs someone — one concrete cost",
      accidentalLesson: "what the audience is being taught without noticing",
      mundaneEntry: "one hyper-specific recognizable NJ or pop-culture moment that opens the door",
      systemicClaim: "the definitive thesis (inverse-hook ready) in one sentence — must encode pattern + stance",
    }),
  ].join("\n");

  const parsed = await geminiJson(apiKey, prompt, { temperature: 0.45 });
  return {
    trope: String(parsed?.trope || "").trim(),
    powerStructure: String(parsed?.powerStructure || "").trim(),
    academicLens: String(parsed?.academicLens || "").trim(),
    teachLens: String(parsed?.teachLens || "").trim(),
    stance: String(parsed?.stance || "").trim(),
    charge: String(parsed?.charge || "").trim(),
    stakes: String(parsed?.stakes || "").trim(),
    accidentalLesson: String(parsed?.accidentalLesson || "").trim(),
    mundaneEntry: String(parsed?.mundaneEntry || "").trim(),
    systemicClaim: String(parsed?.systemicClaim || "").trim(),
  };
}

/**
 * STAGE 2 — 10-Slide Storyboard Segmenter
 * Fixed GST arc. Jobs only — no polished copy yet.
 * Hook carries charge; anatomy = pattern; cases = stakes; epiphany = teach; closer = stance.
 */
export async function stage2Storyboard({ apiKey, topic, context, theory }) {
  const prompt = [
    GST_VOICE,
    "",
    "STAGE 2 — 10-SLIDE STORYBOARD SEGMENTER",
    "Design EXACTLY 10 slides. Jobs + beat notes only. No finished copy.",
    "",
    "FIXED ARC:",
    "1 hook — high-friction micro-thesis (inverse hook) loaded with CHARGE",
    "2-4 anatomy — PATTERN mechanics / why it happens (Barrier, Mechanism, Proof)",
    "5-8 cases — STAKES made physical (named places or scenes when the source has them)",
    "9 epiphany — TEACH the reusable lens (reader can aim this at the next town)",
    "10 cta — STANCE as engagement (not a ticket sell) — invite them to name/use the lens",
    "",
    "Every beat note should serve at least one gear: pattern / teach / stance.",
    "Do not write a neutral tour. Do not flatten into vibes without cost.",
    "",
    "THEORY FROM STAGE 1:",
    JSON.stringify(theory, null, 2),
    "",
    subjectBlock(topic, context),
    "",
    "Return JSON ONLY:",
    `{"slides":[{"n":1,"role":"hook","job":"...","beat":"...","gear":"charge|pattern|teach|stance"},{"n":2,"role":"anatomy","job":"...","beat":"...","gear":"pattern"},{"n":3,"role":"anatomy","job":"...","beat":"...","gear":"pattern"},{"n":4,"role":"anatomy","job":"...","beat":"...","gear":"pattern"},{"n":5,"role":"case","job":"...","beat":"...","gear":"stakes"},{"n":6,"role":"case","job":"...","beat":"...","gear":"stakes"},{"n":7,"role":"case","job":"...","beat":"...","gear":"stakes"},{"n":8,"role":"case","job":"...","beat":"...","gear":"stakes"},{"n":9,"role":"epiphany","job":"...","beat":"...","gear":"teach"},{"n":10,"role":"cta","job":"...","beat":"...","gear":"stance"}],"arc":"one sentence: charge → stakes → teach → stance"}`,
  ].join("\n");

  const parsed = await geminiJson(apiKey, prompt, { temperature: 0.55 });
  let slides = Array.isArray(parsed?.slides) ? parsed.slides : [];
  const defaultGear = (n) =>
    n === 1 ? "charge" : n <= 4 ? "pattern" : n <= 8 ? "stakes" : n === 9 ? "teach" : "stance";
  slides = slides
    .map((s, i) => ({
      n: Number(s?.n) || i + 1,
      role: String(s?.role || "").toLowerCase().trim(),
      job: String(s?.job || "").trim(),
      beat: String(s?.beat || "").trim(),
      gear: String(s?.gear || defaultGear(i + 1)).toLowerCase().trim(),
    }))
    .slice(0, GST_SLIDE_COUNT);

  // Enforce length + roles if the model shorted us.
  while (slides.length < GST_SLIDE_COUNT) {
    const n = slides.length + 1;
    const role =
      n === 1 ? "hook" : n <= 4 ? "anatomy" : n <= 8 ? "case" : n === 9 ? "epiphany" : "cta";
    slides.push({
      n,
      role,
      job: role,
      beat: theory?.systemicClaim || topic || "",
      gear: defaultGear(n),
    });
  }

  return {
    slides,
    arc: String(parsed?.arc || "").trim(),
  };
}

/**
 * STAGE 3 — Micro-Copywriting & Scan-Path Engine
 * Punchy fragments, <35 words, **bold** on core semantic entities.
 */
export async function stage3MicroCopy({ apiKey, topic, context, theory, storyboard }) {
  const prompt = [
    GST_VOICE,
    "",
    "STAGE 3 — MICRO-COPY + SCAN-PATH ENGINE",
    `Write finished Instagram carousel copy for EXACTLY ${GST_SLIDE_COUNT} slides.`,
    `HARD LIMIT: under ${GST_MAX_WORDS} words per slide (count every word).`,
    "Punchy single-sentence fragments. Scan-path: wrap the core semantic entity in **double asterisks** once per slide when it helps (e.g. **The Barrier:**).",
    "No passive voice. No corporate sludge. No statute-speak. No both-sides fog.",
    "Slide 1 = inverse hook + CHARGE (systemicClaim).",
    "Slides 2-4 = PATTERN mechanics.",
    "Slides 5-8 = STAKES as concrete evidence — named rooms, towns, prices, scenes from the source when available. Invent nothing unverifiable.",
    "Slide 9 = TEACH — leave them a reusable lens (teachLens), not just a mood.",
    "Slide 10 = STANCE as engagement (comment keyword / name the town / aim the lens) — never RSVP / don't miss / buy tickets.",
    "",
    "THEORY:",
    JSON.stringify(theory, null, 2),
    "",
    "STORYBOARD:",
    JSON.stringify(storyboard.slides, null, 2),
    "",
    subjectBlock(topic, context),
    "",
    "Return JSON ONLY:",
    `{"slides":[{"n":1,"role":"hook","headline":"...","body":"...","scanPath":["..."]}, ... 10 total ...]}`,
  ].join("\n");

  const parsed = await geminiJson(apiKey, prompt, { temperature: 0.7 });
  let slides = Array.isArray(parsed?.slides) ? parsed.slides : [];
  slides = slides.slice(0, GST_SLIDE_COUNT).map((s, i) => {
    const role = String(s?.role || storyboard.slides[i]?.role || "").toLowerCase();
    const headline = String(s?.headline || "").trim();
    const body = String(s?.body || "").trim();
    const combined = [headline, body].filter(Boolean).join(" ");
    const scanPath = Array.isArray(s?.scanPath) && s.scanPath.length
      ? s.scanPath.map((x) => String(x).trim()).filter(Boolean)
      : extractScanPath(`${headline} ${body}`);
    return {
      n: i + 1,
      role,
      headline,
      body,
      scanPath,
      gear: storyboard.slides[i]?.gear || "",
      wordCount: wordCount(combined),
      bannedHits: containsBannedPhrase(combined),
    };
  });

  while (slides.length < GST_SLIDE_COUNT) {
    const i = slides.length;
    const sb = storyboard.slides[i] || {};
    slides.push({
      n: i + 1,
      role: sb.role || "case",
      headline: sb.job || "THE PATTERN",
      body: sb.beat || theory?.systemicClaim || "",
      scanPath: [],
      gear: sb.gear || "",
      wordCount: 0,
      bannedHits: [],
    });
  }

  return slides;
}

/** Enforce Stage 3 hard rules after the model returns. */
export function enforceMicroCopyRules(slides) {
  return (slides || []).map((s) => {
    let headline = String(s.headline || "").trim();
    let body = String(s.body || "").trim();
    // If over word budget, keep headline + first sentences of body until under cap.
    const trimToBudget = () => {
      const words = `${stripScanMarkers(headline)} ${stripScanMarkers(body)}`
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      if (words.length <= GST_MAX_WORDS) return;
      const kept = words.slice(0, GST_MAX_WORDS).join(" ");
      // Prefer keeping headline intact when possible.
      const hWords = stripScanMarkers(headline).split(/\s+/).filter(Boolean);
      if (hWords.length >= GST_MAX_WORDS) {
        headline = hWords.slice(0, GST_MAX_WORDS).join(" ");
        body = "";
      } else {
        const remain = GST_MAX_WORDS - hWords.length;
        const bWords = stripScanMarkers(body).split(/\s+/).filter(Boolean);
        body = bWords.slice(0, remain).join(" ");
        // Drop scan markers that got truncated mid-token awkwardly — re-apply none.
        headline = stripScanMarkers(headline);
        body = stripScanMarkers(body);
      }
      void kept;
    };
    trimToBudget();

    // Strip banned phrases by blanking the matched token (best-effort).
    for (const ban of containsBannedPhrase(`${headline} ${body}`)) {
      const re = new RegExp(ban.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      headline = headline.replace(re, "").replace(/\s{2,}/g, " ").trim();
      body = body.replace(re, "").replace(/\s{2,}/g, " ").trim();
    }

    const combined = [headline, body].filter(Boolean).join(" ");
    return {
      ...s,
      headline,
      body,
      scanPath: extractScanPath(`${headline} ${body}`).length
        ? extractScanPath(`${headline} ${body}`)
        : s.scanPath || [],
      wordCount: wordCount(combined),
      bannedHits: containsBannedPhrase(combined),
    };
  });
}

/**
 * Map GST storyboard copy onto CGE MediaTool slot objects so the existing
 * carousel renderer can paint them without a new slide type.
 */
export function gstCopyToSlots(microSlides) {
  const seq = [];
  const slides = (microSlides || []).map((s, i) => {
    const n = i + 1;
    const role = s.role || GST_DESIGN_TOKENS.slideRoles[i] || "case";
    const headline = stripScanMarkers(s.headline || "");
    const body = stripScanMarkers(s.body || "");
    const accent = (s.scanPath && s.scanPath[0]) || "";
    const accentWord = accent.split(/\s+/)[0] || "";

    if (n === 1 || role === "hook") {
      seq.push("cover");
      return {
        type: "cover",
        headline: headline || body,
        subtitle: headline ? body : "",
        accentWord: accentWord.toUpperCase() || undefined,
        _gstRole: "hook",
        _scanPath: s.scanPath || [],
      };
    }
    if (n === 4 || (role === "anatomy" && /stat|number|count|price|\$|cap/i.test(`${headline} ${body}`))) {
      // Prefer a stat slot when the anatomy beat is a number.
      const numMatch = `${headline} ${body}`.match(/(\$?\d[\d,]*(?:\.\d+)?%?|\d[\d,]*\+)/);
      if (numMatch) {
        seq.push("stat");
        return {
          type: "stat",
          statNumber: numMatch[1],
          statLabel: headline.replace(numMatch[1], "").trim() || "THE NUMBER",
          statSub: body,
          _gstRole: role,
          _scanPath: s.scanPath || [],
        };
      }
    }
    if (n >= 5 && n <= 8 && role === "case") {
      seq.push("spotlight");
      return {
        type: "spotlight",
        spotName: headline || `CASE ${n - 4}`,
        spotMeta: body,
        spotTime: "",
        spotPrice: "",
        spotCta: "",
        _gstRole: "case",
        _scanPath: s.scanPath || [],
      };
    }
    if (n === 10 || role === "cta") {
      seq.push("cta");
      return {
        type: "cta",
        kicker: (s.scanPath && s.scanPath[0]) || "THE ASK",
        mainLine: headline || body,
        subLine: headline ? body : "",
        _gstRole: "cta",
        _scanPath: s.scanPath || [],
      };
    }
    // anatomy / epiphany / default → news (scan-path punchy card) or text
    if (role === "epiphany" || n === 9) {
      seq.push("text");
      return {
        type: "text",
        textTitle: headline || "THE TAKEAWAY",
        textBody: body,
        _gstRole: "epiphany",
        _scanPath: s.scanPath || [],
      };
    }
    seq.push("news");
    return {
      type: "news",
      newsKicker: (s.scanPath && s.scanPath[0]) || "THE MECHANICS",
      newsHeadline: headline,
      newsBody: body,
      newsBold: true,
      _gstRole: role || "anatomy",
      _scanPath: s.scanPath || [],
    };
  });

  return { sequence: seq, slides };
}

/**
 * Full pipeline: Stage 1 → 2 → 3 → slot map.
 * This is the new body of generateArrangedCarousel.
 */
export async function generateGstCarousel({ apiKey, topic, context }) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  if ((!topic || !String(topic).trim()) && (!context || !String(context).trim())) {
    throw new Error("Add a topic or source material first");
  }

  const theory = await stage1CriticalTheory({ apiKey, topic, context });
  const storyboard = await stage2Storyboard({ apiKey, topic, context, theory });
  let micro = await stage3MicroCopy({ apiKey, topic, context, theory, storyboard });
  micro = enforceMicroCopyRules(micro);
  const mapped = gstCopyToSlots(micro);

  const rationale = [
    storyboard.arc || "",
    theory.systemicClaim ? `Thesis: ${theory.systemicClaim}` : "",
    theory.trope ? `Pattern: ${theory.trope}` : "",
    theory.teachLens ? `Teach: ${theory.teachLens}` : "",
    theory.stance ? `Stance: ${theory.stance}` : "",
    theory.charge && theory.stakes ? `Charge/stakes: ${theory.charge} / ${theory.stakes}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    slides: mapped.slides,
    sequence: mapped.sequence,
    originalSequence: mapped.sequence,
    rationale,
    compressionEvent: null,
    gst: {
      theory,
      storyboard,
      micro,
      design: GST_DESIGN_TOKENS,
    },
  };
}
