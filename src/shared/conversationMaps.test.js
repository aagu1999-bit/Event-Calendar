import test from "node:test";
import assert from "node:assert/strict";
import {
  CONVERSATION_MAP_ORDER,
  suggestConversationRank,
  vetoConversationPrimary,
  formatConversationSeedLines,
  sanitizeConversationRank,
  applyConversationSuggestion,
  parseConversationRankFromContext,
  conversationWriterBlock,
  conversationSlideSequence,
} from "./conversationMaps.js";
import { eventMatrixToFillSeed } from "./eventMatrixToFillSeed.js";
import { MATRIX_FIELDS } from "./matrixEnums.js";
import { earnedSlideCount } from "./matrixCompass.js";

test("four conversation maps, not a cluster catalog", () => {
  assert.deepEqual(CONVERSATION_MAP_ORDER, ["injustice", "explainer", "reframe", "microdoc"]);
});

test("liquor-cap vote suggests Injustice primary", () => {
  const rank = suggestConversationRank({
    hook: "The 1:3,000 cap still authors the night.",
    pov: "Who paid is the restaurant that cannot pour after the vote.",
    anchors: [
      "START — the ordinance passed and the license quota held.",
      "START — a frozen tap on a Saturday that used to pour.",
    ],
  });
  assert.equal(rank.primary, "injustice");
  assert.equal(rank.tertiary, "");
});

test("logistics tax suggests Explainer primary", () => {
  const rank = suggestConversationRank({
    hook: "Parkway towns eat the summer influx.",
    pov: "The influx is a logistics tax, not a vibe. Here is how it works.",
    anchors: [
      "START — the mechanism is weekend traffic eating the shoulder season.",
      "START — breakdown: catalyst is the influx, then the split in who stays.",
    ],
  });
  assert.equal(rank.primary, "explainer");
});

test("headline counter suggests Re-frame primary", () => {
  const rank = suggestConversationRank({
    hook: "The headline said a renaissance. The public log said a closure.",
    pov: "Re-frame the mainstream claim with the archive, not a vibe.",
    anchors: [
      "START — they said the downtown was back.",
      "START — the archive is the shuttered Saturday.",
    ],
  });
  assert.equal(rank.primary, "reframe");
});

test("a room over time suggests Micro-doc primary", () => {
  const rank = suggestConversationRank({
    hook: "Club Zanzibar still authors rooms that never made the map.",
    pov: "The lineage is a remnant — the motel ballroom over time, not a listing.",
    anchors: [
      "START — Club Zanzibar closed in 1992.",
      "START — a living remnant still holds the sound.",
    ],
  });
  assert.equal(rank.primary, "microdoc");
});

test("secondary only when a pointed anchored claim supports another map", () => {
  const rank = suggestConversationRank({
    hook: "The 1:3,000 cap still authors the night.",
    pov: "Who paid is the restaurant that cannot pour after the vote.",
    anchors: [
      "START — the ordinance passed and the license quota held.",
      "START — the mechanism is a logistics tax on who can pour.",
    ],
    argumentCheck: {
      claims: [
        { claim: "the ordinance passed", from: "hook", support: "anchored", anchor: 1 },
        { claim: "the mechanism is a logistics tax", from: "pov", support: "anchored", anchor: 2 },
      ],
    },
  });
  assert.equal(rank.primary, "injustice");
  assert.equal(rank.secondary, "explainer");
});

test("no secondary without an anchored claim", () => {
  const rank = suggestConversationRank({
    hook: "The 1:3,000 cap still authors the night.",
    pov: "Who paid is the restaurant that cannot pour after the vote. The mechanism is a logistics tax.",
    anchors: [
      "START — the ordinance passed and the license quota held.",
      "START — the mechanism is a logistics tax on who can pour.",
    ],
  });
  assert.equal(rank.primary, "injustice");
  assert.equal(rank.secondary, "");
});

test("Check vetoes Injustice primary on festival listings", () => {
  const veto = vetoConversationPrimary({
    primary: "injustice",
    hook: "Discover surprising gathering spots this Saturday.",
    pov: "A weekend of mixers.",
    anchors: ["START — doors at 10", "START — DJ set at the hall"],
  });
  assert.equal(veto.ok, false);
  assert.match(veto.reason, /Injustice primary/);
  assert.equal(vetoConversationPrimary({
    primary: "injustice",
    hook: "The cap still authors the night.",
    pov: "The vote blocked the pour.",
    anchors: ["START — the ordinance passed"],
  }), null);
});

test("seed lines are Cover + News conversation maps, not GST 10", () => {
  const lines = formatConversationSeedLines({
    primary: "explainer",
    secondary: "injustice",
    tertiary: "reframe",
  });
  const blob = lines.join("\n");
  assert.match(blob, /CONVERSATION_RANK_KEYS: primary=explainer/);
  assert.match(blob, /CONVERSATION MAP: primary Explainer/);
  assert.match(blob, /Cover \+ News/);
  assert.match(blob, /10-slide/);
  assert.match(blob, /SECONDARY \(Injustice/);
  assert.match(blob, /TERTIARY \(Re-frame/);
  assert.match(blob, /share this to change the conversation/);
  assert.deepEqual(formatConversationSeedLines({}), []);
});

test("fill seed injects the conversation map and stores the field", () => {
  assert.equal(MATRIX_FIELDS.includes("conversation_rank"), true);
  const seed = eventMatrixToFillSeed({
    name: "Parkway piece",
    matrix: {
      event_tier: "FEATURE",
      hook_a_side: "Parkway towns eat the summer influx.",
      editorial_pov: "The influx is a logistics tax.",
      data_points: ["START — the mechanism is weekend traffic."],
      conversation_rank: { primary: "explainer", secondary: "injustice" },
    },
  });
  assert.match(seed.context, /CONVERSATION MAP: primary Explainer/);
  assert.match(seed.context, /Cover \+ News/);
  assert.match(seed.context, /not a default 3/);
  assert.equal(seed.arrange, false);
});

test("fill seed splits homework off the proof pile", () => {
  const seed = eventMatrixToFillSeed({
    name: "Parkway piece",
    matrix: {
      event_tier: "FEATURE",
      hook_a_side: "Parkway towns eat the summer influx.",
      editorial_pov: "The influx is a logistics tax.",
      data_points: [
        "START — Parkway towns lose the shoulder season.",
        "START — A currently-operating Saturday still pays the tax.",
        "MECHANISM — weekend traffic eats the split.",
        "SPECIMEN — a Parkway operator named the influx.",
        "RECEIPT — UNVERIFIED: the tax is unpaid",
        "GAP — a currently-operating Saturday operator quote",
      ],
      argument_check: {
        verdict: "thin",
        reason: "One claim is still a promise.",
        gaps: ["Need a currently-operating Parkway Saturday quote."],
        claims: [
          { claim: "Parkway towns eat the summer influx.", from: "hook", support: "anchored", anchor: 1 },
          { claim: "The tax is unpaid.", from: "pov", support: "unverified", anchor: 0 },
        ],
        useFor: "Cover + News plus pointed receipts.",
        slideCount: 3,
      },
    },
  });
  assert.match(seed.context, /ANCHORED FACTS \(write from these\)/);
  assert.match(seed.context, /START — Parkway towns lose the shoulder season/);
  assert.match(seed.context, /HOMEWORK — NOT PROOF/);
  assert.match(seed.context, /RECEIPT — UNVERIFIED: the tax is unpaid/);
  assert.match(seed.context, /GAP — a currently-operating Saturday operator quote/);
  assert.match(seed.context, /UNVERIFIED CLAIMS — OMIT FROM EVERY SLIDE/);
  assert.match(seed.context, /OPEN GAPS — homework, not copy/);
  assert.equal(earnedSlideCount(seed.context), 6);
});

test("ranked maps parse from seed and become Cover + News, not GST 10", () => {
  const seed = formatConversationSeedLines({
    primary: "explainer",
    secondary: "injustice",
    tertiary: "reframe",
  }).join("\n");
  const parsed = parseConversationRankFromContext(seed);
  assert.equal(parsed.primary, "explainer");
  assert.equal(parsed.secondary, "injustice");
  assert.equal(parsed.tertiary, "reframe");
  assert.deepEqual(conversationSlideSequence(parsed), ["cover", "news", "cta"]);
  assert.deepEqual(conversationSlideSequence(`${seed}\nPOINTED SLIDE COUNT: 5.`), ["cover", "news", "text", "text", "cta"]);
  assert.deepEqual(conversationSlideSequence(parsed, 5), ["cover", "news", "text", "text", "cta"]);
  const richDesk = [
    seed,
    "POINTED SLIDE COUNT: 3.",
    "- START — Parkway towns lose the shoulder season.",
    "- START — A currently-operating Saturday still pays the tax.",
    "- MECHANISM — weekend traffic eats the split.",
    "- SPECIMEN — a Parkway operator named the influx.",
  ].join("\n");
  assert.deepEqual(conversationSlideSequence(richDesk), ["cover", "news", "text", "text", "text", "cta"]);
  assert.equal(conversationSlideSequence({}), null);
  const writer = conversationWriterBlock(parsed).join("\n");
  assert.match(writer, /outranks GST/);
  assert.match(writer, /Explainer/);
  assert.match(writer, /do not invent who-owns/);
  assert.deepEqual(parseConversationRankFromContext(""), sanitizeConversationRank({}));
});

test("locked operator rank is not overwritten by a new suggestion", () => {
  const locked = sanitizeConversationRank({ primary: "microdoc", locked: true });
  const suggestion = suggestConversationRank({
    hook: "The 1:3,000 cap still authors the night.",
    pov: "The vote blocked the pour.",
    anchors: ["START — the ordinance passed", "START — a frozen tap"],
  });
  const next = applyConversationSuggestion(locked, suggestion);
  assert.equal(next.primary, "microdoc");
  assert.equal(next.locked, true);
  assert.equal(next.suggestedPrimary, "injustice");
});
