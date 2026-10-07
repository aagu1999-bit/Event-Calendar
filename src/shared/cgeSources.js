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
  {
    id: "nj-uncovered",
    name: "NJ Uncovered",
    why: "Social-first NJ news/culture page. They post on Facebook, YouTube, and Instagram — hunt the PAGE and the PERSON, not a hall site. Seed.",
    sites: [
      "instagram.com/nj.uncovered",
      "instagram.com/njuncovered",
      "youtube.com/@nj.uncovered",
      "youtube.com/@njuncovered",
      "facebook.com/njuncovered",
      "facebook.com/newjerseyuncovered",
    ],
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
  "nj.com",
  "tapinto.net",
  "jerseydigs.com",
];

// Live NJ Black press that did not fit Desk B's 20-domain search cap.
// Looked through when the topic makes them apparent — they ARE argument.
export const OVERFLOW_ARGUMENT_DOMAINS = [
  "morejersey.com",
  "southjerseyjournal.com",
  "wearejerseyent.com",
  "arkrepublic.com",
  "shelterforce.org",
  "trentonjournal.com",
];

// Independent seed hosts that also missed the Desk B cap (IG/YT/FB
// paths stay classify-only — allowlisting the whole platform is too wide).
export const OVERFLOW_INDEPENDENT_DOMAINS = [
  "hassanghanny.me",
  "jeweljustice.substack.com",
  "fayemishakur.com",
  "envertmedia.com",
];

// National pop-culture / society argument. Same class as Pop Detective:
// they teach a MECHANISM. They are not the specimen and not the place.
export const PATTERN_ALTITUDE_DOMAINS = [
  "currentaffairs.org",
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
  ...PATTERN_ALTITUDE_DOMAINS,
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

// Halls, stations, and national magazines are PRESS. Look through
// them when the topic would actually show up there. They can confirm
// a door. They cannot authorize a Black-NJ argument.
export const PRESS_SEARCH_DOMAINS = [
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

const PRESS_HOST_MARKERS = PRESS_SEARCH_DOMAINS;

const CULTURAL_HOST_MARKERS = [
  ...LENS_ACCOUNTS.flatMap((account) => account.sites).filter((site) => !site.includes("/")),
  ...OPINION_NEWS_DOMAINS,
  ...OVERFLOW_ARGUMENT_DOMAINS,
  ...OVERFLOW_INDEPENDENT_DOMAINS,
  ...PATTERN_ALTITUDE_DOMAINS,
];

function uniqueDomains(list, cap = 20) {
  return (list || []).filter((site, i, all) => site && all.indexOf(site) === i).slice(0, cap);
}

function haystackOf({ topic = "", cluster = "", corridor = "" } = {}) {
  return [topic, cluster, corridor].join(" ").toLowerCase();
}

// Leftover Desk B pages always get opened. Halls and national magazines
// only when the hook would actually appear on them — a suburban liquor
// cap is not an Essence story; a Newark jazz night is a WBGO/NJPAC one.
export function apparentLookthroughDomains({ topic = "", cluster = "", corridor = "" } = {}) {
  const hay = haystackOf({ topic, cluster, corridor });
  const argument = uniqueDomains([
    ...OVERFLOW_ARGUMENT_DOMAINS,
    ...OVERFLOW_INDEPENDENT_DOMAINS,
  ]);

  const press = [];
  const add = (domains) => {
    for (const domain of domains) press.push(domain);
  };

  if (/south|atlantic|camden|cape may|vineland|millville/.test(hay)) {
    add(["njmonthly.com"]);
  }
  if (/nightlife|club|music|jazz|sonic|concert|hip.?hop|r&b|stage|theater|theatre/.test(hay)) {
    add(["wbgo.org", "njpac.org", "okayplayer.com", "okayafrica.com", "newjerseystage.com"]);
  }
  if (/museum|art|exhibit|gallery/.test(hay)) {
    add(["newarkmuseumart.org", "njpac.org", "njmonthly.com"]);
  }
  if (/caribbean|west african|diaspora|african/.test(hay)) {
    add(["caribbeanlifenews.com", "amsterdamnews.com", "okayafrica.com"]);
  }
  if (/black|culture|society|magazine|national|essence|root/.test(hay)) {
    add(["essence.com", "theroot.com", "thegrio.com", "blackenterprise.com"]);
  }
  if (/policy|statute|license|ordinance|census|congress|legislation|abc\b/.test(hay)) {
    add(["nytimes.com", "washingtonpost.com", "njmonthly.com"]);
  }
  if (/newark|jersey city|essex|hudson|montclair/.test(hay)) {
    add(["njmonthly.com", "wbgo.org", "njpac.org", "newarkmuseumart.org", "newjerseystage.com"]);
  }
  if (/downtown|transit.?village|suburban|strip mall|retrofit/.test(hay)) {
    add(["njmonthly.com"]);
  }
  // Any NJ specimen still gets the local magazine/station. Nationals
  // stay out unless a hint above made them apparent.
  if (!press.length || /jersey|newark|nj\b/.test(hay)) {
    add(["njmonthly.com", "wbgo.org"]);
  }

  return {
    argument,
    press: uniqueDomains(press),
    all: uniqueDomains([...argument, ...press]),
  };
}

export function lookthroughSearchQueries({ topic = "", cluster = "", corridor = "" } = {}) {
  const hook = String(topic || "").trim() || "Black New Jersey gathering";
  const { argument, press } = apparentLookthroughDomains({ topic, cluster, corridor });
  const siteOr = (domains) => domains.slice(0, 5).map((domain) => `site:${domain}`).join(" OR ");
  return [
    `${hook} ${siteOr(argument)}`,
    press.length ? `${hook} ${siteOr(press)}` : null,
  ].filter(Boolean);
}

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

// Desk URLs first — official, then argument, then halls, then
// venue homepages. Fuel Research was citing montclairbrewery.com
// ahead of Echo / nj.gov because Phase 2 returned whatever verified
// the address. Prefer does not drop the brewery site; it just
// refuses to lead with it.
const DESK_CLASS_RANK = {
  [SOURCE_CLASSES.OFFICIAL]: 0,
  [SOURCE_CLASSES.CULTURAL]: 1,
  [SOURCE_CLASSES.PRESS]: 2,
  [SOURCE_CLASSES.UNRANKED]: 3,
};

export function preferDeskSources(urlsOrSources = []) {
  const sources = Array.isArray(urlsOrSources) && urlsOrSources[0] && typeof urlsOrSources[0] === "object" && urlsOrSources[0].class
    ? urlsOrSources.slice()
    : classifySources(urlsOrSources);
  return sources.sort((a, b) => {
    const ra = DESK_CLASS_RANK[a?.class] ?? 3;
    const rb = DESK_CLASS_RANK[b?.class] ?? 3;
    if (ra !== rb) return ra - rb;
    return String(a?.uri || "").localeCompare(String(b?.uri || ""));
  });
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
      "NJ Transit Village program walkable downtown retrofit",
      "New Jersey suburbs that retrofitted a commercial strip into a downtown Cranford",
      "downtown special improvement district New Jersey walkable",
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

// Coherence-check gaps become the next search. The critic already
// named the hole (currently-operating car-centric spots, strip-mall
// speakeasy, current reconfiguring). General (AI Mode) and
// structural (desk) searches both run these before they riff.
export function coherenceGapSearches({ gaps = [], topic = "" } = {}) {
  const clean = (Array.isArray(gaps) ? gaps : [])
    .map((g) => String(g || "").trim())
    .filter(Boolean)
    .slice(0, 4);
  if (!clean.length) return [];
  const hook = String(topic || "").trim() || "Black New Jersey gathering";
  const hay = clean.join(" ").toLowerCase();
  const out = clean.map((gap) => `${gap} New Jersey`);
  if (/current|operating|reconfigur/.test(hay)) {
    out.push(`${hook} currently operating New Jersey gathering spot 2025 2026`);
  }
  if (/speakeasy|strip mall|strip-mall/.test(hay)) {
    out.push("strip mall speakeasy New Jersey currently open");
  }
  if (/historic|historical|too historical/.test(hay)) {
    out.push(`${hook} living remnant currently open New Jersey not closed archive`);
  }
  return out.filter((q, i, all) => all.indexOf(q) === i).slice(0, 8);
}

export function coherenceGapPromptLines({ gaps = [], reason = "" } = {}) {
  const clean = (Array.isArray(gaps) ? gaps : [])
    .map((g) => String(g || "").trim())
    .filter(Boolean)
    .slice(0, 4);
  if (!clean.length) return [];
  return [
    "CLOSE THESE GAPS — the argument check already named what's missing. Hunt these before anything else. Do not add another historical statute if the hole is a living Saturday.",
    ...clean.map((gap) => `- ${gap}`),
    String(reason || "").trim() ? `Check reason: ${String(reason).trim().slice(0, 400)}` : "",
  ].filter(Boolean);
}

// How you learn the field without already being in it: hunt the
// COLUMN and the PAGE inside Black New Jersey, then the influence
// chain that left the state. Opinion and news that argue count.
// An adjacent NYC weekender calendar does not.
export function lensDiscoveryQueries({ cluster = "", topic = "", subjectFacets = [] } = {}) {
  const hook = String(topic || "").trim() || "Black New Jersey gathering";
  const key = String(cluster || "").toUpperCase().replace(/\s+/g, "_");
  const facetsOn = Array.isArray(subjectFacets) && subjectFacets.some((id) => String(id || "").trim());
  const base = [
    `${hook} Black New Jersey opinion OR op-ed OR column site:echonewstv.com OR site:blackinjersey.com OR site:njurbannews.com -njpac -essence`,
    `${hook} "NJ Uncovered" OR njuncovered OR "nj.uncovered" Facebook OR Instagram OR YouTube New Jersey`,
    `${hook} influenced OR influence OR "came from" OR "spread to" New Jersey Baltimore Philadelphia "New York" national`,
    `${hook} New Jersey currently operating place OR program OR Saturday -njpac -essence`,
    `${hook} oral history OR "African American Studies" site:rutgers.edu OR site:montclair.edu OR site:princeton.edu`,
  ];
  const byCluster = {
    STATE_SONIC_HISTORY: [
      "Jersey club Baltimore club Newark influence oral history TheJerzClub",
      "Club Zanzibar Newark house music national influence",
    ],
    NIGHTLIFE_DILEMMA: [
      "Newark nightlife opinion column closure site:nj.com OR site:jerseydigs.com",
      "Jersey City club curfew commentary national nightlife trend",
    ],
    DIASPORA_INFRASTRUCTURE: [
      "Newark Caribbean African American hall opinion column New Jersey",
      "Newark Jersey City cultural hall currently operating New Jersey",
    ],
    SUBURBAN_THIRD_PLACE: [
      "New Jersey Black suburban gathering opinion column national third place",
      "who is the Transit Village downtown retrofit for Black New Jersey",
    ],
    PHILOSOPHY_OF_GATHERING: [
      "Black New Jersey cultural memory opinion column national norm",
    ],
    DIGITAL_NETWORKS: [
      "New Jersey Black culture TikTok national trend influence",
    ],
    DAYTIME_PLAY: [
      "Newark daytime gathering opinion column New Jersey",
    ],
  };
  return [...base, ...(facetsOn ? (byCluster[key] || []) : [])].slice(0, 6);
}

export function sourceDoctrineForPrompt() {
  return [
    "SOURCE DOCTRINE — the operator is systematizing Black New Jersey culture without a journalism degree. The desks teach the field. Do not require a famous critic. Require a New Jersey argument you can point at.",
    "DESK A / OFFICIAL: statute, municipal clerk, ABC, census, library catalog, university archive, ownership record. KEEP the bureaucratic language. Gemini will cook; you will not pre-chew a statute into a vibe.",
    "DESK B / ARGUMENT: Black New Jersey press, local opinion, university pages, and independent pages that already asked a Black-NJ question. Echo (oldest Black-owned NJ paper), Front Runner (South Jersey), Five Wards and Public Square (Newark), The Positive Community (Montclair), West Ward Beans, NJ Urban News, Black In Jersey, Anointed (Camden), NJ Uncovered (Facebook / YouTube / Instagram — hunt the PAGE, not a hall site). These count even when they are not the best writing. A Rutgers oral history or an Echo column is how you learn the field. That is not NJPAC season copy and not Essence lifestyle recap. Seed Instagram/Substack/YouTube pages are starting points, not canon. News pages are also how you notice the NEXT question, not only how you source this one.",
    "ALTITUDE / SOCIETY: Current Affairs and pages like it are allowed for pop-culture and societal understanding ONLY when THIS desk already named a reusable trick to learn. Same class as Pop Culture Detective. They are not the specimen and not the place. Do not hunt a MECHANISM, an access illusion, or their subject (a Ben Shapiro movie, a campus case) as the CGE piece. If you land a trick, land it on a Black-NJ room, corridor, or disappearance already on the desk.",
    "INFLUENCE TRAVELS. A lot of these conversations go beyond Jersey walls. Hunt what influenced what: Baltimore club → Jersey club, a national digital trend flattening a Newark room, a Caribbean circuit that does not stop at the Hudson, a country-wide norm this NJ gathering is an instance of. The JOIN may name Baltimore, Philly, NYC, Atlanta, or a national pattern when it is the chain. A Brooklyn weekender calendar is still the wrong subject. A piece that never lands back in New Jersey is the wrong piece.",
    "THE SPECIMEN AND THE DOOR ARE BLACK NEW JERSEY. The pattern and the join may be regional or national. A sentence that never names New Jersey is the wrong sentence. A sentence that only names New Jersey and pretends the trend was born in a vacuum is also the wrong sentence.",
    "LOOK THROUGH leftover local press and apparent halls when the topic would show up there: More Jersey, South Jersey Journal, We Are Jersey Ent, Ark Republic, Shelterforce, Trenton Journal, Jewel Justice, fayemi, ENVERT, Hassan Ghanny — those ARE argument if they asked the question. NJPAC, WBGO, NJ Monthly, Essence, The Root, The Grio, Okayplayer, a museum, NYT/WaPo — open them when they are apparent. They may confirm a door, a date, or that a night existed. They cannot authorize the new question.",
    "Do NOT treat Timeout, Yelp, TripAdvisor, Eventbrite listicles, NJPAC season copy, Essence/The Root recaps, WBGO program notes, or museum wall text as the argument. They may confirm a door is open. They cannot authorize the new question. Prefer opinion / column / commentary over listings.",
    "Hunt the COLUMN, the PERSON, the PAGE, and the UNIVERSITY holding (oral history, AAS, Institute of Jazz Studies). If the first result is a hall, a national magazine, or a Brooklyn weekender, keep searching.",
    "Name the source class on each fact when you can: (OFFICIAL — nj.gov), (CULTURAL — blackinjersey.com), (PRESS — essence.com).",
    "A claim that only exists on an unranked listicle is UNCONFIRMED, not a document.",
  ].join(" ");
}
