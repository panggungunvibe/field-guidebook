// Reconstructed from Deimos's publicly delivered gallery model (17 Nov 2026):
// 2dwtc1gf9h3fi.js, modules 16229 / 66440 / 6170. This is a readable,
// renderer-independent model; plant identity and imagery remain caller data.
// Positions and phase are CSS pixels; all angles are radians.

export const BOOK_THICKNESS = 26;
export const BOOK_PERSPECTIVE = 900;
export const GALLERY_BREAKPOINT = 640;
export const GALLERY_SLOT_LIMIT = 24;
const PITCH = -0.065;
const DEG = Math.PI / 180;
const DEPTH_OFFSETS = [0.7, 0.95, 1.2];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

export function wrap(value, length) {
  if (!Number.isFinite(value) || !Number.isFinite(length) || length <= 0) return 0;
  const remainder = value % length;
  return remainder < 0 ? remainder + length : remainder;
}

export function smoothstep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

export function smootherstep(value) {
  const t = clamp(value, 0, 1);
  return t * t * t * (t * (6 * t - 15) + 10);
}

function bookOptics(book) {
  return {
    thickness: clamp(finite(book.thickness), 0, 0.15 * Math.max(0, finite(book.width))),
    yaw: (finite(book.yaw) + Math.PI * clamp(finite(book.flipProgress), 0, 1)) % (Math.PI * 2),
    pitch: clamp(finite(book.pitch), -0.35, 0.35),
    perspective: Math.max(BOOK_PERSPECTIVE, finite(book.width), finite(book.height)),
  };
}

function hingeFront(book, point) {
  const angle = -Math.PI / 10 * clamp(finite(book.coverOpen), 0, 1);
  if (!angle) return point;
  const pivotX = -book.width / 2;
  const pivotZ = bookOptics(book).thickness / 2;
  const x = point.x - pivotX;
  const z = point.z - pivotZ;
  return {
    x: pivotX + x * Math.cos(angle) + z * Math.sin(angle),
    y: point.y,
    z: pivotZ - x * Math.sin(angle) + z * Math.cos(angle),
  };
}

export function projectBookPoint(book, point) {
  const optics = bookOptics(book);
  // Physical book yaw, then pitch, followed by camera projection and planar roll.
  const yawX = point.x * Math.cos(optics.yaw) + point.z * Math.sin(optics.yaw);
  const yawZ = -point.x * Math.sin(optics.yaw) + point.z * Math.cos(optics.yaw);
  const pitchY = point.y * Math.cos(optics.pitch) - yawZ * Math.sin(optics.pitch);
  const pitchZ = point.y * Math.sin(optics.pitch) + yawZ * Math.cos(optics.pitch);
  const denominator = Math.max(0.1, 1 - pitchZ / optics.perspective);
  const x = yawX / denominator;
  const y = pitchY / denominator;
  const roll = finite(book.rotation);
  return {
    x: finite(book.x) + x * Math.cos(roll) - y * Math.sin(roll),
    y: finite(book.y) + x * Math.sin(roll) + y * Math.cos(roll),
    z: pitchZ,
    w: denominator,
  };
}

export function getProjectedBookBounds(book, horizontalGutter = 0, verticalGutter = horizontalGutter) {
  const halfWidth = book.width / 2 + Math.max(0, finite(horizontalGutter));
  const halfHeight = book.height / 2 + Math.max(0, finite(verticalGutter));
  const halfDepth = bookOptics(book).thickness / 2;
  const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  const include = point => {
    const projected = projectBookPoint(book, point);
    bounds.left = Math.min(bounds.left, projected.x);
    bounds.right = Math.max(bounds.right, projected.x);
    bounds.top = Math.min(bounds.top, projected.y);
    bounds.bottom = Math.max(bounds.bottom, projected.y);
  };
  for (const x of [-halfWidth, halfWidth]) {
    for (const y of [-halfHeight, halfHeight]) {
      for (const z of [-halfDepth, halfDepth]) include({ x, y, z });
      if (halfDepth > 0 && book.coverOpen) include(hingeFront(book, { x, y, z: halfDepth }));
    }
  }
  return bounds;
}

export function getHeroCurve(x, width, height) {
  const progress = smoothstep(x / width);
  const mobile = width < GALLERY_BREAKPOINT;
  const minimumScale = mobile ? 0.45 : 0.34;
  const maximumScale = mobile ? 1.7 : 2.4;
  // The reference scales by SCENE HEIGHT, not viewport width.
  const fit = mobile ? 1 : clamp(height / 1050, 0.85, 1.2);
  return {
    scale: (minimumScale + (maximumScale - minimumScale) * (1 - progress) ** (mobile ? 2.2 : 3)) * fit,
    y: -(mobile ? 0.35 : 0.8) * height * (progress - 0.4) ** 2,
    depth: (1 - progress) * 100 + 1,
  };
}

export function getHeroBlur(x, width) {
  const progress = clamp(x / width, 0, 1);
  const left = 1 - smoothstep(progress / 0.38);
  const right = 1 - smoothstep((1 - progress) / 0.035);
  const leftDominates = left > right;
  return Math.round((leftDominates ? left * 60 : right * 3) * 10) / 10;
}

export function getHeroYaw(x, width) {
  return 0.35 - smoothstep(x / width) * 0.24;
}

function rotatedExtent(width, height, rotation, gutter) {
  const halfWidth = width / 2 + gutter;
  const halfHeight = height / 2 + gutter;
  return Math.abs(Math.cos(rotation)) * halfWidth + Math.abs(Math.sin(rotation)) * halfHeight;
}

export function getGalleryMargins(width, hero = true, cardWidth = width < GALLERY_BREAKPOINT ? 200 : 230) {
  const mobile = width < GALLERY_BREAKPOINT;
  const nearScale = hero ? (mobile ? 1.7 : 2.88) : 1.25 * 1.08;
  const farScale = hero ? (mobile ? 0.45 : 0.34 * 1.2) : 0.75 * 1.08;
  const farGutter = hero ? 13.25 : 96.5;
  const nearExtent = rotatedExtent(cardWidth * nearScale, 1.4 * cardWidth * nearScale, (hero ? 5.4 : 3.05) * DEG, 193);
  const farExtent = rotatedExtent(cardWidth * farScale, 1.4 * cardWidth * farScale, (hero ? 14.2 : 3.05) * DEG, farGutter);
  const bounds = (scale, yaw, gutter) => getProjectedBookBounds({
    x: 0, y: 0, width: cardWidth * scale, height: 1.4 * cardWidth * scale,
    thickness: BOOK_THICKNESS * scale, yaw, pitch: PITCH, rotation: 0,
  }, gutter);
  return {
    left: Math.max(520, nearExtent, hero ? bounds(nearScale, 0.35, 193).right : 0),
    right: Math.max(96, farExtent, hero ? -bounds(farScale, 0.11, farGutter).left : 0),
  };
}

export function getGallerySpacing(width, hero = true, cardWidth = width < GALLERY_BREAKPOINT ? 200 : 230) {
  const margins = getGalleryMargins(width, hero, cardWidth);
  return Math.max(Math.max(1, cardWidth - (hero ? 135 : 28)), Math.ceil((width + margins.left + margins.right) / 22));
}

function validContentBounds(bounds) {
  return bounds && [bounds.left, bounds.right, bounds.bottom].every(Number.isFinite) && bounds.left <= bounds.right;
}

function getHeroBaseline(width, height, cardWidth, cardHeight, contentBounds) {
  if (!validContentBounds(contentBounds)) return 0.67 * height;
  // Sample the projected moving envelope, reserving the same 24 px gap at
  // either side of the content exclusion calculation as the reference.
  const start = -3 * cardWidth;
  const step = (width + 6 * cardWidth) / 128;
  let previousX = start;
  let previousCurve = getHeroCurve(previousX, width, height);
  let baseline = 0;
  for (let sample = 0; sample < 128; sample++) {
    const x = start + (sample + 1) * step;
    const curve = getHeroCurve(x, width, height);
    const visible = getHeroBlur(previousX, width) === 0 || getHeroBlur(x, width) === 0 || (previousX <= width / 2 && x >= width / 2);
    const halfWidth = cardWidth * previousCurve.scale / 2 + 13;
    const halfHeight = cardHeight * previousCurve.scale / 2 + 13;
    const halfDepth = BOOK_THICKNESS * previousCurve.scale / 2;
    const nextYaw = getHeroYaw(x, width);
    const previousYaw = getHeroYaw(previousX, width);
    const extentX = halfWidth * Math.cos(nextYaw) + halfDepth * Math.sin(previousYaw);
    const extentZ = halfWidth * Math.sin(previousYaw) + halfDepth * Math.cos(nextYaw);
    const projection = 1 / Math.max(0.1, 1 - (halfHeight * Math.abs(Math.sin(PITCH)) + Math.cos(PITCH) * extentZ) / BOOK_PERSPECTIVE);
    const projectedX = extentX * projection;
    const projectedY = (Math.cos(PITCH) * halfHeight + extentZ * Math.abs(Math.sin(PITCH))) * projection;
    if (visible && x + projectedX >= contentBounds.left - 10 && previousX - projectedX <= contentBounds.right + 10) {
      baseline = Math.max(baseline, contentBounds.bottom + 24 + projectedY - Math.min(previousCurve.y, curve.y));
    }
    previousX = x;
    previousCurve = curve;
  }
  return baseline + 24;
}

const DECK_X = [0, 0.118, 0.22, 0.2];
const DECK_Y = [0, 0.045, 0.105, 0.11];
const DECK_ROLL = [0, 6, 7, 7];
const DECK_SCALE = [1, 0.92, 0.86, 0.78];
const DECK_YAW = [0, 0.07, 0.12, 0.12];

function deckValue(values, distance) {
  const position = clamp(distance, 0, 3);
  const index = Math.min(values.length - 2, Math.floor(position));
  return values[index] + (values[index + 1] - values[index]) * (position - index);
}

function identity(books, slot) {
  const bookIndex = wrap(slot, books.length);
  const book = books[bookIndex];
  return { bookIndex, slot, slug: book.slug, title: book.title, kicker: book.kicker, color: book.color };
}

export function getGalleryLayout({ books, width, height, phase = 0, time = 0, contentBounds, deck = width < GALLERY_BREAKPOINT, overflow = 360 }) {
  if (!books?.length || ![width, height].every(value => Number.isFinite(value) && value > 0)) return [];
  const cardWidth = width < GALLERY_BREAKPOINT ? 200 : 230;
  const cardHeight = width < GALLERY_BREAKPOINT ? 280 : 310;
  const spacing = getGallerySpacing(width, true, cardWidth);
  const loop = books.length * spacing;
  const wrappedPhase = wrap(phase, loop);
  const bottom = height + clamp(finite(overflow), 0, Math.max(0, 16384 - height));
  const poses = [];

  if (deck) {
    const rawPosition = wrappedPhase / spacing;
    const step = Math.floor(rawPosition);
    const position = step + smootherstep(smootherstep(rawPosition - step));
    const scale = Math.min(1.15, 0.46 * width / cardWidth);
    const baseline = validContentBounds(contentBounds) ? contentBounds.bottom + 48 + cardHeight * scale / 2 : 0.67 * height;
    for (let slot = Math.floor(position) - 3; slot <= Math.ceil(position) + 3; slot++) {
      const offset = slot - position;
      const distance = Math.abs(offset);
      if (distance > 3) continue;
      const direction = Math.sign(offset);
      const size = scale * deckValue(DECK_SCALE, distance);
      const pose = {
        ...identity(books, slot), depth: -distance,
        x: width / 2 + direction * deckValue(DECK_X, distance) * width,
        y: baseline + deckValue(DECK_Y, distance) * width,
        width: cardWidth * size, height: cardHeight * size,
        thickness: BOOK_THICKNESS * size,
        yaw: -direction * deckValue(DECK_YAW, distance), pitch: PITCH,
        rotation: direction * deckValue(DECK_ROLL, distance) * DEG,
        hoverable: distance < 0.5, blur: 0, rgb: 0,
      };
      pose.bounds = getProjectedBookBounds(pose, 2);
      if (pose.bounds.bottom >= 0 && pose.bounds.top <= bottom) poses.push(pose);
    }
  } else {
    const margins = getGalleryMargins(width, true, cardWidth);
    const baseline = getHeroBaseline(width, height, cardWidth, cardHeight, contentBounds);
    const firstSlot = Math.ceil((wrappedPhase - cardWidth / 2 - margins.left) / spacing);
    const lastSlot = Math.floor((wrappedPhase - cardWidth / 2 + width + margins.right) / spacing);
    for (let slot = firstSlot; slot <= lastSlot && slot < firstSlot + GALLERY_SLOT_LIMIT; slot++) {
      const x = slot * spacing + cardWidth / 2 - wrappedPhase;
      const curve = getHeroCurve(x, width, height);
      const blur = getHeroBlur(x, width);
      const book = identity(books, slot);
      const pose = {
        ...book, depth: curve.depth + DEPTH_OFFSETS[book.bookIndex % 3],
        x, y: baseline + curve.y,
        width: cardWidth * curve.scale, height: cardHeight * curve.scale,
        thickness: BOOK_THICKNESS * curve.scale,
        yaw: getHeroYaw(x, width), pitch: PITCH, rotation: 0,
        hoverable: blur === 0, blur, rgb: 0,
      };
      pose.bounds = getProjectedBookBounds(pose, 3 * blur + 2);
      if (pose.bounds.right >= 0 && pose.bounds.left <= width && pose.bounds.bottom >= 0 && pose.bounds.top <= bottom) poses.push(pose);
    }
  }
  // The original paints far-to-near; opacity is always one. Defocus must not
  // introduce an independent opacity ramp or an extra global 3D translation.
  return poses.sort((a, b) => a.depth - b.depth || a.slot - b.slot);
}
