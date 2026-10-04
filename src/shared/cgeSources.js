// CGE source doctrine — the translator's desk, not a vibe scout.
//
// Official websites hold the record (statute, census, library, clerk).
// Cultural sources hold the feedback (who uses the room, who holds the
// memory, the press that already speaks from inside the community).
// The list is meant to grow. Append a domain; do not invent a source
// you have not actually used.
//
// Perplexity Agent web_search allowlists cap at 20 domains per call.
// Keep each desk's SEARCH list at or under 20. Classification lists
// can be longer — they only label URLs after the fact.

export const SOURCE_CLASSES = {
  OFFICIAL: "OFFICIAL",
  CULTURAL: "CULTURAL",
  PRESS: "PRESS",
  UNRANKED: "UNRANKED",
};

// Desk A — official record. TLD ".gov" covers nj.gov, census.gov,
// loc.gov, nps.gov, and municipal .gov clerks. Named extras are the
// NJ cultural-memory institutions that are not .gov.
export const OFFICIAL_SEARCH_DOMAINS = [
  ".gov",
  "rutgers.edu",
  "njstatelib.org",
  "jerseyhistory.org",
  "newarkpubliclibrary.org",
  "npl.org",
  "princeton.edu",
  "montclair.edu",
];

// Desk B — cultural feedback. Seed only. Add halls, associations,
// stations, and papers as CGE actually learns to trust them.
export const CULTURAL_SEARCH_DOMAINS = [
  "centralgroupevents.com",
  "wbgo.org",
  "njpac.org",
  "newarkmuseumart.org",
  "newjerseystage.com",
  "jerseyhistory.org",
  "njmonthly.com",
  "jerseydigs.com",
  "tapinto.net",
  "nj.com",
  "amsterdamnews.com",
  "theroot.com",
  "thegrio.com",
  "essence.com",
  "okayplayer.com",
  "okayafrica.com",
  "caribbeanlifenews.com",
  "blackenterprise.com",
];

// Classification — longer than the search allowlists on purpose.
const OFFICIAL_HOST_MARKERS = [
  ".gov",
  ".nj.us",
  "rutgers.edu",
  "princeton.edu",
  "montclair.edu",
  "njstatelib.org",
  "jerseyhistory.org",
  "newarkpubliclibrary.org",
  "npl.org",
  "loc.gov",
  "census.gov",
  "archives.gov",
];

const PRESS_HOST_MARKERS = [
  "nj.com",
  "tapinto.net",
  "njmonthly.com",
  "jerseydigs.com",
  "amsterdamnews.com",
  "theroot.com",
  "thegrio.com",
  "essence.com",
  "okayplayer.com",
  "okayafrica.com",
  "caribbeanlifenews.com",
  "blackenterprise.com",
  "nytimes.com",
  "washingtonpost.com",
];

const CULTURAL_HOST_MARKERS = [
  "centralgroupevents.com",
  "wbgo.org",
  "njpac.org",
  "newarkmuseumart.org",
  "newjerseystage.com",
];

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return String(url || "").replace(/^www\./, "").toLowerCase();
  }
}

function hostMatches(host, marker) {
  const m = String(marker || "").replace(/^www\./, "").toLowerCase();
  if (!host || !m) return false;
  if (m.startsWith(".")) return host.endsWith(m) || host === m.slice(1);
  return host === m || host.endsWith(`.${m}`);
}

export function classifySource(url) {
  const host = hostOf(url);
  if (!host) return SOURCE_CLASSES.UNRANKED;
  if (OFFICIAL_HOST_MARKERS.some((m) => hostMatches(host, m))) return SOURCE_CLASSES.OFFICIAL;
  if (CULTURAL_HOST_MARKERS.some((m) => hostMatches(host, m))) return SOURCE_CLASSES.CULTURAL;
  if (PRESS_HOST_MARKERS.some((m) => hostMatches(host, m))) return SOURCE_CLASSES.PRESS;
  return SOURCE_CLASSES.UNRANKED;
}

export function classifySources(urls = []) {
  const seen = new Set();
  const out = [];
  for (const raw of urls) {
    const uri = String(raw || "").trim();
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    out.push({
      uri,
      host: hostOf(uri),
      class: classifySource(uri),
    });
  }
  return out;
}

export function countSourceClasses(sources = []) {
  const counts = { OFFICIAL: 0, CULTURAL: 0, PRESS: 0, UNRANKED: 0 };
  for (const s of sources) {
    const key = SOURCE_CLASSES[s?.class] ? s.class : SOURCE_CLASSES.UNRANKED;
    counts[key] += 1;
  }
  return counts;
}

// Named searches the desks should actually run. Cluster lens said
// "what kind of fact." These say which query to type.
export function clusterSearchQueries(cluster = "") {
  const key = String(cluster || "").toUpperCase().replace(/\s+/g, "_");
  const table = {
    POLICY_MECHANICS: [
      "N.J.S.A. liquor license one per 3,000 New Jersey",
      "NJ Division of ABC license cap statute site:nj.gov",
      "home rule 564 municipalities New Jersey gathering permits",
    ],
    STATE_SONIC_HISTORY: [
      "Club Zanzibar Newark Lincoln Motel archive",
      "Institute of Jazz Studies Rutgers New Jersey",
      "Newark ballroom house music history library",
    ],
    DIASPORA_INFRASTRUCTURE: [
      "Caribbean benevolent association hall Newark New Jersey",
      "African American civic lodge Newark ownership",
      "West African restaurant corridor Newark Irvington",
    ],
    NIGHTLIFE_DILEMMA: [
      "Newark Jersey City nightclub closure curfew ordinance",
      "NJ ABC decibel capacity license nightlife",
      "hi-fi listening bar New Jersey municipal code",
    ],
    SUBURBAN_THIRD_PLACE: [
      "New Jersey municipal park permit gathering",
      "transit village public space ordinance New Jersey",
      "strip mall occupancy assembly license New Jersey",
    ],
    REGIONAL_DEMOGRAPHICS: [
      "NJ Transit reverse commute ridership census",
      "New Jersey Black population county ACS census.gov",
      "transit village demographics New Jersey",
    ],
    GATHERING_LOGISTICS: [
      "New Jersey special events permit fee municipal",
      "temporary food license outdoor gathering New Jersey",
      "occupancy load assembly space New Jersey UCC",
    ],
    DAYTIME_PLAY: [
      "New Jersey municipal field permit adult recreation",
      "roller rink New Jersey historic recreation",
      "public park alcohol ordinance New Jersey",
    ],
    DIGITAL_NETWORKS: [
      "New Jersey ticketing consumer affairs event",
      "municipal flyer posting ordinance New Jersey",
    ],
    PHILOSOPHY_OF_GATHERING: [
      "third place public library New Jersey hours",
      "New Jersey civic hall membership historical society",
    ],
  };
  // Legacy label keys (pre-compass) land here via loose includes.
  if (table[key]) return table[key];
  const asLabel = String(cluster || "").toLowerCase();
  if (asLabel.includes("policy")) return table.POLICY_MECHANICS;
  if (asLabel.includes("sonic") || asLabel.includes("history")) return table.STATE_SONIC_HISTORY;
  if (asLabel.includes("diaspora")) return table.DIASPORA_INFRASTRUCTURE;
  if (asLabel.includes("nightlife")) return table.NIGHTLIFE_DILEMMA;
  if (asLabel.includes("third")) return table.SUBURBAN_THIRD_PLACE;
  if (asLabel.includes("demographic") || asLabel.includes("transit")) return table.REGIONAL_DEMOGRAPHICS;
  return [];
}

export function sourceDoctrineForPrompt() {
  return [
    "SOURCE DOCTRINE — a cultural translator needs the right desks, not the highest-ranked Google result.",
    "DESK A / OFFICIAL: statute, municipal clerk, ABC, census, library catalog, university archive, ownership record. KEEP the bureaucratic language. Gemini will cook; you will not pre-chew a statute into a vibe.",
    "DESK B / CULTURAL: the room's own site, the association, the Black/Caribbean/African press, WBGO, NJPAC, historical society, CGE's own published guide. This is who uses the room and who holds the memory.",
    "Do NOT treat Timeout, Yelp, TripAdvisor, Eventbrite listicles, or 'best of New Jersey' roundups as the document. They may confirm a room is open. They cannot authorize you to speak on the record.",
    "Name the source class on each fact when you can: (OFFICIAL — nj.gov), (CULTURAL — wbgo.org), (PRESS — nj.com).",
    "A claim that only exists on an unranked listicle is UNCONFIRMED, not a document.",
  ].join(" ");
}
