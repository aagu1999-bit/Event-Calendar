import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useBrandStore, useCarouselTemplatesStore, BUILTIN_CAROUSEL_TEMPLATES } from "../store";
import { generateTemplateFill, pickTemplate, generateArrangedCarousel, researchEvent, researchNews, connectDots, dotsPlanToSlides } from "./aiContent.js";

// Scaffold that primes the Context box with the ingredients a strong hook
// (esp. an open loop) needs: the TWIST is the curiosity gap, PROOF + WHAT
// HAPPENS are what the carousel uses to pay it off honestly. Filling these
// in beats a bland bullet list every time — the "＋ Template" button drops
// this skeleton in for the user to complete.
const CONTEXT_SCAFFOLD = [
  "THE TWIST: (the one surprising, counterintuitive thing — the \"wait, what?\")",
  "WHAT HAPPENS: (concrete activities, lineup, format)",
  "PROOF: (real specifics — names, venues, times, prices, counts)",
  "WHY NOW: (why THIS weekend; what's new or at stake)",
  "WHO IT'S FOR: (the specific crowd — never \"everyone\")",
].join("\n");

// Modal for AI-assisted whole-carousel generation. Pick a template,
// type a topic + context, Gemini fills every slot in the sequence in
// one coherent call. Output → preview cards → "Push to carousel".
//
// Props:
//   open               — boolean
//   apiKey             — Gemini key (from MediaTool)
//   initialTemplateId  — preselect a template
//   onClose()
//   onAccept(slides)   — slides array matching the template's sequence

export function AiTemplateFillModal({ open, apiKey, initialTemplateId, initialTopic = "", initialContext = "", initialArrange = false, onClose, onAccept }) {
  const voice = useBrandStore((s) => s.voice);
  const slotPrompts = useBrandStore((s) => s.slotPrompts);
  const addExemplar = useBrandStore((s) => s.addExemplar);
  const customs = useCarouselTemplatesStore((s) => s.customs);
  const allTemplates = [...BUILTIN_CAROUSEL_TEMPLATES, ...customs];

  const [templateId, setTemplateId] = useState(initialTemplateId || allTemplates[0]?.id || "");
  const [topic, setTopic] = useState("");
  const [context, setContext] = useState("");
  const [mode, setMode] = useState("editorial");
  const [slides, setSlides] = useState([]);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState("");
  // When true, Gemini picks the template instead of the user. The
  // template dropdown gets hidden and replaced with an "AI will pick"
  // banner. After generation, the picked template + reasoning displays
  // in the result panel so the user knows what was chosen.
  const [letAiPick, setLetAiPick] = useState(false);
  const [aiArrange, setAiArrange] = useState(false);
  // Connect-the-dots mode — a thesis + several real-news "dots" welded into one
  // evidence carousel. dotsDiscover lets the AI propose the thread itself.
  const [dotsMode, setDotsMode] = useState(false);
  const [dotsDiscover, setDotsDiscover] = useState(false);
  // Anchor event — when set, the dots become the problem/demand and THIS event
  // is the answer (verdict) + the CTA. Turns coverage into problem→solution promo.
  const [dotsAnchor, setDotsAnchor] = useState("");
  // Target slide count for "AI arranges" — "auto" lets Gemini size the arc to
  // the story; a number pins it. Ignored by fixed-length template fill.
  const [slideCount, setSlideCount] = useState("auto");
  // Letter / manifesto mode — write the whole carousel as one continuous
  // first-person letter (the @summerblockfest structure), thought carrying
  // slide to slide, instead of standalone cards.
  const [letterMode, setLetterMode] = useState(false);
  const [researchOn, setResearchOn] = useState(false);
  // Timely news lookup — grounds generation in recent + upcoming happenings
  // (distinct from researchOn's evergreen background) so you can spin a
  // same-week "what's happening" post out of the current moment.
  const [newsOn, setNewsOn] = useState(false);
  // The brief + source links from the last news lookup, so the user can SEE
  // and verify what fed the generation instead of trusting a black box.
  const [newsFound, setNewsFound] = useState(null);
  const [pickedTemplate, setPickedTemplate] = useState(null);
  const [pickReasoning, setPickReasoning] = useState("");
  // Per-slide exemplar harvest state. Tracks slide indices the user
  // saved. Cleared on new generation. Only certain slot types yield
  // useful exemplars (cover/text/spotlight/cta) — other types are
  // skipped in the slot→exemplar mapping.
  const [savedIdx, setSavedIdx] = useState(new Set());
  // Which generated slides to push into the carousel (default: all). The user
  // opts slides OUT via the keep toggle on each preview card.
  const [keptIdx, setKeptIdx] = useState(new Set());
  // Index currently being re-rolled by the per-slide "↻" button (null = none).
  const [regenIdx, setRegenIdx] = useState(null);
  // Set true right before a single-slot swap so the keptIdx-reset effect
  // knows to leave the user's keep/skip choices alone (only a fresh full
  // generation should reset everything to kept).
  const singleRegenRef = useRef(false);

  useEffect(() => {
    if (open) {
      setSlides([]);
      setError("");
      setBusy(false);
      setBusyLabel("");
      setPickedTemplate(null);
      setPickReasoning("");
      setSavedIdx(new Set());
      setMode("editorial");
      setAiArrange(false);
      setDotsMode(false);
      setDotsDiscover(false);
      setDotsAnchor("");
      setSlideCount("auto");
      setNewsOn(false);
      setNewsFound(null);
      setLetterMode(false);
      if (initialTemplateId) setTemplateId(initialTemplateId);
      // Seed topic/context when a caller opens us with a story (e.g. the News
      // Scout's "Build carousel"). Only overwrite when a non-empty seed is
      // given, so the plain ✨ AI Fill button preserves the last topic. A
      // seeded open also flips on "AI arranges" so it designs a full carousel.
      if (initialTopic) setTopic(initialTopic);
      if (initialContext) setContext(initialContext);
      if (initialArrange) setAiArrange(true);
    }
  }, [open, initialTemplateId, initialTopic, initialContext, initialArrange]);

  // Every freshly generated batch starts fully kept — but a single-slot
  // re-roll (same array length, one entry swapped) must NOT wipe the user's
  // keep/skip choices, so it flags singleRegenRef to skip one reset.
  useEffect(() => {
    if (singleRegenRef.current) { singleRegenRef.current = false; return; }
    setKeptIdx(new Set(slides.map((_, i) => i)));
  }, [slides]);

  if (!open) return null;

  const template = allTemplates.find(t => t.id === templateId) || allTemplates[0];
  const voiceOn = (voice?.description && voice.description.trim()) ||
                  (Array.isArray(voice?.exemplars) && voice.exemplars.some(e => e && e.trim()));
  // When either AI mode is on, the AI chooses the layout, so the manual
  // Template dropdown is inert (greyed) and its slide count no longer applies.
  const aiChoosesLayout = letAiPick || aiArrange || dotsMode;
  // Label for the Generate button — must reflect what will actually run.
  const genLabel = slides.length
    ? "↻ Regenerate"
    : dotsMode
      ? (dotsAnchor.trim() ? "🧵 Build the case for my event" : dotsDiscover ? "🧵 Find a thread + build" : "🧵 Connect the dots")
      : aiArrange
        ? (slideCount === "auto" ? "✨ Design + generate" : `✨ Generate ${slideCount} slides`)
        : letAiPick
          ? "✨ Let AI pick + generate"
          : `✨ Generate ${template?.sequence?.length || 0} slides`;
  const enrichCount = (researchOn ? 1 : 0) + (newsOn ? 1 : 0);
  // Dots with "find the thread" or an anchor event needs no thesis typed; everything else needs a topic/context.
  const canGenerate = (dotsMode && (dotsDiscover || !!dotsAnchor.trim())) || !!topic.trim() || !!context.trim();

  const handleGenerate = async () => {
    if (!apiKey) { setError("Paste your Gemini API key in the MediaTool toolbar first."); return; }
    if (!dotsMode && !aiArrange && !letAiPick && !template) { setError("Pick a template first, or toggle 'Let AI pick' / 'AI arranges'."); return; }
    // Dots mode with "find the thread" or an anchor event needs no thesis; otherwise require a thesis/topic.
    if (!(dotsMode && (dotsDiscover || dotsAnchor.trim())) && !topic.trim() && !context.trim()) { setError(dotsMode ? "Type the thesis/pattern — or add an anchor event, or toggle 'Let AI find the thread'." : "Add a topic or some event details first."); return; }
    setBusy(true);
    setError("");
    setSlides([]);
    setPickedTemplate(null);
    setPickReasoning("");
    setNewsFound(null);
    try {
      // Optional web research — a grounded Gemini call looks the event up and
      // returns a background brief, which we append to the context so every
      // downstream generation is richer than what the user typed alone.
      // Best-effort: if it fails (grounding unsupported / offline), continue.
      let genContext = context;
      if (researchOn) {
        setBusyLabel("Researching the event…");
        try {
          const brief = await researchEvent({ apiKey, topic, context });
          if (brief) {
            genContext = (genContext ? genContext + "\n\n" : "")
              + "RESEARCHED BACKGROUND (general web context — verify any specifics before treating them as fact about THIS event):\n"
              + brief;
          }
        } catch (e) {
          console.warn("Research step failed, continuing without it:", e?.message || e);
        }
      }
      // Timely news lookup — recent + upcoming happenings for this topic/area,
      // folded in so the carousel is built off the current moment.
      if (newsOn) {
        setBusyLabel("Looking up recent news…");
        try {
          const news = await researchNews({ apiKey, topic, context });
          if (news?.brief) {
            genContext = (genContext ? genContext + "\n\n" : "")
              + "TIMELY NEWS + UPCOMING HAPPENINGS (recent web results — verify any date/venue/price before stating it as fact; build the post around these current items):\n"
              + news.brief;
            setNewsFound(news);
          }
        } catch (e) {
          console.warn("News lookup failed, continuing without it:", e?.message || e);
        }
      }
      // "Connect the dots" — a thesis + several real-news dots, welded into an
      // evidence carousel. Supersedes template/arrange.
      if (dotsMode) {
        // Anchor is a Promo technique; discover is an Editorial one.
        const anchorForRun = mode === "promo" ? dotsAnchor : "";
        const discoverForRun = mode === "editorial" ? dotsDiscover : false;
        setBusyLabel(anchorForRun.trim() ? "Building the case for your event…" : discoverForRun ? "Finding a thread…" : "Gathering the evidence…");
        const plan = await connectDots({ apiKey, thesis: discoverForRun ? "" : topic, area: "New Jersey", anchorEvent: anchorForRun });
        const dotsSlides = dotsPlanToSlides(plan);
        if (!dotsSlides.length) { setError("Couldn't find enough real dots for that thread. Try a clearer thesis, or toggle 'Let AI find the thread'."); return; }
        setNewsFound({ brief: plan.brief, sources: plan.sources });
        setPickedTemplate({ id: "connect-the-dots", name: `Connect the dots${plan.thesis ? ` — ${plan.thesis}` : ""}`, sequence: dotsSlides.map(s => s.type), custom: true });
        setPickReasoning(plan.thesis ? `Thesis: ${plan.thesis}` : "");
        setSlides(dotsSlides);
        return;
      }
      // "AI arranges" — design a bespoke slot sequence for this story, then
      // fill + polish it. Supersedes template selection.
      if (aiArrange) {
        setBusyLabel("Designing + filling…");
        const arranged = await generateArrangedCarousel({ apiKey, topic, context: genContext, voice, slotPrompts, mode, targetCount: slideCount === "auto" ? null : parseInt(slideCount, 10), letterMode });
        setPickedTemplate({ id: "ai-arranged", name: "AI-arranged carousel", sequence: arranged.sequence, custom: true });
        setPickReasoning(arranged.rationale);
        setSlides(arranged.slides);
        return;
      }
      // Phase 1 (optional): AI picks the template.
      let useTemplate = template;
      if (letAiPick) {
        setBusyLabel("Picking template…");
        const pick = await pickTemplate({
          apiKey,
          topic,
          context: genContext,
          candidates: allTemplates,
        });
        useTemplate = pick.template;
        setPickedTemplate(pick.template);
        setPickReasoning(pick.reasoning);
      }
      // Phase 2: fill the picked/chosen template.
      setBusyLabel(`Filling ${useTemplate.sequence.length} slides…`);
      const result = await generateTemplateFill({
        apiKey,
        sequence: useTemplate.sequence,
        topic,
        context: genContext,
        voice,
        slotPrompts,
        templateMeta: useTemplate,
        mode,
        letterMode,
      });
      setSlides(result);
    } catch (err) {
      console.error(err);
      setError(err.message || "Generation failed");
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  };

  const handlePush = () => {
    const chosen = slides.filter((_, i) => keptIdx.has(i));
    if (!chosen.length) { setError("Keep at least one slide to push."); return; }
    onAccept(chosen, pickedTemplate || template);
    onClose();
  };

  // Re-roll a SINGLE slot, keeping every other slide as-is. Reuses the
  // template-fill generator with a one-slot sequence, and feeds in the FULL
  // carousel + this slide's immediate neighbors so the rewrite matches the
  // established voice/motif, bridges the slides on either side, and fills the
  // missing beat — plus its previous copy so it comes out clearly different.
  const handleRegenerateSlide = async (idx) => {
    if (!apiKey) { setError("Paste your Gemini API key in the MediaTool toolbar first."); return; }
    const slot = slides[idx];
    if (!slot || regenIdx !== null) return;
    setRegenIdx(idx);
    setError("");
    try {
      const prevVersion = slotToExemplar(slot).trim();
      const n = slides.length;
      const before = idx > 0 ? slides[idx - 1] : null;
      const after = idx < n - 1 ? slides[idx + 1] : null;
      // Full map of the carousel with THIS slide flagged, so the model can see
      // the established voice/motif and exactly what each other slide already
      // covers (the pattern to match + the gap to fill).
      const fullMap = slides
        .map((s, i) => `Slide ${i + 1} (${s.type})${i === idx ? "  <-- THIS ONE (being redone)" : ""}: ${slotToExemplar(s).trim() || "(no text)"}`)
        .join("\n");
      const neighborLines = [
        before ? `THE SLIDE RIGHT BEFORE (slide ${idx} - ${before.type}): ${slotToExemplar(before).trim() || "(no text)"}`
               : "There is NO slide before — this is the opener/cover.",
        after ? `THE SLIDE RIGHT AFTER (slide ${idx + 2} - ${after.type}): ${slotToExemplar(after).trim() || "(no text)"}`
              : "There is NO slide after — this is the closer/CTA.",
      ].join("\n");
      const regenContext = [
        context.trim(),
        `FULL CAROUSEL (study the voice, the running motif, and what each slide already covers — do not repeat or contradict them):\n${fullMap}`,
        `YOUR JOB: rewrite ONLY slide ${idx + 1} (the ${slot.type}) so it fits SEAMLESSLY between its neighbors — continue/pay off what the slide before sets up, and tee up the slide after. Match the established voice + motif + pattern, and fill the specific missing beat this position needs. Don't duplicate what other slides already say.\n${neighborLines}`,
        prevVersion && `PREVIOUS VERSION OF THIS SLIDE (make the new one clearly DIFFERENT — fresh angle/wording, not a rephrase — while still bridging the neighbors):\n${prevVersion}`,
      ].filter(Boolean).join("\n\n");
      const result = await generateTemplateFill({
        apiKey,
        sequence: [slot.type],
        topic,
        context: regenContext,
        voice,
        slotPrompts,
        templateMeta: pickedTemplate || template || { sequence: [slot.type] },
        mode,
        polish: false,
        letterMode,
      });
      const fresh = Array.isArray(result) && result[0] ? result[0] : null;
      if (!fresh) throw new Error("No slide returned");
      singleRegenRef.current = true; // preserve keep/skip choices across the swap
      setSlides(prevSlides => prevSlides.map((s, i) => (i === idx ? fresh : s)));
      setSavedIdx(prev2 => { const n = new Set(prev2); n.delete(idx); return n; }); // new copy → un-mark "saved"
    } catch (err) {
      console.error(err);
      setError(`Regenerate slide ${idx + 1} failed: ${err.message || err}`);
    } finally {
      setRegenIdx(null);
    }
  };

  // Small per-type preview renderer for the result cards.
  // Render the generated slot as a plain-text exemplar so it can prime
  // future Gemini calls via voice.exemplars. Returns "" for slots we
  // can't meaningfully harvest (stat-only, photo-only without caption,
  // etc.); button is hidden in that case.
  const slotToExemplar = (slot) => {
    if (!slot) return "";
    if (slot.type === "cover") {
      return [slot.headline, slot.subtitle].filter(s => s && s.trim()).join("\n\n");
    }
    if (slot.type === "text") {
      const parts = [];
      if (slot.textTitle) parts.push(String(slot.textTitle).trim());
      if (slot.textBody) parts.push(String(slot.textBody).trim());
      return parts.join("\n\n");
    }
    if (slot.type === "spotlight") {
      const head = (slot.spotName || "").trim();
      const meta = (slot.spotMeta || "").trim();
      const detail = [slot.spotTime, slot.spotPrice, slot.spotCta].filter(Boolean).join(" · ");
      return [head, meta, detail].filter(Boolean).join("\n");
    }
    if (slot.type === "cta") {
      const k = (slot.kicker || "").trim();
      const m = (slot.mainLine || "").trim();
      const s = (slot.subLine || "").trim();
      const directory = (slot.ctaDate || "").trim();
      const directoryVenue = (slot.ctaVenue || "").trim();
      // Directory-style CTA (multi-CTA template) uses ctaDate as headline
      if (directory) return [directory, directoryVenue].filter(Boolean).join("\n");
      return [k && k.toUpperCase(), m, s].filter(Boolean).join("\n");
    }
    if (slot.type === "countdown") {
      return [slot.countText, slot.countEvent, slot.countWhen, slot.countCta]
        .map(s => (s || "").trim()).filter(Boolean).join("\n");
    }
    if (slot.type === "poster") {
      return [slot.kicker, slot.title, slot.subtitle, slot.dateLine]
        .map(s => (s || "").trim()).filter(Boolean).join("\n");
    }
    if (slot.type === "press") {
      return [slot.pressTitle, slot.pressLineup, slot.pressGenres, slot.pressDateLine]
        .map(s => (s || "").trim()).filter(Boolean).join("\n");
    }
    if (slot.type === "features") {
      const items = Array.isArray(slot.features) ? slot.features : [];
      const head = (slot.featuresTitle || "").trim();
      const body = items.map(f => `${f.emoji || ""} ${f.headline || ""} — ${f.sub || ""}`.trim()).join("\n");
      return [head, body].filter(Boolean).join("\n");
    }
    return "";
  };

  const handleSaveSlideAsExemplar = (slot, idx) => {
    const text = slotToExemplar(slot).trim();
    if (!text) return;
    addExemplar(text);
    setSavedIdx(prev => {
      const next = new Set(prev);
      next.add(idx);
      return next;
    });
  };

  const renderPreview = (slot, idx) => {
    const num = idx + 1;
    if (slot.type === "cover") {
      return (
        <div>
          <div style={{ fontSize: "0.5rem", color: "#E5BC4F", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
            Slide {num} · Cover
          </div>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "1rem", fontWeight: 800, lineHeight: 1.15 }}>
            {(slot.headline || "").split(/\s+/).map((w, wi) => (
              <span key={wi} style={{ color: slot.accentWord && w.toLowerCase() === String(slot.accentWord).toLowerCase() ? "#E5BC4F" : "inherit" }}>
                {w}{" "}
              </span>
            ))}
          </div>
          <div style={{ fontSize: "0.7rem", color: "rgba(245,240,232,0.7)", marginTop: 4 }}>
            {slot.subtitle}
          </div>
        </div>
      );
    }
    if (slot.type === "text") {
      return (
        <div>
          <div style={{ fontSize: "0.5rem", color: "#E5BC4F", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
            Slide {num} · Text (manifesto)
          </div>
          {slot.textTitle && (
            <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "0.9rem", fontWeight: 800, marginBottom: 6 }}>
              {slot.textTitle}
            </div>
          )}
          <div style={{ fontSize: "0.7rem", color: "rgba(245,240,232,0.75)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
            {slot.textBody}
          </div>
        </div>
      );
    }
    if (slot.type === "spotlight") {
      return (
        <div>
          <div style={{ fontSize: "0.5rem", color: "#E5BC4F", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
            Slide {num} · Spotlight
          </div>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "0.95rem", fontWeight: 800, marginBottom: 4 }}>
            {slot.spotName}
          </div>
          <div style={{ fontSize: "0.7rem", color: "rgba(245,240,232,0.7)" }}>
            {slot.spotMeta}
          </div>
          {(slot.spotTime || slot.spotPrice || slot.spotCta) && (
            <div style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.5)", marginTop: 4 }}>
              {[slot.spotTime, slot.spotPrice, slot.spotCta].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
      );
    }
    if (slot.type === "cta") {
      return (
        <div>
          <div style={{ fontSize: "0.5rem", color: "#E5BC4F", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
            Slide {num} · CTA
          </div>
          {slot.ctaKicker && (
            <div style={{ display: "inline-block", padding: "2px 8px", background: "#E5BC4F", color: "#000", fontSize: "0.5rem", fontWeight: 800, letterSpacing: 1.5, marginBottom: 6, borderRadius: 3, fontFamily: "'Syne',sans-serif" }}>
              {(slot.ctaKicker || "").toUpperCase()}
            </div>
          )}
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "1rem", fontWeight: 800, marginBottom: 4 }}>
            {slot.ctaDate}
          </div>
          <div style={{ fontSize: "0.7rem", color: "rgba(245,240,232,0.7)" }}>
            {slot.ctaVenue}
          </div>
          {slot.ctaUrl && (
            <div style={{ fontSize: "0.6rem", color: "#E5BC4F", marginTop: 4 }}>
              {slot.ctaUrl}
            </div>
          )}
        </div>
      );
    }
    if (slot.type === "news") {
      return (
        <div>
          <div style={{ fontSize: "0.5rem", color: "#E5BC4F", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
            Slide {num} · News
          </div>
          {slot.newsKicker && (
            <div style={{ fontSize: "0.55rem", color: "#E5BC4F", letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 800, marginBottom: 4 }}>{slot.newsKicker}</div>
          )}
          {slot.newsHeadline && (
            <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "0.95rem", fontWeight: 800, marginBottom: 4 }}>{slot.newsHeadline}</div>
          )}
          <div style={{ fontSize: "0.72rem", color: "rgba(245,240,232,0.78)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
            {String(slot.newsBody || "").split(/(\*[^*]+\*)/g).map((p, i) =>
              (p.length > 2 && p.startsWith("*") && p.endsWith("*"))
                ? <b key={i} style={{ color: "#F5F0E8" }}>{p.slice(1, -1)}</b>
                : <span key={i}>{p}</span>
            )}
          </div>
          {slot.newsCaption && (
            <div style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.45)", marginTop: 5 }}>📍 {slot.newsCaption}</div>
          )}
        </div>
      );
    }
    if (slot.type === "photo") {
      return (
        <div>
          <div style={{ fontSize: "0.5rem", color: "#E5BC4F", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
            Slide {num} · Photo (you upload the image)
          </div>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "0.95rem", fontWeight: 800, marginBottom: 4 }}>
            {slot.caption}
          </div>
          {slot.captionSecondary && (
            <div style={{ fontSize: "0.6rem", color: "rgba(229,188,79,0.7)", letterSpacing: 1.5, textTransform: "uppercase" }}>
              {slot.captionSecondary}
            </div>
          )}
        </div>
      );
    }
    if (slot.type === "countdown") {
      return (
        <div>
          <div style={{ fontSize: "0.5rem", color: "#E5BC4F", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
            Slide {num} · Countdown
          </div>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "1.2rem", fontWeight: 900, color: "#E5BC4F", letterSpacing: 1, marginBottom: 4 }}>
            {slot.countText}
          </div>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "0.85rem", fontWeight: 800, marginBottom: 4 }}>
            {slot.countEvent}
          </div>
          {slot.countWhen && (
            <div style={{ fontSize: "0.65rem", color: "rgba(245,240,232,0.75)" }}>{slot.countWhen}</div>
          )}
          {slot.countCta && (
            <div style={{ fontSize: "0.6rem", color: "#E5BC4F", marginTop: 4 }}>{slot.countCta}</div>
          )}
        </div>
      );
    }
    if (slot.type === "poster") {
      return (
        <div>
          <div style={{ fontSize: "0.5rem", color: "#E5BC4F", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
            Slide {num} · Poster
          </div>
          {slot.topLine && (
            <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.7)", letterSpacing: 2, marginBottom: 6, fontFamily: "ui-monospace,Menlo,monospace" }}>
              {slot.topLine}
            </div>
          )}
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "1.05rem", fontWeight: 900, lineHeight: 1.1, whiteSpace: "pre-wrap", marginBottom: 4 }}>
            {slot.title}
          </div>
          {slot.subtitle && (
            <div style={{ fontSize: "0.65rem", color: "rgba(245,240,232,0.7)", fontStyle: "italic", marginBottom: 6 }}>
              {slot.subtitle}
            </div>
          )}
          {slot.dateLine && (
            <div style={{ fontSize: "0.6rem", color: "rgba(229,188,79,0.85)", letterSpacing: 1, fontWeight: 700 }}>
              {slot.dateLine}
            </div>
          )}
        </div>
      );
    }
    if (slot.type === "press") {
      return (
        <div>
          <div style={{ fontSize: "0.5rem", color: "#E5BC4F", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
            Slide {num} · Press
          </div>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "1.4rem", fontWeight: 900, letterSpacing: 1, marginBottom: 4 }}>
            {slot.pressTitle}
          </div>
          {slot.pressBadge && (
            <div style={{ display: "inline-block", padding: "2px 6px", background: "rgba(212,63,47,0.85)", color: "#FFF", fontSize: "0.5rem", fontWeight: 800, letterSpacing: 1, marginBottom: 6, borderRadius: 2 }}>
              {slot.pressBadge}
            </div>
          )}
          {slot.pressLineup && (
            <div style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.75)", whiteSpace: "pre-wrap", marginBottom: 4, lineHeight: 1.4 }}>
              {slot.pressLineup}
            </div>
          )}
          {slot.pressGenres && (
            <div style={{ fontSize: "0.55rem", color: "rgba(242,201,76,0.85)", letterSpacing: 1.2, marginBottom: 4 }}>
              {slot.pressGenres}
            </div>
          )}
          {slot.pressDateLine && (
            <div style={{ fontSize: "0.6rem", color: "rgba(229,188,79,0.85)", letterSpacing: 1, fontWeight: 700 }}>
              {slot.pressDateLine}
            </div>
          )}
        </div>
      );
    }
    if (slot.type === "features") {
      const items = Array.isArray(slot.features) ? slot.features : [];
      return (
        <div>
          <div style={{ fontSize: "0.5rem", color: "#E5BC4F", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
            Slide {num} · Features
          </div>
          {slot.featuresTitle && (
            <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "0.85rem", fontWeight: 800, letterSpacing: 1, marginBottom: 6 }}>
              {slot.featuresTitle}
            </div>
          )}
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {items.map((f, i) => (
              <li key={i} style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: "0.9rem" }}>{f.emoji}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "0.75rem" }}>{f.headline}</div>
                  {f.sub && <div style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.65)" }}>{f.sub}</div>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    if (slot.type === "stat") {
      return (
        <div>
          <div style={{ fontSize: "0.5rem", color: "#E5BC4F", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
            Slide {num} · Stat
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
            <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "1.4rem", fontWeight: 900, color: "#F5F0E8" }}>
              {slot.statNumber}
            </div>
            <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "0.75rem", fontWeight: 800, letterSpacing: 1.5, color: "rgba(245,240,232,0.85)" }}>
              {slot.statLabel}
            </div>
          </div>
          {slot.statSub && (
            <div style={{ fontSize: "0.7rem", color: "rgba(245,240,232,0.6)" }}>
              {slot.statSub}
            </div>
          )}
        </div>
      );
    }
    return (
      <div style={{ fontSize: "0.7rem", color: "rgba(245,240,232,0.5)" }}>
        Slide {num} · {slot.type} (no preview)
      </div>
    );
  };

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.78)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#0f0f0f",
          border: "1px solid rgba(229,188,79,0.35)",
          borderRadius: 8,
          padding: 24,
          maxWidth: 820,
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          color: "#F5F0E8",
          fontFamily: "'DM Sans',sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h2 style={{ fontSize: "1.15rem", fontFamily: "'Syne',sans-serif", fontWeight: 700, letterSpacing: 1, margin: 0 }}>
            ✨ AI Fill Template
          </h2>
          <button
            onClick={onClose}
            style={{ background: "transparent", border: "none", color: "rgba(245,240,232,0.55)", fontSize: "1.4rem", cursor: "pointer", lineHeight: 1 }}
            title="Close"
          >×</button>
        </div>

        <div style={{ fontSize: "0.66rem", color: "rgba(245,240,232,0.55)", marginBottom: 12, lineHeight: 1.45 }}>
          Type a topic + context; Gemini writes every slide as one coherent story. Let it pick or arrange the layout, or choose a template. Per-slot rules from <strong>/brand → Slide Content Rules</strong> apply.
        </div>

        <div style={{ fontSize: "0.55rem", letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 700, color: "rgba(245,240,232,0.4)", margin: "0 0 7px" }}>Generation mode</div>

        {/* Let AI pick toggle — when on, Gemini chooses the best
            template from built-ins + customs based on topic + context.
            Two Gemini calls instead of one. */}
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.72rem", color: letAiPick ? "#E5BC4F" : "rgba(245,240,232,0.7)", cursor: "pointer", marginBottom: 8, padding: "7px 9px", background: letAiPick ? "rgba(229,188,79,0.08)" : "transparent", border: "1px solid " + (letAiPick ? "rgba(229,188,79,0.35)" : "rgba(245,240,232,0.08)"), borderRadius: 4 }}>
          <input
            type="checkbox"
            checked={letAiPick}
            onChange={(e) => { setLetAiPick(e.target.checked); if (e.target.checked) { setAiArrange(false); setDotsMode(false); } }}
          />
          <span style={{ fontWeight: 700, letterSpacing: 0.5 }}>
            ✨ Let AI pick the best template
          </span>
          <span style={{ marginLeft: "auto", fontSize: "0.55rem", color: "rgba(245,240,232,0.4)", letterSpacing: 0.5 }}>
            picks from {allTemplates.length} templates
          </span>
        </label>

        {/* AI arranges — design a bespoke slot sequence for THIS story instead of
            a fixed template. Supersedes template selection + AI-pick. */}
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.72rem", color: aiArrange ? "#E5BC4F" : "rgba(245,240,232,0.7)", cursor: "pointer", marginBottom: 8, padding: "7px 9px", background: aiArrange ? "rgba(229,188,79,0.08)" : "transparent", border: "1px solid " + (aiArrange ? "rgba(229,188,79,0.35)" : "rgba(245,240,232,0.08)"), borderRadius: 4 }}>
          <input
            type="checkbox"
            checked={aiArrange}
            onChange={(e) => { setAiArrange(e.target.checked); if (e.target.checked) { setLetAiPick(false); setDotsMode(false); } }}
          />
          <span style={{ fontWeight: 700, letterSpacing: 0.5 }}>
            🪄 Let AI arrange the carousel
          </span>
          <span style={{ marginLeft: "auto", fontSize: "0.55rem", color: "rgba(245,240,232,0.4)", letterSpacing: 0.5 }}>
            designs a custom sequence
          </span>
        </label>

        {/* Slide count — only meaningful when AI arranges the carousel (a fixed
            template is locked to its own length). "Auto" lets Gemini size the
            arc to the story; a number pins the count. */}
        {aiArrange && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "8px 10px", background: "rgba(229,188,79,0.04)", border: "1px solid rgba(229,188,79,0.15)", borderRadius: 4 }}>
            <span style={{ fontSize: "0.65rem", color: "rgba(245,240,232,0.7)", letterSpacing: 0.5, fontWeight: 700 }}>How many slides?</span>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {["auto", "4", "5", "6", "7", "8", "10"].map((c) => (
                <button
                  key={c}
                  onClick={() => setSlideCount(c)}
                  title={c === "auto" ? "Let AI decide based on the story" : `Aim for exactly ${c} slides`}
                  style={{
                    padding: "4px 10px", borderRadius: 4, cursor: "pointer",
                    fontSize: "0.62rem", fontWeight: 700, fontFamily: "'Syne',sans-serif",
                    background: slideCount === c ? "rgba(229,188,79,0.18)" : "rgba(245,240,232,0.04)",
                    color: slideCount === c ? "#E5BC4F" : "rgba(245,240,232,0.5)",
                    border: slideCount === c ? "1px solid rgba(229,188,79,0.5)" : "1px solid transparent",
                  }}
                >{c === "auto" ? "✨ Auto" : c}</button>
              ))}
            </div>
          </div>
        )}


        <details style={{ marginBottom: 12, border: "1px solid rgba(245,240,232,0.08)", borderRadius: 6, background: "rgba(245,240,232,0.015)" }}>
          <summary style={{ padding: "8px 10px", cursor: "pointer", fontSize: "0.55rem", letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 700, color: "rgba(245,240,232,0.5)", listStyle: "none", display: "flex", alignItems: "center", gap: 8 }}>
            <span>▸ Enrich &amp; voice</span>
            <span style={{ marginLeft: "auto", fontSize: "0.55rem", color: enrichCount ? "#63B3ED" : "rgba(245,240,232,0.3)", letterSpacing: 0.5, textTransform: "none", fontWeight: 700 }}>{enrichCount ? `${enrichCount} on` : "web lookup"}</span>
          </summary>
          <div style={{ padding: "2px 10px 6px" }}>

        {/* Web research — a grounded Gemini call looks the event up (Google
            Search) and feeds the background into generation, so it's not a
            black box that only knows what you typed. Opt-in: one extra call
            and it uses grounding quota. Stacks with pick/arrange/template. */}
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.72rem", color: researchOn ? "#63B3ED" : "rgba(245,240,232,0.7)", cursor: "pointer", marginBottom: 8, padding: "7px 9px", background: researchOn ? "rgba(99,179,237,0.08)" : "transparent", border: "1px solid " + (researchOn ? "rgba(99,179,237,0.35)" : "rgba(245,240,232,0.08)"), borderRadius: 4 }}>
          <input
            type="checkbox"
            checked={researchOn}
            onChange={(e) => setResearchOn(e.target.checked)}
          />
          <span style={{ fontWeight: 700, letterSpacing: 0.5 }}>
            🔎 Look up this event (background)
          </span>
          <span style={{ marginLeft: "auto", fontSize: "0.55rem", color: "rgba(245,240,232,0.4)", letterSpacing: 0.5 }}>
            facts about an event you already named
          </span>
        </label>

        {/* Timely news lookup — recent + upcoming happenings for this topic/area.
            Distinct from Research (evergreen background): this pulls dated,
            current items so you can spin a same-week "what's happening" post.
            Great paired with "AI arranges" for a from-scratch timely carousel. */}
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.72rem", color: newsOn ? "#63B3ED" : "rgba(245,240,232,0.7)", cursor: "pointer", marginBottom: 8, padding: "7px 9px", background: newsOn ? "rgba(99,179,237,0.08)" : "transparent", border: "1px solid " + (newsOn ? "rgba(99,179,237,0.35)" : "rgba(245,240,232,0.08)"), borderRadius: 4 }}>
          <input
            type="checkbox"
            checked={newsOn}
            onChange={(e) => setNewsOn(e.target.checked)}
          />
          <span style={{ fontWeight: 700, letterSpacing: 0.5 }}>
            📰 Find what's happening now (discover)
          </span>
          <span style={{ marginLeft: "auto", fontSize: "0.55rem", color: "rgba(245,240,232,0.4)", letterSpacing: 0.5 }}>
            timely, dated items to build around
          </span>
        </label>

          </div>
        </details>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: "0.65rem", color: "rgba(245,240,232,0.65)", display: "block", marginBottom: 5, letterSpacing: 0.5 }}>
              Template {aiChoosesLayout && <span style={{ color: "rgba(245,240,232,0.4)", fontStyle: "italic", textTransform: "none", letterSpacing: 0 }}>({dotsMode ? "connect the dots" : aiArrange ? "AI will design" : "AI will pick"})</span>}
            </label>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              disabled={aiChoosesLayout}
              style={{
                width: "100%",
                padding: "8px 10px",
                background: "#111",
                border: "1px solid rgba(245,240,232,0.08)",
                borderRadius: 4,
                color: aiChoosesLayout ? "rgba(245,240,232,0.35)" : "#F5F0E8",
                fontFamily: "inherit",
                fontSize: "0.78rem",
                outline: "none",
                boxSizing: "border-box",
                opacity: aiChoosesLayout ? 0.5 : 1,
                cursor: aiChoosesLayout ? "not-allowed" : "pointer",
              }}
            >
              <optgroup label="Built-in" style={{ color: "#000" }}>
                {BUILTIN_CAROUSEL_TEMPLATES.map(t => (
                  <option key={t.id} value={t.id} style={{ color: "#000" }}>{t.name} ({t.sequence.length})</option>
                ))}
              </optgroup>
              {customs.length > 0 && (
                <optgroup label="Your saved" style={{ color: "#000" }}>
                  {customs.map(t => (
                    <option key={t.id} value={t.id} style={{ color: "#000" }}>{t.name} ({t.sequence.length})</option>
                  ))}
                </optgroup>
              )}
            </select>
            {template && !aiChoosesLayout && (
              <div style={{ marginTop: 4, fontSize: "0.55rem", color: "rgba(245,240,232,0.45)", letterSpacing: 0.5 }}>
                {template.sequence.join(" → ")}
              </div>
            )}
          </div>
          <div>
            <label style={{ fontSize: "0.65rem", color: "rgba(245,240,232,0.65)", display: "block", marginBottom: 5, letterSpacing: 0.5 }}>
              {dotsMode ? (dotsDiscover ? "Thesis (optional — AI will find one)" : "Thesis / pattern to connect") : "Topic (carousel headline subject)"}
            </label>
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder='"Juneteenth 2026 weekend in NJ"'
              style={{
                width: "100%",
                padding: "8px 10px",
                background: "#111",
                border: "1px solid rgba(245,240,232,0.08)",
                borderRadius: 4,
                color: "#F5F0E8",
                fontFamily: "inherit",
                fontSize: "0.78rem",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>

        <label style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.5)", display: "block", marginBottom: 6, letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700 }}>
          Register
        </label>
        <div style={{ display: "flex", gap: 4, marginBottom: 10, padding: 3, background: "rgba(0,0,0,0.28)", borderRadius: 9, border: "1px solid rgba(245,240,232,0.06)" }}>
          {[["editorial", "📰", "Editorial", "report the scene, don't sell"], ["promo", "📣", "Promo", "centered on your event"], ["story", "📖", "Story", "narrative, human, scene-driven"]].map(([m, ic, lbl, hint]) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                // Each technique belongs to its register — clear the others'.
                if (m !== "story") setLetterMode(false);   // Manifesto is a Story technique
                if (m === "story") setDotsMode(false);      // dots isn't a Story technique
                if (m !== "promo") setDotsAnchor("");        // anchor only under Promo
                if (m !== "editorial") setDotsDiscover(false); // discover only under Editorial
              }}
              title={hint}
              style={{
                flex: 1, padding: "9px 8px", borderRadius: 7, cursor: "pointer",
                fontSize: "0.7rem", fontWeight: 700, fontFamily: "'Syne',sans-serif",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 3, lineHeight: 1.1,
                background: mode === m ? "rgba(229,188,79,0.16)" : "transparent",
                color: mode === m ? "#E5BC4F" : "rgba(245,240,232,0.5)",
                border: mode === m ? "1px solid rgba(229,188,79,0.5)" : "1px solid transparent",
                transition: "background 0.12s, color 0.12s",
              }}
            >
              <span style={{ fontSize: "0.95rem" }}>{ic}</span>
              <span>{lbl}</span>
              <span style={{ fontSize: "0.48rem", fontWeight: 600, fontFamily: "'DM Sans',sans-serif", color: mode === m ? "rgba(229,188,79,0.7)" : "rgba(245,240,232,0.32)", letterSpacing: 0.2 }}>{hint}</span>
            </button>
          ))}
        </div>

        {/* Each register surfaces its own optional TECHNIQUE right here — the
            pathway first, then the move that walks it. Story → Manifesto;
            Promo/Editorial → Connect the dots (with an anchor field that pops up
            only under Promo, turning coverage into problem→solution promo). */}
        {mode === "story" && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.68rem", color: letterMode ? "#A78BFA" : "rgba(245,240,232,0.7)", cursor: "pointer", marginBottom: 12, padding: "7px 9px", background: letterMode ? "rgba(139,92,246,0.10)" : "rgba(139,92,246,0.04)", border: "1px solid " + (letterMode ? "rgba(139,92,246,0.4)" : "rgba(139,92,246,0.18)"), borderRadius: 4 }}>
            <input type="checkbox" checked={letterMode} onChange={(e) => setLetterMode(e.target.checked)} />
            <span style={{ fontWeight: 700, letterSpacing: 0.5 }}>✉️ As one continuous letter (Manifesto)</span>
            <span style={{ marginLeft: "auto", fontSize: "0.55rem", color: "rgba(245,240,232,0.4)", letterSpacing: 0.5 }}>a Story technique · swipe-to-the-end</span>
          </label>
        )}
        {(mode === "promo" || mode === "editorial") && (
          <>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.68rem", color: dotsMode ? "#A78BFA" : "rgba(245,240,232,0.7)", cursor: "pointer", marginBottom: dotsMode ? 0 : 12, padding: "7px 9px", background: dotsMode ? "rgba(139,92,246,0.10)" : "rgba(139,92,246,0.04)", border: "1px solid " + (dotsMode ? "rgba(139,92,246,0.4)" : "rgba(139,92,246,0.18)"), borderRadius: 4 }}>
              <input type="checkbox" checked={dotsMode} onChange={(e) => { setDotsMode(e.target.checked); if (e.target.checked) { setLetAiPick(false); setAiArrange(false); } }} />
              <span style={{ fontWeight: 700, letterSpacing: 0.5 }}>🧵 Connect the dots</span>
              <span style={{ marginLeft: "auto", fontSize: "0.55rem", color: "rgba(245,240,232,0.4)", letterSpacing: 0.5 }}>
                {mode === "promo" ? "a Promo technique · trend → your event" : "an Editorial technique · pure coverage"}
              </span>
            </label>
            {dotsMode && (
              <div style={{ marginBottom: 12, padding: "8px 10px", background: "rgba(139,92,246,0.05)", border: "1px solid rgba(139,92,246,0.18)", borderTop: "none", borderRadius: "0 0 4px 4px" }}>
                {mode === "promo" ? (
                  <>
                    <label style={{ fontSize: "0.58rem", color: "#A78BFA", letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 700, display: "block", marginBottom: 4 }}>
                      🎯 Anchor event — your event is the answer
                    </label>
                    <textarea
                      value={dotsAnchor}
                      onChange={(e) => setDotsAnchor(e.target.value)}
                      rows={2}
                      placeholder="Describe your event as THE answer — name · date · venue · @handle · tickets. e.g. 'Y2K Nights — Sat July 17, Music Farm Newark, @cge, tix in bio'"
                      style={{ width: "100%", padding: "7px 9px", background: "#111", border: "1px solid rgba(139,92,246,0.25)", borderRadius: 4, color: "#F5F0E8", fontFamily: "inherit", fontSize: "0.72rem", outline: "none", boxSizing: "border-box", resize: "vertical" }}
                    />
                    <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.4)", marginTop: 4, lineHeight: 1.4 }}>
                      {dotsAnchor.trim()
                        ? "Problem → solution: the trend builds the demand, your event lands as the answer, and the close drives to it."
                        : "Fill this in — the dots become the setup, and your event is the payoff. (Blank = it just reports the trend.)"}
                    </div>
                  </>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.65rem", color: dotsDiscover ? "#A78BFA" : "rgba(245,240,232,0.7)", cursor: "pointer", fontWeight: 700 }}>
                      <input type="checkbox" checked={dotsDiscover} onChange={(e) => setDotsDiscover(e.target.checked)} />
                      Let AI find the thread
                    </label>
                    <span style={{ marginLeft: "auto", fontSize: "0.55rem", color: "rgba(245,240,232,0.4)", letterSpacing: 0.5, textAlign: "right", lineHeight: 1.3 }}>
                      {dotsDiscover ? "AI proposes the pattern from current news" : "type your thesis in the box below"}
                    </span>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 5, flexWrap: "wrap" }}>
          <label style={{ fontSize: "0.65rem", color: "rgba(245,240,232,0.65)", letterSpacing: 0.5 }}>
            {mode === "promo"
              ? "Describe your event — details get pulled from this (name · date · time · venue · city · @handle · tickets)"
              : "Context — the raw material for the hook (the twist, the proof, why now)"}
          </label>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => {
              if (context.trim() && !confirm("Replace what's in the Context box with the prompt template?")) return;
              setContext(CONTEXT_SCAFFOLD);
            }}
            title="Drop in a fill-in template that gives the AI the ingredients an open loop needs"
            style={{
              padding: "3px 9px", borderRadius: 4, cursor: "pointer",
              background: "rgba(139,92,246,0.12)", color: "#A78BFA",
              border: "1px solid rgba(139,92,246,0.4)",
              fontSize: "0.55rem", fontWeight: 700, letterSpacing: "1px",
              textTransform: "uppercase", fontFamily: "inherit",
            }}
          >＋ Template</button>
        </div>
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          rows={5}
          placeholder={mode === "promo"
            ? `Just describe your event — write it naturally and the AI pieces the details together:

"Y2K Nights at Music Farm in Newark, Sat July 17. 90s/2000s R&B + Hip-Hop, live DJ, throwback fits encouraged. Doors 9. @cge, tix in bio."`
            : `For Feature Drop: "Live DJ, Bachata lessons, DJ JdaBachata and DJ Carlita, Luzz Pickleball Paddle 2025 Glider giveaway, gift baskets, 100+ singles, Pickleball HQ Aberdeen, July 11"

For Editorial Roundup: 5 events with name · day · time · venue · URL each, one per line.`}
          style={{
            width: "100%",
            padding: "8px 10px",
            background: "#111",
            border: "1px solid rgba(245,240,232,0.08)",
            borderRadius: 4,
            color: "#F5F0E8",
            fontFamily: "inherit",
            fontSize: "0.78rem",
            outline: "none",
            boxSizing: "border-box",
            resize: "vertical",
            marginBottom: 12,
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <button
            onClick={handleGenerate}
            disabled={busy || (!canGenerate)}
            style={{
              padding: "9px 18px",
              background: busy ? "rgba(229,188,79,0.4)" : (canGenerate ? "#E5BC4F" : "rgba(229,188,79,0.25)"),
              color: "#000",
              border: "none",
              borderRadius: 4,
              fontSize: "0.72rem",
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: "uppercase",
              cursor: busy ? "wait" : (canGenerate ? "pointer" : "not-allowed"),
              fontFamily: "'Syne',sans-serif",
            }}
          >{busy ? (busyLabel || "Generating…") : genLabel}</button>

          <span style={{ fontSize: "0.6rem", color: voiceOn ? "#34D399" : "rgba(245,240,232,0.4)", letterSpacing: 1, textTransform: "uppercase", fontFamily: "'Syne',sans-serif", fontWeight: 700 }}>
            {voiceOn ? "🎙 Voice: ON" : "🎙 Voice: off"}
          </span>
        </div>

        {error && (
          <div style={{ marginBottom: 14, padding: "10px 12px", background: "rgba(251,113,133,0.08)", border: "1px solid rgba(251,113,133,0.3)", borderRadius: 4, fontSize: "0.7rem", color: "rgba(251,113,133,0.9)" }}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* What the news lookup actually found — surfaced so you can verify it
            (and catch stale/off items) instead of trusting a black box. */}
        {newsFound && (newsFound.brief || (newsFound.sources && newsFound.sources.length > 0)) && (
          <details open style={{ marginBottom: 14, background: "rgba(99,179,237,0.05)", border: "1px solid rgba(99,179,237,0.3)", borderRadius: 5 }}>
            <summary style={{ padding: "9px 12px", cursor: "pointer", fontSize: "0.6rem", color: "#63B3ED", letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700, fontFamily: "'Syne',sans-serif", listStyle: "none" }}>
              🔎 What the web turned up{newsFound.sources?.length ? ` · ${newsFound.sources.length} source${newsFound.sources.length === 1 ? "" : "s"}` : ""}
            </summary>
            <div style={{ padding: "0 12px 12px" }}>
              {newsFound.brief && (
                <pre style={{ margin: "0 0 8px", whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "0.68rem", lineHeight: 1.5, color: "rgba(245,240,232,0.82)" }}>{newsFound.brief}</pre>
              )}
              {newsFound.sources?.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <div style={{ fontSize: "0.5rem", letterSpacing: 1, textTransform: "uppercase", color: "rgba(245,240,232,0.4)", marginBottom: 2 }}>Sources</div>
                  {newsFound.sources.map((s, i) => (
                    <a key={i} href={s.uri} target="_blank" rel="noreferrer" style={{ fontSize: "0.64rem", color: "#63B3ED", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {i + 1}. {s.title}
                    </a>
                  ))}
                </div>
              )}
              <div style={{ fontSize: "0.52rem", color: "rgba(245,240,232,0.4)", marginTop: 8, lineHeight: 1.4 }}>
                Verify any date/venue/price before posting — grounded search can still be wrong or stale.
              </div>
            </div>
          </details>
        )}

        {slides.length > 0 && (
          <>
            {pickedTemplate && (
              <div style={{ marginBottom: 12, padding: "10px 12px", background: "rgba(52,211,153,0.05)", border: "1px solid rgba(52,211,153,0.25)", borderRadius: 5 }}>
                <div style={{ fontSize: "0.55rem", color: "#34D399", letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700, fontFamily: "'Syne',sans-serif", marginBottom: 4 }}>
                  ✨ AI picked: {pickedTemplate.name}
                </div>
                {pickReasoning && (
                  <div style={{ fontSize: "0.7rem", color: "rgba(245,240,232,0.7)", fontStyle: "italic", lineHeight: 1.4 }}>
                    "{pickReasoning}"
                  </div>
                )}
                <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.45)", marginTop: 4, letterSpacing: 0.5 }}>
                  Sequence: {pickedTemplate.sequence.join(" → ")}
                </div>
              </div>
            )}
            <div style={{ fontSize: "0.55rem", color: "#E5BC4F", letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700, fontFamily: "'Syne',sans-serif", marginBottom: 8 }}>
              Preview · {slides.length} slides
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
              {slides.map((slot, idx) => {
                const exemplarText = slotToExemplar(slot);
                const canSave = exemplarText && exemplarText.trim().length > 0;
                const saved = savedIdx.has(idx);
                const kept = keptIdx.has(idx);
                return (
                  <div
                    key={idx}
                    style={{
                      position: "relative",
                      padding: 12,
                      paddingRight: canSave ? 132 : 52,
                      paddingLeft: 40,
                      background: kept ? "rgba(229,188,79,0.04)" : "rgba(245,240,232,0.02)",
                      border: "1px solid " + (kept ? "rgba(229,188,79,0.20)" : "rgba(245,240,232,0.10)"),
                      borderRadius: 6,
                      opacity: kept ? 1 : 0.45,
                      transition: "opacity 0.1s",
                    }}
                  >
                    <button
                      onClick={() => setKeptIdx(prev => { const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n; })}
                      title={kept ? "Slide will be pushed — click to skip" : "Slide is skipped — click to keep"}
                      style={{
                        position: "absolute", top: 10, left: 10, width: 22, height: 22,
                        borderRadius: 5, cursor: "pointer", padding: 0,
                        background: kept ? "#34D399" : "transparent",
                        border: `1px solid ${kept ? "#34D399" : "rgba(245,240,232,0.3)"}`,
                        color: "#000", fontSize: "0.8rem", fontWeight: 800, lineHeight: 1,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}
                    >{kept ? "✓" : ""}</button>
                    <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 5, alignItems: "center" }}>
                      <button
                        onClick={() => handleRegenerateSlide(idx)}
                        disabled={regenIdx !== null}
                        title="Re-roll just this slide — keeps every other slide as-is"
                        style={{
                          background: regenIdx === idx ? "rgba(139,92,246,0.25)" : "transparent",
                          border: "1px solid rgba(139,92,246,0.45)",
                          color: "#A78BFA",
                          fontSize: "0.55rem",
                          fontWeight: 700,
                          letterSpacing: 0.8,
                          textTransform: "uppercase",
                          padding: "3px 7px",
                          borderRadius: 3,
                          cursor: regenIdx !== null ? "wait" : "pointer",
                          fontFamily: "'Syne',sans-serif",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {regenIdx === idx ? "…" : "↻ Redo"}
                      </button>
                      {canSave && (
                        <button
                          onClick={() => handleSaveSlideAsExemplar(slot, idx)}
                          disabled={saved}
                          title={saved ? "Saved to Brand Voice exemplars" : "Save this slide's copy to Brand Voice — feeds future generations"}
                          style={{
                            background: saved ? "rgba(52,211,153,0.15)" : "transparent",
                            border: `1px solid ${saved ? "rgba(52,211,153,0.4)" : "rgba(229,188,79,0.25)"}`,
                            color: saved ? "#34D399" : "rgba(229,188,79,0.8)",
                            fontSize: "0.55rem",
                            fontWeight: 700,
                            letterSpacing: 0.8,
                            textTransform: "uppercase",
                            padding: "3px 7px",
                            borderRadius: 3,
                            cursor: saved ? "default" : "pointer",
                            fontFamily: "'Syne',sans-serif",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {saved ? "✓ Saved" : "🔖 Save"}
                        </button>
                      )}
                    </div>
                    {renderPreview(slot, idx)}
                  </div>
                );
              })}
            </div>

            <button
              onClick={handlePush}
              style={{
                width: "100%",
                padding: "12px 18px",
                background: "#34D399",
                color: "#000",
                border: "none",
                borderRadius: 4,
                fontSize: "0.78rem",
                fontWeight: 800,
                letterSpacing: 1.2,
                textTransform: "uppercase",
                cursor: "pointer",
                fontFamily: "'Syne',sans-serif",
              }}
            >→ Push {keptIdx.size} of {slides.length} slides to carousel</button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
