// Canvas 2D fallback reconstructed from the public Deimos module 19225.
// This deliberately retains that fallback's DPR cap, quantized blur cache and
// scanline-clipped affine mesh; it is not a CSS or WebGPU pixel approximation.
import { projectBookPoint, getProjectedBookBounds } from "./gallery-geometry.js";

const BLUR_LEVELS = [0, 3, 6, 12, 24, 48, 64, 96];
const CACHE_BYTES = 0x1000000;
const PAGE_COLOR = "#eee9dd";
const SOURCE_DEPTH = 26;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const unit = (value) => clamp(finite(value), 0, 1);

export function quantizeCanvasBlur(value) {
  const bounded = clamp(value, 0, 96);
  return BLUR_LEVELS.reduce((nearest, level) => Math.abs(level - bounded) < Math.abs(nearest - bounded) ? level : nearest, 0);
}

function optics(book) {
  return {
    thickness: clamp(finite(book.thickness), 0, 0.15 * Math.max(0, finite(book.width))),
    yaw: (finite(book.yaw) + Math.PI * unit(book.flipProgress)) % (2 * Math.PI),
    pitch: clamp(finite(book.pitch), -0.35, 0.35),
    perspective: Math.max(900, finite(book.width), finite(book.height)),
  };
}

function rotate(point, yaw, pitch) {
  const x = point.x * Math.cos(yaw) + point.z * Math.sin(yaw);
  const z = -point.x * Math.sin(yaw) + point.z * Math.cos(yaw);
  return { x, y: point.y * Math.cos(pitch) - z * Math.sin(pitch), z: point.y * Math.sin(pitch) + z * Math.cos(pitch) };
}

function hinge(book, point) {
  const angle = -Math.PI / 10 * unit(book.coverOpen);
  if (!angle) return point;
  const pivotX = -book.width / 2, pivotZ = optics(book).thickness / 2;
  const x = point.x - pivotX, z = point.z - pivotZ;
  return { x: pivotX + x * Math.cos(angle) + z * Math.sin(angle), y: point.y, z: pivotZ - x * Math.sin(angle) + z * Math.cos(angle) };
}

export function getCanvasBookFaces(book, horizontalGutter = 0, verticalGutter = horizontalGutter) {
  const camera = optics(book);
  if (camera.thickness <= 0) return [];
  const halfWidth = book.width / 2 + Math.max(0, finite(horizontalGutter));
  const halfHeight = book.height / 2 + Math.max(0, finite(verticalGutter));
  const halfDepth = camera.thickness / 2;
  const point = (x, y, z) => ({ x, y, z });
  const faces = [
    { name: "front", normal: point(0, 0, 1), corners: [point(-halfWidth, -halfHeight, halfDepth), point(halfWidth, -halfHeight, halfDepth), point(-halfWidth, halfHeight, halfDepth), point(halfWidth, halfHeight, halfDepth)] },
    { name: "back", normal: point(0, 0, -1), corners: [point(halfWidth, -halfHeight, -halfDepth), point(-halfWidth, -halfHeight, -halfDepth), point(halfWidth, halfHeight, -halfDepth), point(-halfWidth, halfHeight, -halfDepth)] },
    { name: "spine", normal: point(-1, 0, 0), corners: [point(-halfWidth, -halfHeight, -halfDepth), point(-halfWidth, -halfHeight, halfDepth), point(-halfWidth, halfHeight, -halfDepth), point(-halfWidth, halfHeight, halfDepth)] },
    { name: "pages", normal: point(1, 0, 0), corners: [point(halfWidth, -halfHeight, halfDepth), point(halfWidth, -halfHeight, -halfDepth), point(halfWidth, halfHeight, halfDepth), point(halfWidth, halfHeight, -halfDepth)] },
    { name: "top", normal: point(0, -1, 0), corners: [point(-halfWidth, -halfHeight, -halfDepth), point(halfWidth, -halfHeight, -halfDepth), point(-halfWidth, -halfHeight, halfDepth), point(halfWidth, -halfHeight, halfDepth)] },
    { name: "bottom", normal: point(0, 1, 0), corners: [point(-halfWidth, halfHeight, halfDepth), point(halfWidth, halfHeight, halfDepth), point(-halfWidth, halfHeight, -halfDepth), point(halfWidth, halfHeight, -halfDepth)] },
  ];
  const opened = unit(book.coverOpen);
  if (opened) {
    const front = faces[0];
    faces.push({ name: "paper", normal: point(0, 0, 1), corners: [point(-book.width / 2, -book.height / 2, halfDepth), point(book.width / 2, -book.height / 2, halfDepth), point(-book.width / 2, book.height / 2, halfDepth), point(book.width / 2, book.height / 2, halfDepth)] });
    faces[0] = { ...front, normal: rotate(front.normal, -Math.PI / 10 * opened, 0), corners: front.corners.map((corner) => hinge(book, corner)) };
  }
  const visible = [];
  for (const face of faces) {
    const normal = rotate(face.normal, camera.yaw, camera.pitch);
    const center = rotate(face.corners.reduce((sum, corner) => point(sum.x + corner.x / 4, sum.y + corner.y / 4, sum.z + corner.z / 4), point(0, 0, 0)), camera.yaw, camera.pitch);
    if (-normal.x * center.x - normal.y * center.y + normal.z * (camera.perspective - center.z) <= 0) continue;
    visible.push({ ...face, projected: face.corners.map((corner) => projectBookPoint(book, corner)), normal, depth: center.z, shade: clamp(0.72 + 0.28 * normal.z + 0.08 * normal.x - 0.12 * normal.y, 0.5, 1.08) });
  }
  return visible.sort((a, b) => a.depth - b.depth);
}

function facePoint(face, u, v) {
  const [origin, right, bottom] = face.corners;
  return { x: origin.x + (right.x - origin.x) * u + (bottom.x - origin.x) * v, y: origin.y + (right.y - origin.y) * u + (bottom.y - origin.y) * v, z: origin.z + (right.z - origin.z) * u + (bottom.z - origin.z) * v };
}

function traceFace(context, face) {
  const [a, b, c, d] = face.projected;
  context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.lineTo(d.x, d.y); context.lineTo(c.x, c.y); context.closePath();
}

function shadeColor(color = "#c1b6df", shade = 1, grayscale = 0) {
  const hex = /^#[0-9a-f]{6}$/i.test(color) ? color.slice(1) : "c1b6df";
  const rgb = [0, 2, 4].map((offset) => clamp(parseInt(hex.slice(offset, offset + 2), 16) / 255 * shade, 0, 1));
  const luma = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return `rgb(${rgb.map((channel) => Math.round((channel + (luma - channel) * grayscale) * 255)).join(",")})`;
}

function blurGutters(book, x, y) {
  const camera = optics(book);
  let horizontalDepth = Math.abs(Math.sin(camera.yaw) * Math.cos(camera.pitch));
  const verticalDepth = Math.abs(Math.sin(camera.pitch));
  let extent = book.width / 2 * horizontalDepth + book.height / 2 * verticalDepth + camera.thickness / 2 * Math.abs(Math.cos(camera.yaw) * Math.cos(camera.pitch));
  if (unit(book.coverOpen)) {
    horizontalDepth = Math.max(horizontalDepth, Math.abs(Math.sin(camera.yaw - Math.PI / 10 * unit(book.coverOpen)) * Math.cos(camera.pitch)));
    for (const px of [-book.width / 2, book.width / 2]) for (const py of [-book.height / 2, book.height / 2]) extent = Math.max(extent, projectBookPoint(book, hinge(book, { x: px, y: py, z: camera.thickness / 2 })).z);
  }
  const extraDepth = x * horizontalDepth + y * verticalDepth;
  const scale = extraDepth ? Math.min(1, Math.max(0, 0.9 * camera.perspective - extent) / extraDepth) : 1;
  return { x: x * scale, y: y * scale };
}

// Integer scanline coverage avoids seams/overdraw between adjacent mesh cells.
// The source fallback uses copy compositing inside these exact pixel runs.
function drawTriangle(context, image, sx, sy, sw, sh, a, b, c, scratch, sourceBounds, reverse = false) {
  if (Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) < 1e-8) return;
  const { resolution, left, top } = scratch;
  const [first, middle, last] = [a, b, c].map((point) => ({ x: 1 + (point.x - left) * resolution, y: 1 + (point.y - top) * resolution })).sort((one, two) => one.y - two.y);
  const firstRow = Math.max(0, Math.ceil(first.y - 0.5)), lastRow = Math.min(scratch.height, Math.ceil(last.y - 0.5));
  if (lastRow <= firstRow) return;
  context.save();
  try {
    context.setTransform(1, 0, 0, 1, 0, 0); context.beginPath();
    let minX = scratch.width, maxX = 0;
    for (let row = firstRow; row < lastRow; row++) {
      const y = row + 0.5, start = y < middle.y ? first : middle, end = y < middle.y ? middle : last;
      const x1 = first.x + (last.x - first.x) * (y - first.y) / (last.y - first.y);
      const x2 = start.x + (end.x - start.x) * (y - start.y) / (end.y - start.y);
      const from = Math.max(0, Math.ceil(Math.min(x1, x2) - 0.5 - 1e-7)), to = Math.min(scratch.width, Math.ceil(Math.max(x1, x2) - 0.5 + 1e-7));
      if (to <= from) continue;
      context.rect(from, row, to - from, 1); minX = Math.min(minX, from); maxX = Math.max(maxX, to);
    }
    if (maxX <= minX) return;
    context.clip(); context.setTransform(resolution, 0, 0, resolution, 1 - left * resolution, 1 - top * resolution);
    const xx = reverse ? c.x - a.x : b.x - a.x, xy = reverse ? c.y - a.y : b.y - a.y;
    const yx = reverse ? c.x - b.x : c.x - a.x, yy = reverse ? c.y - b.y : c.y - a.y;
    const tx = reverse ? a.x + b.x - c.x : a.x, ty = reverse ? a.y + b.y - c.y : a.y;
    context.transform(xx, xy, yx, yy, tx, ty);
    const determinant = xx * yy - xy * yx;
    const inverse = (x, y) => ({ x: ((x - tx) * yy - (y - ty) * yx) / determinant, y: ((y - ty) * xx - (x - tx) * xy) / determinant });
    const leftX = left + (minX - 1) / resolution, rightX = left + (maxX - 1) / resolution;
    const topY = top + (firstRow - 1) / resolution, bottomY = top + (lastRow - 1) / resolution;
    const corners = [inverse(leftX, topY), inverse(rightX, topY), inverse(leftX, bottomY), inverse(rightX, bottomY)];
    const fromX = Math.max(sourceBounds.x, sx + Math.min(...corners.map((point) => point.x)) * sw);
    const fromY = Math.max(sourceBounds.y, sy + Math.min(...corners.map((point) => point.y)) * sh);
    const toX = Math.min(sourceBounds.x + sourceBounds.width, sx + Math.max(...corners.map((point) => point.x)) * sw);
    const toY = Math.min(sourceBounds.y + sourceBounds.height, sy + Math.max(...corners.map((point) => point.y)) * sh);
    if (toX <= fromX || toY <= fromY) return;
    context.globalCompositeOperation = "copy";
    context.drawImage(image, fromX, fromY, toX - fromX, toY - fromY, (fromX - sx) / sw, (fromY - sy) / sh, (toX - fromX) / sw, (toY - fromY) / sh);
  } finally { context.restore(); }
}

function drawProjectedFace(output, buffer, width, height, pixelRatio, book, face, image, sx = 0, sy = 0, sw = image.width, sh = image.height) {
  const [a, b, c, d] = face.projected;
  const minW = Math.min(a.w, b.w, c.w, d.w);
  const left = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x, d.x)) - 1), top = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y, d.y)) - 1);
  const right = Math.min(width, Math.ceil(Math.max(a.x, b.x, c.x, d.x)) + 1), bottom = Math.min(height, Math.ceil(Math.max(a.y, b.y, c.y, d.y)) + 1);
  const faceWidth = right - left, faceHeight = bottom - top;
  if (faceWidth <= 0 || faceHeight <= 0) return;
  const resolution = Math.min(pixelRatio, book.blur >= 24 ? 0.35 : book.blur >= 12 ? 0.5 : 1, 1022 / faceWidth, 1022 / faceHeight);
  const density = book.blur >= 12 ? Math.max(0.65, resolution) : 1;
  const subdivisions = (a, b, c, d) => Math.min(32, Math.max(1, Math.ceil(Math.sqrt(Math.max(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(d.x - c.x, d.y - c.y)) * density * Math.max(Math.abs(b.w - a.w), Math.abs(d.w - c.w)) / minW * 2))));
  const columns = subdivisions(a, b, c, d), rows = subdivisions(a, c, b, d);
  const context = buffer.context, sourceBounds = { x: sx, y: sy, width: sw, height: sh };
  const scratch = { resolution, left, top, width: Math.ceil(faceWidth * resolution) + 2, height: Math.ceil(faceHeight * resolution) + 2 };
  context.save();
  try {
    context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, scratch.width, scratch.height);
    context.setTransform(resolution, 0, 0, resolution, 1 - left * resolution, 1 - top * resolution);
    context.globalAlpha = 1; context.globalCompositeOperation = "source-over";
    for (let row = 0; row < rows; row++) {
      const fromV = row / rows, toV = (row + 1) / rows;
      let tl = projectBookPoint(book, facePoint(face, 0, fromV)), bl = projectBookPoint(book, facePoint(face, 0, toV));
      for (let column = 0; column < columns; column++) {
        const fromU = column / columns, toU = (column + 1) / columns;
        const tr = projectBookPoint(book, facePoint(face, toU, fromV)), br = projectBookPoint(book, facePoint(face, toU, toV));
        drawTriangle(context, image, sx + fromU * sw, sy + fromV * sh, sw / columns, sh / rows, tl, tr, bl, scratch, sourceBounds);
        drawTriangle(context, image, sx + fromU * sw, sy + fromV * sh, sw / columns, sh / rows, bl, tr, br, scratch, sourceBounds, true);
        tl = tr; bl = br;
      }
    }
    if (face.name === "front" && unit(book.coverOpen) && face.shade < 1) {
      context.setTransform(1, 0, 0, 1, 0, 0); context.globalCompositeOperation = "source-atop"; context.globalAlpha = 1 - face.shade; context.fillStyle = "#000000"; context.fillRect(0, 0, scratch.width, scratch.height);
    }
  } finally { context.restore(); }
  output.save();
  try { traceFace(output, face); output.clip(); output.drawImage(buffer.canvas, 1, 1, faceWidth * resolution, faceHeight * resolution, left, top, faceWidth, faceHeight); }
  finally { output.restore(); }
}

function context2d(canvas) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Gallery needs a Canvas 2D context");
  return context;
}
const releaseCanvas = (canvas) => { canvas.width = canvas.height = 0; };

export function createGalleryCanvas({ canvas, textures }) {
  const textureWidth = textures.width || 230, textureHeight = textures.height || 310;
  if (![textureWidth, textureHeight].every((value) => Number.isFinite(value) && value > 0 && value <= 4096)) throw new RangeError("Gallery texture dimensions must be positive and at most 4096 logical pixels");
  const context = context2d(canvas), makeCanvas = () => canvas.ownerDocument.createElement("canvas");
  const cache = new Map();
  let cacheBytes = 0, mixBytes = 0, faceBytes = 0, mixBuffer = null, faceBuffer = null, disposed = false;
  let width = 0, height = 0, pixelRatio = 1, bottomFade = 0;
  const assertAlive = () => { if (disposed) throw new Error("Gallery fallback renderer has been disposed"); };
  const evict = (key, entry) => { cache.delete(key); cacheBytes -= entry.bytes; releaseCanvas(entry.canvas); };
  const reserve = (bytes = 0) => {
    while ((bytes > 0 && cache.size >= 24) || cacheBytes + bytes + mixBytes + faceBytes > CACHE_BYTES) {
      const oldest = cache.entries().next().value;
      if (!oldest) break;
      evict(oldest[0], oldest[1]);
    }
  };
  const getMixBuffer = () => {
    if (mixBuffer) return mixBuffer;
    const logicalWidth = textureWidth + 580, logicalHeight = textureHeight + 580;
    const resolution = Math.min(1.5, Math.sqrt(1048576 / (logicalWidth * logicalHeight)));
    const buffer = makeCanvas();
    buffer.width = Math.max(1, Math.floor(logicalWidth * resolution)); buffer.height = Math.max(1, Math.floor(logicalHeight * resolution));
    mixBuffer = { canvas: buffer, context: context2d(buffer), resolution };
    mixBytes = buffer.width * buffer.height * 4; reserve();
    return mixBuffer;
  };
  const getFaceBuffer = () => {
    if (faceBuffer) return faceBuffer;
    const buffer = makeCanvas(); buffer.width = buffer.height = 1024;
    faceBuffer = { canvas: buffer, context: context2d(buffer) };
    faceBytes = buffer.width * buffer.height * 4; reserve();
    return faceBuffer;
  };
  const filteredTexture = (index, name, source, blur, grayscale, logicalWidth = textureWidth, logicalHeight = textureHeight) => {
    if (!blur && !grayscale) return null;
    const version = textures.versions[index], key = `${index}:${name}:${version}:${blur}:${grayscale}`;
    let entry = cache.get(key);
    if (entry) { cache.delete(key); cache.set(key, entry); return entry; }
    const image = typeof source === "function" ? source() : source;
    const temporary = new Set();
    try {
      const padding = blur ? Math.ceil(3 * blur + 2) : 0;
      const allowance = CACHE_BYTES - mixBytes - faceBytes;
      let resolution = Math.min(image.width / logicalWidth, image.height / logicalHeight, blur ? blur >= 24 ? 0.25 : blur >= 6 ? 0.5 : 0.75 : Infinity);
      resolution = Math.min(resolution, (Math.sqrt(allowance / 4) - 2) / Math.sqrt((logicalWidth + 2 * padding) * (logicalHeight + 2 * padding)));
      let columns = Math.ceil((logicalWidth + 2 * padding) * resolution), rows = Math.ceil((logicalHeight + 2 * padding) * resolution);
      if (columns * rows * 4 > allowance) {
        resolution = Math.min(resolution, (Math.floor(Math.sqrt(allowance / 4)) - 1) / Math.max(logicalWidth + 2 * padding, logicalHeight + 2 * padding));
        columns = Math.ceil((logicalWidth + 2 * padding) * resolution); rows = Math.ceil((logicalHeight + 2 * padding) * resolution);
      }
      const allocate = () => { const result = makeCanvas(); temporary.add(result); result.width = columns; result.height = rows; return result; };
      const unfiltered = allocate();
      context2d(unfiltered).drawImage(image, padding * resolution, padding * resolution, logicalWidth * resolution, logicalHeight * resolution);
      let result = unfiltered;
      if (blur || grayscale) {
        result = allocate(); const filtered = context2d(result);
        filtered.filter = [blur ? `blur(${blur * resolution}px)` : "", grayscale ? `grayscale(${grayscale})` : ""].filter(Boolean).join(" ");
        filtered.drawImage(unfiltered, 0, 0);
      }
      temporary.delete(result);
      entry = { canvas: result, padding, resolution, bytes: columns * rows * 4, index, version };
    } finally { temporary.forEach(releaseCanvas); if (typeof source === "function") releaseCanvas(image); }
    reserve(entry.bytes); cache.set(key, entry); cacheBytes += entry.bytes;
    return entry;
  };
  const sideTexture = (name, fill, binding, logicalWidth, logicalHeight) => {
    const image = makeCanvas(); image.width = Math.ceil(1.5 * logicalWidth); image.height = Math.ceil(1.5 * logicalHeight);
    const paint = context2d(image); paint.setTransform(image.width / logicalWidth, 0, 0, image.height / logicalHeight, 0, 0);
    paint.fillStyle = fill; paint.fillRect(0, 0, logicalWidth, logicalHeight);
    if (name === "paper") {
      for (let strip = 0; strip < 8; strip++) {
        const t = (strip + 0.5) / 8, shade = (1 - t * t * (3 - 2 * t)) * 0.035;
        paint.fillStyle = shadeColor("#f2eee6", 1 - shade / 0.935); paint.fillRect(strip / 100 * logicalWidth, 0, logicalWidth / 100, logicalHeight);
      }
      return image;
    }
    if (name !== "spine") {
      paint.strokeStyle = shadeColor(PAGE_COLOR, 0.84); paint.lineWidth = 0.45; paint.beginPath();
      for (let line = 1; line < SOURCE_DEPTH / 1.5; line++) {
        if (name === "pages") { paint.moveTo(1.5 * line, 0); paint.lineTo(1.5 * line, logicalHeight); }
        else { paint.moveTo(0, 1.5 * line); paint.lineTo(logicalWidth, 1.5 * line); }
      }
      paint.stroke(); paint.fillStyle = binding;
      if (name === "pages") {
        paint.fillRect(0, 0, 3, logicalHeight); paint.fillRect(logicalWidth - 3, 0, 3, logicalHeight);
        const edge = 3 * logicalHeight / 310; paint.fillRect(3, 0, logicalWidth - 6, edge); paint.fillRect(3, logicalHeight - edge, logicalWidth - 6, edge);
      } else { paint.fillRect(0, 0, logicalWidth, 3); paint.fillRect(0, logicalHeight - 3, logicalWidth, 3); }
    }
    return image;
  };
  const fillSide = (book, face) => {
    const grayscale = unit(book.grayscale), isSpine = face.name === "spine";
    if (face.name === "paper") {
      context.fillStyle = shadeColor("#f2eee6", face.shade, grayscale); traceFace(context, face); context.fill();
      for (let strip = 0; strip < 8; strip++) {
        const t = (strip + 0.5) / 8, shade = (1 - t * t * (3 - 2 * t)) * 0.035;
        context.fillStyle = shadeColor("#f2eee6", face.shade * (1 - shade / 0.935), grayscale);
        const points = [[strip / 100, 0], [(strip + 1) / 100, 0], [(strip + 1) / 100, 1], [strip / 100, 1]].map(([u, v]) => projectBookPoint(book, facePoint(face, u, v)));
        context.beginPath(); context.moveTo(points[0].x, points[0].y); points.slice(1).forEach((point) => context.lineTo(point.x, point.y)); context.closePath(); context.fill();
      }
      return;
    }
    const color = isSpine ? book.color : PAGE_COLOR, shade = Math.min(1, face.shade) * (isSpine ? 0.86 : 1);
    context.fillStyle = shadeColor(color, shade, grayscale); traceFace(context, face); context.fill();
    if (isSpine) return;
    context.save();
    try {
      context.clip(); context.strokeStyle = shadeColor(color, 0.84 * shade, grayscale); context.lineWidth = 0.45;
      const lines = Math.min(24, Math.max(2, Math.floor(optics(book).thickness / 1.5)));
      context.beginPath();
      for (let line = 1; line < lines; line++) {
        const t = line / lines, vertical = face.name === "pages";
        const from = projectBookPoint(book, facePoint(face, vertical ? t : 0, vertical ? 0 : t));
        const to = projectBookPoint(book, facePoint(face, vertical ? t : 1, vertical ? 1 : t));
        context.moveTo(from.x, from.y); context.lineTo(to.x, to.y);
      }
      context.stroke();
      const edge = 3 / SOURCE_DEPTH;
      const borders = face.name === "pages" ? [[0, 0, edge, 1], [1 - edge, 0, 1, 1], [edge, 0, 1 - edge, 3 / 310], [edge, 1 - 3 / 310, 1 - edge, 1]] : [[0, 0, 1, edge], [0, 1 - edge, 1, 1]];
      context.fillStyle = shadeColor(book.color, shade, grayscale);
      for (const [left, top, right, bottom] of borders) {
        const corners = [[left, top], [right, top], [right, bottom], [left, bottom]].map(([u, v]) => projectBookPoint(book, facePoint(face, u, v)));
        context.beginPath(); context.moveTo(corners[0].x, corners[0].y); corners.slice(1).forEach((point) => context.lineTo(point.x, point.y)); context.closePath(); context.fill();
      }
    } finally { context.restore(); }
  };
  const drawBook = (book, texture) => {
    const grayscale = unit(book.grayscale), scaleX = book.width / textureWidth, scaleY = book.height / textureHeight;
    const blur = quantizeCanvasBlur(book.blur / scaleX), padding = blur ? Math.ceil(3 * blur + 2) : 0;
    const gutters = blurGutters(book, padding * scaleX, padding * scaleY);
    const faces = getCanvasBookFaces(book), hasCover = faces.some((face) => face.name === "front" || face.name === "back");
    const bounds = getProjectedBookBounds(book, hasCover ? gutters.x : 0, hasCover ? gutters.y : 0);
    if (bounds.right < 0 || bounds.left > width || bounds.bottom < 0 || bounds.top > height) return;
    const expanded = padding ? getCanvasBookFaces(book, gutters.x, gutters.y) : faces;
    const buffer = faces.some((face) => face.name === "front" || face.name === "back" || blur) ? getFaceBuffer() : null;
    context.save();
    try {
      for (const face of faces) {
        if (face.name === "front" || face.name === "back") {
          const image = face.name === "back" && texture.back?.width && texture.back.height ? texture.back : texture.front;
          if (!image?.width || !image.height) continue;
          const cached = filteredTexture(texture.index, face.name, image, blur, grayscale);
          if (!cached) { drawProjectedFace(context, buffer, width, height, pixelRatio, book, face, image); continue; }
          const expandedFace = expanded.find((entry) => entry.name === face.name), x = gutters.x / scaleX, y = gutters.y / scaleY;
          drawProjectedFace(context, buffer, width, height, pixelRatio, book, expandedFace, cached.canvas, (cached.padding - x) * cached.resolution, (cached.padding - y) * cached.resolution, (textureWidth + 2 * x) * cached.resolution, (textureHeight + 2 * y) * cached.resolution);
          continue;
        }
        if (!blur) { fillSide(book, face); continue; }
        const name = face.name, vertical = name === "spine" || name === "pages";
        const sideWidth = vertical ? SOURCE_DEPTH : textureWidth, sideHeight = vertical || name === "paper" ? textureHeight : SOURCE_DEPTH;
        const fill = shadeColor(name === "spine" ? book.color : name === "paper" ? "#f2eee6" : PAGE_COLOR, name === "spine" ? 0.86 : 1), binding = shadeColor(book.color, 1);
        const mix = getMixBuffer();
        const cached = filteredTexture(texture.index, `side:${vertical || name === "paper" ? name : "ends"}:${fill}:${binding}`, () => sideTexture(name, fill, binding, sideWidth, sideHeight), blur, grayscale, sideWidth, sideHeight);
        const paint = mix.context, resolution = mix.resolution, offset = 290 * resolution, drawWidth = sideWidth * resolution, drawHeight = sideHeight * resolution;
        paint.save();
        try {
          paint.setTransform(1, 0, 0, 1, 0, 0); paint.clearRect(offset - 1, offset - 1, drawWidth + 2, drawHeight + 2);
          paint.globalAlpha = 1; paint.globalCompositeOperation = "source-over";
          paint.drawImage(cached.canvas, cached.padding * cached.resolution, cached.padding * cached.resolution, sideWidth * cached.resolution, sideHeight * cached.resolution, offset, offset, drawWidth, drawHeight);
          paint.globalCompositeOperation = "source-atop"; paint.globalAlpha = 1 - Math.min(1, face.shade); paint.fillStyle = "#000000"; paint.fillRect(offset - 1, offset - 1, drawWidth + 2, drawHeight + 2);
        } finally { paint.restore(); }
        drawProjectedFace(context, buffer, width, height, pixelRatio, book, face, mix.canvas, offset, offset, drawWidth, drawHeight);
      }
    } finally { context.restore(); }
  };
  return {
    kind: "canvas2d",
    render(frame) {
      assertAlive();
      const dpr = frame.pixelRatio ?? globalThis.devicePixelRatio ?? 1;
      if (![frame.width, frame.height, dpr].every(Number.isFinite) || frame.width < 0 || frame.height < 0 || dpr <= 0 || frame.width > 16384 || frame.height > 16384) throw new RangeError("Gallery fallback resize needs bounded nonnegative dimensions and positive DPR");
      width = frame.width; height = frame.height; pixelRatio = Math.min(1, dpr);
      bottomFade = clamp(finite(frame.bottomFade, Math.round(Math.min(0.6 * Math.max(0, finite(frame.overflow)), 216))), 0, height);
      const columns = Math.max(1, Math.round(width * pixelRatio)), rows = Math.max(1, Math.round(height * pixelRatio));
      if (canvas.width !== columns) canvas.width = columns;
      if (canvas.height !== rows) canvas.height = rows;
      context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0); context.globalAlpha = 1; context.globalCompositeOperation = "source-over";
      for (const [key, entry] of cache) if (entry.version !== textures.versions[entry.index]) evict(key, entry);
      for (const pose of frame.poses) {
        const texture = textures.get?.(pose.slug) ?? { front: (textures.fronts || textures.tiles)[pose.bookIndex], back: textures.backs?.[pose.bookIndex], index: pose.bookIndex };
        if (!Number.isInteger(texture.index) || texture.index < 0 || !texture.front) throw new RangeError("Gallery fallback card references an unavailable texture");
        if (![pose.x, pose.y, pose.width, pose.height, pose.rotation, pose.blur].every(Number.isFinite) || pose.width <= 0 || pose.height <= 0) throw new RangeError("Gallery fallback card geometry must be finite with positive dimensions");
        if (optics(pose).thickness <= 0) throw new RangeError("The hero gallery fallback requires volumetric book poses");
        drawBook(pose, texture);
      }
      if (bottomFade > 0) {
        context.save();
        try {
          const top = height - bottomFade, fade = context.createLinearGradient(0, top, 0, height);
          fade.addColorStop(0, "rgba(0,0,0,0)"); fade.addColorStop(1, "rgba(0,0,0,1)");
          context.globalCompositeOperation = "destination-out"; context.fillStyle = fade; context.fillRect(0, top, width, bottomFade);
        } finally { context.restore(); }
      }
      canvas.dataset.renderer = "canvas2d";
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [key, entry] of cache) evict(key, entry);
      if (mixBuffer) releaseCanvas(mixBuffer.canvas);
      if (faceBuffer) releaseCanvas(faceBuffer.canvas);
      mixBuffer = faceBuffer = null; mixBytes = faceBytes = 0;
      releaseCanvas(canvas);
    },
  };
}
