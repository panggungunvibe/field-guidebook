// Matching/ranking follows Deimos public modules 57467 and 55391.
// FRIM fields replace the original topic descriptions; ranking stays intact.
export function normalizeSearchText(value) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function searchSlug(value) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

export function rankSearchTopics(topics, query) {
  const normalized = normalizeSearchText(query);
  if (!normalized) return { matches: [], exactMatch: null };
  const slug = searchSlug(query), terms = normalized.split(" ");
  let exactMatch = null;
  const ranked = [];
  for (const topic of topics) {
    const title = normalizeSearchText(topic.title);
    const exact = title === normalized || Boolean(slug) && topic.slug === slug;
    if (exact && !exactMatch) exactMatch = topic;
    const searchable = `${title} ${normalizeSearchText(topic.description ?? "")}`;
    const rank = exact ? 0
      : title.startsWith(normalized) ? 1
      : title.includes(normalized) ? 2
      : terms.every((term) => title.includes(term)) ? 3
      : terms.every((term) => searchable.includes(term)) ? 4 : -1;
    if (rank >= 0) ranked.push({ topic, rank });
  }
  ranked.sort((a, b) => a.rank - b.rank || a.topic.title.localeCompare(b.topic.title, "en") || a.topic.slug.localeCompare(b.topic.slug, "en"));
  return { matches: ranked.map(({ topic }) => topic), exactMatch };
}

export function plantSearchDescription(plant) {
  return [plant.english, plant.scientific, plant.kicker, ...(plant.categories || []), plant.lookFor].filter((value) => typeof value === "string" && value.length > 0).join(" ");
}

export function searchPlants(plants, query) {
  const topics = plants.map((plant) => ({ plant, slug: plant.slug, title: plant.title, description: plantSearchDescription(plant) }));
  const result = rankSearchTopics(topics, query);
  return { matches: result.matches.map(({ plant }) => plant), exactMatch: result.exactMatch?.plant ?? null };
}

// The original gallery keeps its supplied order for an empty/whitespace query.
// A nonempty punctuation-only query still enters search and returns no matches.
export function filterPlants(plants, query) {
  return query.trim() ? searchPlants(plants, query).matches : plants;
}
