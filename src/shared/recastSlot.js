// Recast a generated preview card to another Look.
// Keeps the sentences. Does not call the writer. Jobs do not lock this.

export const PREVIEW_RECAST_TYPES = ["cover", "news", "text", "cta"];

export const PREVIEW_RECAST_LABELS = {
  cover: "Cover",
  news: "News",
  text: "Text",
  cta: "CTA",
};

function pairFrom(slot) {
  const s = slot && typeof slot === "object" ? slot : {};
  const t = String(s.type || "");
  const url = s.ctaUrl || "";
  if (t === "cover") {
    return { title: s.headline, body: s.subtitle, kicker: "", url };
  }
  if (t === "news") {
    return { title: s.newsHeadline, body: s.newsBody, kicker: s.newsKicker, url };
  }
  if (t === "text") {
    return { title: s.textTitle, body: s.textBody, kicker: "", url };
  }
  if (t === "cta") {
    return { title: s.ctaDate, body: s.ctaVenue, kicker: s.ctaKicker, url };
  }
  if (t === "spotlight") {
    return { title: s.spotName, body: s.spotMeta, kicker: "", url };
  }
  return {
    title: s.headline || s.textTitle || s.newsHeadline || s.ctaDate || "",
    body: s.subtitle || s.textBody || s.newsBody || s.ctaVenue || "",
    kicker: s.newsKicker || s.ctaKicker || "",
    url,
  };
}

function clean(v) {
  return v == null ? "" : String(v);
}

export function recastSlot(slot, nextType) {
  const type = String(nextType || "").trim().toLowerCase();
  if (!slot || typeof slot !== "object") return slot;
  if (!PREVIEW_RECAST_TYPES.includes(type)) return slot;
  if (slot.type === type) return slot;
  const { title, body, kicker, url } = pairFrom(slot);
  const carry = clean(url) ? { ctaUrl: clean(url) } : {};
  if (type === "cover") {
    return { type, headline: clean(title), subtitle: clean(body), ...carry };
  }
  if (type === "news") {
    return {
      type,
      newsKicker: clean(kicker),
      newsHeadline: clean(title),
      newsBody: clean(body),
      ...carry,
    };
  }
  if (type === "text") {
    return { type, textTitle: clean(title), textBody: clean(body), ...carry };
  }
  return {
    type,
    ctaKicker: clean(kicker),
    ctaDate: clean(title),
    ctaVenue: clean(body),
    ctaUrl: clean(url),
  };
}
