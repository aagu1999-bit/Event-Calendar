#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs";
import { generateGstCarousel, GST_MAX_WORDS, wordCount, containsBannedPhrase } from "../src/shared/gstPipeline.js";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY missing");
  process.exit(1);
}

const topic = 'Why "nowhere to go" in a NJ town often means the tap is frozen';
const context = [
  "- Towns in New Jersey can't just add a bunch of new rooms that serve drinks.",
  "- The old places that already have a license get to stay.",
  "- A new bar, or a restaurant that wants a bar, often gets blocked.",
  "- People say there's nowhere to go. A lot of the time the town already used up its drink licenses, so the Saturday night has nowhere new to land.",
  "- This is not about one club. It's about why a town feels shut even when people still want a night out.",
].join("\n");

console.error("Running GST pipeline…");
const result = await generateGstCarousel({ apiKey, topic, context });

const report = {
  topic,
  rationale: result.rationale,
  sequence: result.sequence,
  theory: result.gst.theory,
  arc: result.gst.storyboard.arc,
  slides: result.slides.map((s, i) => ({
    n: i + 1,
    type: s.type,
    role: s._gstRole,
    text: [
      s.headline || s.textTitle || s.newsHeadline || s.spotName || s.statNumber || s.mainLine || s.kicker,
      s.subtitle || s.textBody || s.newsBody || s.spotMeta || s.statSub || s.subLine,
    ]
      .filter(Boolean)
      .join("\n"),
    words: wordCount(
      [
        s.headline, s.subtitle, s.textTitle, s.textBody, s.newsHeadline, s.newsBody,
        s.spotName, s.spotMeta, s.statNumber, s.statLabel, s.statSub, s.mainLine, s.subLine, s.kicker,
      ]
        .filter(Boolean)
        .join(" "),
    ),
    banned: containsBannedPhrase(
      [
        s.headline, s.subtitle, s.textTitle, s.textBody, s.newsHeadline, s.newsBody,
        s.spotName, s.spotMeta, s.mainLine, s.subLine,
      ]
        .filter(Boolean)
        .join(" "),
    ),
  })),
  micro: result.gst.micro,
};

mkdirSync("/opt/cursor/artifacts", { recursive: true });
writeFileSync("/opt/cursor/artifacts/gst-pipeline-run.json", JSON.stringify(report, null, 2));
writeFileSync("/workspace/artifacts/gst-pipeline-run.json", JSON.stringify(report, null, 2));

console.log(JSON.stringify({
  sequence: report.sequence,
  theory: report.theory,
  slides: report.slides.map((s) => ({ n: s.n, type: s.type, role: s.role, words: s.words, banned: s.banned, text: s.text })),
}, null, 2));

const over = report.slides.filter((s) => s.words > GST_MAX_WORDS);
const banned = report.slides.filter((s) => s.banned.length);
if (over.length) console.error("OVER WORD BUDGET:", over.map((s) => s.n));
if (banned.length) console.error("BANNED HITS:", banned.map((s) => `${s.n}:${s.banned}`));
console.error("Wrote /opt/cursor/artifacts/gst-pipeline-run.json");
