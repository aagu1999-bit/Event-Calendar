// CGE source doctrine — the translator's desk, not a vibe scout.
//
// Official websites hold the record (statute, census, library, clerk).
// Lens accounts hold the new question. Institutions and national
// magazines cannot. The list is meant to grow from minds the operator
// actually trusts. Append an account; do not invent a source you have
// not actually used.
//
// Why pages like not_gui, Pop Culture Detective, and We Are GST are
// hard to find: they are one-person (or small-team) publication-minds.
// They publish on Instagram and Substack. They have no hall, no season
// brochure, no SEO. Google ranks NJPAC, Essence, and museum wall text
// first. Allowlisting instagram.com is too broad (the whole platform).
// The move is path-level handles + named hunts for the PERSON and the
// PAGE. Those three are the ALTITUDE, not the topic — do not write
// about Nigerian civic climate or masculinity media criticism. Find
// the equivalent mind for Black New Jersey and the specimen in front
// of us.
//
// Perplexity Agent web_search allowlists cap at 20 domains per call
// and accept path-level filters (instagram.com/handle). Keep each
// desk's SEARCH list at or under 20. Classification lists can be
// longer — they only label URLs after the fact.

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

// Desk B — lens accounts. Independent minds with a method, not halls.
// Seed only. Add a handle when CGE has actually used that page.
export const LENS_ACCOUNTS = [
  {
    id: "cge",
    name: "Central Group Events",
    why: "House archive — CGE's own published guide. Not an outside lens; the door the piece should close into.",
    sites: ["centralgroupevents.com"],
  },
  {
    id: "diaspora-gothic",
    name: "Hassan Ghanny / diaspora gothic",
    why: "NJ-born independent cultural worker. Essays, zines, video essays. Instagram-first mind, not a hall.",
    sites: ["hassanghanny.me", "instagram.com/diaspora.gothic"],
  },
  {
    id: "jewel-justice",
    name: "Jewel Justice",
    why: "South Jersey writer. Independent Substack on Black life, culture, and art. A mind, not a season brochure.",
    sites: ["jeweljustice.substack.com"],
  },
  {
    id: "thejerzclub",
    name: "TheJerzClub",
    why: "Started as an Instagram page for Jersey club makers. Still the low-level room for that lineage — not NJPAC programming copy.",
    sites: ["thejerzclub.substack.com", "instagram.com/thejerzclub"],
  },
  {
    id: "idontdoclubs",
    name: "Genese Jamilah / I Don't Do Clubs / the weeklies",
    why: "Independent Black-professional gathering lens that already includes NJ in the week. A person with a page, not a venue calendar.",
    sites: ["idontdoclubs.com", "theweekliesbygenesejamilah.substack.com", "instagram.com/idontdoclubs"],
  },
  {
    id: "fayemi-shakur",
    name: "fayemi shakur",
    why: "Newark cultural critic. Independent writing and A Womb of Violet — the city's own critical voice, not museum wall text.",
    sites: ["fayemishakur.com", "instagram.com/fayemi_"],
  },
  {
    id: "envert",
    name: "Flisadam Pointer / ENVERT",
    why: "Newark-built independent music desk. Unsigned and local first. A journalist's own platform, not a national recap.",
    sites: ["envertmedia.com", "instagram.com/flisadamp"],
  },
];

export const CULTURAL_SEARCH_DOMAINS = LENS_ACCOUNTS
  .flatMap((account) => account.sites)
  .filter((site, i, all) => all.indexOf(site) === i)
  .slice(0, 20);

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

// Halls, stations, and national magazines are PRESS now. They can
// confirm a door. They cannot supply the daily new lens.
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
  "wbgo.org",
  "njpac.org",
  "newarkmuseumart.org",
  "newjerseystage.com",
  "blackinjersey.com",
  "njurbannews.com",
];

const CULTURAL_HOST_MARKERS = LENS_ACCOUNTS
  .flatMap((account) => account.sites)
  .filter((site) => !site.includes("/"));

const CULTURAL_PATH_MARKERS = LENS_ACCOUNTS
  .flatMap((account) => account.sites)
  .filter((site) => site.includes("/"));

function urlParts(url) {
  const raw = String(url || "").trim();
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    return { host, path, key: `${host}${path}` };
  } catch {
    const s = raw.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "").toLowerCase();
    const slash = s.indexOf("/");
    if (slash === -1) return { host: s, path: "", key: s };
    return { host: s.slice(0, slash), path: s.slice(slash), key: s };
  }
}

function hostOf(url) {
  return urlParts(url).host;
}

function hostMatches(host, marker) {
  const m = String(marker || "").replace(/^www\./, "").toLowerCase();
  if (!host || !m) return false;
  if (m.startsWith(".")) return host.endsWith(m) || host === m.slice(1);
  return host === m || host.endsWith(`.${m}`);
}

function pathMatches(url, marker) {
  const m = String(marker || "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "").toLowerCase();
  if (!m || !m.includes("/")) return false;
  const { key } = urlParts(url);
  return key === m || key.startsWith(`${m}/`);
}

export function classifySource(url) {
  const { host } = urlParts(url);
  if (!host) return SOURCE_CLASSES.UNRANKED;
  if (OFFICIAL_HOST_MARKERS.some((m) => hostMatches(host, m))) return SOURCE_CLASSES.OFFICIAL;
  if (CULTURAL_PATH_MARKERS.some((m) => pathMatches(url, m))) return SOURCE_CLASSES.CULTURAL;
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

// How you find a not_gui / GST / Pop Detective for what is in front of
// us: search the PERSON and the PAGE, subtract the halls, stay on
// Instagram + Substack + a personal site.
export function lensDiscoveryQueries({ cluster = "", topic = "" } = {}) {
  const hook = String(topic || "").trim() || "Black New Jersey gathering";
  const key = String(cluster || "").toUpperCase().replace(/\s+/g, "_");
  const base = [
    `${hook} independent writer Instagram Substack Newark OR "Jersey City" -njpac -essence -museum`,
    `${hook} New Jersey culture critic newsletter OR zine Instagram -timeout`,
    `who writes about ${hook} Instagram "New Jersey" -njpac -yelp`,
  ];
  const byCluster = {
    STATE_SONIC_HISTORY: [
      "Jersey club historian Instagram Substack TheJerzClub",
      "Club Zanzibar Newark oral history independent writer -njpac",
    ],
    NIGHTLIFE_DILEMMA: [
      "Newark nightlife independent writer Instagram Substack",
      "Jersey City club closure critic newsletter",
    ],
    DIASPORA_INFRASTRUCTURE: [
      "Newark Caribbean African hall independent writer Instagram",
      "diaspora gothic Hassan Ghanny New Jersey essay",
    ],
    SUBURBAN_THIRD_PLACE: [
      "New Jersey Black suburban gathering writer Instagram Substack",
      "I Don't Do Clubs New Jersey weeklies",
    ],
    PHILOSOPHY_OF_GATHERING: [
      "Newark cultural critic Instagram Substack fayemi shakur",
      "Black New Jersey essayist zine Instagram -museum",
    ],
    DIGITAL_NETWORKS: [
      "New Jersey Black event flyer Instagram writer independent",
    ],
    DAYTIME_PLAY: [
      "Newark daytime gathering independent writer Instagram",
    ],
  };
  return [...base, ...(byCluster[key] || [])].slice(0, 6);
}

export function sourceDoctrineForPrompt() {
  return [
    "SOURCE DOCTRINE — a cultural translator needs the right desks, not the highest-ranked Google result.",
    "DESK A / OFFICIAL: statute, municipal clerk, ABC, census, library catalog, university archive, ownership record. KEEP the bureaucratic language. Gemini will cook; you will not pre-chew a statute into a vibe.",
    "DESK B / LENS: independent minds, not halls. The pages that are hard to find — Instagram-first writers, Substacks, one-person publications — because Google ranks NJPAC, Essence, and museums first. Those institutions cannot provide the new lens we search for daily. A lens account has a recurring mind and a method (specimen → pattern → join). Class examples of ALTITUDE, not topic: not_gui / n0tgui, Pop Culture Detective, We Are GST. Do not write their subjects. Find the equivalent mind for Black New Jersey and this specimen. CGE's own published guide is the house archive.",
    "Do NOT treat Timeout, Yelp, TripAdvisor, Eventbrite listicles, NJPAC season copy, Essence/The Root recaps, WBGO program notes, or museum wall text as the lens. They may confirm a door is open. They cannot authorize the new question.",
    "Hunt the PERSON and the PAGE: named Instagram handles (path-level, not instagram.com wholesale), named Substacks, personal sites. If the first result is a hall or a national magazine, keep searching.",
    "Name the source class on each fact when you can: (OFFICIAL — nj.gov), (CULTURAL — thejerzclub.substack.com), (PRESS — nj.com).",
    "A claim that only exists on an unranked listicle is UNCONFIRMED, not a document.",
  ].join(" ");
}
