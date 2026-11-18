// Reader provenance is an explicit data relationship, never inferred from a
// bibliography. Current FRIM records contain entry-level sources only, so they
// create contextualSourceIds and no sentence evidence or citation superscripts.
// Future book.provenance data may supply:
// { evidence: [{id, sourceId, quote, tier?, verification?, retrievedAt?}],
//   passages: {"overview:0:0": {evidenceIds: [], contextualSourceIds: []}} }
// sourceId accepts a source's explicit id or URL. A mapped evidence record must
// have an existing source and a nonempty recorded quote. No quote is synthesized.

function sourceKey(url) {
  let value = 2166136261;
  for (const character of url) value = Math.imul(value ^ character.codePointAt(0), 16777619);
  return `source-${(value >>> 0).toString(36)}`;
}

function sentences(text) {
  return String(text ?? "").split("\n\n").map((paragraph) => paragraph.match(/[^。！？!?]+[。！？!?]*/g) || [paragraph]);
}

function unique(values) {
  return [...new Set(values)];
}

export function createProvenanceModel(book) {
  const sourceById = new Map();
  const sourceIdByURL = new Map();
  const sourceAliases = new Map();
  const sources = [];
  for (const original of book.sources || []) {
    if (!original || typeof original.url !== "string" || !original.url.trim()) continue;
    const url = original.url.trim();
    const existing = sourceIdByURL.get(url);
    if (existing) {
      if (original.id) sourceAliases.set(original.id, existing);
      continue;
    }
    let id = String(original.id || sourceKey(url));
    while (sourceById.has(id)) id += "-source";
    let domain = "";
    try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch { /* Keep the recorded URL without inventing its domain. */ }
    const source = Object.freeze({ ...original, id, url, domain, number: sources.length + 1 });
    sources.push(source);
    sourceById.set(id, source);
    sourceIdByURL.set(url, id);
    sourceAliases.set(id, id);
    sourceAliases.set(url, id);
  }

  const evidenceById = new Map();
  for (const original of book.provenance?.evidence || []) {
    if (!original || typeof original.id !== "string" || !original.id || evidenceById.has(original.id)) continue;
    const sourceId = sourceAliases.get(original.sourceId);
    if (!sourceId || typeof original.quote !== "string" || !original.quote.trim()) continue;
    evidenceById.set(original.id, Object.freeze({ ...original, sourceId, quote: original.quote }));
  }

  const passageById = new Map();
  const allSourceIds = sources.map((source) => source.id);
  const mappings = book.provenance?.passages || {};
  const addPassage = (key, text, kind, number) => {
    const id = `${book.slug}:${key}`;
    const configured = mappings[id] || mappings[key] || {};
    const evidenceIds = unique((Array.isArray(configured.evidenceIds) ? configured.evidenceIds : []).filter((entry) => evidenceById.has(entry)));
    const contextualSourceIds = unique((Array.isArray(configured.contextualSourceIds) ? configured.contextualSourceIds : allSourceIds).map((entry) => sourceAliases.get(entry)).filter(Boolean));
    const passage = Object.freeze({ id, key, text: String(text ?? ""), kind, number, evidenceIds, contextualSourceIds });
    passageById.set(id, passage);
    return passage;
  };

  let sentenceNumber = 0;
  const prose = {};
  const addProse = (key, text) => {
    prose[key] = sentences(text).map((paragraph, paragraphIndex) => paragraph.map((text, sentenceIndex) => addPassage(`${key}:${paragraphIndex}:${sentenceIndex}`, text, "sentence", ++sentenceNumber)));
  };
  addProse("overview", book.overview);
  (book.sections || []).forEach((text, index) => addProse(`section-${index + 1}`, text));
  const facts = [
    ["scientific", book.scientific],
    ["confidence", book.confidence],
    ["look-for", book.lookFor],
  ].map(([key, text], index) => addPassage(`fact:${key}`, text, "fact", index + 1));
  const observations = book.observation.items.map((item, index) => addPassage(`observation:${index + 1}`, `${item.text}\n${item.cue.label}：${item.cue.text}`, "observation", index + 1));

  return {
    sources, sourceById, evidenceById, passageById, prose, facts, observations,
    citationNumbers(passage) {
      return unique(passage.evidenceIds.map((id) => sourceById.get(evidenceById.get(id)?.sourceId)?.number).filter(Number.isInteger)).sort((a, b) => a - b);
    },
    evidenceFor(passage) { return passage.evidenceIds.map((id) => evidenceById.get(id)).filter(Boolean); },
    contextualSourcesFor(passage) { return passage.contextualSourceIds.map((id) => sourceById.get(id)).filter(Boolean); },
  };
}
