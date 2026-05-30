import React from "react";

// Drop-in <input> replacement that uppercases everything the user types.
// Saves the user from holding Caps Lock when entering event names, venues,
// cities, types, times, etc. Visual hint via text-transform; data is also
// stored uppercase so it round-trips correctly through validation.
export function UInput({ onChange, style, ...rest }) {
  return (
    <input
      {...rest}
      onChange={(e) => {
        e.target.value = e.target.value.toUpperCase();
        if (onChange) onChange(e);
      }}
      style={{ textTransform: "uppercase", ...(style || {}) }}
    />
  );
}

export function UTextarea({ onChange, style, ...rest }) {
  return (
    <textarea
      {...rest}
      onChange={(e) => {
        e.target.value = e.target.value.toUpperCase();
        if (onChange) onChange(e);
      }}
      style={{ textTransform: "uppercase", ...(style || {}) }}
    />
  );
}

// Friday date helper used by Calendar + Regulars to default to the
// current week's Friday based on the system clock (no more hardcoded dates).
export function todaysFridayMD() {
  const d = new Date();
  const dow = d.getDay(); // Sun=0 .. Sat=6
  const offset = dow <= 5 ? (5 - dow) : 6; // days until next Fri (today if it's Fri)
  d.setDate(d.getDate() + offset);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
