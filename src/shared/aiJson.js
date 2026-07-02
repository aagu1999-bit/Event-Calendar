// Salvage JSON from an LLM response. Even with responseMimeType:"application/json"
// set, smaller models (notably gemini-2.5-flash-lite) sometimes wrap the output
// in a ```json code fence or prepend a stray line of prose. A bare JSON.parse
// then throws "Gemini did not return valid JSON" even though the JSON is right
// there. This strips fences and, as a last resort, extracts the outermost
// {...} or [...] span before parsing.
// Pull the response text out of a Gemini generateContent payload. gemini-2.5-*
// are thinking models: their content.parts array can contain a reasoning part
// ({thought:true, text:"..."}) BEFORE the real answer part. Reading parts[0]
// blindly returns the thinking prose, which then fails JSON.parse. Skip any
// thought parts and take the first real text part (falling back to parts[0]
// for non-thinking models that only emit one part).
export function extractResponseText(data) {
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  return (parts.find(p => p && !p.thought && typeof p.text === "string") ?? parts[0])?.text;
}

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
