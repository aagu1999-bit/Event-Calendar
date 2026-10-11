import {
  SLIDE_JOBS,
  MIDDLE_JOBS,
  COVER_STYLE_ORDER,
  COVER_STYLES,
  sanitizeSlidePlan,
  defaultSlidePlan,
  addMiddleJob,
  removeJob,
  setCoverStyle,
  formatSlidePlanHeading,
} from "./slideJobs.js";

// One strip. Jobs, not Look + Job + Talk menus. GST callers pass disabled.
export function SlideJobStrip({ plan, onChange, disabled = false, disabledNote = "" }) {
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
