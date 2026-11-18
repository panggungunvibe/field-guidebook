import { createGalleryTextures } from "./gallery-textures.js";
import { createGalleryCanvas } from "./gallery-canvas.js";
import { createGalleryGpu } from "./gallery-gpu.js";

// Own the drawing surfaces separately from the gallery's links and controller.
// Like the reference, paint with Canvas2D while photographs load, then promote
// a fully rendered GPU surface. Keep the fallback alive for device loss.
export function createGalleryRenderer(host, books, { onStatus = () => {} } = {}) {
  const lifetime = new AbortController();
  let disposed = false;
  let latest = null;
  let textures = null;
  let fallback = null;
  let gpu = null;
  let fallbackCanvas = null;
  let gpuCanvas = null;
  let renderer = "pending";
  let gpuStatus = "waiting";
  let failedPhotos = 0;
  let frameCount = 0;
  let reducedQuality = false;
  let slowFrames = 0;
  let lastDraw = 0;

  const publish = () => {
    if (disposed) return;
    host.dataset.renderer = renderer;
    host.dataset.gpuStatus = gpuStatus;
    host.dataset.failedPhotos = String(failedPhotos);
    host.dataset.frameCount = String(frameCount);
    onStatus({ renderer, gpuStatus, failedPhotos });
  };
  const makeCanvas = () => {
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.className = "gallery-canvas";
    return canvas;
  };
  const frame = () => latest && ({
    ...latest,
    pixelRatio: reducedQuality ? 1 : Math.min(latest.width < 640 ? 2 : 1.5, Math.max(1, window.devicePixelRatio || 1)),
  });
  const useFallback = (reason) => {
    const previous = gpu;
    gpu = null;
    previous?.dispose();
    gpuCanvas?.remove();
    gpuCanvas = null;
    gpuStatus = reason;
    if (disposed) return;
    if (fallback && latest) {
      try {
        fallback.render(frame());
        host.replaceChildren(fallbackCanvas);
        renderer = "canvas2d";
      } catch (error) {
        renderer = "unavailable";
        host.replaceChildren();
        console.error("Gallery Canvas2D rendering failed", error);
      }
    }
    publish();
  };
  const paint = () => {
    if (disposed || !latest || latest.active === false || host.hidden) return;
    const current = gpu || fallback;
    if (!current) return;
    const wasGpu = current === gpu;
    const now = performance.now();
    const elapsed = lastDraw ? now - lastDraw : 0;
    lastDraw = now;
    try {
      current.render(frame());
      frameCount += 1;
      if (gpu && !reducedQuality) {
        slowFrames = elapsed > 30 || performance.now() - now > 25 ? slowFrames + 1 : 0;
        if (slowFrames >= 45) reducedQuality = true;
      }
      host.dataset.frameCount = String(frameCount);
      host.dataset.pixelRatio = String(frame().pixelRatio);
    } catch (error) {
      if (wasGpu) {
        console.warn("Gallery GPU drawing failed; using Canvas2D", error);
        // A synchronous GPU failure can report device loss before throwing.
        // In that case onLost already installed a working fallback surface.
        if (gpu === current) useFallback("failed");
      } else {
        renderer = "unavailable";
        host.replaceChildren();
        publish();
        console.error("Gallery drawing failed", error);
      }
    }
  };

  const ready = (async () => {
    await document.fonts.ready;
    if (disposed) return;
    textures = createGalleryTextures(books, {
      ratio: 1.5,
      signal: lifetime.signal,
      onChange: paint,
    });
    fallbackCanvas = makeCanvas();
    fallback = createGalleryCanvas({ canvas: fallbackCanvas, textures });
    renderer = "canvas2d";
    paint();
    host.replaceChildren(fallbackCanvas);
    publish();

    const result = await textures.ready;
    if (disposed) return;
    failedPhotos = result?.failedPhotos || 0;
    if (result?.gpuSafe === false || !navigator.gpu) {
      gpuStatus = result?.gpuSafe === false ? "unsafe-textures" : "unavailable";
      publish();
      return;
    }
    gpuStatus = "loading";
    publish();
    const candidateCanvas = makeCanvas();
    let candidate = null;
    let lostDuringCreation = false;
    try {
      candidate = await createGalleryGpu({
        canvas: candidateCanvas,
        textures,
        onLost: () => {
          lostDuringCreation = true;
          if (gpu === candidate && !disposed) useFallback("lost");
        },
      });
      if (disposed || lostDuringCreation) {
        candidate.dispose();
        return;
      }
      if (latest) candidate.render(frame());
      gpu = candidate;
      gpuCanvas = candidateCanvas;
      host.replaceChildren(gpuCanvas);
      renderer = "webgpu";
      gpuStatus = "ready";
      lastDraw = 0;
      slowFrames = 0;
      publish();
    } catch (error) {
      candidate?.dispose();
      if (disposed) return;
      gpuStatus = "failed";
      publish();
      console.warn("Gallery GPU setup failed; using Canvas2D", error);
    }
  })().catch((error) => {
    if (disposed) return;
    renderer = "unavailable";
    gpuStatus = "failed";
    publish();
    console.error("Gallery initialization failed", error);
  });

  publish();
  return {
    ready,
    render(next) {
      latest = next;
      paint();
    },
    setHidden(hidden) {
      if (host.hidden === hidden) return;
      host.hidden = hidden;
      if (hidden) lastDraw = 0;
      else paint();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      lifetime.abort();
      gpu?.dispose();
      fallback?.dispose();
      textures?.dispose();
      host.replaceChildren();
      gpu = fallback = textures = null;
    },
  };
}
