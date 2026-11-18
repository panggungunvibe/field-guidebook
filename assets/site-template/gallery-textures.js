import { SITE } from "./site-config.js";

/* Independent Canvas2D cover painter derived from the publicly delivered
   Deimos controller (3rqywqpjh5v1v.js, module 19225). Fronts are always painted
   in 230 × 310 logical units, including the 200 × 280 mobile gallery poses.
   These canvases have no transparent gutter; the GPU renderer owns its atlas.
   Only the content fields below are adapted to the FRIM guide records. */

const LOGICAL_WIDTH = 230;
const LOGICAL_HEIGHT = 310;
const INK = "#171614";
const ATLAS_GUTTER = 64;
const ATLAS_PIXEL_BUDGET = 0x1000000;
const DISPLAY_FALLBACK = '"Geist Serif", "Songti SC", "STSong", "Noto Serif CJK SC", Georgia, serif';
const LABEL_FALLBACK = '"Geist", "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", Arial, sans-serif';

function context(canvas) {
  const result = canvas.getContext("2d");
  if (!result) throw new Error("Gallery textures need a Canvas 2D context");
  return result;
}

function fitText(text, width, measure) {
  const value = String(text ?? "");
  if (measure(value) <= width) return value;
  if (measure("…") > width) return "";
  const letters = Array.from(value);
  while (letters.length && measure(`${letters.join("")}…`) > width) letters.pop();
  return `${letters.join("")}…`;
}

function wrapText(text, width, maximumLines, measure) {
  const lines = [];
  let line = "";
  for (const word of String(text ?? "").trim().split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate) <= width) {
      line = candidate;
      continue;
    }
    if (line) { lines.push(line); line = ""; }
    for (const letter of word) {
      if (line && measure(line + letter) > width) { lines.push(line); line = ""; }
      line += letter;
    }
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, Math.max(0, maximumLines));
  if (shown.length && lines.length > shown.length) {
    const last = shown.length - 1;
    shown[last] = fitText(`${shown[last]}…`, width, measure);
  }
  return shown;
}

function summaryText(text) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= 180) return normalized;
  const prefix = normalized.slice(0, 179);
  const lastSpace = prefix.lastIndexOf(" ");
  return `${prefix.slice(0, lastSpace > 108 ? lastSpace : prefix.length).trimEnd()}…`;
}

function contentFor(book, index) {
  return {
    title: String(book.title ?? ""),
    kicker: String(book.kicker ?? ""),
    number: String(book.number ?? index + 1).padStart(2, "0"),
    color: book.color || "#ededea",
    brand: SITE.brand.bookTitle,
    footer: String(book.scientific ?? SITE.article.photoFallback),
    action: "打开 ↗",
    summary: summaryText(book.overview),
    metadata: [book.scientific, book.confidence].filter(Boolean).map(String),
    imprint: SITE.brand.bookMotto,
  };
}

function paintHeader(ctx, book, width, density, labelFont) {
  ctx.fillStyle = INK;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.font = `${9 * density}px ${labelFont}`;
  const measure = (value) => ctx.measureText(value).width;
  const number = fitText(`Nº ${book.number}`, width - 32 * density - measure(book.brand) - 8 * density, measure);
  ctx.fillText(book.brand, 16 * density, 12 * density);
  ctx.textAlign = "right";
  ctx.fillText(number, width - 16 * density, 12 * density);
  ctx.textAlign = "left";
}

function paintBinding(ctx, height, density) {
  ctx.save();
  ctx.fillStyle = INK;
  for (const [left, width, alpha] of [[0, 2.5, .15], [2.5, 2.5, .07], [6, 1, .1]]) {
    ctx.globalAlpha = alpha;
    ctx.fillRect(left * density, 0, width * density, height);
  }
  ctx.restore();
}

function paintPlaceholder(ctx, width, top, height, opacity) {
  ctx.save();
  const scale = Math.min(width / LOGICAL_WIDTH, height / 180);
  ctx.translate((width - LOGICAL_WIDTH * scale) / 2, top + (height - 180 * scale) / 2);
  ctx.scale(scale, scale);
  ctx.strokeStyle = INK;
  ctx.lineWidth = .8;
  ctx.globalAlpha = .45 * opacity;
  ctx.beginPath();
  ctx.arc(115, 90, 66, 0, Math.PI * 2);
  ctx.moveTo(147, 90);
  ctx.ellipse(115, 90, 32, 66, 0, 0, Math.PI * 2);
  for (const [x, y, dx, dy] of [[49, 90, 132, 0], [59, 55, 112, 0], [59, 125, 112, 0], [115, 24, 0, 132]]) {
    ctx.moveTo(x, y); ctx.lineTo(x + dx, y + dy);
  }
  ctx.stroke();
  ctx.restore();
}

function paintFront(canvas, book, width, height, fonts, photograph, opacity = 1) {
  const ctx = context(canvas);
  const density = Math.min(1, width / LOGICAL_WIDTH, height / LOGICAL_HEIGHT);
  ctx.save();
  try {
    ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.font = `${(book.title.length > 100 ? 20 : 25) * density}px ${fonts.display}`;
    const measure = (value) => ctx.measureText(value).width;
    const fontSize = (book.title.length > 100 ? 20 : 25) * density;
    const lineHeight = fontSize * 1.04;
    const padding = 16 * density;
    const artTop = 35.5 * density;
    const textWidth = width - 2 * padding;
    const textBaseHeight = 81 * density;
    const maxLines = Math.max(1, Math.min(4, Math.floor((height - artTop - 60 * density - textBaseHeight) / lineHeight)));
    const lines = wrapText(book.title, textWidth, maxLines, measure);
    const textTop = height - textBaseHeight - lines.length * lineHeight;
    const artHeight = textTop - artTop;
    const kickerTop = textTop + 12 * density;
    const titleTop = kickerTop + 19.5 * density;
    const ruleTop = titleTop + lines.length * lineHeight + 14 * density;

    ctx.fillStyle = book.color;
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    try {
      ctx.beginPath(); ctx.rect(0, artTop, width, artHeight); ctx.clip();
      const placeholderOpacity = photograph ? 1 - opacity : 1;
      if (placeholderOpacity > 0) paintPlaceholder(ctx, width, artTop, artHeight, placeholderOpacity);
      if (photograph) {
        const cropScale = Math.max(width / photograph.width, artHeight / photograph.height);
        const cropWidth = width / cropScale;
        const cropHeight = artHeight / cropScale;
        ctx.globalCompositeOperation = "multiply";
        ctx.globalAlpha = opacity;
        ctx.filter = "grayscale(1) contrast(1.08)";
        ctx.drawImage(photograph.source, (photograph.width - cropWidth) * .5, (photograph.height - cropHeight) * .3, cropWidth, cropHeight, 0, artTop, width, artHeight);
      }
    } finally { ctx.restore(); }

    paintHeader(ctx, book, width, density, fonts.labels);
    ctx.font = `${9 * density}px ${fonts.labels}`;
    ctx.fillText(fitText(book.kicker, textWidth, measure), padding, kickerTop);
    ctx.font = `${fontSize}px ${fonts.display}`;
    lines.forEach((line, index) => ctx.fillText(line, padding, titleTop + index * lineHeight));
    ctx.strokeStyle = INK;
    ctx.globalAlpha = .2;
    ctx.lineWidth = density;
    ctx.beginPath(); ctx.moveTo(padding, ruleTop); ctx.lineTo(width - padding, ruleTop); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.font = `${9 * density}px ${fonts.labels}`;
    ctx.fillText(fitText(book.footer, textWidth - measure(book.action) - 8 * density, measure), padding, ruleTop + 8 * density);
    ctx.textAlign = "right";
    ctx.fillText(book.action, width - padding, ruleTop + 8 * density);
    paintBinding(ctx, height, density);
  } finally { ctx.restore(); }
}

function paintBack(canvas, book, width, height, fonts) {
  const ctx = context(canvas);
  const density = Math.min(1, width / LOGICAL_WIDTH, height / LOGICAL_HEIGHT);
  const padding = 20 * density;
  const textWidth = width - padding * 2;
  const measure = (value) => ctx.measureText(value).width;
  ctx.save();
  try {
    ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = book.color;
    ctx.fillRect(0, 0, width, height);
    paintHeader(ctx, book, width, density, fonts.labels);
    ctx.font = `${9 * density}px ${fonts.labels}`;
    const imprint = wrapText(book.imprint, textWidth, 2, measure);
    const smallLine = 13.5 * density;
    const imprintTop = height - padding - imprint.length * smallLine;
    const metadataTop = imprintTop - 12 * density - book.metadata.length * smallLine;
    const titleTop = 57.5 * density;
    const fontSize = (book.title.length > 100 ? 22 : 27) * density;
    const titleLine = fontSize * 1.08;
    const summaryLine = 18.6 * density;
    const availableTitle = metadataTop - titleTop - 24 * density - 3 * summaryLine;
    ctx.font = `${fontSize}px ${fonts.display}`;
    const title = wrapText(book.title, textWidth, Math.max(1, Math.min(3, Math.floor(availableTitle / titleLine))), measure);
    title.forEach((line, index) => ctx.fillText(line, padding, titleTop + index * titleLine));
    const summaryTop = titleTop + title.length * titleLine + 12 * density;
    ctx.font = `${12 * density}px ${fonts.labels}`;
    const summary = wrapText(book.summary, textWidth, Math.min(6, Math.floor((metadataTop - 12 * density - summaryTop) / summaryLine)), measure);
    summary.forEach((line, index) => ctx.fillText(line, padding, summaryTop + index * summaryLine));
    ctx.font = `${9 * density}px ${fonts.labels}`;
    book.metadata.forEach((line, index) => ctx.fillText(fitText(line, textWidth, measure), padding, metadataTop + index * smallLine));
    imprint.forEach((line, index) => ctx.fillText(line, padding, imprintTop + index * smallLine));
    paintBinding(ctx, height, density);
  } finally { ctx.restore(); }
}

function backingRatio(width, height, requested, count) {
  const maximum = Math.min(requested, 1.5);
  const fits = (ratio) => {
    const dimension = (value) => 64 * Math.ceil((Math.max(1, Math.round(value * ratio)) + 2 * ATLAS_GUTTER) / 64);
    return dimension(width) * dimension(height) * count * 2 <= ATLAS_PIXEL_BUDGET;
  };
  if (fits(maximum)) return maximum;
  let low = 0, high = maximum;
  for (let step = 0; step < 48; step++) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle; else high = middle;
  }
  return low;
}

function fontFamily(styles, variable, fallback) {
  const candidate = styles.getPropertyValue(variable).trim();
  return candidate && candidate.length <= 512 && !/[;{}\u0000-\u001f]|(?:var|url)\s*\(/i.test(candidate) ? candidate : fallback;
}

function safeImageURL(value) {
  try {
    const url = new URL(value, document.baseURI);
    if (url.username || url.password) return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && url.origin === location.origin)) return null;
    url.hash = "";
    return url.href;
  } catch { return null; }
}

function abortable(promise, signal, releaseLateValue) {
  return new Promise((resolve, reject) => {
    let cancelled = signal.aborted;
    const abort = () => { cancelled = true; reject(signal.reason || new DOMException("Gallery request aborted", "AbortError")); };
    if (cancelled) abort(); else signal.addEventListener("abort", abort, { once: true });
    promise.then((value) => {
      signal.removeEventListener("abort", abort);
      if (cancelled) releaseLateValue?.(value); else resolve(value);
    }, (error) => { signal.removeEventListener("abort", abort); reject(error); });
  });
}

function loadImageElement(url, signal, gpuSafe) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const image = new Image();
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    const detach = () => { image.onload = image.onerror = null; signal.removeEventListener("abort", abort); };
    const close = () => { detach(); image.removeAttribute("src"); };
    const fail = (error) => { close(); reject(error); };
    const abort = () => fail(signal.reason || new DOMException("Gallery image aborted", "AbortError"));
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) { fail(new Error("Gallery image has no pixels")); return; }
      detach();
      resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight, gpuSafe, close });
    };
    image.onerror = () => fail(new Error("Gallery image could not load"));
    signal.addEventListener("abort", abort, { once: true });
    try { image.src = url; } catch (error) { fail(error); }
  });
}

async function decodeBlob(blob, signal) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await abortable(createImageBitmap(blob), signal, (late) => late.close());
      if (!bitmap.width || !bitmap.height) { bitmap.close(); throw new Error("Gallery bitmap has no pixels"); }
      return { source: bitmap, width: bitmap.width, height: bitmap.height, gpuSafe: true, close: () => bitmap.close() };
    } catch (error) { if (signal.aborted) throw error; }
  }
  const url = URL.createObjectURL(blob);
  try {
    const loaded = await loadImageElement(url, signal, true);
    return { ...loaded, close() { loaded.close(); URL.revokeObjectURL(url); } };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

async function loadPhotograph(url, parentSignal) {
  const request = new AbortController();
  const abort = () => request.abort(parentSignal.reason);
  if (parentSignal.aborted) abort(); else parentSignal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => request.abort(new Error("Gallery cover timed out")), 8000);
  try {
    let response;
    try { response = await fetch(url, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", signal: request.signal }); }
    catch (error) {
      if (request.signal.aborted) throw error;
      return await loadImageElement(url, request.signal, false);
    }
    if (!response.ok || response.type === "opaque" || (response.url && !safeImageURL(response.url))) throw new Error(`Gallery cover response rejected (${response.status})`);
    return await decodeBlob(await abortable(response.blob(), request.signal), request.signal);
  } finally { clearTimeout(timeout); parentSignal.removeEventListener("abort", abort); }
}

/** Front/back canvases are immediately available with the source globe fallback.
 * ready resolves after font loading and the four-worker photo queue. Every paint
 * increments versions[index] and notifies subscribers with that index. */
export function createGalleryTextures(books, options = {}) {
  if (typeof document === "undefined") throw new Error("Gallery textures are browser-only");
  const width = options.width ?? LOGICAL_WIDTH;
  const height = options.height ?? LOGICAL_HEIGHT;
  const requestedRatio = options.ratio ?? 1.5;
  if (![width, height].every((value) => Number.isFinite(value) && value > 0 && value <= 4096)) throw new RangeError("Gallery texture dimensions must be positive and at most 4096 logical pixels");
  if (!Number.isFinite(requestedRatio) || requestedRatio <= 0) throw new RangeError("Gallery backing ratio must be positive");
  const records = books.slice(0, 40);
  const ratio = backingRatio(width, height, requestedRatio, records.length);
  const styles = getComputedStyle(document.documentElement);
  const fonts = {
    display: fontFamily(styles, "--serif", DISPLAY_FALLBACK),
    labels: fontFamily(styles, "--sans", LABEL_FALLBACK),
  };
  const makeCanvas = options.canvasFactory || (() => document.createElement("canvas"));
  const fronts = [], backs = [], versions = records.map(() => 0);
  const contents = records.map(contentFor);
  const indices = new Map(records.map((book, index) => [book.slug, index]));
  const listeners = new Set();
  const controller = new AbortController();
  let disposed = false;
  let failedPhotos = 0;
  let gpuSafe = true;
  const callbacks = new Set([options.onChange, options.onUpdate].filter((value) => typeof value === "function"));
  const notify = (index) => {
    if (disposed) return;
    versions[index]++;
    for (const listener of [...callbacks, ...listeners]) {
      try { listener(index); } catch (error) { console.error("Gallery texture update callback failed", error); }
    }
  };

  try {
    contents.forEach((book) => {
      const front = makeCanvas(), back = makeCanvas();
      fronts.push(front); backs.push(back);
      front.width = back.width = Math.max(1, Math.round(width * ratio));
      front.height = back.height = Math.max(1, Math.round(height * ratio));
      paintFront(front, book, width, height, fonts);
      paintBack(back, book, width, height, fonts);
    });
  } catch (error) {
    [...fronts, ...backs].forEach((canvas) => { canvas.width = canvas.height = 0; });
    throw error;
  }

  const externalAbort = () => dispose();
  function dispose() {
    if (disposed) return;
    disposed = true;
    controller.abort(new DOMException("Gallery textures disposed", "AbortError"));
    options.signal?.removeEventListener("abort", externalAbort);
    listeners.clear(); callbacks.clear();
    [...fronts, ...backs].forEach((canvas) => { canvas.width = canvas.height = 0; });
  }
  if (options.signal?.aborted) dispose(); else options.signal?.addEventListener("abort", externalAbort, { once: true });

  const ready = (async () => {
    if (disposed) return { gpuSafe: false, failedPhotos };
    try {
      if (document.fonts) {
        await abortable(Promise.all([
          document.fonts.load(`25px ${fonts.display}`, SITE.title),
          document.fonts.load(`9px ${fonts.labels}`, `${SITE.brand.wordmark} ${SITE.article.photoFallback}`),
          document.fonts.ready,
        ]), controller.signal);
      }
    } catch { if (disposed) return { gpuSafe: false, failedPhotos }; }
    if (disposed) return { gpuSafe: false, failedPhotos };
    contents.forEach((book, index) => {
      if (disposed) return;
      paintFront(fronts[index], book, width, height, fonts);
      paintBack(backs[index], book, width, height, fonts);
      notify(index);
    });
    const grouped = new Map();
    records.forEach((book, index) => {
      if (!book.image) return;
      const url = safeImageURL(book.image);
      if (!url) { failedPhotos++; return; }
      const group = grouped.get(url) || [];
      group.push(index); grouped.set(url, group);
    });
    const queue = [...grouped];
    const takeNext = () => {
      if (disposed || !queue.length) return null;
      let next = 0;
      try {
        const preferred = options.priority?.() || [];
        const ranks = new Map(preferred.map((index, rank) => [index, rank]));
        const rank = (group) => Math.min(...group[1].map((index) => ranks.get(index) ?? preferred.length + index));
        for (let index = 1; index < queue.length; index++) if (rank(queue[index]) < rank(queue[next])) next = index;
      } catch { next = 0; }
      return queue.splice(next, 1)[0];
    };
    const worker = async () => {
      for (let entry = takeNext(); entry; entry = takeNext()) {
        const [url, affected] = entry;
        let photograph;
        try {
          photograph = await loadPhotograph(url, controller.signal);
          if (disposed) return;
          gpuSafe &&= photograph.gpuSafe;
          for (const index of affected) {
            if (disposed) return;
            try { paintFront(fronts[index], contents[index], width, height, fonts, photograph); notify(index); }
            catch { paintFront(fronts[index], contents[index], width, height, fonts); failedPhotos++; notify(index); }
          }
        } catch { if (!disposed) failedPhotos += affected.length; }
        finally { photograph?.close(); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
    return { gpuSafe: gpuSafe && !disposed, failedPhotos };
  })();

  return {
    fronts, tiles: fronts, backs, versions, width, height, ratio, ready,
    get(slug) {
      const index = typeof slug === "number" ? slug : indices.get(slug);
      if (disposed || !Number.isInteger(index) || index < 0 || index >= records.length) return null;
      return { front: fronts[index], back: backs[index], index, version: versions[index] };
    },
    subscribe(listener) {
      if (disposed || typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose,
  };
}
