// CGE source doctrine — the translator's desk, not a vibe scout.
//
// Official websites hold the record (statute, census, library, clerk).
// Desk B holds the ARGUMENT: a local opinion piece, a news column, or
// an independent page that already asked a Black-NJ question. The
// operator is systematizing this field without a journalism degree —
// the desks exist so the homework is learnable, not so we pretend the
// seed accounts are the best minds. Append a source you have actually
// used. Do not invent one.
//
// Why pages like not_gui, Pop Culture Detective, and We Are GST are
// hard to find: they are one-person (or small-team) publication-minds.
// They publish on Instagram and Substack. They have no hall, no season
// brochure, no SEO. Google ranks NJPAC, Essence, and museum wall text
// first. Allowlisting instagram.com is too broad (the whole platform).
// The move is path-level handles + named hunts for the PERSON, the
// PAGE, and the COLUMN. Those three are the ALTITUDE, not the topic —
// do not write about Nigerian civic climate or masculinity media
// criticism. Find the equivalent argument for Black New Jersey — not
// an adjacent NYC week.
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

// Desk B — argument sources. Independent pages are a seed, not canon.
// Local opinion and news count: that is how you learn the field.
// Hyperlocal Black NJ only. An adjacent NYC week is the wrong lens.
export const LENS_ACCOUNTS = [
  {
    id: "cge",
    name: "Central Group Events",
    why: "House archive — CGE's own published guide. The door the piece should close into.",
    sites: ["centralgroupevents.com"],
  },
  {
    id: "diaspora-gothic",
    name: "Hassan Ghanny / diaspora gothic",
    why: "NJ-born independent cultural worker. Seed, not the best mind — counts until a stronger NJ page replaces it.",
    sites: ["hassanghanny.me", "instagram.com/diaspora.gothic"],
  },
  {
    id: "jewel-justice",
    name: "Jewel Justice",
    why: "South Jersey writer. Seed. Independent Substack on Black life and culture.",
    sites: ["jeweljustice.substack.com"],
  },
  {
    id: "thejerzclub",
    name: "TheJerzClub",
    why: "Instagram-first Jersey club room. Seed for that lineage — not NJPAC programming copy.",
    sites: ["thejerzclub.substack.com", "instagram.com/thejerzclub"],
  },
  {
    id: "fayemi-shakur",
    name: "fayemi shakur",
    why: "Newark cultural critic. Seed. The city's own critical voice, not museum wall text.",
    sites: ["fayemishakur.com", "instagram.com/fayemi_"],
  },
  {
    id: "envert",
    name: "Flisadam Pointer / ENVERT",
    why: "Newark-built independent music desk. Seed. A journalist's own platform, not a national recap.",
    sites: ["envertmedia.com", "instagram.com/flisadamp"],
  },
];

// Local opinion and news — valid places to PULL the question from.
// Prefer columns, op-eds, and reported argument over listings.
// Seeded from Black In Jersey's 2024 Black-owned media list and the
// AACC NJ partner list. Classification can be longer than search.
export const OPINION_NEWS_DOMAINS = [
  "blackinjersey.com",
  "echonewstv.com",
  "njurbannews.com",
  "frontrunnernewjersey.com",
  "publicsq.org",
  "fivewardsmedia.com",
  "thepositivecommunity.com",
  "westwardbeans.com",
  "thenewarktimes.com",
  "anointedonline.net",
  "atlanticcityfocus.com",
  "morejersey.com",
  "nj.com",
  "tapinto.net",
  "jerseydigs.com",
];

// Live NJ Black press that did not fit the 20-domain search cap.
// Still labeled CULTURAL when a citation lands.
const NJ_PRESS_CLASSIFY_ONLY = [
  "southjerseyjournal.com",
  "wearejerseyent.com",
  "arkrepublic.com",
  "shelterforce.org",
  "trentonjournal.com",
];

// NJ universities sit on both desks. Desk A reads them as archive.
// Desk B reads them as the homework: oral history, African American
// Studies, Institute of Jazz Studies, a thesis that already joined
// the specimen. That is not NJPAC season copy.
export const UNIVERSITY_ARGUMENT_DOMAINS = [
  "rutgers.edu",
  "montclair.edu",
  "princeton.edu",
];

// Search allowlist is the 20-domain cap. Instagram seed paths stay
// classifiable but do not eat a slot — the Black NJ press does.
export const CULTURAL_SEARCH_DOMAINS = [
  "centralgroupevents.com",
  "thejerzclub.substack.com",
  ...UNIVERSITY_ARGUMENT_DOMAINS,
  ...OPINION_NEWS_DOMAINS,
].filter((site, i, all) => all.indexOf(site) === i).slice(0, 20);

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

// Halls, stations, and national magazines are PRESS. They can confirm
// a door. They cannot authorize a Black-NJ argument.
const PRESS_HOST_MARKERS = [
  "njmonthly.com",
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
];

const CULTURAL_HOST_MARKERS = [
  ...LENS_ACCOUNTS.flatMap((account) => account.sites).filter((site) => !site.includes("/")),
  ...OPINION_NEWS_DOMAINS,
  ...NJ_PRESS_CLASSIFY_ONLY,
];

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

export function isUniversitySource(url) {
  const { host } = urlParts(url);
  return UNIVERSITY_ARGUMENT_DOMAINS.some((m) => hostMatches(host, m));
}

// A Rutgers oral history is an argument even though the host classifies
// OFFICIAL. Empty means no column, no seed page, and no university page.
export function argumentDeskEmpty(sources = []) {
  const counts = countSourceClasses(sources);
  if (counts.CULTURAL > 0) return false;
  return !sources.some((s) => isUniversitySource(s.uri || s.host));
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

// How you learn the field without already being in it: hunt the
// COLUMN and the PAGE inside Black New Jersey. Opinion and news that
// argue count. An adjacent NYC week does not.
export function lensDiscoveryQueries({ cluster = "", topic = "" } = {}) {
  const hook = String(topic || "").trim() || "Black New Jersey gathering";
  const key = String(cluster || "").toUpperCase().replace(/\s+/g, "_");
  const base = [
    `${hook} Black New Jersey opinion OR op-ed OR column site:echonewstv.com OR site:blackinjersey.com OR site:njurbannews.com -njpac -essence -currentaffairs`,
    `${hook} Newark OR "South Jersey" commentary site:frontrunnernewjersey.com OR site:fivewardsmedia.com OR site:publicsq.org`,
    `${hook} oral history OR "African American Studies" site:rutgers.edu OR site:montclair.edu OR site:princeton.edu`,
  ];
  const byCluster = {
    STATE_SONIC_HISTORY: [
      "Jersey club Newark opinion oral history TheJerzClub -njpac",
      "Club Zanzibar Newark column OR oral history -brooklyn",
    ],
    NIGHTLIFE_DILEMMA: [
      "Newark nightlife opinion column closure site:nj.com OR site:jerseydigs.com",
      "Jersey City club curfew commentary -timeout",
    ],
    DIASPORA_INFRASTRUCTURE: [
      "Newark Caribbean African American hall opinion column New Jersey",
      "who owns versus who programs Newark culture column",
    ],
    SUBURBAN_THIRD_PLACE: [
      "New Jersey Black suburban gathering opinion column -brooklyn",
    ],
    PHILOSOPHY_OF_GATHERING: [
      "Black New Jersey cultural memory opinion column -museum",
    ],
    DIGITAL_NETWORKS: [
      "New Jersey Black event flyer Instagram writer independent -brooklyn",
    ],
    DAYTIME_PLAY: [
      "Newark daytime gathering opinion column New Jersey",
    ],
  };
  return [...base, ...(byCluster[key] || [])].slice(0, 6);
}

export function sourceDoctrineForPrompt() {
  return [
    "SOURCE DOCTRINE — the operator is systematizing Black New Jersey culture without a journalism degree. The desks teach the field. Do not require a famous critic. Require a New Jersey argument you can point at.",
    "DESK A / OFFICIAL: statute, municipal clerk, ABC, census, library catalog, university archive, ownership record. KEEP the bureaucratic language. Gemini will cook; you will not pre-chew a statute into a vibe.",
    "DESK B / ARGUMENT: Black New Jersey press, local opinion, university pages, and independent pages that already asked a Black-NJ question. Echo (oldest Black-owned NJ paper), Front Runner (South Jersey), Five Wards and Public Square (Newark), The Positive Community (Montclair), West Ward Beans, NJ Urban News, Black In Jersey, Anointed (Camden). These count even when they are not the best writing. A Rutgers oral history or an Echo column is how you learn the field. That is not NJPAC season copy, not Current Affairs, not Essence. Seed Instagram/Substack pages are starting points, not canon.",
    "THE PLACE IS BLACK NEW JERSEY. Not an adjacent NYC week, not Brooklyn, not 'the diaspora' in the abstract. A sentence that could run in Brooklyn without edits is the wrong sentence. Hyperlocal is the moat.",
    "Do NOT treat Timeout, Yelp, TripAdvisor, Eventbrite listicles, NJPAC season copy, Essence/The Root recaps, WBGO program notes, or museum wall text as the argument. They may confirm a door is open. They cannot authorize the new question. Prefer opinion / column / commentary over listings.",
    "Hunt the COLUMN, the PERSON, the PAGE, and the UNIVERSITY holding (oral history, AAS, Institute of Jazz Studies). If the first result is a hall, a national magazine, or a Brooklyn weekender, keep searching.",
    "Name the source class on each fact when you can: (OFFICIAL — nj.gov), (CULTURAL — blackinjersey.com), (PRESS — essence.com).",
    "A claim that only exists on an unranked listicle is UNCONFIRMED, not a document.",
  ].join(" ");
}
