import { useEffect, useState } from "react";
import { MOVE_JOBS, MOVES_MAX, checkMoves } from "./storyMoves.js";

const GOLD = "#E5BC4F";
const INK = "#F5F0E8";
const dim = (a) => `rgba(245,240,232,${a})`;

const field = {
  width: "100%", boxSizing: "border-box", background: dim(0.04), color: INK,
  border: `1px solid ${dim(0.12)}`, borderRadius: 4, padding: "5px 7px",
  fontFamily: "inherit", fontSize: "0.7rem", lineHeight: 1.4,
};
const smallBtn = {
  background: "transparent", color: dim(0.65), border: `1px solid ${dim(0.18)}`,
  borderRadius: 4, padding: "2px 7px", fontSize: "0.6rem", cursor: "pointer",
};

// Focus + moves + parked, editable. Nothing here calls a model: edits are
// re-checked locally and Recut turns the moves back into cards.
export function StoryPlanPanel({ plan, context, onRecut }) {
  const [focus, setFocus] = useState(plan?.focus || "");
  const [moves, setMoves] = useState(plan?.moves || []);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setFocus(plan?.focus || "");
    setMoves(plan?.moves || []);
    setDirty(false);
  }, [plan]);

  if (!plan) return null;

  const live = checkMoves({ focus, moves }, context);
  const deskLine = new Map((live.desk?.lines || []).map((l) => [l.n, l]));
  const planWarnings = live.warnings.filter((w) => w.move == null);
  const edit = (next) => { setMoves(next); setDirty(true); };
  const update = (i, patch) => edit(moves.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= moves.length) return;
    const next = moves.slice();
    [next[i], next[j]] = [next[j], next[i]];
    edit(next);
  };
  const unpark = (line) => edit([
    ...moves.slice(0, -1),
    { job: "context", label: "", headline: "", text: line.text, cites: [line.n], follows: "" },
    ...moves.slice(-1),
  ]);

  return (
    <div style={{ marginBottom: 14, padding: "10px 12px", background: "rgba(229,188,79,0.04)", border: "1px solid rgba(229,188,79,0.3)", borderRadius: 6 }}>
      <div style={{ fontSize: "0.55rem", color: GOLD, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700, fontFamily: "'Syne',sans-serif", marginBottom: 6 }}>
        Story plan · {moves.length} moves → {moves.length} cards
      </div>
      <label style={{ display: "block", fontSize: "0.58rem", color: dim(0.55), marginBottom: 3 }}>Focus — the one thing a reader walks away with</label>
      <textarea value={focus} rows={2} onChange={(e) => { setFocus(e.target.value); setDirty(true); }} style={{ ...field, marginBottom: 8 }} />

      {planWarnings.map((w, i) => (
        <div key={i} style={{ fontSize: "0.64rem", color: "#FB7185", marginBottom: 4 }}>⚠️ {w.message}</div>
      ))}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {moves.map((m, i) => {
          const own = live.warnings.filter((w) => w.move === i + 1);
          return (
            <div key={i} style={{ padding: 8, border: `1px solid ${own.length ? "rgba(251,113,133,0.4)" : dim(0.1)}`, borderRadius: 5, background: dim(0.02) }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 5, flexWrap: "wrap" }}>
                <b style={{ color: GOLD, fontSize: "0.66rem", minWidth: 16 }}>{i + 1}</b>
                <select value={m.job} onChange={(e) => update(i, { job: e.target.value })} style={{ ...field, width: "auto", padding: "2px 4px" }}>
                  {MOVE_JOBS.map((j) => <option key={j} value={j}>{j}</option>)}
                </select>
                <input value={m.label || ""} placeholder="kicker" onChange={(e) => update(i, { label: e.target.value })} style={{ ...field, width: 120 }} />
                <span style={{ fontSize: "0.6rem", color: dim(0.5) }} title={m.cites.map((c) => `#${c} ${deskLine.get(c)?.text || ""}`).join("\n")}>
                  {m.cites.length ? m.cites.map((c) => `#${c}`).join(" ") : "no desk line"}
                </span>
                <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                  <button type="button" style={smallBtn} onClick={() => move(i, -1)} disabled={i === 0} title="Move up">↑</button>
                  <button type="button" style={smallBtn} onClick={() => move(i, 1)} disabled={i === moves.length - 1} title="Move down">↓</button>
                  <button type="button" style={smallBtn} onClick={() => edit(moves.filter((_, j) => j !== i))} title="Drop this move; its desk lines go back to Parked">Park</button>
                </span>
              </div>
              <input value={m.headline} placeholder="headline" onChange={(e) => update(i, { headline: e.target.value })} style={{ ...field, fontWeight: 700, marginBottom: 4 }} />
              <textarea value={m.text} rows={2} onChange={(e) => update(i, { text: e.target.value })} style={field} />
              {m.follows ? <div style={{ fontSize: "0.58rem", color: dim(0.45), marginTop: 3 }}>Follows because: {m.follows}</div> : null}
              {own.map((w, wi) => (
                <div key={wi} style={{ fontSize: "0.62rem", color: "#FB7185", marginTop: 3 }}>⚠️ {w.message}</div>
              ))}
            </div>
          );
        })}
      </div>

      {live.parked.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ fontSize: "0.6rem", color: dim(0.6), cursor: "pointer" }}>Parked · {live.parked.length} desk lines not in the story</summary>
          {live.parked.map((l) => (
            <div key={l.n} style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: "0.64rem", color: dim(0.7), marginTop: 4 }}>
              <span style={{ flex: 1 }}>#{l.n} {l.text}</span>
              <button type="button" style={smallBtn} disabled={moves.length >= MOVES_MAX + 2} onClick={() => unpark(l)} title="Add a move from this line before the closer">Use</button>
            </div>
          ))}
        </details>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
        <button
          type="button"
          disabled={!dirty || !moves.length}
          onClick={() => { onRecut(live); setDirty(false); }}
          style={{ padding: "6px 14px", borderRadius: 5, border: "none", fontWeight: 800, fontSize: "0.68rem", fontFamily: "'Syne',sans-serif", cursor: dirty ? "pointer" : "default", background: dirty ? GOLD : dim(0.1), color: dirty ? "#000" : dim(0.4) }}
        >Recut cards</button>
        <span style={{ fontSize: "0.58rem", color: dim(0.45) }}>Recut replaces the cards below with one card per move. No model call.</span>
      </div>
    </div>
  );
}
