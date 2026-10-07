// Subject lock — named sub-versions of a cluster and corridor.
//
// Cluster + corridor were too coarse. Fuel Research invented
// intersections (Sunken Silo + liquor cap + Afrobeats) because the
// operator had no way to say "this piece is the parking-lot brewery
// on Route 22, not the rest of Suburban Third-Place mashed together."
//
// Empty picks keep today's whole-cluster / whole-corridor behavior.
// Picked facets/locales become the SUBJECT LOCK that thesis, hook,
// Fuel Research, and the fill seed all have to honor.
//
// Caps: 1–3 cluster facets, 0–3 corridor locales, 0–1 join facet
// from another cluster. Changing cluster/corridor sanitizes stale ids.

import { resolveClusterKey, CONTENT_CLUSTERS } from "./matrixCompass.js";

export const CLUSTER_SHORT = {
  SUBURBAN_THIRD_PLACE: "Suburban",
  DIASPORA_INFRASTRUCTURE: "Diaspora",
  NIGHTLIFE_DILEMMA: "Nightlife",
  DAYTIME_PLAY: "Daytime",
  GATHERING_LOGISTICS: "Logistics",
  REGIONAL_DEMOGRAPHICS: "Demographics",
  STATE_SONIC_HISTORY: "History",
  POLICY_MECHANICS: "Policy",
  DIGITAL_NETWORKS: "Digital",
  PHILOSOPHY_OF_GATHERING: "Philosophy",
};

export const CLUSTER_FACETS = {
  SUBURBAN_THIRD_PLACE: [
    { id: "parking-lot-brewery", label: "Parking-lot brewery", search: "New Jersey parking lot brewery community hub suburban", hint: "The taproom that became the town square by accident" },
    { id: "strip-mall-speakeasy", label: "Strip-mall speakeasy", search: "New Jersey strip mall speakeasy hidden bar Route 22", hint: "A room behind a plaza, not a downtown" },
    { id: "accidental-cafe", label: "Accidental cafe", search: "New Jersey cafe after hours mixer takeover suburban", hint: "Daytime coffee that hosts the night" },
    { id: "downtown-retrofit", label: "Downtown retrofit", search: "New Jersey Transit Village downtown retrofit walkable Cranford", hint: "A town that rebuilt a walkable core" },
    { id: "walkable-vs-strip", label: "Walkable vs strip", search: "New Jersey walkable downtown vs Route 22 commercial strip gathering", hint: "The contrast the brief has to name" },
  ],
  DIASPORA_INFRASTRUCTURE: [
    { id: "afrobeats-corridor", label: "Afrobeats corridor", search: "Afrobeats Amapiano residency New Jersey Newark Irvington", hint: "Who actually owns the sound systems" },
    { id: "owns-vs-programs", label: "Owns vs programs", search: "who owns versus who programs Newark Jersey City nightlife diaspora", hint: "The room is full — who holds the lease" },
    { id: "same-city-diasporas", label: "Same-city diasporas", search: "African American Caribbean West African scenes same city Newark New Jersey", hint: "Three scenes, one ZIP, not always one room" },
    { id: "memory-transfer", label: "Memory transfer", search: "second generation cultural hall New Jersey kids do not inherit", hint: "The hall still opens; the memory does not automatically transfer" },
    { id: "newark-jc-pipeline", label: "Newark–JC pipeline", search: "Newark Jersey City creative pipeline independent scene diaspora", hint: "The independent scene outside Manhattan's shadow" },
  ],
  NIGHTLIFE_DILEMMA: [
    { id: "mega-club-collapse", label: "Mega-club collapse", search: "Newark Jersey City nightclub closure mega club bottle service", hint: "Cavernous rooms closing, not a generic party beat" },
    { id: "hi-fi-listening", label: "Hi-fi listening", search: "hi-fi vinyl listening bar New Jersey intimate 150 capacity", hint: "Low-volume rooms replacing checkout nightlife" },
    { id: "bottle-service-fatigue", label: "Bottle-service fatigue", search: "bottle service fatigue New Jersey nightlife 150 cap room", hint: "The checkout line that used to be the night" },
    { id: "early-curfew", label: "Early curfew", search: "Jersey City Newark nightclub curfew ordinance last call", hint: "The clock that authors the scene" },
  ],
  DAYTIME_PLAY: [
    { id: "adult-field-day", label: "Adult field day", search: "adult field day New Jersey grown professional relay race", hint: "Paying to touch grass together" },
    { id: "run-club", label: "Run club", search: "run club New Jersey social hub replaced dating app 5K", hint: "The weekly 5K that replaced Hinge" },
    { id: "roller-rink", label: "Roller rink", search: "roller rink New Jersey adult night historic recreation", hint: "Kinetic rooms that are not a bar" },
    { id: "sober-social", label: "Sober social", search: "sober curious social New Jersey daytime gathering no alcohol", hint: "The parallel nightlife without the pour" },
  ],
  GATHERING_LOGISTICS: [
    { id: "venue-splits", label: "Venue splits", search: "New Jersey venue rental split independent promoter gathering", hint: "The math the crowd never sees" },
    { id: "food-truck-routing", label: "Food-truck routing", search: "New Jersey food truck coordination outdoor gathering permit", hint: "Who feeds the field" },
    { id: "rain-contingency", label: "Rain contingency", search: "New Jersey outdoor event rain contingency park permit", hint: "Weather as an operator problem" },
    { id: "permit-red-tape", label: "Permit red tape", search: "New Jersey special events permit fee municipal gathering", hint: "The clerk, not the vibe" },
    { id: "door-economics", label: "Door economics", search: "New Jersey door split occupancy load independent night", hint: "Cover, cap, and who gets paid" },
  ],
  REGIONAL_DEMOGRAPHICS: [
    { id: "reverse-commute", label: "Reverse commute", search: "NJ Transit reverse commute ridership culture who shows up", hint: "Who is traveling against the rush" },
    { id: "transit-village-gentrification", label: "Transit-village gentrification", search: "New Jersey Transit Village gentrification demographics who the downtown is for", hint: "Who the retrofit is actually for" },
    { id: "suburban-brain-drain", label: "Suburban brain drain", search: "New Jersey suburban brain drain young professionals leave hometown", hint: "The weekend that empties the town" },
    { id: "rail-habits", label: "Rail habits", search: "NJ Transit rail habits weekend gathering last train culture", hint: "The last inbound as a social clock" },
  ],
  STATE_SONIC_HISTORY: [
    { id: "club-zanzibar", label: "Club Zanzibar", search: "Club Zanzibar Newark Lincoln Motel Jersey Sound Paradise Garage", hint: "The motel ballroom that authored a sound" },
    { id: "preserved-vs-performed", label: "Preserved vs performed", search: "New Jersey historic venue preserved lineage versus aesthetic rental", hint: "Keeping a lineage vs renting the look" },
    { id: "motel-ballrooms", label: "Motel ballrooms", search: "New Jersey motel ballroom house music unmarked warehouse history", hint: "Rooms that never made the tourism map" },
  ],
  POLICY_MECHANICS: [
    { id: "liquor-cap", label: "Liquor cap", search: "N.J.S.A. liquor license one per 3,000 New Jersey ABC", hint: "The 1:3,000 quota that shapes every room" },
    { id: "home-rule", label: "Home rule", search: "New Jersey home rule 564 municipalities noise parking permit", hint: "564 towns, 564 rulebooks" },
    { id: "zoning-curfew", label: "Zoning / curfew", search: "New Jersey zoning curfew ordinance nightlife assembly occupancy", hint: "The ordinance doing the architecture" },
  ],
  DIGITAL_NETWORKS: [
    { id: "algorithmic-ticketing", label: "Algorithmic ticketing", search: "algorithmic ticketing queue independent New Jersey promoter", hint: "Who the queue lets in" },
    { id: "flyer-death", label: "Flyer death", search: "street flyer dead WhatsApp Telegram New Jersey nightlife", hint: "The channel that replaced the pole" },
    { id: "private-group-chats", label: "Private group chats", search: "private WhatsApp Telegram community New Jersey event ticket", hint: "Referral, not press" },
    { id: "operator-automation", label: "Operator automation", search: "independent operator automation ticketing New Jersey small venue", hint: "The spreadsheet behind the door" },
  ],
  PHILOSOPHY_OF_GATHERING: [
    { id: "third-place-void", label: "Third-place void", search: "Ray Oldenburg third place New Jersey suburb home work only", hint: "Home and work covered; the third place missing" },
    { id: "social-friction", label: "Social friction", search: "social friction suburban New Jersey gathering cost of going out", hint: "The cost of being outside" },
    { id: "propinquity", label: "Propinquity", search: "propinquity effect New Jersey transit village who you actually see", hint: "Who you bump into because of geography" },
  ],
};

export const CORRIDOR_LOCALES = {
  "Urban / Commuter Core": [
    { id: "newark", label: "Newark", search: "Newark New Jersey gathering nightlife downtown Ironbound", hint: "Newark · Essex" },
    { id: "jersey-city", label: "Jersey City", search: "Jersey City nightlife curfew gathering downtown", hint: "Jersey City · Hudson" },
    { id: "ironbound", label: "Ironbound", search: "Ironbound Newark restaurants nightlife gathering", hint: "Ironbound, Newark" },
  ],
  "Route 1 Central Crossroads": [
    { id: "route-1", label: "Route 1", search: "Route 1 New Jersey commercial strip gathering Middlesex", hint: "Route 1 · Middlesex / Mercer belt" },
    { id: "route-22", label: "Route 22", search: "Route 22 New Jersey strip mall brewery parking lot gathering", hint: "Route 22" },
    { id: "industrial-plazas", label: "Industrial plazas", search: "New Jersey industrial plaza brewery warehouse gathering Central Jersey", hint: "Central Jersey industrial plazas" },
    { id: "new-brunswick", label: "New Brunswick", search: "New Brunswick New Jersey downtown gathering nightlife", hint: "New Brunswick · Middlesex" },
  ],
  "Transit Village Suburbs": [
    { id: "cranford", label: "Cranford", search: "Cranford NJ Transit Village downtown retrofit walkable", hint: "Cranford · Union" },
    { id: "morristown", label: "Morristown", search: "Morristown NJ downtown gathering Transit Village", hint: "Morristown · Morris" },
    { id: "westfield", label: "Westfield", search: "Westfield NJ downtown gathering walkable Transit Village", hint: "Westfield · Union" },
    { id: "moorestown", label: "Moorestown", search: "Moorestown NJ downtown gathering South Jersey Transit Village", hint: "Moorestown · Burlington" },
  ],
  "Shore / Southern Arteries": [
    { id: "asbury-park", label: "Asbury Park", search: "Asbury Park New Jersey gathering nightlife downtown", hint: "Asbury Park · Monmouth" },
    { id: "atlantic-city", label: "Atlantic City", search: "Atlantic City New Jersey gathering nightlife beyond casino", hint: "Atlantic City · Atlantic" },
    { id: "parkway-towns", label: "Parkway towns", search: "Garden State Parkway New Jersey shore town gathering summer", hint: "Garden State Parkway towns" },
    { id: "wildwood", label: "Wildwood", search: "Wildwood New Jersey boardwalk gathering nightlife", hint: "Wildwood · Cape May" },
  ],
  "Decentralized Borderlands": [
    { id: "pa-line", label: "PA line", search: "New Jersey Pennsylvania border gathering Hunterdon Warren", hint: "NJ–PA line · Hunterdon / Warren" },
    { id: "ny-line", label: "NY line", search: "New Jersey New York border gathering Bergen Rockland", hint: "NJ–NY line · Bergen" },
    { id: "hunterdon", label: "Hunterdon", search: "Hunterdon County New Jersey gathering downtown rural", hint: "Hunterdon County" },
    { id: "warren", label: "Warren", search: "Warren County New Jersey gathering downtown rural", hint: "Warren County" },
  ],
};

const FACET_INDEX = new Map();
for (const [clusterKey, facets] of Object.entries(CLUSTER_FACETS)) {
  for (const facet of facets) {
    FACET_INDEX.set(facet.id, { ...facet, cluster: clusterKey });
  }
}

function normalizeIds(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const id = String(item || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function getFacet(id) {
  return FACET_INDEX.get(String(id || "").trim()) || null;
}

export function getLocale(corridor, id) {
  const list = CORRIDOR_LOCALES[corridor] || [];
  return list.find((l) => l.id === id) || null;
}

export function facetsForCluster(cluster) {
  const key = resolveClusterKey(cluster);
  return key ? (CLUSTER_FACETS[key] || []) : [];
}

export function localesForCorridor(corridor) {
  const name = String(corridor || "").trim();
  return CORRIDOR_LOCALES[name] || [];
}

export function joinFacetOptions(cluster) {
  const current = resolveClusterKey(cluster);
  const out = [];
  for (const [key, facets] of Object.entries(CLUSTER_FACETS)) {
    if (key === current) continue;
    const short = CLUSTER_SHORT[key] || key;
    for (const facet of facets) {
      out.push({
        ...facet,
        cluster: key,
        clusterLabel: CONTENT_CLUSTERS[key]?.label || key,
        joinLabel: `${short} · ${facet.label}`,
      });
    }
  }
  return out;
}

export function sanitizeSubjectLock({
  cluster,
  corridor,
  subjectFacets,
  corridorLocales,
  joinFacet,
  facetsMax = 3,
  localesMax = 3,
} = {}) {
  const clusterKey = resolveClusterKey(cluster);
  const allowedFacet = new Set((CLUSTER_FACETS[clusterKey] || []).map((f) => f.id));
  const allowedLocale = new Set((CORRIDOR_LOCALES[String(corridor || "").trim()] || []).map((l) => l.id));

  const subject_facets = normalizeIds(subjectFacets)
    .filter((id) => allowedFacet.has(id))
    .slice(0, facetsMax);

  const corridor_locales = normalizeIds(corridorLocales)
    .filter((id) => allowedLocale.has(id))
    .slice(0, localesMax);

  const joinId = String(joinFacet || "").trim();
  const join = getFacet(joinId);
  const join_facet = join && join.cluster !== clusterKey ? join.id : "";

  return { subject_facets, corridor_locales, join_facet };
}

function englishList(labels) {
  if (!labels.length) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

// Facet lock is the LABEL only. Catalog spends (Oldenburg, "cost of
// being outside") live on hover so they cannot beat Narrowing / Hook /
// POV. Locales never enter this string — places are context, not a lens.
export function lockLensDirective(lock) {
  if (!lock || !Array.isArray(lock.facets) || lock.facets.length === 0) return "";
  const focus = lock.facets.map((f) => f.label);
  const siblingLabels = (CLUSTER_FACETS[lock.clusterKey] || [])
    .filter((f) => !lock.facets.some((sel) => sel.id === f.id))
    .map((f) => f.label.toLowerCase());
  const leaveBit = siblingLabels.length
    ? ` Leave ${englishList(siblingLabels)} off this piece unless JOIN names them.`
    : " Do not widen past this lock.";
  const joinBit = lock.join ? ` Joined only to ${lock.join.label}.` : "";
  return `This piece is locked to ${englishList(focus)}. Ground here. Do not recite the rest of the cluster syllabus.${leaveBit}${joinBit}`;
}

export function buildSubjectLock({
  cluster,
  corridor,
  subjectFacets,
  corridorLocales,
  joinFacet,
} = {}) {
  const clean = sanitizeSubjectLock({
    cluster,
    corridor,
    subjectFacets,
    corridorLocales,
    joinFacet,
  });
  const clusterKey = resolveClusterKey(cluster);
  const facets = clean.subject_facets.map((id) => getFacet(id)).filter(Boolean);
  const locales = clean.corridor_locales
    .map((id) => getLocale(corridor, id))
    .filter(Boolean);
  const join = clean.join_facet ? getFacet(clean.join_facet) : null;
  const empty = facets.length === 0 && locales.length === 0 && !join;
  const summaryParts = [
    ...facets.map((f) => f.label),
    ...locales.map((l) => l.label),
    ...(join ? [`joined to ${join.label}`] : []),
  ];
  const summary = summaryParts.join(" · ");

  let composeClause = "";
  if (!empty) {
    const place = locales.length ? englishList(locales.map((l) => l.label)) : "";
    const joinBit = join
      ? ` Joined only to ${join.label} — that is the only permitted intersection.`
      : (facets.length ? " Do not mash overlapping topics from the rest of the cluster." : "");
    if (facets.length) {
      const facetBit = `stays on ${englishList(facets.map((f) => f.label.toLowerCase()))}`;
      const localeBit = place ? ` in ${place} (place context only)` : "";
      composeClause = `This piece ${facetBit}${localeBit}.${joinBit}`;
    } else {
      composeClause = `This piece is set in ${place} (place context only — not a story spend).${joinBit}`;
    }
  }

  const searches = [
    ...facets.map((f) => f.search),
    ...locales.map((l) => l.search),
    ...(join ? [join.search] : []),
  ].filter(Boolean);

  return {
    empty,
    clusterKey,
    clusterLabel: clusterKey ? (CONTENT_CLUSTERS[clusterKey]?.label || clusterKey) : "",
    facets,
    locales,
    join: join
      ? { ...join, clusterLabel: CONTENT_CLUSTERS[join.cluster]?.label || join.cluster }
      : null,
    summary,
    composeClause,
    searches,
    snapshot: {
      facets: [...clean.subject_facets].sort(),
      locales: [...clean.corridor_locales].sort(),
      join: clean.join_facet || "",
    },
    fields: clean,
  };
}

export function subjectLockPromptLines(lock) {
  if (!lock || lock.empty) return [];
  const lines = [
    "SUBJECT LOCK — the operator picked the sub-version. Stay on it. Do not mash the rest of the cluster into this piece.",
  ];
  if (lock.facets.length) {
    lines.push(`Locked cluster facets: ${lock.facets.map((f) => f.label).join("; ")}.`);
  } else {
    lines.push("Locked cluster facets: (none — the whole cluster is in play, still honor locales/join if set).");
  }
  if (lock.locales.length) {
    lines.push(`Geography context (not a story spend): ${lock.locales.map((l) => l.label).join("; ")}. Search these places; do not turn the town into the thesis.`);
  }
  if (lock.join) {
    lines.push(`JOIN (the only permitted intersection with another cluster): ${lock.join.label} from ${lock.join.clusterLabel}.`);
  } else {
    lines.push("JOIN: none. Do not invent an intersection with liquor cap, Afrobeats, hi-fi rooms, or any other cluster facet unless it is already the locked facet.");
  }
  lines.push("If a tempting adjacent story appears (a statute that explains a brewery, a diaspora night that shares a ZIP), leave it out unless JOIN names it.");
  return lines;
}

export function subjectLockInstruction() {
  return "If SUBJECT LOCK is in the user payload, the Analytical lens is the locked facet LABELS — not the cluster syllabus and not the catalog hover line. Operator Narrowing / Hook / POV beat any catalog spend. Locales are geography context only; do not turn a town into the thesis. Do not recite sibling theories from the same cluster. Do not invent an intersection with a different cluster facet unless JOIN names it.";
}
