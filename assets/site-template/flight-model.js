// Independent reconstruction of Deimos's book flight model, captured 17 Nov 2026.
// Evidence: 15p8l5acb7rn7.js module 28241; DOM orchestration in
// 30eh4knekz2p8.js module 20620; reveal CSS in 3bgz-9nc3dudy.css.
// Geometry stays in logical CSS pixels and radians. The final approach is a
// camera-depth translation, not a width/height tween.

import { smoothstep } from './gallery-geometry.js';

export const FLIGHT_CENTER_MS = 600;
export const FLIGHT_ZOOM_MS = 460;
export const FLIGHT_DURATION_MS = FLIGHT_CENTER_MS + FLIGHT_ZOOM_MS;
export const FLIGHT_REVEAL_MS = 220;
export const FLIGHT_REVEAL_EASING = 'cubic-bezier(.23, 1, .32, 1)';

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const mix = (start, end, progress) => start + (end - start) * progress;

/**
 * Accepts a gallery pose whose centre is in viewport coordinates, or a full
 * source-style plan { origin, width, height, depth, pose, optics }.
 * A DOM caller keeps the flight element base-sized at left=-width/2,
 * top=-height/2, transform-origin:center, with no ancestor perspective.
 */
export function createFlightPlan(input, viewport) {
  const fullPlan = Boolean(input.origin && input.pose);
  const width = fullPlan ? input.width : finite(input.baseWidth, 230);
  const height = fullPlan ? input.height : finite(input.baseHeight, 310);
  const depth = fullPlan ? input.depth : finite(input.baseDepth, 26);
  const origin = fullPlan ? { ...input.origin } : {
    left: input.x - input.width / 2,
    top: input.y - input.height / 2,
    width: input.width,
    height: input.height,
  };
  const pose = fullPlan ? { ...input.pose } : {
    yaw: finite(input.yaw),
    pitch: finite(input.pitch),
    rotation: finite(input.rotation),
    thickness: finite(input.thickness, origin.width / width * depth),
  };
  const optics = {
    perspective: Math.max(900, origin.width, origin.height),
    cameraX: 0,
    cameraY: 0,
    pivotX: 0,
    pivotY: 0,
    translateX: 0,
    translateY: 0,
    translateZ: 0,
    ...input.optics,
  };
  return { width, height, depth, origin, pose, optics, viewport: { ...viewport } };
}

export function flightTransform(frame, optics) {
  const remaining = frame.seed;
  return [
    `translate3d(${frame.x}px,${frame.y}px,0)`,
    `rotateZ(${frame.rotation}rad)`,
    `translate(${optics.cameraX * remaining}px,${optics.cameraY * remaining}px)`,
    `perspective(${optics.perspective}px)`,
    `translate(${-optics.cameraX * remaining}px,${-optics.cameraY * remaining}px)`,
    `translate3d(${optics.translateX * remaining}px,${optics.translateY * remaining}px,${frame.z}px)`,
    `translate(${optics.pivotX * remaining}px,${optics.pivotY * remaining}px)`,
    `rotateX(${frame.pitch}rad)`,
    `rotateY(${frame.yaw}rad)`,
    `scale3d(${frame.scaleX},${frame.scaleY},${frame.scaleZ})`,
    `translate(${-optics.pivotX * remaining}px,${-optics.pivotY * remaining}px)`,
  ].join(' ');
}

export function computeFlightFrame(inputPose, viewport, elapsed, direction = 'open') {
  const plan = createFlightPlan(inputPose, viewport);
  const { origin, width, height, depth, pose, optics } = plan;
  const elapsedMs = clamp(finite(elapsed), 0, FLIGHT_DURATION_MS);
  const returning = direction === 'return';
  const time = returning ? FLIGHT_DURATION_MS - elapsedMs : elapsedMs;
  const centerProgress = smoothstep(Math.min(1, time / FLIGHT_CENTER_MS));
  const zoomProgress = smoothstep(Math.max(0, (time - FLIGHT_CENTER_MS) / FLIGHT_ZOOM_MS));
  const initialScaleX = origin.width / width;
  const initialScaleY = origin.height / height;
  const centerScale = Math.min(
    0.46 * viewport.width / origin.width,
    0.58 * viewport.height / origin.height,
    340 / origin.width,
  );
  const centerWidth = width * initialScaleX * centerScale;
  const centerHeight = height * initialScaleY * centerScale;
  const coverScale = 1.08 * Math.max(
    (viewport.width + 8) / centerWidth,
    (viewport.height + 8) / centerHeight,
  );
  // Perspective magnification at the front face is P / (P - z - depth/2).
  // Solve that equation for the desired viewport-covering magnification.
  const finalDepth = optics.perspective - pose.thickness / 2 - optics.perspective / coverScale;
  const nextFullTurn = (Math.floor(pose.yaw / (2 * Math.PI)) + 1) * Math.PI * 2;
  const frame = {
    x: mix(origin.left + origin.width / 2, viewport.width / 2, centerProgress),
    y: mix(origin.top + origin.height / 2, viewport.height / 2, centerProgress),
    z: mix(optics.translateZ * (1 - centerProgress), finalDepth, zoomProgress),
    yaw: mix(pose.yaw, nextFullTurn, centerProgress),
    pitch: mix(pose.pitch, 0, centerProgress),
    rotation: mix(pose.rotation, 0, centerProgress),
    scaleX: initialScaleX * mix(1, centerScale, centerProgress),
    scaleY: initialScaleY * mix(1, centerScale, centerProgress),
    scaleZ: pose.thickness / depth,
    seed: 1 - centerProgress,
    progress: time / FLIGHT_DURATION_MS,
    contentOpacity: 1 - centerProgress,
    paperOpacity: centerProgress,
    phase: returning
      ? (elapsedMs >= FLIGHT_DURATION_MS ? 'landed' : elapsedMs < FLIGHT_ZOOM_MS ? 'returning-zoom' : 'returning-spin')
      : (time < FLIGHT_CENTER_MS ? 'centering' : time < FLIGHT_DURATION_MS ? 'zooming' : 'waiting'),
    baseWidth: width,
    baseHeight: height,
    baseDepth: depth,
    optics,
  };
  frame.transform = flightTransform(frame, optics);
  return frame;
}

function revealEase(progress) {
  // Invert the CSS cubic-bezier x polynomial before evaluating its y. The
  // reference's reveal and its 1.02 scale must use the same easing progress.
  const x = clamp(progress, 0, 1);
  const coordinate = (t, first, second) => 3 * (1 - t) ** 2 * t * first + 3 * (1 - t) * t ** 2 * second + t ** 3;
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 40; iteration++) {
    const t = (low + high) / 2;
    if (coordinate(t, 0.23, 0.32) < x) low = t;
    else high = t;
  }
  return coordinate((low + high) / 2, 1, 1);
}

/** Overlay-only stage, started after route paint (or before reverse flight). */
export function computeRevealFrame(elapsed, direction = 'reveal') {
  const progress = clamp(finite(elapsed) / FLIGHT_REVEAL_MS, 0, 1);
  if (direction === 'reemerge') return { opacity: progress, scale: 1, progress, phase: 'reemerging' };
  const eased = progress === 0 || progress === 1 ? progress : revealEase(progress);
  return { opacity: 1 - eased, scale: 1 + 0.02 * eased, progress, phase: 'revealing' };
}
