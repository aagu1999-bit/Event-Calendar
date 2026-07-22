import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { scoutEvents, researchEventBreakdown } from "../shared/aiContent.js";
import { useEventsStore, useCarouselSeedStore } from "../store";
import { getEmoji, parseDateToDay } from "../shared/parseEvents";

// Event Scout — hunts NJ for upcoming Black-culture events that fit the CGE
// beat, scores each against the brand, and surfaces the winners as carousel
// candidates. Discovery + scoring live in aiContent.scoutEvents (mirrors the
// News Scout). Nothing here posts or saves automatically: each pick can be
// added to the calendar, handed to the Media builder as a carousel seed, or
// skipped. Reads the same Gemini key the Media tab uses (browser-saved or env).

const tierClass = (s) => (s >= 80 ? "s-hi" : s >= 60 ? "s-mid" : "s-lo");
const BAR = 70; // score at/above which a pick shows in the "top picks" section

export default function ScoutPicks() {
  const navigate = useNavigate();
  const events = useEventsStore((s) => s.events);
  const updateEvents = useEventsStore((s) => s.updateEvents);
  const setSeed = useCarouselSeedStore((s) => s.setSeed);

  const envKey = (import.meta.env.VITE_GEMINI_API_KEY || "").trim();
  const uiKey = (() => { try { return localStorage.getItem("cge_gemini_key") || ""; } catch { return ""; } })();
  const apiKey = envKey || uiKey;

  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // { candidates, sources, brief }
  const [dismissed, setDismissed] = useState(() => new Set());
  const [added, setAdded] = useState(() => new Set());
  const [showBelow, setShowBelow] = useState(false);
  const [ranAt, setRanAt] = useState(null);
  const [buildingId, setBuildingId] = useState(null); // event name whose breakdown is being researched

  const existingNames = useMemo(() => events.map((e) => e.name), [events]);

  const run = async () => {
    if (busy) return;
    if (!apiKey) {
      setError("Add your Gemini API key on the Media tab first — it's saved in your browser and shared here.");
      return;
    }
    setBusy(true); setError(""); setResult(null);
    try {
      const r = await scoutEvents({ apiKey, area: "New Jersey", focus, existingNames });
      setResult(r);
      setRanAt(Date.now());
      if (!r.candidates.length) {
        setError("Nothing cleared the bar this run. Try a focus — a city, or 'day parties', 'Juneteenth', 'openings'.");
      }
    } catch (e) {
      setError(e?.message || "Scout failed — check the key and try again.");
    } finally {
      setBusy(false);
    }
  };

  const addToCalendar = (c) => {
    const di = c.date ? parseDateToDay(c.date) : null;
    const ev = {
      id: Date.now() + Math.random() * 1e5,
      name: c.name,
      day: di?.day || "Fri",
      date: di?.date || c.date || "",
      time: c.time || "",
      venue: c.venue || "",
      area: c.city || "",
      region: c.region || "North",
      type: c.type || "",
      emoji: getEmoji(c.type),
      link: c.sourceUrl || "",
      igHandle: "",
      featured: false,
    };
    updateEvents((prev) => [...prev, ev]);
    setAdded((s) => new Set(s).add(c.name));
  };

  // Make Carousel: deep-research THIS event into a structured breakdown
  // (THE TWIST / WHAT HAPPENS / PROOF / WHY NOW / WHO IT'S FOR), then seed the
  // Media builder's Topic + Context and navigate. The breakdown call web-
  // searches the event, so it takes a few seconds — the button shows a busy
  // state. If it fails, researchEventBreakdown returns a thin fallback so the
  // handoff still works.
  const makeCarousel = async (c) => {
    if (buildingId) return;
    setBuildingId(c.name);
    let context;
    try {
      const { breakdown } = await researchEventBreakdown({ apiKey, event: c });
      context = breakdown;
    } catch {
      context = [c.type, c.venue && `at ${c.venue}`, c.city, c.date && `on ${c.date}`, c.time, c.why]
        .filter(Boolean).join(" · ");
    }
    setSeed({ topic: c.name, context });
    navigate("/media");
  };

  const visible = (result?.candidates || []).filter((c) => !dismissed.has(c.name));
  const top = visible.filter((c) => c.score >= BAR);
  const below = visible.filter((c) => c.score < BAR);
  const flyerFor = (c) => (c.isNew ? "f-new" : "f-cal");

  return (
    <div className="cge-scout">
      <style>{scoutCss}</style>

      <div className="kicker">CGE Tools · Scout</div>
      <h1 className="h1 disp"><span className="sat">🛰</span> Event Scout</h1>
      <p className="sub">Scouts New Jersey for Black-culture events worth a carousel, scores each against your brand, and hands the winners to the Media builder.</p>

      {/* CONTROL BAR */}
      <div className="controls">
        <label className="focus">🔎
          <input
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            placeholder="Optional focus — e.g. this weekend · Newark + Jersey City · day parties, openings"
          />
        </label>
        <button className="scan" onClick={run} disabled={busy}>
          {busy ? "🛰 Scouting NJ…" : "🛰 Scout NJ"}
        </button>
      </div>
      <div className="runline">
        {busy ? (
          <><span className="dot busy" /> <b>Running several searches across the beat…</b></>
        ) : ranAt ? (
          <><span className="dot" /> <b>Scouted just now</b>{result ? ` · ${result.candidates.length} picks · ${top.length} cleared the bar (≥ ${BAR})` : ""}</>
        ) : (
          <><span className="dot idle" /> <b>Discovers net-new NJ events that fit CGE. Ranking your own calendar is coming next.</b></>
        )}
      </div>

      {error && <div className="err">{error}</div>}

      {!apiKey && !error && (
        <div className="err soft">Heads up: no Gemini key found. Add one on the <b>Media</b> tab (it saves in your browser) and it'll work here too.</div>
      )}

      {/* EMPTY / FIRST-RUN */}
      {!result && !busy && (
        <div className="empty">
          <div className="empty-ic">🛰</div>
          <div>Press <b>Scout NJ</b> to find upcoming events that fit your page.<br />Add a focus for a tighter hunt, or leave it blank for a broad sweep.</div>
        </div>
      )}

      {/* TOP PICKS */}
      {top.length > 0 && (
        <>
          <div className="seclabel"><span className="t">Top picks — ranked by CGE fit</span><span className="rule" /></div>
          {top.map((c, i) => (
            <Card key={c.name + i} c={c} first={i === 0} flyerClass={flyerFor(c)}
              added={added.has(c.name)} building={buildingId === c.name} anyBuilding={!!buildingId}
              onCarousel={() => makeCarousel(c)}
              onAdd={() => addToCalendar(c)}
              onSkip={() => setDismissed((s) => new Set(s).add(c.name))} />
          ))}
        </>
      )}

      {/* BELOW THE BAR */}
      {below.length > 0 && (
        <>
          <div className="seclabel"><span className="t">Below the bar — scored under {BAR}</span><span className="rule" /></div>
          {!showBelow ? (
            <div style={{ textAlign: "center" }}>
              <button className="btn ghost" onClick={() => setShowBelow(true)}>Show {below.length} more scored event{below.length === 1 ? "" : "s"} ▾</button>
            </div>
          ) : (
            below.map((c, i) => (
              <Card key={c.name + i} c={c} flyerClass={flyerFor(c)}
                added={added.has(c.name)} building={buildingId === c.name} anyBuilding={!!buildingId}
                onCarousel={() => makeCarousel(c)}
                onAdd={() => addToCalendar(c)}
                onSkip={() => setDismissed((s) => new Set(s).add(c.name))} />
            ))
          )}
        </>
      )}

      {/* HOW IT SCORES */}
      {result && (
        <div className="explain">
          <h3>How the score is built</h3>
          <div className="rub"><span className="w">×40</span><span className="d"><b>Brand fit</b> — matched against your CGE beat (Black culture / Black-owned / NJ)</span></div>
          <div className="rub"><span className="w">×25</span><span className="d"><b>Excitement</b> — event type, venue, headliners, stop-the-scroll pull</span></div>
          <div className="rub"><span className="w">×20</span><span className="d"><b>Freshness &amp; timing</b> — happening soon, just announced, not stale</span></div>
          <div className="rub"><span className="w">×15</span><span className="d"><b>Newness</b> — events not already on your calendar score higher</span></div>
          <p className="note">Same AI engine as your News Scout, pointed at events. Since Instagram scrapes carry no like/follower data, buzz comes from what the web search surfaces. Nothing posts automatically — the scout only proposes.</p>
        </div>
      )}
    </div>
  );
}

function Card({ c, first, flyerClass, added, building, anyBuilding, onCarousel, onAdd, onSkip }) {
  const words = (c.name || "").toUpperCase().split(/\s+/);
  const line1 = words.slice(0, Math.ceil(words.length / 2)).join(" ");
  const line2 = words.slice(Math.ceil(words.length / 2)).join(" ");
  const meta = [c.type, c.venue, c.city, [c.date, c.time].filter(Boolean).join(" · ")].filter(Boolean);
  return (
    <div className={"card" + (first ? " top" : "")}>
      <div className={"flyer " + flyerClass}>
        <div className="exp">⤢</div>
        <div className="art">{line1}<br />{line2}</div>
      </div>
      <div className="body">
        <div className="toprow">
          <h2 className="name disp">{c.name}</h2>
          <div className={"score " + tierClass(c.score)}>
            <div className="n">{Math.round(c.score)}</div><div className="l">fit</div>
          </div>
        </div>
        <div className="badges">
          {c.isNew ? <span className="bdg new">✦ New find</span> : <span className="bdg incal">In your calendar</span>}
          {c.buzz && <span className="bdg hot">🔥 Buzzing</span>}
          {c.kicker && <span className="bdg soon">{c.kicker}</span>}
        </div>
        {meta.length > 0 && (
          <div className="meta">{meta.map((m, i) => (<span key={i}>{i > 0 && <span className="sep">·</span>}{m}</span>))}</div>
        )}
        {c.why && <div className="why"><b>Why it's a CGE post:</b> {c.why}</div>}
        {c.chips?.length > 0 && (
          <div className="chips">{c.chips.map((ch, i) => <span key={i} className="chip match">{ch}</span>)}</div>
        )}
        <div className="actions">
          <button className="btn primary" onClick={onCarousel} disabled={anyBuilding}
            style={anyBuilding && !building ? { opacity: 0.5, cursor: "not-allowed" } : building ? { cursor: "wait" } : undefined}>
            {building ? "✨ Researching…" : "★ Make Carousel"}
          </button>
          {added ? (
            <button className="btn done" disabled>✓ Added</button>
          ) : (
            <button className="btn" onClick={onAdd}>＋ Add to Calendar</button>
          )}
          {c.sourceUrl && <a className="srclink" href={c.sourceUrl} target="_blank" rel="noopener noreferrer">↗ view source</a>}
          <button className="btn x" onClick={onSkip}>✕ Skip</button>
        </div>
      </div>
    </div>
  );
}

const scoutCss = `
.cge-scout{max-width:760px;margin:0 auto;padding:22px 16px 60px;color:#F5F0E8;
  font-family:"DM Sans",system-ui,-apple-system,sans-serif}
.cge-scout .disp{font-family:"Syne","DM Sans",system-ui,sans-serif;font-weight:800;letter-spacing:-0.02em}
.cge-scout .kicker{font-size:0.62rem;letter-spacing:0.22em;text-transform:uppercase;color:rgba(245,240,232,0.32);font-weight:700}
.cge-scout .h1{font-size:1.7rem;margin:5px 0 2px;display:flex;align-items:center;gap:10px}
.cge-scout .h1 .sat{font-size:1.45rem;filter:drop-shadow(0 0 10px rgba(229,188,79,0.5))}
.cge-scout .sub{color:rgba(245,240,232,0.55);font-size:0.85rem;max-width:58ch;line-height:1.45}
.cge-scout .controls{margin:18px 0 8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.cge-scout .focus{flex:1;min-width:200px;display:flex;align-items:center;gap:8px;background:#0c0c0d;
  border:1px solid rgba(245,240,232,0.10);border-radius:10px;padding:10px 12px;color:rgba(245,240,232,0.4)}
.cge-scout .focus input{flex:1;background:transparent;border:0;outline:0;color:#F5F0E8;font:inherit;font-size:0.82rem}
.cge-scout .scan{display:inline-flex;align-items:center;gap:9px;background:#FACC15;color:#111;font-weight:800;
  font-size:0.85rem;border:0;border-radius:10px;padding:11px 18px;cursor:pointer;white-space:nowrap}
.cge-scout .scan:disabled{opacity:0.6;cursor:wait}
.cge-scout .runline{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:0.71rem;color:rgba(245,240,232,0.4)}
.cge-scout .runline b{color:rgba(245,240,232,0.55);font-weight:600}
.cge-scout .dot{width:7px;height:7px;border-radius:50%;background:#34D399;box-shadow:0 0 8px #34D399;flex:0 0 auto}
.cge-scout .dot.idle{background:rgba(245,240,232,0.25);box-shadow:none}
.cge-scout .dot.busy{background:#FACC15;box-shadow:0 0 8px #FACC15;animation:scoutpulse 1s infinite}
@keyframes scoutpulse{0%,100%{opacity:1}50%{opacity:0.3}}
.cge-scout .err{margin:14px 0;background:rgba(251,113,133,0.10);border:1px solid rgba(251,113,133,0.3);
  border-radius:10px;padding:11px 13px;color:#FB7185;font-size:0.8rem}
.cge-scout .err.soft{background:rgba(229,188,79,0.08);border-color:rgba(229,188,79,0.28);color:#E5BC4F}
.cge-scout .err b{font-weight:700}
.cge-scout .empty{margin:34px 0;text-align:center;color:rgba(245,240,232,0.45);font-size:0.86rem;line-height:1.6}
.cge-scout .empty-ic{font-size:2.4rem;margin-bottom:10px;filter:drop-shadow(0 0 14px rgba(229,188,79,0.35))}
.cge-scout .empty b{color:#E5BC4F;font-weight:700}
.cge-scout .seclabel{display:flex;align-items:center;gap:10px;margin:22px 2px 12px}
.cge-scout .seclabel .t{font-size:0.64rem;letter-spacing:0.18em;text-transform:uppercase;color:rgba(245,240,232,0.32);font-weight:700;white-space:nowrap}
.cge-scout .seclabel .rule{flex:1;height:1px;background:rgba(245,240,232,0.06)}
.cge-scout .card{display:flex;background:#121214;border:1px solid rgba(245,240,232,0.10);
  border-radius:14px;overflow:hidden;margin-bottom:13px}
.cge-scout .card.top{border-color:rgba(229,188,79,0.4);box-shadow:0 0 0 1px rgba(229,188,79,0.10),0 8px 30px rgba(0,0,0,0.4)}
.cge-scout .flyer{width:108px;flex:0 0 108px;position:relative;background:#000}
.cge-scout .flyer .art{position:absolute;inset:0;display:flex;align-items:flex-end;padding:9px;
  font-family:"Syne",sans-serif;font-weight:800;font-size:0.78rem;color:rgba(255,255,255,0.92);
  text-shadow:0 1px 6px rgba(0,0,0,0.7);line-height:1.05}
.cge-scout .flyer .exp{position:absolute;top:7px;right:7px;width:18px;height:18px;border-radius:50%;
  background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-size:0.6rem}
.cge-scout .f-new{background:linear-gradient(150deg,#6d28d9,#b45309 90%)}
.cge-scout .f-cal{background:linear-gradient(150deg,#1f2937,#0ea5e9)}
.cge-scout .body{flex:1;min-width:0;padding:13px 14px 12px}
.cge-scout .toprow{display:flex;align-items:flex-start;gap:10px}
.cge-scout .name{font-size:1rem;line-height:1.15;margin:0;flex:1;min-width:0}
.cge-scout .score{flex:0 0 auto;text-align:center;min-width:44px}
.cge-scout .score .n{font-family:"Syne",sans-serif;font-weight:800;font-size:1.24rem;line-height:1}
.cge-scout .score .l{font-size:0.48rem;letter-spacing:0.14em;text-transform:uppercase;color:rgba(245,240,232,0.32);font-weight:700;margin-top:2px}
.cge-scout .s-hi .n{color:#34D399}.cge-scout .s-mid .n{color:#E5BC4F}.cge-scout .s-lo .n{color:rgba(245,240,232,0.5)}
.cge-scout .badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.cge-scout .bdg{font-size:0.56rem;font-weight:800;letter-spacing:0.07em;text-transform:uppercase;padding:3px 7px;border-radius:5px;border:1px solid transparent}
.cge-scout .bdg.new{color:#34D399;background:rgba(52,211,153,0.10);border-color:rgba(52,211,153,0.3)}
.cge-scout .bdg.incal{color:#63B3ED;background:rgba(99,179,237,0.08);border-color:rgba(99,179,237,0.25)}
.cge-scout .bdg.hot{color:#FB7185;background:rgba(251,113,133,0.10);border-color:rgba(251,113,133,0.3)}
.cge-scout .bdg.soon{color:#FACC15;background:rgba(250,204,21,0.08);border-color:rgba(250,204,21,0.28)}
.cge-scout .meta{font-size:0.74rem;color:rgba(245,240,232,0.55);margin-top:9px}
.cge-scout .meta .sep{color:rgba(245,240,232,0.32);margin:0 5px}
.cge-scout .why{font-size:0.79rem;color:#F5F0E8;margin-top:9px;padding:9px 11px;border-radius:9px;
  background:rgba(229,188,79,0.05);border:1px solid rgba(229,188,79,0.14);line-height:1.4}
.cge-scout .why b{color:#E5BC4F;font-weight:700}
.cge-scout .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}
.cge-scout .chip{font-size:0.62rem;color:rgba(245,240,232,0.55);background:#0d0d0e;border:1px solid rgba(245,240,232,0.10);border-radius:20px;padding:3px 9px}
.cge-scout .chip.match{color:#C084FC;border-color:rgba(192,132,252,0.3)}
.cge-scout .actions{display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap}
.cge-scout .btn{font:inherit;font-size:0.74rem;font-weight:700;border-radius:8px;padding:8px 13px;cursor:pointer;
  border:1px solid rgba(245,240,232,0.10);background:#0d0d0e;color:#F5F0E8;display:inline-flex;align-items:center;gap:6px}
.cge-scout .btn.primary{background:#E5BC4F;color:#111;border-color:transparent}
.cge-scout .btn.done{color:#34D399;border-color:rgba(52,211,153,0.3);cursor:default}
.cge-scout .btn.ghost{color:rgba(245,240,232,0.55);margin:2px auto}
.cge-scout .btn.x{margin-left:auto;color:rgba(245,240,232,0.32);padding:8px 10px}
.cge-scout .srclink{font-size:0.7rem;color:#63B3ED;text-decoration:none;font-weight:700}
.cge-scout .explain{margin-top:26px;background:#161618;border:1px solid rgba(245,240,232,0.10);border-radius:14px;padding:16px 17px}
.cge-scout .explain h3{font-size:0.68rem;letter-spacing:0.15em;text-transform:uppercase;color:rgba(245,240,232,0.32);margin:0 0 12px;font-weight:700}
.cge-scout .rub{display:flex;align-items:center;gap:11px;padding:7px 0;border-bottom:1px solid rgba(245,240,232,0.06);font-size:0.79rem}
.cge-scout .rub:last-child{border-bottom:0}
.cge-scout .rub .w{font-family:"Syne",sans-serif;font-weight:800;color:#E5BC4F;min-width:38px}
.cge-scout .rub .d{color:rgba(245,240,232,0.55)}
.cge-scout .rub .d b{color:#F5F0E8;font-weight:600}
.cge-scout .note{font-size:0.71rem;color:rgba(245,240,232,0.32);margin-top:13px;line-height:1.5}
`;
