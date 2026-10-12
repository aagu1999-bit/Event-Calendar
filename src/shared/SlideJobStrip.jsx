import { useEffect } from "react";
import {
  SLIDE_JOBS,
  MIDDLE_JOBS,
  COVER_STYLE_ORDER,
  COVER_STYLES,
  NEWS_STYLES,
  NEWS_STYLE_ORDER,
  sanitizeSlidePlan,
  defaultSlidePlan,
  addMiddleJob,
  removeJob,
  setCoverStyle,
  formatSlidePlanHeading,
  newsStyleAvailability,
  clampNewsStyles,
  toggleNewsStyle,
} from "./slideJobs.js";

export function NewsStyleChips({ plan, onChange, desk = {}, disabled = false }) {
  const clean = sanitizeSlidePlan(plan);
  const avail = newsStyleAvailability(desk);
  const selected = new Set(clean.newsStyles);
  const availSig = NEWS_STYLE_ORDER.map((k) => (avail[k]?.ok ? "1" : "0")).join("");
  const selSig = clean.newsStyles.join(",");

  useEffect(() => {
    const next = clampNewsStyles(plan, desk);
    if (next.newsStyles.join(",") === sanitizeSlidePlan(plan).newsStyles.join(",")) return;
    if (typeof onChange === "function") onChange(next);
  }, [availSig, selSig]); // eslint-disable-line react-hooks/exhaustive-deps — clamp when desk unlocks change

  const chip = (key) => {
    const style = NEWS_STYLES[key];
    const on = selected.has(key);
    const ok = !!avail[key]?.ok;
    const locked = disabled || !ok;
    return {
      padding: "5px 9px",
      borderRadius: 4,
      cursor: locked && !on ? "not-allowed" : (disabled ? "not-allowed" : "pointer"),
      fontFamily: "inherit",
      fontSize: "0.58rem",
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      fontWeight: 700,
      background: on ? "rgba(99,179,237,0.22)" : "transparent",
      color: on ? "#F5F0E8" : (ok ? "rgba(245,240,232,0.55)" : "rgba(245,240,232,0.28)"),
      border: `1px solid ${on ? "rgba(99,179,237,0.55)" : (ok ? "rgba(245,240,232,0.14)" : "rgba(245,240,232,0.08)")}`,
      opacity: disabled ? 0.45 : (ok || on ? 1 : 0.4),
    };
  };

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: "0.58rem", letterSpacing: 1.3, textTransform: "uppercase", fontWeight: 800, color: selected.size ? "#63B3ED" : "rgba(245,240,232,0.5)", marginBottom: 6 }}>
        News styles · stack on the card
      </div>
      <div style={{ fontSize: "0.62rem", color: "rgba(245,240,232,0.68)", lineHeight: 1.45, marginBottom: 8 }}>
        {disabled
          ? "GST is on — News styles are ignored."
          : selected.size
            ? `News will combine ${clean.newsStyles.map((k) => NEWS_STYLES[k].label).join(" + ")}. Not extra slides.`
            : "Pick any that the desk has earned. Grey means the Fuel / Check is not there yet."}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {NEWS_STYLE_ORDER.map((key) => {
          const ok = !!avail[key]?.ok;
          return (
            <button
              key={key}
              type="button"
              disabled={disabled || !ok}
              title={avail[key]?.reason || NEWS_STYLES[key].hint}
              onClick={() => {
                if (disabled || typeof onChange !== "function") return;
                onChange(toggleNewsStyle(plan, key, desk));
              }}
              style={chip(key)}
            >{NEWS_STYLES[key].label}</button>
          );
        })}
      </div>
    </div>
  );
}

// One strip. Jobs, not Look + Job + Talk menus. GST callers pass disabled.
export function SlideJobStrip({ plan, onChange, desk = {}, disabled = false, disabledNote = "", showNewsStyles = true }) {
  const clean = sanitizeSlidePlan(plan);
  const named = clean.jobs.length > 0;
  const chip = (on, extra = {}) => ({
    padding: "5px 8px",
    borderRadius: 4,
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit",
    fontSize: "0.58rem",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    fontWeight: 700,
    background: on ? "rgba(99,179,237,0.22)" : "transparent",
    color: on ? "#F5F0E8" : "rgba(245,240,232,0.55)",
    border: `1px solid ${on ? "rgba(99,179,237,0.55)" : "rgba(245,240,232,0.14)"}`,
    opacity: disabled ? 0.45 : 1,
    ...extra,
  });

  const commit = (next) => {
    if (disabled || typeof onChange !== "function") return;
    onChange(sanitizeSlidePlan(next));
  };

  return (
    <div style={{
      marginBottom: 12,
      padding: "10px 12px",
      background: named ? "rgba(99,179,237,0.08)" : "rgba(245,240,232,0.03)",
      border: `1px solid ${named ? "rgba(99,179,237,0.32)" : "rgba(245,240,232,0.10)"}`,
      borderRadius: 6,
    }}>
      {showNewsStyles ? (
        <NewsStyleChips plan={plan} onChange={onChange} desk={desk} disabled={disabled} />
      ) : null}
      <div style={{ fontSize: "0.58rem", letterSpacing: 1.3, textTransform: "uppercase", fontWeight: 800, color: named ? "#63B3ED" : "rgba(245,240,232,0.5)", marginBottom: 6 }}>
        Slide jobs · what each card does
      </div>
      <div style={{ fontSize: "0.62rem", color: "rgba(245,240,232,0.68)", lineHeight: 1.45, marginBottom: 8 }}>
        {disabled
          ? (disabledNote || "GST is on — this plan is ignored.")
          : named
            ? formatSlidePlanHeading(clean)
            : "Auto from this desk (Cover + News + closer). Name jobs to lock the cards. GST ignores a named plan."}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        <button type="button" disabled={disabled} onClick={() => commit({ jobs: [], coverStyle: "" })} style={chip(!named)}>
          Auto from desk
        </button>
        <button type="button" disabled={disabled} onClick={() => commit(defaultSlidePlan())} style={chip(named && clean.jobs.join(",") === "hook,happened,todo")}>
          3-card default
        </button>
      </div>
      {named ? (
        <>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
            {clean.jobs.map((key) => {
              const job = SLIDE_JOBS[key];
              const locked = key === "hook" || key === "todo";
              return (
                <button
                  key={key}
                  type="button"
                  disabled={disabled || locked}
                  title={locked ? `${job.label} stays on the plan` : `Remove ${job.label}`}
                  onClick={() => commit(removeJob(clean, key))}
                  style={chip(true, { cursor: locked || disabled ? "default" : "pointer" })}
                >
                  {job.label}{locked ? "" : " ×"}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: "0.54rem", letterSpacing: 1.1, textTransform: "uppercase", color: "rgba(245,240,232,0.4)", fontWeight: 700, marginBottom: 6 }}>
            Add a middle job
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {MIDDLE_JOBS.filter((key) => !clean.jobs.includes(key)).map((key) => (
              <button
                key={key}
                type="button"
                disabled={disabled}
                onClick={() => commit(addMiddleJob(clean, key))}
                style={chip(false)}
              >+ {SLIDE_JOBS[key].label}</button>
            ))}
          </div>
          <div style={{ fontSize: "0.54rem", letterSpacing: 1.1, textTransform: "uppercase", color: "rgba(245,240,232,0.4)", fontWeight: 700, marginBottom: 6 }}>
            Cover style
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {COVER_STYLE_ORDER.map((key) => (
              <button
                key={key}
                type="button"
                disabled={disabled}
                onClick={() => commit(setCoverStyle(clean, clean.coverStyle === key ? "" : key))}
                style={chip(clean.coverStyle === key)}
              >{COVER_STYLES[key].label}</button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
