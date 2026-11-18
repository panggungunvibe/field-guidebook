import { getProjectedBookBounds } from "./gallery-geometry.js";

// Independently implemented from the public Deimos gallery's documented
// mathematical behavior (modules21218 /13135, retrieved17 Nov2026). This module
// renders the closed moving gallery only; links, input, and flights remain DOM.
// Source constants:64px transparent texture gutter, seven mip levels,24 poses,
// premultiplied alpha, no depth attachment, and one sample per output pixel.
export const GPU_TEXTURE_GUTTER = 64;
export const GPU_MIP_LEVELS = 7;
export const GPU_CARD_FLOATS = 28;
export const GPU_CARD_LIMIT = 24;
const TEXTURE_PIXEL_BUDGET = 0x1000000;
const clamp = (value, lower, upper) => Math.max(lower, Math.min(upper, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

export function getGpuTextureLayout(fronts, backs = []) {
  if (!Array.isArray(fronts) || fronts.length < 1 || fronts.length > 40) {
    throw new RangeError("The gallery needs between1 and40 front textures");
  }
  if (backs.length && backs.length !== fronts.length) {
    throw new RangeError("Every gallery front must have a paired back texture");
  }
  const sources = [...fronts, ...backs];
  let width = 0, height = 0;
  for (const source of sources) {
    if (!source || !Number.isSafeInteger(source.width) || !Number.isSafeInteger(source.height) || source.width < 1 || source.height < 1) {
      throw new RangeError("Cover textures require positive integer backing dimensions");
    }
    width = Math.max(width, source.width);
    height = Math.max(height, source.height);
  }
  width = 64 * Math.ceil((width + GPU_TEXTURE_GUTTER * 2) / 64);
  height = 64 * Math.ceil((height + GPU_TEXTURE_GUTTER * 2) / 64);
  if (width * height * sources.length > TEXTURE_PIXEL_BUDGET) {
    throw new RangeError("Gallery texture array exceeds the reference pixel budget");
  }
  return { width, height, layers: sources.length, mipLevelCount: GPU_MIP_LEVELS };
}

function paperColor(value) {
  const hex = /^#[\da-f]{6}$/i.test(value) ? value.slice(1) : "c1b6df";
  return [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
}

function textureArrays(textures) {
  const fronts = textures.fronts || textures.tiles;
  const backs = textures.backs || [];
  return { fronts, backs };
}

// The buffer layout deliberately exposes every optical parameter, allowing
// numerical comparison with the public renderer without running GPU code.
export function packGalleryGpuCards(poses, textures, width, height, target = new Float32Array(GPU_CARD_LIMIT * GPU_CARD_FLOATS)) {
  if (target.length < GPU_CARD_LIMIT * GPU_CARD_FLOATS) throw new RangeError("Gallery card buffer is too small");
  const { fronts, backs } = textureArrays(textures);
  let count = 0;
  for (const pose of poses) {
    const resolved = pose.slug == null ? null : textures.get?.(pose.slug);
    const index = resolved?.index ?? pose.bookIndex;
    if (!Number.isInteger(index) || index < 0 || index >= fronts.length) throw new RangeError("Pose references an unavailable cover");
    if (![pose.x, pose.y, pose.width, pose.height, pose.rotation, pose.blur].every(Number.isFinite) || pose.width <= 0 || pose.height <= 0) {
      throw new RangeError("Gallery pose geometry must be finite and positive");
    }
    if (finite(pose.coverOpen) !== 0) throw new RangeError("The moving-gallery renderer accepts closed covers only");
    const blur = clamp(pose.blur, 0, 60);
    const gutter = 3 * blur + 2;
    const bounds = getProjectedBookBounds(pose, gutter);
    if (bounds.right < 0 || bounds.left > width || bounds.bottom < 0 || bounds.top > height) continue;
    if (count === GPU_CARD_LIMIT) throw new RangeError("At most24 gallery poses can be painted in one frame");
    const front = fronts[index], back = backs[index] || front;
    const paper = paperColor(pose.color);
    const thickness = clamp(finite(pose.thickness), 0, pose.width * .15);
    if (thickness <= 0) throw new RangeError("The moving-gallery renderer requires physical book thickness");
    const yaw = (finite(pose.yaw) + Math.PI * clamp(finite(pose.flipProgress), 0, 1)) % (Math.PI * 2);
    const offset = count++ * GPU_CARD_FLOATS;
    target.set([
      pose.x, pose.y, pose.width, pose.height,
      Math.cos(pose.rotation), Math.sin(pose.rotation), blur, gutter,
      front.width, front.height, index, GPU_TEXTURE_GUTTER,
      back.width, back.height, index + (backs.length ? fronts.length : 0), 0,
      1, 0, clamp(finite(pose.grayscale), 0, 1), 0,
      thickness, yaw, clamp(finite(pose.pitch), -.35, .35), Math.max(900, pose.width, pose.height),
      ...paper, 1,
    ], offset);
  }
  return { count, data: target.subarray(0, count * GPU_CARD_FLOATS) };
}

export const GALLERY_GPU_SHADER = /* wgsl */`
struct View {
  size: vec2f,
  pixelRatio: f32,
  bottomFade: f32,
}
struct Book {
  placement: vec4f,
  optics: vec4f,
  frontTexture: vec4f,
  backTexture: vec4f,
  options: vec4f,
  volume: vec4f,
  paper: vec4f,
}
@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage, read> books: array<Book>;
@group(0) @binding(2) var covers: texture_2d_array<f32>;
@group(0) @binding(3) var coverSampler: sampler;

struct VertexResult {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) @interpolate(flat) bookIndex: u32,
  @location(2) @interpolate(flat) face: u32,
  @location(3) @interpolate(flat) light: f32,
}

fn rotateVolume(point: vec3f, yaw: f32, pitch: f32) -> vec3f {
  let horizontal = point.x * cos(yaw) + point.z * sin(yaw);
  let depth = -point.x * sin(yaw) + point.z * cos(yaw);
  return vec3f(horizontal, point.y * cos(pitch) - depth * sin(pitch),
    point.y * sin(pitch) + depth * cos(pitch));
}

@vertex fn galleryVertex(@builtin(vertex_index) vertex: u32,
                         @builtin(instance_index) instance: u32) -> VertexResult {
  let corners = array<vec2f, 6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),
    vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
  let corner = corners[vertex % 6u];
  let book = books[instance];
  let face = vertex / 6u;
  let halfSize = book.placement.zw * .5;
  let halfDepth = book.volume.x * .5;
  let halo = select(0.0, book.optics.w, book.optics.z > 0.0);
  var result: VertexResult;
  result.position = vec4f(0,0,0,1);
  result.bookIndex = instance;
  result.face = face;
  result.light = 1.0;
  var point: vec3f;
  var center: vec3f;
  var normal: vec3f;
  switch face {
    case 0u: {
      result.local = corner * (halfSize + vec2f(halo));
      point = vec3f(result.local,halfDepth);
      center = vec3f(0,0,halfDepth); normal = vec3f(0,0,1);
    }
    case 1u: {
      result.local = corner * (halfSize + vec2f(halo));
      point = vec3f(-result.local.x,result.local.y,-halfDepth);
      center = vec3f(0,0,-halfDepth); normal = vec3f(0,0,-1);
    }
    case 2u: {
      result.local = corner * vec2f(halfDepth,halfSize.y);
      point = vec3f(-halfSize.x,result.local.y,result.local.x);
      center = vec3f(-halfSize.x,0,0); normal = vec3f(-1,0,0);
    }
    case 3u: {
      result.local = corner * vec2f(halfDepth,halfSize.y);
      point = vec3f(halfSize.x,result.local.y,-result.local.x);
      center = vec3f(halfSize.x,0,0); normal = vec3f(1,0,0);
    }
    case 4u: {
      result.local = corner * vec2f(halfSize.x,halfDepth);
      point = vec3f(result.local.x,-halfSize.y,result.local.y);
      center = vec3f(0,-halfSize.y,0); normal = vec3f(0,-1,0);
    }
    default: {
      result.local = corner * vec2f(halfSize.x,halfDepth);
      point = vec3f(result.local.x,halfSize.y,-result.local.y);
      center = vec3f(0,halfSize.y,0); normal = vec3f(0,1,0);
    }
  }
  let worldNormal = rotateVolume(normal,book.volume.y,book.volume.z);
  let worldCenter = rotateVolume(center,book.volume.y,book.volume.z);
  // Perspective-facing test, including the finite distance to the camera.
  if (dot(worldNormal,vec3f(-worldCenter.xy,book.volume.w-worldCenter.z)) <= 0.0) {
    return result;
  }
  let world = rotateVolume(point,book.volume.y,book.volume.z);
  let clipW = max(.1,1.0-world.z/book.volume.w);
  let rolled = vec2f(world.x*book.optics.x-world.y*book.optics.y,
    world.x*book.optics.y+world.y*book.optics.x);
  let screen = book.placement.xy*clipW+rolled;
  let depth = clamp(.5-world.z/(2.0*book.volume.w),0.0,1.0);
  result.position = vec4f(screen/view.size*vec2f(2,-2)+vec2f(-clipW,clipW),depth*clipW,clipW);
  result.light = clamp(.72+.28*worldNormal.z+.08*worldNormal.x-.12*worldNormal.y,.5,1.08);
  return result;
}

fn coverSample(local: vec2f, book: Book, textureInfo: vec4f, level: f32) -> vec4f {
  let pixel = (local/book.placement.zw+vec2f(.5))*textureInfo.xy+vec2f(book.frontTexture.w);
  let uv = pixel/vec2f(textureDimensions(covers,0));
  if (any(uv<vec2f(0)) || any(uv>vec2f(1))) { return vec4f(0); }
  return textureSampleLevel(covers,coverSampler,uv,i32(textureInfo.z),level);
}

fn filteredCover(local: vec2f, book: Book, textureInfo: vec4f) -> vec4f {
  let sigma = book.optics.z;
  let sourcePerCSS = textureInfo.xy/book.placement.zw;
  let sharpLevel = max(0.0,log2(max(sourcePerCSS.x,sourcePerCSS.y)/view.pixelRatio));
  if (sigma<.25) { return coverSample(local,book,textureInfo,sharpLevel); }
  // Mips supply low-frequency variance. Quadrature supplies the residual;
  // every tap samples one complete premultiplied RGBA texel.
  let level = clamp(log2(max(1.0,sigma*min(sourcePerCSS.x,sourcePerCSS.y)*2.0)),
    0.0,f32(textureNumLevels(covers)-1u));
  let mipSigma = exp2(level)/sourcePerCSS/sqrt(12.0);
  let residual = sqrt(max(vec2f(sigma*sigma)-mipSigma*mipSigma,vec2f(0)));
  if (sigma<12.0) {
    var sum = vec4f(0);
    for (var y:i32=-1;y<=1;y++) {
      for (var x:i32=-1;x<=1;x++) {
        let weight = select(.25,.5,x==0)*select(.25,.5,y==0);
        let delta = vec2f(f32(x),f32(y))*residual*sqrt(2.0);
        sum += coverSample(local+delta,book,textureInfo,level)*weight;
      }
    }
    return sum;
  }
  let radius = residual/sqrt(1.12);
  var sum = coverSample(local,book,textureInfo,level)*.2;
  let inner = array<vec2f,4>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(1,1));
  for (var index=0u;index<4u;index++) {
    sum += coverSample(local+inner[index]*radius,book,textureInfo,level)*.12;
  }
  let outer = array<vec2f,8>(vec2f(2,0),vec2f(-2,0),vec2f(0,2),vec2f(0,-2),
    vec2f(1.41421356,1.41421356),vec2f(-1.41421356,1.41421356),
    vec2f(1.41421356,-1.41421356),vec2f(-1.41421356,-1.41421356));
  for (var index=0u;index<8u;index++) {
    sum += coverSample(local+outer[index]*radius,book,textureInfo,level)*.04;
  }
  return sum;
}

fn edgeMaterial(local: vec2f, face: u32, book: Book, light: f32) -> vec4f {
  if (face==2u) { return vec4f(clamp(book.paper.rgb*light,vec3f(0),vec3f(1)),1); }
  let depthCoordinate = select(local.y,local.x,face==3u);
  let detailStrength = exp(-book.optics.z*book.optics.z*.02);
  let pages = (.5+.5*cos(depthCoordinate*3.92699082))*.025*detailStrength;
  let horizontal = select(0.0,(.5+.5*cos(local.y*1.04719755))*.012*detailStrength,face==3u);
  let binding = smoothstep(.65,1.0,abs(depthCoordinate)/(book.volume.x*.5))*.035;
  let paper = vec3f(.95,.935,.9)-vec3f(pages+horizontal+binding);
  return vec4f(clamp(paper*light,vec3f(0),vec3f(1)),1);
}

@fragment fn galleryFragment(input: VertexResult) -> @location(0) vec4f {
  let book = books[input.bookIndex];
  var color: vec4f;
  if (input.face>=2u) {
    color = edgeMaterial(input.local,input.face,book,input.light);
  } else {
    let info = select(book.frontTexture,book.backTexture,input.face==1u);
    let cover = filteredCover(input.local,book,info);
    color = vec4f(min(cover.rgb*input.light,vec3f(cover.a)),cover.a);
  }
  let luminance = dot(color.rgb,vec3f(.2126,.7152,.0722));
  color = vec4f(mix(color.rgb,vec3f(luminance),book.options.z),color.a);
  if (view.bottomFade>0.0) {
    let fromBottom = view.size.y-input.position.y/view.pixelRatio;
    color *= smoothstep(0.0,view.bottomFade,fromBottom);
  }
  return color;
}
`;

export const GALLERY_MIP_SHADER = /* wgsl */`
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
struct MipVertex { @builtin(position) position:vec4f, @location(0) uv:vec2f }
@vertex fn mipVertex(@builtin(vertex_index) index:u32) -> MipVertex {
  let triangle=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
  var result:MipVertex;
  result.position=vec4f(triangle[index],0,1);
  result.uv=triangle[index]*vec2f(.5,-.5)+vec2f(.5);
  return result;
}
@fragment fn mipFragment(input:MipVertex) -> @location(0) vec4f {
  return textureSampleLevel(source,sourceSampler,input.uv,0.0);
}
`;

async function shaderModule(device, label, code) {
  const module = device.createShaderModule({ label, code });
  if (module.getCompilationInfo) {
    const report = await module.getCompilationInfo();
    const errors = report.messages.filter(message => message.type === "error");
    if (errors.length) throw new Error(`${label}: ${errors.map(error => `${error.lineNum}:${error.linePos} ${error.message}`).join("; ")}`);
  }
  return module;
}

/** frame.height is the TOTAL paint height, including overflow. The caller owns
 * scheduling and promotion of this separate canvas over its2D fallback. */
export async function createGalleryGpu({ canvas, textures, onLost } = {}) {
  const gpu = globalThis.navigator?.gpu;
  if (!gpu) throw new Error("WebGPU is unavailable; use the Canvas gallery");
  const { fronts, backs } = textureArrays(textures);
  const atlas = getGpuTextureLayout(fronts, backs);
  const sources = [...fronts, ...backs];
  const adapter = await gpu.requestAdapter();
  if (!adapter) throw new Error("No WebGPU adapter is available");
  const device = await adapter.requestDevice({ label: "FRIM moving gallery" });
  let context, disposed = false, failure = null, unsubscribe;
  const resources = [];
  const own = resource => (resources.push(resource), resource);
  const fail = error => {
    if (disposed || failure) return;
    failure = error instanceof Error ? error : new Error(String(error));
    if (canvas.dataset?.renderer === "webgpu") delete canvas.dataset.renderer;
    try { onLost?.(failure); } catch { /* A consumer error must not hide device loss. */ }
  };
  const onUncapturedError = event => fail(new Error(`Gallery GPU validation failed: ${event.error?.message || "unknown GPU error"}`));
  device.addEventListener("uncapturederror", onUncapturedError);
  device.lost.then(info => fail(new Error(`Gallery GPU device lost (${info.reason}): ${info.message || "unavailable"}`))).catch(fail);
  const assertReady = () => {
    if (disposed) throw new Error("Gallery GPU renderer is disposed");
    if (failure) throw failure;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe?.();
    device.removeEventListener("uncapturederror", onUncapturedError);
    if (canvas.dataset?.renderer === "webgpu") delete canvas.dataset.renderer;
    try { context?.unconfigure(); } catch { /* Context may have been lost. */ }
    for (const resource of resources) resource.destroy?.();
    device.destroy();
  };
  try {
    if (atlas.width > device.limits.maxTextureDimension2D || atlas.height > device.limits.maxTextureDimension2D || atlas.layers > device.limits.maxTextureArrayLayers) {
      throw new RangeError("Gallery texture array exceeds this GPU's limits");
    }
    const texture = own(device.createTexture({
      label: "Gallery premultiplied covers", size: [atlas.width, atlas.height, atlas.layers],
      format: "rgba8unorm", mipLevelCount: atlas.mipLevelCount,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    }));
    const cards = own(device.createBuffer({ label: "Gallery ordered poses", size: GPU_CARD_LIMIT * GPU_CARD_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }));
    const view = own(device.createBuffer({ label: "Gallery viewport", size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    const [galleryModule, mipModule] = await Promise.all([
      shaderModule(device, "Gallery projection and material", GALLERY_GPU_SHADER),
      shaderModule(device, "Gallery mip generation", GALLERY_MIP_SHADER),
    ]);
    const format = gpu.getPreferredCanvasFormat();
    const [pipeline, mipPipeline] = await Promise.all([
      device.createRenderPipelineAsync({
        label: "Gallery books", layout: "auto",
        vertex: { module: galleryModule, entryPoint: "galleryVertex" },
        fragment: { module: galleryModule, entryPoint: "galleryFragment", targets: [{ format, blend: {
          color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
        } }] },
        primitive: { topology: "triangle-list", cullMode: "none" }, multisample: { count: 1 },
      }),
      device.createRenderPipelineAsync({
        label: "Gallery linear mip downsample", layout: "auto",
        vertex: { module: mipModule, entryPoint: "mipVertex" },
        fragment: { module: mipModule, entryPoint: "mipFragment", targets: [{ format: "rgba8unorm" }] },
        primitive: { topology: "triangle-list" },
      }),
    ]);
    const sampler = device.createSampler({ minFilter: "linear", magFilter: "linear", mipmapFilter: "linear" });
    const mipSampler = device.createSampler({ minFilter: "linear", magFilter: "linear" });
    const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: view } }, { binding: 1, resource: { buffer: cards } },
      { binding: 2, resource: texture.createView({ dimension: "2d-array" }) }, { binding: 3, resource: sampler },
    ] });
    // These views are immutable and reused if a font or photo repaints a layer.
    const mipPasses = Array.from({ length: atlas.layers }, (_, layer) =>
      Array.from({ length: atlas.mipLevelCount - 1 }, (_, level) => {
        const sourceView = texture.createView({ dimension: "2d", baseArrayLayer: layer, arrayLayerCount: 1, baseMipLevel: level, mipLevelCount: 1 });
        const destinationView = texture.createView({ dimension: "2d", baseArrayLayer: layer, arrayLayerCount: 1, baseMipLevel: level + 1, mipLevelCount: 1 });
        return { destinationView, bindGroup: device.createBindGroup({ layout: mipPipeline.getBindGroupLayout(0), entries: [
          { binding: 0, resource: sourceView }, { binding: 1, resource: mipSampler },
        ] }) };
      }));
    const uploadedVersions = Array(fronts.length).fill(-1);
    let dirty = true;
    unsubscribe = textures.subscribe?.(() => { dirty = true; });
    const uploadTextures = () => {
      const changedLayers = [];
      for (let index = 0; index < fronts.length; index++) {
        const version = textures.versions?.[index] ?? 0;
        if (uploadedVersions[index] === version) continue;
        for (const layer of backs.length ? [index, index + fronts.length] : [index]) {
          const source = sources[layer];
          if (source.width + GPU_TEXTURE_GUTTER * 2 > atlas.width || source.height + GPU_TEXTURE_GUTTER * 2 > atlas.height) {
            throw new RangeError("A repainted gallery texture no longer fits its allocated layer");
          }
          device.queue.copyExternalImageToTexture({ source }, {
            texture, origin: [GPU_TEXTURE_GUTTER, GPU_TEXTURE_GUTTER, layer],
            premultipliedAlpha: true, colorSpace: "srgb",
          }, [source.width, source.height]);
          changedLayers.push(layer);
        }
        uploadedVersions[index] = version;
      }
      if (changedLayers.length) {
        const encoder = device.createCommandEncoder({ label: "Gallery changed mip layers" });
        for (const layer of changedLayers) for (const mip of mipPasses[layer]) {
          const pass = encoder.beginRenderPass({ colorAttachments: [{ view: mip.destinationView, loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] });
          pass.setPipeline(mipPipeline); pass.setBindGroup(0, mip.bindGroup); pass.draw(3); pass.end();
        }
        device.queue.submit([encoder.finish()]);
      }
      dirty = false;
    };
    uploadTextures();
    context = canvas.getContext("webgpu");
    if (!context) throw new Error("A WebGPU canvas context is unavailable");
    canvas.width = canvas.height = 1;
    context.configure({ device, format, alphaMode: "premultiplied", colorSpace: "srgb",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
    await device.queue.onSubmittedWorkDone();
    assertReady();
    const cardData = new Float32Array(GPU_CARD_LIMIT * GPU_CARD_FLOATS);
    const viewport = new Float32Array(4);
    let previousView = "";
    const render = ({ poses = [], width, height, overflow = 0, bottomFade, pixelRatio } = {}) => {
      assertReady();
      try {
        if (![width, height].every(Number.isFinite) || width < 0 || height < 0) throw new RangeError("Gallery viewport dimensions must be nonnegative and finite");
        const requestedRatio = pixelRatio ?? Math.min(width < 640 ? 2 : 1.5, Math.max(1, finite(globalThis.devicePixelRatio, 1)));
        if (!Number.isFinite(requestedRatio) || requestedRatio <= 0) throw new RangeError("Gallery pixel ratio must be positive and finite");
        const ratio = Math.min(2, requestedRatio);
        const backingWidth = Math.max(1, Math.round(width * ratio));
        const backingHeight = Math.max(1, Math.round(height * ratio));
        if (Math.max(backingWidth, backingHeight) > device.limits.maxTextureDimension2D) throw new RangeError("Gallery viewport exceeds the GPU texture limit");
        if (canvas.width !== backingWidth) canvas.width = backingWidth;
        if (canvas.height !== backingHeight) canvas.height = backingHeight;
        if (canvas.style) { canvas.style.width = "100%"; canvas.style.height = `${height}px`; }
        const fade = clamp(finite(bottomFade, Math.round(Math.min(.6 * Math.max(0, finite(overflow)), 216))), 0, Math.max(1, height));
        const signature = `${width}:${height}:${ratio}:${fade}`;
        if (signature !== previousView) {
          viewport.set([Math.max(1, width), Math.max(1, height), ratio, fade]);
          device.queue.writeBuffer(view, 0, viewport);
          previousView = signature;
        }
        if (dirty || uploadedVersions.some((version, index) => version !== (textures.versions?.[index] ?? 0))) uploadTextures();
        const packed = packGalleryGpuCards(poses, textures, Math.max(1, width), Math.max(1, height), cardData);
        if (packed.count) device.queue.writeBuffer(cards, 0, packed.data);
        const encoder = device.createCommandEncoder({ label: "Gallery frame" });
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] });
        if (packed.count) { pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.draw(36, packed.count); }
        pass.end(); device.queue.submit([encoder.finish()]);
        assertReady();
      } catch (error) { fail(error); throw error; }
    };
    if (canvas.dataset) canvas.dataset.renderer = "webgpu";
    return { kind: "webgpu", render, dispose };
  } catch (error) {
    dispose();
    throw new Error("Gallery WebGPU initialization failed; use the Canvas gallery", { cause: error });
  }
}
