// fetch() wrapper that retries transient backend failures with exponential
// backoff. On the Repl, a save can briefly get a 502/503/504 while the server
// is waking, restarting, or momentarily overloaded — and a plain fetch fails
// the whole save on that single blip. Save endpoints (workspaces, review
// sessions, library) route their fetches through this so a momentary hiccup
// recovers on its own. Real errors (400 / 404 / 413 …) and successful
// responses return immediately for the caller to handle as before.
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export async function retryFetch(url, init = {}, { tries = 4 } = {}) {
  let lastRes = null, lastErr = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt > 0) {
      // 0.7s → 1.4s → 2.8s — enough for the server to come back up.
      await new Promise(r => setTimeout(r, 700 * 2 ** (attempt - 1)));
    }
    try {
      const res = await fetch(url, init);
      if (res.ok || !RETRYABLE.has(res.status)) return res; // success or a real error to surface
      lastRes = res;                                        // transient status → remember + retry
    } catch (e) {
      lastErr = e;                                          // network / gateway drop → retry
    }
  }
  if (lastRes) return lastRes;        // give the caller the last transient response to surface
  throw lastErr || new Error("Request failed");
}
