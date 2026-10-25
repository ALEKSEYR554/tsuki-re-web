"use strict";
/* wgpu.js — WebGPU renderer, same drawQuads contract as the Canvas2D one
   (render.js): quads from KW.Stage, textures from the boot texture map.
   Progressive enhancement: init() probes adapter+device WITHOUT touching
   the real canvas, so a failed probe leaves the canvas free for the
   Canvas2D fallback. On device loss, onDeviceLost fires and boot swaps in
   a fresh canvas + the Canvas2D renderer.

   Structure (mirrors knife-render's wgpu design):
   - one accumulation texture ("frame", cleared to black per frame);
   - native blends (alpha / multiply / screen — knife-render's own blend
     states) draw straight into it;
   - backdrop-reading Ps blends (knife-render's ps_* shader family, exact
     formulas) copy frame -> backdrop, then draw into frame reading it;
   - a final blit presents frame on the canvas.
   Clips are done on the CPU (Sutherland–Hodgman against the clip polygon,
   fan triangulation) — no stencil needed. Grade baking is NOT applied here
   either (parity: the Canvas2D path never calls bakeGrade today). */
var KP = globalThis.KP || (globalThis.KP = {});
(function () {
  // port blend name -> Ps op number (knife-render PsOp order)
  const PS_OP = {
    "add": 1, "darken": 2, "lighten": 3, "linear-burn": 4, "burn": 5,
    "dodge": 6, "dodge-alpha": 7, "difference": 8, "difference-alpha": 9,
    "exclusion": 10, "hard-light": 11, "hard-light-ex": 12, "overlay": 13,
    "soft-light": 14, "sub": 15, "add-noalpha": 16, "sub-noalpha": 17,
    "noalpha": 18,
  };
  // Sutherland–Hodgman: intersect subject polygon with convex clip polygon.
  // Verts are [x, y, u, v, r, g, b, a]; all components interpolate.
  function clipPoly(subject, clip) {
    let area = 0;
    for (let i = 0; i < clip.length; i++) {
      const a = clip[i], b = clip[(i + 1) % clip.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    const sign = area >= 0 ? 1 : -1;
    let out = subject;
    for (let i = 0; i < clip.length && out.length; i++) {
      const a = clip[i], b = clip[(i + 1) % clip.length];
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const inside = (p) => (ex * (p[1] - a[1]) - ey * (p[0] - a[0])) * sign >= 0;
      const inter = (p, q) => {
        // Crossing of segment p->q with the edge line, via cross ratios:
        // t = d1 / (d1 - d2) where d1, d2 are the signed distances of p, q
        // from the edge line (cross(edge, point - a)).
        const dx = q[0] - p[0], dy = q[1] - p[1];
        const d1 = ex * (p[1] - a[1]) - ey * (p[0] - a[0]);
        const den = d1 - (ex * (q[1] - a[1]) - ey * (q[0] - a[0]));
        const t = den !== 0 ? d1 / den : 0;
        const tt = Math.max(0, Math.min(1, t));
        // First 8 components (pos, uv, color) interpolate; the soft-clip
        // fields past them are per-quad constants, so copy them from p
        // instead of blending them toward the clip polygon's dummies.
        const r = new Array(p.length);
        for (let k = 0; k < 8; k++) r[k] = p[k] + (q[k] - p[k]) * tt;
        for (let k = 8; k < p.length; k++) r[k] = p[k];
        return r;
      };
      const next = [];
      for (let j = 0; j < out.length; j++) {
        const cur = out[j], prv = out[(j + out.length - 1) % out.length];
        const curIn = inside(cur), prvIn = inside(prv);
        if (curIn) {
          if (!prvIn) next.push(inter(prv, cur));
          next.push(cur);
        } else if (prvIn) next.push(inter(prv, cur));
      }
      out = next;
    }
    return out;
  }
  class WgpuRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.kind = "webgpu";
      this.cache = new Map();
      this.bakeTexCache = new Map(); // (image, stec, snx) -> baked GPU texture rec
      this.pending = new Map(); // url -> in-flight load promise (dedup)
      this.device = null;
      this.onDeviceLost = null;
      this.vbuf = null;
      this.vbufSize = 0;
      this.spriteBindCache = new Map();
      this.psBindCache = new Map();
    }
    async init() {
      if (!navigator.gpu) return false;
      let adapter = null, device = null;
      try {
        adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return false;
        device = await adapter.requestDevice();
      } catch (e) { return false; }
      if (!device) return false;
      this.device = device;
      this.W = this.canvas.width || 1920;
      this.H = this.canvas.height || 1080;
      const W = this.W, H = this.H;
      device.lost.then((info) => {
        this.device = null;
        if (this.onDeviceLost) this.onDeviceLost(info);
      });
      device.onuncapturederror = (e) => console.warn("[wgpu]", e.error && e.error.message || e);
      // NOTE: the canvas is configured LAST: if anything below fails, init
      // returns false with the canvas still untouched, so the Canvas2D
      // fallback can take it (a canvas with a WebGPU context cannot take
      // a 2d one).
      this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();
      device.pushErrorScope("validation");
      // frame is copied FROM (Ps backdrop source) and backdrop is copied
      // TO: both need the copy usages, or copyTextureToTexture fails
      // validation and the whole submit is dropped — every frame with a
      // Ps-blended quad (e.g. the "sub" line layers in 00_00) then either
      // freezes or renders against a zero backdrop. That was the 0006
      // flicker on the lines beat.
      this.frame = device.createTexture({
        size: [W, H, 1], format: "rgba8unorm",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
      });
      this.backdrop = device.createTexture({
        size: [W, H, 1], format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      this.frameView = this.frame.createView();
      // 1x1 white texture for colour-fill quads
      this.white = device.createTexture({
        size: [1, 1, 1], format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      device.queue.writeTexture({ texture: this.white }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1, 1]);
      // Effect targets (0028): FADS rule-transition scratch + ghost
      // scratch, all frame-sized. oldFrame holds the captured pre-
      // transition frame; transOut the transition result (copied back
      // into frame so the ghost pass and the blit always read frame).
      const mkTarget = (extra) => device.createTexture({
        size: [W, H, 1], format: "rgba8unorm",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST | extra,
      });
      this.oldFrame = mkTarget(0);
      this.transOut = mkTarget(0);
      this.ghostSrc = mkTarget(0);
      this.ghostChan = mkTarget(0);
      this.ghostOut = mkTarget(0);
      this.ghostOutRec = { texture: this.ghostOut, width: W, height: H };
      this.noiseTex = null;
      // 1x1 white rule texture: non-rule quads sample it with a
      // negative progress, which short-circuits the mask to 1
      this.whiteRule = device.createTexture({
        size: [1, 1, 1], format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      device.queue.writeTexture({ texture: this.whiteRule }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1, 1]);
      this.transParams = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.transBindCache = new Map();
      this.ghostVbuf = null;
      this.sampler = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
      // per-op uniform buffers (one write at init; avoids per-draw writes,
      // which would all land before the submitted commands)
      this.opBuffers = {};
      for (const op of Object.values(PS_OP)) {
        const b = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(b, 0, new Uint32Array([op, 0, 0, 0]));
        this.opBuffers[op] = b;
      }
      // Rule-aware sprite layout (0028): sprite texture, rule texture
      // (whiteRule for quads without a rule), sampler. The rule mask
      // short-circuits to 1 when the progress varying is negative.
      const spriteLayout = device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      ] });
      const transLayout = device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ] });
      const psLayout = device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ] });
      const blitLayout = device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      ] });
      // Soft-clip varyings: inner rect edges relative to the clip centre,
      // the centre (pivot), the clip rotation (cos, sin) and (radius, has).
      // Shared by the sprite and Ps fragment shaders.
      const softWgsl = `
        fn soft_mask(px: vec2<f32>, inner: vec4<f32>, pivot: vec2<f32>, rot: vec2<f32>, rad: f32) -> f32 {
          let d = px - pivot;
          let local = vec2<f32>(d.x * rot.x + d.y * rot.y, -d.x * rot.y + d.y * rot.x);
          let c = (inner.xy + inner.zw) * 0.5;
          let h = (inner.zw - inner.xy) * 0.5;
          let q = abs(local - c) - (h - vec2<f32>(rad));
          let sdf = length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - rad;
          return 1.0 - smoothstep(0.0, rad, sdf);
        }`;
      const spriteVert = device.createShaderModule({ code: `
        struct VsOut { @builtin(position) clip: vec4<f32>, @location(0) uv: vec2<f32>, @location(1) color: vec4<f32>, @location(2) px: vec2<f32>, @location(3) softInner: vec4<f32>, @location(4) softPivot: vec2<f32>, @location(5) softRot: vec2<f32>, @location(6) softRad: vec2<f32>, @location(7) hazeX: vec4<f32>, @location(8) hazeY: vec4<f32>, @location(9) rule: vec2<f32> };
        @vertex
        fn vs(@location(0) pos: vec2<f32>, @location(1) uv: vec2<f32>, @location(2) color: vec4<f32>, @location(3) softInner: vec4<f32>, @location(4) softPivot: vec2<f32>, @location(5) softRot: vec2<f32>, @location(6) softRad: vec2<f32>, @location(7) hazeX: vec4<f32>, @location(8) hazeY: vec4<f32>, @location(9) rule: vec2<f32>) -> VsOut {
          var o: VsOut;
          o.clip = vec4<f32>(pos.x / ${W}.0 * 2.0 - 1.0, 1.0 - pos.y / ${H}.0 * 2.0, 0.0, 1.0);
          o.uv = uv; o.color = color; o.px = pos;
          o.softInner = softInner; o.softPivot = softPivot; o.softRot = softRot; o.softRad = softRad;
          o.hazeX = hazeX; o.hazeY = hazeY; o.rule = rule;
          return o;
        }` });
      // Shared effect math (knife-render shader.wgsl): STRA haze waves
      // along v, and the screen-space rule mask.
      const fxWgsl = `
        fn haze_uv(uv: vec2<f32>, hx: vec4<f32>, hy: vec4<f32>) -> vec2<f32> {
          let tau = 6.2831853;
          let dx = sin(tau * (fract(uv.y * hx.y) + fract(hx.z))) * hx.x;
          let dy = cos(tau * (fract(uv.y * hy.y) + fract(hy.z))) * hy.x;
          return uv + vec2<f32>(dx, dy);
        }
        fn rule_mask(r: f32, p: f32) -> f32 {
          let v = 128.0 / 255.0;
          let t = clamp((r - ((1.0 + 2.0 * v) * p - v) + 0.5 * v) / v, 0.0, 1.0);
          return 1.0 - t * t * (3.0 - 2.0 * t);
        }`;
      // knife-render fs_sprite: the shader PREMULTIPLIES rgb by alpha.
      // img2230 (the blue glare) carries its softness entirely in alpha
      // (rgb stays bright blue where alpha fades to 2), so a straight
      // output + screen (src=One) added full blue over the whole quad —
      // the hard blue wash in 0007. With premultiplied output, screen
      // (One / OneMinusSrc) becomes the alpha-weighted screen, and the
      // alpha path is unchanged: (s*a,a)+(One,1-a) == s*a+d*(1-a).
      const fsSprite = device.createShaderModule({ code: `
        @group(0) @binding(0) var tex0: texture_2d<f32>;
        @group(0) @binding(1) var texRule: texture_2d<f32>;
        @group(0) @binding(2) var samp: sampler;
        ${softWgsl}
        ${fxWgsl}
        fn rule_at(uv: vec2<f32>, flags: f32) -> f32 {
          let f = u32(flags + 0.5);
          var q = uv;
          if ((f & 1u) != 0u) { q.x = 1.0 - q.x; }
          if ((f & 2u) != 0u) { q.y = 1.0 - q.y; }
          return textureSample(texRule, samp, q).r;
        }
        @fragment
        fn fs(@location(0) uv: vec2<f32>, @location(1) color: vec4<f32>, @location(2) px: vec2<f32>, @location(3) softInner: vec4<f32>, @location(4) softPivot: vec2<f32>, @location(5) softRot: vec2<f32>, @location(6) softRad: vec2<f32>, @location(7) hazeX: vec4<f32>, @location(8) hazeY: vec4<f32>, @location(9) rule: vec2<f32>) -> @location(0) vec4<f32> {
          let t = textureSample(tex0, samp, haze_uv(uv, hazeX, hazeY));
          var a = t.a * color.a;
          if (softRad.y > 0.5) { a *= soft_mask(px, softInner, softPivot, softRot, softRad.x); }
          if (rule.x >= 0.0) { a *= rule_mask(rule_at(px / vec2<f32>(${W}.0, ${H}.0), rule.y), rule.x); }
          return vec4<f32>(t.rgb * color.rgb * a, a);
        }` });
      // Ghost scratch shader (knife game/ghost.rs render, shader 2
      // noalpha): the frame times the channel-mask colour, alpha 1.
      const fsGhost = device.createShaderModule({ code: `
        @group(0) @binding(0) var tex0: texture_2d<f32>;
        @group(0) @binding(1) var texRule: texture_2d<f32>;
        @group(0) @binding(2) var samp: sampler;
        @fragment
        fn fs(@location(0) uv: vec2<f32>, @location(1) color: vec4<f32>) -> @location(0) vec4<f32> {
          let t = textureSample(tex0, samp, uv);
          return vec4<f32>(t.rgb * color.rgb, 1.0);
        }` });
      // FADS rule transition (fs_transition): old frame -> new frame
      // through the screen-space rule image.
      const fsTransition = device.createShaderModule({ code: `
        @group(0) @binding(0) var texOld: texture_2d<f32>;
        @group(0) @binding(1) var texNew: texture_2d<f32>;
        @group(0) @binding(2) var texRule: texture_2d<f32>;
        @group(0) @binding(3) var samp: sampler;
        @group(0) @binding(4) var<uniform> params: vec4<f32>;
        ${fxWgsl}
        fn rule_at(uv: vec2<f32>, flags: f32) -> f32 {
          let f = u32(flags + 0.5);
          var q = uv;
          if ((f & 1u) != 0u) { q.x = 1.0 - q.x; }
          if ((f & 2u) != 0u) { q.y = 1.0 - q.y; }
          return textureSample(texRule, samp, q).r;
        }
        @fragment
        fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
          let a = textureSample(texOld, samp, uv);
          let b = textureSample(texNew, samp, uv);
          let t = rule_mask(rule_at(uv, params.y), params.x);
          return vec4<f32>(mix(a.rgb, b.rgb, t), 1.0);
        }` });
      // Backdrop-reading blends: knife-render fs_ps, formulas verbatim.
      // tex0 = sprite, tex1 = backdrop copy, params.x = op.
      const fsPs = device.createShaderModule({ code: `
        @group(0) @binding(0) var tex0: texture_2d<f32>;
        @group(0) @binding(1) var tex1: texture_2d<f32>;
        @group(0) @binding(2) var samp: sampler;
        @group(0) @binding(3) var<uniform> params: vec4<u32>;
        ${softWgsl}
        ${fxWgsl}
        @fragment
        fn fs(@location(0) uv: vec2<f32>, @location(1) color: vec4<f32>, @location(2) px: vec2<f32>, @location(3) softInner: vec4<f32>, @location(4) softPivot: vec2<f32>, @location(5) softRot: vec2<f32>, @location(6) softRad: vec2<f32>, @location(7) hazeX: vec4<f32>, @location(8) hazeY: vec4<f32>) -> @location(0) vec4<f32> {
          let t = textureSample(tex0, samp, haze_uv(uv, hazeX, hazeY));
          let d4 = textureLoad(tex1, vec2<i32>(px), 0);
          let d = d4.rgb;
          let s = t.rgb * color.rgb;
          var a = t.a * color.a;
          var ca = color.a;
          if (softRad.y > 0.5) { let m = soft_mask(px, softInner, softPivot, softRot, softRad.x); a *= m; ca *= m; }
          let one = vec3<f32>(1.0);
          let zero = vec3<f32>(0.0);
          let op = params.x;
          if (a <= 0.0 && (op <= 15u || op == 19u)) { return d4; }
          var o = d;
          switch (op) {
            case 1u: { o = d + a * (min(d + s, one) - d); }
            case 2u: { o = d + a * (min(d, s) - d); }
            case 3u: { o = d + a * (max(d, s) - d); }
            case 4u: { o = d + a * (max(d + s - one, zero) - d); }
            case 5u: {
              let r = select(zero, max(one - (one - d) / s, zero), s > zero);
              o = d + a * (r - d);
            }
            case 6u: {
              let k = max(one - s, zero);
              o = d + a * (select(one, min(d / k, one), k > zero) - d);
            }
            case 7u: {
              let k = max(one - a * s, zero);
              o = select(zero, min(d / k, one), d > zero);
            }
            case 8u: { o = d + a * (abs(d - s) - d); }
            case 9u: { o = abs(d - a * s); }
            case 10u: { o = d + a * ((d + s - 2.0 * d * s) - d); }
            case 11u, 12u: {
              var h = s;
              if (op == 12u) { h = min(s / t.a, one); }
              let r = select(one - 2.0 * (one - h) * (one - d), 2.0 * d * h, h < vec3<f32>(0.5));
              o = d + a * (r - d);
            }
            case 13u: {
              let r = select(one - 2.0 * (one - s) * (one - d), 2.0 * d * s, d < vec3<f32>(0.5));
              o = d + a * (r - d);
            }
            case 14u: {
              let r = select(pow(d, one / (2.0 * s)), pow(d, 2.0 - 2.0 * s), s < vec3<f32>(0.5));
              o = d + a * (r - d);
            }
            case 15u: { o = max(d - a * (one - s), zero); }
            case 16u: { o = min(d + s * ca, one); }
            case 17u: { o = max(d - ca * (one - s), zero); }
            case 18u: { o = s; }
            case 19u: { o = d * d4.a + a * (s - d * d4.a); }
            default: {}
          }
          return vec4<f32>(o, 1.0);
        }` });
      const blitVert = device.createShaderModule({ code: `
        struct VsOut { @builtin(position) clip: vec4<f32>, @location(0) uv: vec2<f32> };
        @vertex
        fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
          var pos = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
          var o: VsOut;
          o.clip = vec4<f32>(pos[vi], 0.0, 1.0);
          o.uv = pos[vi] * 0.5 + 0.5;
          o.uv.y = 1.0 - o.uv.y;
          return o;
        }` });
      const fsBlit = device.createShaderModule({ code: `
        @group(0) @binding(0) var tex0: texture_2d<f32>;
        @group(0) @binding(1) var samp: sampler;
        @fragment
        fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
          let t = textureSample(tex0, samp, uv);
          return vec4<f32>(t.rgb, 1.0);
        }` });
      const vbufLayout = { arrayStride: 112, attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x2" },
        { shaderLocation: 1, offset: 8, format: "float32x2" },
        { shaderLocation: 2, offset: 16, format: "float32x4" },
        { shaderLocation: 3, offset: 32, format: "float32x4" },
        { shaderLocation: 4, offset: 48, format: "float32x2" },
        { shaderLocation: 5, offset: 56, format: "float32x2" },
        { shaderLocation: 6, offset: 64, format: "float32x2" },
        { shaderLocation: 7, offset: 72, format: "float32x4" },
        { shaderLocation: 8, offset: 88, format: "float32x4" },
        { shaderLocation: 9, offset: 104, format: "float32x2" },
      ] };
      // knife-render blend_state(), verbatim (alpha component included:
      // non-Over blends preserve the target's alpha).
      const alphaBlend = { color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
                           alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" } };
      const keepAlpha = { srcFactor: "zero", dstFactor: "one", operation: "add" };
      const mkSprite = (blend) => device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [spriteLayout] }),
        vertex: { module: spriteVert, entryPoint: "vs", buffers: [vbufLayout] },
        fragment: { module: fsSprite, entryPoint: "fs", targets: [{ format: "rgba8unorm", blend }] },
        primitive: { topology: "triangle-list", cullMode: "none" },
      });
      this.pipeSprite = {
        alpha: mkSprite(alphaBlend),
        multiply: mkSprite({ color: { srcFactor: "dst", dstFactor: "one-minus-src-alpha", operation: "add" },
                             alpha: keepAlpha }),
        screen: mkSprite({ color: { srcFactor: "one", dstFactor: "one-minus-src", operation: "add" },
                           alpha: keepAlpha }),
      };
      this.pipePs = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [psLayout] }),
        vertex: { module: spriteVert, entryPoint: "vs", buffers: [vbufLayout] },
        fragment: { module: fsPs, entryPoint: "fs", targets: [{ format: "rgba8unorm" }] },
        primitive: { topology: "triangle-list", cullMode: "none" },
      });
      const mkGhost = (blend) => device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [spriteLayout] }),
        vertex: { module: spriteVert, entryPoint: "vs", buffers: [vbufLayout] },
        fragment: { module: fsGhost, entryPoint: "fs", targets: [{ format: "rgba8unorm", blend }] },
        primitive: { topology: "triangle-list", cullMode: "none" },
      });
      this.pipeGhostOpaque = mkGhost(undefined);
      this.pipeGhostAdd = mkGhost({ color: { srcFactor: "one", dstFactor: "one", operation: "add" },
                                    alpha: { srcFactor: "zero", dstFactor: "one", operation: "add" } });
      this.pipeTrans = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [transLayout] }),
        vertex: { module: blitVert, entryPoint: "vs", buffers: [] },
        fragment: { module: fsTransition, entryPoint: "fs", targets: [{ format: "rgba8unorm" }] },
        primitive: { topology: "triangle-list", cullMode: "none" },
      });
      this.oldFrameView = this.oldFrame.createView();
      this.transOutView = this.transOut.createView();
      this.ghostSrcView = this.ghostSrc.createView();
      this.ghostChanView = this.ghostChan.createView();
      this.ghostOutView = this.ghostOut.createView();
      this.ghostSrcRec = { texture: this.ghostSrc, width: W, height: H };
      this.ghostChanRec = { texture: this.ghostChan, width: W, height: H };
      this.whiteRuleRec = { texture: this.whiteRule, width: 1, height: 1 };
      // 48 verts: 3 channels x (base + shifted) x 6, + chan quad 6 + overlay quad 6
      this.ghostVbuf = device.createBuffer({ size: 48 * 112, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      this.pipeBlit = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [blitLayout] }),
        vertex: { module: blitVert, entryPoint: "vs", buffers: [] },
        fragment: { module: fsBlit, entryPoint: "fs", targets: [{ format: this.canvasFormat }] },
        primitive: { topology: "triangle-list", cullMode: "none" },
      });
      this.blitBind = device.createBindGroup({ layout: blitLayout, entries: [
        { binding: 0, resource: this.frameView },
        { binding: 1, resource: this.sampler },
      ] });
      this.spriteLayout = spriteLayout;
      this.psLayout = psLayout;
      const scopeErr = await device.popErrorScope();
      if (scopeErr) { console.warn("[wgpu] pipeline validation failed:", scopeErr.message); return false; }
      this.ctx = this.canvas.getContext("webgpu");
      if (!this.ctx) return false;
      this.ctx.configure({ device, format: this.canvasFormat, alphaMode: "opaque" });
      return true;
    }
    setGrades(g) { this.grades = g; } // parity: the Canvas2D path never bakes either
    // Title unload: destroy the scene's GPU textures and drop the bind
    // groups that reference them. frame/backdrop/white are the
    // renderer's own and survive (the clear below and later scenes
    // need them); every scene texture is re-created on demand by
    // loadImage/bakedFor. Dawn defers the actual free until in-flight
    // work finishes, so destroying here (a user-action boundary, not
    // mid-frame) is safe.
    releaseTextures() {
      if (this.device) {
        for (const rec of this.cache.values()) { if (rec && rec.texture) { try { rec.texture.destroy(); } catch (e) {} } }
        for (const b of this.bakeTexCache.values()) { if (b && b.texture) { try { b.texture.destroy(); } catch (e) {} } }
      }
      this.cache.clear();
      this.bakeTexCache.clear();
      this.pending.clear();
      this.spriteBindCache.clear();
      this.psBindCache.clear();
    }
    async loadImage(url) {
      if (this.cache.has(url)) return this.cache.get(url);
      // in-flight dedup, same as the Canvas2D renderer: without it, one
      // absent texture spawned a parallel GPU texture per frame until
      // the first load landed, and the losers leaked VRAM until unload.
      if (this.pending.has(url)) return this.pending.get(url);
      const p = (async () => {
        const img = await new Promise((res) => {
          const im = new Image();
          // split deployment: cross-origin media must load with CORS,
          // or the texture upload reads a tainted image
          if (/^https?:\/\//.test(url)) im.crossOrigin = "anonymous";
          im.onload = () => res(im);
          im.onerror = () => res(null);
          im.src = url;
        });
        if (!img || !this.device) { this.cache.set(url, null); return null; }
        const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        if (!w || !h) { this.cache.set(url, null); return null; }
        const tex = this.device.createTexture({
          size: [w, h, 1], format: "rgba8unorm",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        try {
          this.device.queue.copyExternalImageToTexture({ source: img, flipY: false }, { texture: tex }, [w, h, 1]);
        } catch (e) { this.cache.set(url, null); return null; }
        const rec = { texture: tex, width: w, height: h, img };
        this.cache.set(url, rec);
        return rec;
      })();
      this.pending.set(url, p);
      p.then(() => { if (this.pending.get(url) === p) this.pending.delete(url); });
      return p;
    }
    // Per-(image, stec, snx) baked GPU texture for one quad; the raw rec
    // when no bake applies or no raw image is attached (white fallback).
    bakedFor(q, tex) {
      // STEC-1 fill: solid colour, texture alpha (fs_fill), via the
      // shared Canvas2D fill baker, uploaded as a GPU texture
      if (q.fill) {
        if (!tex.img || typeof KP.fillImage !== "function" || !this.device) return tex;
        const key = (q.name || "") + "|fill|" + q.fill.join(",");
        let b = this.bakeTexCache.get(key);
        if (!b) {
          const filled = KP.fillImage(tex.img, q.fill);
          const gt = this.device.createTexture({
            size: [filled.width, filled.height, 1], format: "rgba8unorm",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
          });
          try {
            this.device.queue.copyExternalImageToTexture({ source: filled, flipY: false }, { texture: gt }, [filled.width, filled.height, 1]);
          } catch (e) { return tex; }
          b = { texture: gt, width: filled.width, height: filled.height };
          this.bakeTexCache.set(key, b);
        }
        return b;
      }
      const stec = q.stec || 0;
      const snx = q.snx || [1, 1];
      if (stec < 2 && snx[0] === 1 && snx[1] === 1) return tex;
      if (!tex.img || typeof KP.bakeGrade !== "function" || !this.device) return tex;
      const key = (q.name || "") + "|" + stec + "|" + snx[0] + "|" + snx[1];
      let b = this.bakeTexCache.get(key);
      if (!b) {
        const baked = KP.bakeGrade(tex.img, this.grades ? this.grades[stec] : null, snx[0], snx[1]);
        if (baked === tex.img) return tex;
        const w = baked.width, h = baked.height;
        const gt = this.device.createTexture({
          size: [w, h, 1], format: "rgba8unorm",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        try {
          this.device.queue.copyExternalImageToTexture({ source: baked, flipY: false }, { texture: gt }, [w, h, 1]);
        } catch (e) { return tex; }
        b = { texture: gt, width: w, height: h };
        this.bakeTexCache.set(key, b);
      }
      return b;
    }
    spriteBind(texRec, ruleRec) {
      const ruleTex = (ruleRec && ruleRec.texture) || this.whiteRule;
      let byRule = this.spriteBindCache.get(texRec.texture);
      if (!byRule) { byRule = new Map(); this.spriteBindCache.set(texRec.texture, byRule); }
      let g = byRule.get(ruleTex);
      if (!g) {
        g = this.device.createBindGroup({ layout: this.spriteLayout, entries: [
          { binding: 0, resource: texRec.texture.createView() },
          { binding: 1, resource: ruleTex.createView() },
          { binding: 2, resource: this.sampler },
        ] });
        byRule.set(ruleTex, g);
      }
      return g;
    }
    transBind(ruleRec) {
      let g = this.transBindCache.get(ruleRec.texture);
      if (!g) {
        g = this.device.createBindGroup({ layout: this.transLayout, entries: [
          { binding: 0, resource: this.oldFrameView },
          { binding: 1, resource: this.frameView },
          { binding: 2, resource: ruleRec.texture.createView() },
          { binding: 3, resource: this.sampler },
          { binding: 4, resource: { buffer: this.transParams } },
        ] });
        this.transBindCache.set(ruleRec.texture, g);
      }
      return g;
    }
    // Capture the presented frame before a rule transition draws over
    // it (boot calls this before the first transition frame's draw).
    captureFrame() {
      if (!this.device) return;
      const encoder = this.device.createCommandEncoder();
      encoder.copyTextureToTexture({ texture: this.frame }, { texture: this.oldFrame }, [this.W, this.H, 1]);
      this.device.queue.submit([encoder.finish()]);
    }
    psBind(texRec, op) {
      const key = texRec.texture;
      let byOp = this.psBindCache.get(key);
      if (!byOp) { byOp = new Map(); this.psBindCache.set(key, byOp); }
      let g = byOp.get(op);
      if (!g) {
        g = this.device.createBindGroup({ layout: this.psLayout, entries: [
          { binding: 0, resource: texRec.texture.createView() },
          { binding: 1, resource: this.backdrop.createView() },
          { binding: 2, resource: this.sampler },
          { binding: 3, resource: { buffer: this.opBuffers[op] } },
        ] });
        byOp.set(op, g);
      }
      return g;
    }
    // Ghost scratch verts (knife game/ghost.rs render): 3 channels x
    // (base + shifted) x 6, + chan quad 6 + overlay quad 6 = 48 verts.
    // Each vert: pos, uv, color, soft(10 zeros, rad off), haze(8 zeros),
    // rule(-1, 0). Returned as a Float32Array.
    ghostVerts(g) {
      const W = this.W, H = this.H;
      const out = new Float32Array(48 * 28);
      const quad = (vi, x0, y0, x1, y1, col) => {
        const corners = [[x0, y0, 0, 0], [x1, y0, 1, 0], [x1, y1, 1, 1], [x0, y0, 0, 0], [x1, y1, 1, 1], [x0, y1, 0, 1]];
        for (let k = 0; k < 6; k++) {
          const o = (vi + k) * 28;
          const c = corners[k];
          out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = c[3];
          out[o + 4] = col[0]; out[o + 5] = col[1]; out[o + 6] = col[2]; out[o + 7] = col[3];
          out[o + 8] = 0; out[o + 9] = 0; out[o + 10] = 0; out[o + 11] = 0;
          out[o + 12] = 0; out[o + 13] = 0; out[o + 14] = 1; out[o + 15] = 0;
          out[o + 16] = 0; out[o + 17] = 0;
          for (let f = 18; f < 26; f++) out[o + f] = 0;
          out[o + 26] = -1; out[o + 27] = 0;
        }
      };
      for (let c = 0; c < 3; c++) {
        const col = [...g.cols[c], 1];
        quad(c * 12, 0, 0, W, H, col);
        const [ox, oy] = g.offs[c];
        quad(c * 12 + 6, ox, oy, W + ox, H + oy, col);
      }
      quad(36, 0, 0, W, H, [1, 1, 1, 1]);
      quad(42, 0, 0, W, H, [1, 1, 1, g.alpha]);
      return out;
    }
    drawQuads(quads, images, opts) {
      const device = this.device;
      if (!device) return;
      opts = opts || {};
      const W = this.W, H = this.H;
      // STNS grain: upload the boot-painted noise canvas once per frame
      if (opts.noiseCanvas) {
        if (!this.noiseTex) {
          this.noiseTex = device.createTexture({
            size: [W, H, 1], format: "rgba8unorm",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
          });
          this.noiseRec = { texture: this.noiseTex, width: W, height: H };
        }
        try {
          device.queue.copyExternalImageToTexture({ source: opts.noiseCanvas, flipY: false }, { texture: this.noiseTex }, [W, H, 1]);
        } catch (e) {}
      }
      // Phase 1: clip + triangulate + build vertices and the op list.
      const verts = [];
      const ops = [];
      for (const q of quads) {
        if (q.alpha <= 0) continue;
        let tex = null;
        let uv = q.uv || [0, 0, 1, 1];
        if (q.noise && this.noiseRec) {
          // STNS grain: RT40 instead of the image, uv full
          tex = this.noiseRec;
          uv = [0, 0, 1, 1];
        } else {
          if (images) tex = images[q.name] || images[(q.name || "").toLowerCase()];
          if (!tex) {
            if (!q.rgb) continue;
            tex = { texture: this.white, width: 1, height: 1, white: true };
          } else tex = this.bakedFor(q, tex);
        }
        const rgb = q.rgb || [1, 1, 1];
        const [p0, p1, p2, p3] = q.pos;
        // Soft-clip fields (per-quad constants): inner rect rel pivot,
        // pivot, (cos, sin) of the clip rotation, (radius, has).
        const sf = q.soft;
        const soft = sf ? [...sf.inner, ...sf.pivot, Math.cos(sf.rot), Math.sin(sf.rot), sf.radius, 1]
                        : [0, 0, 0, 0, 0, 0, 1, 0, 0, 0];
        const haze = q.haze ? [...q.haze[0], ...q.haze[1]] : [0, 0, 0, 0, 0, 0, 0, 0];
        // STTR rule: progress + flip varyings; -1 = no rule. The rule
        // texture comes from the images map (boot preloads data/rules).
        let ruleRec = null;
        const rule = q.rule ? [q.rule.progress, q.rule.flip] : [-1, 0];
        if (q.rule && images) ruleRec = images["rule_" + q.rule.n] || null;
        const subj = [
          [p0[0], p0[1], uv[0], uv[1], rgb[0], rgb[1], rgb[2], q.alpha, ...soft, ...haze, ...rule],
          [p1[0], p1[1], uv[2], uv[1], rgb[0], rgb[1], rgb[2], q.alpha, ...soft, ...haze, ...rule],
          [p2[0], p2[1], uv[2], uv[3], rgb[0], rgb[1], rgb[2], q.alpha, ...soft, ...haze, ...rule],
          [p3[0], p3[1], uv[0], uv[3], rgb[0], rgb[1], rgb[2], q.alpha, ...soft, ...haze, ...rule],
        ];
        let poly = subj;
        if (q.clip && q.clip.length >= 3) {
          // clipPoly walks the SUBJECT's vertices (interpolating their
          // uv/color); the clip polygon itself only supplies geometry, so
          // its extra components are dummies.
          poly = clipPoly(subj, q.clip.map((p) => [p[0], p[1], 0, 0, 0, 0, 0, 0]));
          if (!poly || poly.length < 3) continue;
        }
        const first = verts.length / 28;
        for (let i = 1; i < poly.length - 1; i++) {
          verts.push(...poly[0], ...poly[i], ...poly[i + 1]);
        }
        const count = (poly.length - 2) * 3;
        if (count <= 0) continue;
        const blend = q.blend || "alpha";
        if (q.rule && ruleRec) {
          // Rule + backdrop blend has no rule pipe (knife applies the
          // rule inside fs_ps too); fall back to the alpha pipe so the
          // wipe itself stays right
          const pipe = PS_OP[blend] !== undefined ? "alpha" : (blend === "multiply" || blend === "screen") ? blend : "alpha";
          ops.push({ kind: "sprite", pipe, tex, ruleTex: ruleRec, first, count });
        } else if (PS_OP[blend] !== undefined) ops.push({ kind: "ps", op: PS_OP[blend], tex, first, count });
        else if (blend === "multiply" || blend === "screen") ops.push({ kind: "sprite", pipe: blend, tex, first, count });
        else ops.push({ kind: "sprite", pipe: "alpha", tex, first, count });
      }
      // Phase 2: upload + encode.
      const bytes = verts.length * 4;
      if (bytes > 0) {
        if (!this.vbuf || bytes > this.vbufSize) {
          // old buffer is left for GC (destroying it could race in-flight work)
          this.vbufSize = Math.max(65536, bytes * 2);
          this.vbuf = device.createBuffer({ size: this.vbufSize, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        }
        device.queue.writeBuffer(this.vbuf, 0, new Float32Array(verts));
      }
      const encoder = device.createCommandEncoder();
      {
        const pass = encoder.beginRenderPass({ colorAttachments: [{
          view: this.frameView, loadOp: "clear", clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: "store",
        }] });
        pass.end();
      }
      let pass = null;
      const openPass = () => {
        if (!pass) pass = encoder.beginRenderPass({ colorAttachments: [{
          view: this.frameView, loadOp: "load", storeOp: "store",
        }] });
      };
      const closePass = () => { if (pass) { pass.end(); pass = null; } };
      for (const op of ops) {
        if (op.kind === "ps") {
          closePass();
          encoder.copyTextureToTexture({ texture: this.frame }, { texture: this.backdrop }, [W, H, 1]);
          const p = encoder.beginRenderPass({ colorAttachments: [{
            view: this.frameView, loadOp: "load", storeOp: "store",
          }] });
          p.setPipeline(this.pipePs);
          p.setBindGroup(0, this.psBind(op.tex, op.op));
          p.setVertexBuffer(0, this.vbuf);
          p.draw(op.count, 1, op.first, 0);
          p.end();
        } else {
          openPass();
          pass.setPipeline(this.pipeSprite[op.pipe]);
          pass.setBindGroup(0, this.spriteBind(op.tex, op.ruleTex));
          pass.setVertexBuffer(0, this.vbuf);
          pass.draw(op.count, 1, op.first, 0);
        }
      }
      closePass();
      // FADS rule transition (fs_transition): the captured old frame
      // and the new stage through the rule, back into frame so the
      // ghost pass and the blit always read frame
      if (opts.transition && opts.transition.ruleRec) {
        const t = opts.transition;
        device.queue.writeBuffer(this.transParams, 0, new Float32Array([t.progress, t.flip || 0, 0, 0]));
        const tp = encoder.beginRenderPass({ colorAttachments: [{
          view: this.transOutView, loadOp: "clear", clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: "store",
        }] });
        tp.setPipeline(this.pipeTrans);
        tp.setBindGroup(0, this.transBind(t.ruleRec));
        tp.draw(3, 1, 0, 0);
        tp.end();
        encoder.copyTextureToTexture({ texture: this.transOut }, { texture: this.frame }, [W, H, 1]);
      }
      // FADE 40/41 ghost pass (knife game/ghost.rs render): frame into
      // src, per-channel masked + shifted copies into chan, red
      // replaces / green+blue add into out, then the overlay blend
      // (PsOp 13) onto frame at the effect alpha
      if (opts.ghost && opts.ghost.alpha > 0) {
        const g = opts.ghost;
        device.queue.writeBuffer(this.ghostVbuf, 0, this.ghostVerts(g));
        encoder.copyTextureToTexture({ texture: this.frame }, { texture: this.ghostSrc }, [W, H, 1]);
        for (let c = 0; c < 3; c++) {
          const p = encoder.beginRenderPass({ colorAttachments: [{
            view: this.ghostChanView, loadOp: "clear", clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: "store",
          }] });
          p.setPipeline(this.pipeGhostOpaque);
          p.setBindGroup(0, this.spriteBind(this.ghostSrcRec, null));
          p.setVertexBuffer(0, this.ghostVbuf);
          p.draw(12, 1, c * 12, 0);
          p.end();
        }
        for (let c = 0; c < 3; c++) {
          const p = encoder.beginRenderPass({ colorAttachments: [{
            view: this.ghostOutView, loadOp: c === 0 ? "clear" : "load", clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: "store",
          }] });
          p.setPipeline(c === 0 ? this.pipeGhostOpaque : this.pipeGhostAdd);
          p.setBindGroup(0, this.spriteBind(this.ghostChanRec, null));
          p.setVertexBuffer(0, this.ghostVbuf);
          p.draw(6, 1, 36, 0);
          p.end();
        }
        encoder.copyTextureToTexture({ texture: this.frame }, { texture: this.backdrop }, [W, H, 1]);
        const p = encoder.beginRenderPass({ colorAttachments: [{
          view: this.frameView, loadOp: "load", storeOp: "store",
        }] });
        p.setPipeline(this.pipePs);
        p.setBindGroup(0, this.psBind(this.ghostOutRec, 13));
        p.setVertexBuffer(0, this.ghostVbuf);
        p.draw(6, 1, 42, 0);
        p.end();
      }
      {
        const pass = encoder.beginRenderPass({ colorAttachments: [{
          view: this.ctx.getCurrentTexture().createView(), loadOp: "clear",
          clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: "store",
        }] });
        pass.setPipeline(this.pipeBlit);
        pass.setBindGroup(0, this.blitBind);
        pass.draw(3, 1, 0, 0);
        pass.end();
      }
      device.queue.submit([encoder.finish()]);
    }
  }
  KP.WgpuRenderer = WgpuRenderer;
  if (typeof module !== "undefined") module.exports = KP;
})();
