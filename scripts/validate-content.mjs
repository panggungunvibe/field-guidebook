#!/usr/bin/env node
// Validate the content contracts used by the bundled site, without a build tool.
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const personalized = args.includes('--personalized');
const directories = args.filter(value => value !== '--personalized');
if (directories.length !== 1 || directories[0].startsWith('-')) {
  console.error('Usage: node scripts/validate-content.mjs <project-directory> [--personalized]');
  process.exit(2);
}
const project = path.resolve(directories[0]);
const publicDirectory = path.join(project, 'public');
const errors = [], warnings = [];
const error = message => errors.push(message);
const warning = message => warnings.push(message);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, label, allowEmpty = false) => {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) error(`${label}: expected ${allowEmpty ? 'a string' : 'a nonempty string'}.`);
};
const texts = (value, label, minimum = 1) => {
  if (!Array.isArray(value) || value.length < minimum) { error(`${label}: expected an array with at least ${minimum} item(s).`); return []; }
  value.forEach((entry, index) => text(entry, `${label}[${index}]`));
  return value;
};

async function localResource(value, label, image = false) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000]/u.test(value)) {
    error(`${label}: use a root-relative path inside public/, such as /media/photo.jpg.`); return;
  }
  let pathname;
  try { pathname = decodeURIComponent(value.split(/[?#]/u)[0]); }
  catch { error(`${label}: invalid URL encoding.`); return; }
  const parts = pathname.slice(1).split('/');
  if (!parts.length || parts.some(part => !part || part === '.' || part === '..' || /[\\\u0000]/u.test(part))) {
    error(`${label}: unsafe local path.`); return;
  }
  const filename = path.join(publicDirectory, ...parts);
  try {
    let current = publicDirectory;
    if ((await lstat(current)).isSymbolicLink()) throw Error('public/ is a symbolic link');
    for (const part of parts) {
      current = path.join(current, part);
      if ((await lstat(current)).isSymbolicLink()) throw Error('symbolic links are not supported');
    }
    const resolved = await realpath(filename), publicResolved = await realpath(publicDirectory);
    if (!resolved.startsWith(publicResolved + path.sep) || !(await stat(resolved)).isFile()) throw Error('not a file inside public/');
    if (image && !/\.(?:png|jpe?g|webp|gif|svg|avif|ico)$/iu.test(resolved)) throw Error('unsupported image extension');
  } catch (cause) { error(`${label}: cannot use ${value} (${cause.message}).`); }
}

async function sourceURL(value, label) {
  if (typeof value !== 'string' || !value.trim()) { error(`${label}: expected an HTTP(S) URL or a file in public/.`); return; }
  if (value.startsWith('/')) { await localResource(value, label); return; }
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw Error('unsupported URL');
  } catch { error(`${label}: expected an HTTP(S) URL without credentials, or a file in public/.`); }
}

async function brandURL(value) {
  const label = 'SITE.brand.url';
  if (value === '#' || value === '/') return;
  if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')) {
    try {
      const pathname = decodeURIComponent(value.split(/[?#]/u)[0]);
      if (/[\\\u0000]/u.test(pathname) || pathname.split('/').some(part => part === '.' || part === '..')) throw Error('unsafe path');
      return;
    } catch { error(`${label}: unsafe root-relative path.`); return; }
  }
  await sourceURL(value, label);
}

async function loadModule(name) {
  const filename = path.join(project, name);
  if ((await lstat(filename)).isSymbolicLink()) throw Error(`${name} must not be a symbolic link`);
  return import(pathToFileURL(filename).href);
}

try {
  const [contentModule, observationModule, siteModule] = await Promise.all([
    loadModule('plant-data.js'), loadModule('plant-observations.js'), loadModule('site-config.js'),
  ]);
  const plants = contentModule.PLANTS;
  const observations = observationModule.PLANT_OBSERVATIONS;
  const site = siteModule.SITE ?? siteModule.SITE_CONFIG ?? siteModule.default;
  if (!isRecord(site)) error('site-config.js: export a site configuration object as SITE, SITE_CONFIG, or default.');
  else {
    if (!isRecord(site.brand)) error('SITE.brand: expected a brand configuration object.');
    text(site.brand?.logo, 'SITE.brand.logo', true);
    if (typeof site.brand?.logo === 'string' && site.brand.logo.trim()) await localResource(site.brand.logo, 'SITE.brand.logo', true);
    text(site.brand?.wordmark, 'SITE.brand.wordmark');
    await brandURL(site.brand?.url);
    await localResource(site.favicon, 'SITE.favicon', true);
    texts(site.hero?.titleLines, 'SITE.hero.titleLines');
    const factLabels = texts(site.article?.factLabels, 'SITE.article.factLabels', 3);
    if (factLabels.length !== 3) error('SITE.article.factLabels: exactly three labels are required by the facts panel.');
  }
  if (!Array.isArray(plants) || !plants.length) throw Error('plant-data.js must export a nonempty PLANTS array.');
  if (!isRecord(observations)) throw Error('plant-observations.js must export a PLANT_OBSERVATIONS object.');
  const slugs = new Set();
  for (const [index, plant] of plants.entries()) {
    if (!isRecord(plant)) { error(`PLANTS[${index}]: expected an object.`); continue; }
    const label = `PLANTS[${index}] (${plant.slug || '?'})`;
    if (typeof plant.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(plant.slug)) error(`${label}.slug: use lowercase letters, digits and single hyphens.`);
    if (slugs.has(plant.slug)) error(`${label}.slug: duplicate slug.`);
    slugs.add(plant.slug);
    for (const key of ['number', 'title', 'scientific', 'kicker', 'confidence', 'locate', 'lookFor', 'overview', 'quote', 'quoteNote']) text(plant[key], `${label}.${key}`);
    text(plant.english, `${label}.english`, true);
    if (typeof plant.color !== 'string' || !/^#[a-f\d]{6}$/iu.test(plant.color)) error(`${label}.color: use a six-digit hex color.`);
    texts(plant.categories, `${label}.categories`);
    const titles = texts(plant.sectionTitles, `${label}.sectionTitles`);
    const sections = texts(plant.sections, `${label}.sections`);
    if (titles.length !== sections.length) error(`${label}: sectionTitles and sections must have equal length.`);
    await localResource(plant.image, `${label}.image`, true);
    if (!Array.isArray(plant.plates) || !plant.plates.length) error(`${label}.plates: include at least one image plate.`);
    for (const [plateIndex, plate] of (Array.isArray(plant.plates) ? plant.plates : []).entries()) {
      const plateLabel = `${label}.plates[${plateIndex}]`;
      if (!isRecord(plate)) { error(`${plateLabel}: expected an object.`); continue; }
      await localResource(plate.image, `${plateLabel}.image`, true);
      text(plate.caption, `${plateLabel}.caption`); text(plate.credit, `${plateLabel}.credit`);
      if (plate.ratio !== undefined && (typeof plate.ratio !== 'number' || !Number.isFinite(plate.ratio) || plate.ratio <= 0)) error(`${plateLabel}.ratio: expected a positive number.`);
      if (plate.position !== undefined) text(plate.position, `${plateLabel}.position`);
    }
    if (!Array.isArray(plant.sources)) error(`${label}.sources: expected an array; an empty array is allowed when no sources are available.`);
    for (const [sourceIndex, source] of (Array.isArray(plant.sources) ? plant.sources : []).entries()) {
      const sourceLabel = `${label}.sources[${sourceIndex}]`;
      if (!isRecord(source)) { error(`${sourceLabel}: expected an object.`); continue; }
      text(source.title, `${sourceLabel}.title`); text(source.meta, `${sourceLabel}.meta`, true);
      await sourceURL(source.url, `${sourceLabel}.url`);
    }
    const study = observations[plant.slug];
    if (!isRecord(study)) { error(`${label}: missing matching PLANT_OBSERVATIONS entry.`); continue; }
    if (JSON.stringify(plant.observation) !== JSON.stringify(study)) error(`${label}.observation: must match PLANT_OBSERVATIONS[slug].`);
    text(study.title, `${label}.observation.title`); text(study.intro, `${label}.observation.intro`);
    if (!Array.isArray(study.items) || !study.items.length) error(`${label}.observation.items: include at least one observation.`);
    const usedPhotos = new Set();
    for (const [itemIndex, item] of (Array.isArray(study.items) ? study.items : []).entries()) {
      const itemLabel = `${label}.observation.items[${itemIndex}]`;
      if (!isRecord(item)) { error(`${itemLabel}: expected an object.`); continue; }
      text(item.title, `${itemLabel}.title`); text(item.text, `${itemLabel}.text`);
      text(item.cue?.label, `${itemLabel}.cue.label`); text(item.cue?.text, `${itemLabel}.cue.text`);
      if (!Array.isArray(item.photoIndices)) { error(`${itemLabel}.photoIndices: expected an array (may be empty).`); continue; }
      if (item.photoIndices.length > 2) error(`${itemLabel}.photoIndices: the photo stack supports at most two photographs.`);
      for (const photoIndex of item.photoIndices) {
        if (!Number.isInteger(photoIndex) || photoIndex < 0 || photoIndex >= (plant.plates?.length || 0)) { error(`${itemLabel}.photoIndices: invalid index ${photoIndex}.`); continue; }
        const image = plant.plates[photoIndex]?.image;
        if (usedPhotos.has(image)) error(`${itemLabel}: the same photograph appears more than once in this observation section.`);
        usedPhotos.add(image);
      }
    }
    texts(plant.related, `${label}.related`, 0);
  }
  for (const plant of plants.filter(isRecord)) {
    for (const slug of Array.isArray(plant.related) ? plant.related : []) {
      if (!slugs.has(slug) || slug === plant.slug) error(`${plant.slug}.related: ${slug} must reference a different existing entry.`);
    }
  }
  const unusedObservations = Object.keys(observations).filter(slug => !slugs.has(slug));
  if (unusedObservations.length) warning(`Unused observation records: ${unusedObservations.join(', ')}.`);
  if (personalized) {
    const baselineSlugs = ['kapur-crown-shyness', 'birds-nest-fern', 'wart-fern', 'pride-of-burma', 'red-button-ginger', 'spider-lily', 'peace-lily', 'dragon-scale-fern', 'putat', 'keruing-winged-fruit', 'amaryllidaceae-seed', 'rattan', 'palm-seedling', 'ganoderma', 'moss-lichen', 'buttress-root'];
    const remaining = baselineSlugs.filter(slug => slugs.has(slug));
    if (remaining.length) warning(`Baseline sample slugs remain (${remaining.join(', ')}). Keep them only when relevant to the user's topic.`);
    for (const name of ['site-config.js', 'plant-data.js', 'plant-observations.js']) {
      const contents = await readFile(path.join(project, name), 'utf8');
      if (/\bFRIM\b|frim\.gov\.my|frim-logo|Forest Research Institute Malaysia/u.test(contents)) warning(`${name}: FRIM sample identity or sources remain; review for the replacement topic.`);
    }
  }
  console.log(`Checked ${plants.length} entries and ${Object.keys(observations).length} observation records.`);
} catch (cause) { error(cause.message); }

warnings.forEach(message => console.warn(`WARNING: ${message}`));
errors.forEach(message => console.error(`ERROR: ${message}`));
if (errors.length) {
  console.error(`Content validation failed: ${errors.length} error(s), ${warnings.length} warning(s).`);
  process.exitCode = 1;
} else {
  console.log(`Content validation passed (${warnings.length} warning(s)).`);
}
