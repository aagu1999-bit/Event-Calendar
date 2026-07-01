// Salvage JSON from an LLM response. Even with responseMimeType:"application/json"
// set, smaller models (notably gemini-2.5-flash-lite) sometimes wrap the output
// in a ```json code fence or prepend a stray line of prose. A bare JSON.parse
// then throws "Gemini did not return valid JSON" even though the JSON is right
// there. This strips fences and, as a last resort, extracts the outermost
// {...} or [...] span before parsing.
export function extractJson(raw) {
  if (raw == null || String(raw).trim() === "") {
    throw new Error("Empty response from Gemini");
  }
  let s = String(raw).trim();

  // Strip a wrapping markdown code fence: ```json ... ``` or ``` ... ```
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1].trim();

  // Happy path.
  try { return JSON.parse(s); } catch { /* fall through to extraction */ }

  // Last resort: grab the outermost object/array span and try that. Handles a
  // leading "Here is the JSON:" line or a trailing note the model tacked on.
  const first = s.search(/[{[]/);
  const last = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (first >= 0 && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)); } catch { /* give up below */ }
  }

  throw new Error("Gemini did not return valid JSON");
}
