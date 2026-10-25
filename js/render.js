"use strict";
/* render.js — Canvas2D renderer over KW.Stage quads (knife stage.rs
   layer_quad output). A quad's corners already carry pivot, zoom, rotation,
   shake and SOXY; the renderer only maps the unit square onto them, applies
   the clip polygon, alpha, colour and the blend mode (knife's PsOp names
   mapped to canvas composite ops; modes with no canvas equivalent fall back
   to source-over and are noted). Textures are grade-baked at load exactly
   like knife's pre_alter: grey + levels + tints from grades.json, then the
   layer's SNX2/SNX3 brightness/contrast — baked per (image, grade, snx)
   key, cached. Effects ported from knife-render: STTR/FADS rule wipes
   (fs_rule/fs_transition math), STNS grain (the never-cleared noise
   canvas), STRA haze (horizontal strips, exact for axis-aligned quads),
   STEC-1 fill (fs_fill) and the FADE 40/41 ghost pass. GAP: clip
   soft-edge coloured bands (stage.rs band()) are not drawn yet. */
var KP = globalThis.KP || (globalThis.KP = {});
(function () {
  const COMPOSITE = {
    "alpha": "source-over", "add": "lighter", "darken": "darken", "lighten": "lighten",
    "multiply": "multiply", "screen": "screen", "overlay": "overlay",
    "difference": "difference", "sub": "source-over", "burn": "color-burn",
    "dodge": "color-dodge", "exclusion": "exclusion", "hard-light": "hard-light",
    "soft-light": "soft-light", "linear-burn": "source-over",
    "dodge-alpha": "color-dodge", "difference-alpha": "difference",
    "add-noalpha": "lighter", "sub-noalpha": "source-over", "noalpha": "source-over",
    "hard-light-ex": "hard-light",
  };
  // ---- faithful knife grade.rs bake (shared with the WebGPU path) ----
  const G_UNSET = -9;
  function gradeParams(row) {
    const set = (v) => v !== G_UNSET;
    const p = { gain: [1, 1, 1], low: [0, 0, 0], high: [1, 1, 1], amount: 0, grey: false, keepZero: false, tints: [] };
    let any = false;
    for (let c = 0; c < 3; c++) {
      if (set(row[3 * c])) { p.gain[c] = row[3 * c]; any = true; }
      if (set(row[3 * c + 1])) { p.low[c] = row[3 * c + 1] / 255; any = true; }
      if (set(row[3 * c + 2])) { p.high[c] = row[3 * c + 2] / 255; any = true; }
    }
    const flag = row[9] | 0;
    if (any || flag === 1 || flag === 2) p.amount = 1;
    p.grey = flag === 1 || flag === 2;
    p.keepZero = flag === 3;
    for (const t of [row.slice(10, 15), row.slice(15, 20)]) {
      const mode = t[4] | 0;
      if (mode >= 1) p.tints.push({ rgb: [Math.max(0, t[0]) / 255, Math.max(0, t[1]) / 255, Math.max(0, t[2]) / 255], a: Math.max(0, t[3]) / 255, mode });
    }
    return p;
  }
  function gradeTint(x, t, a, mode) {
    const tt = 255 * t;
    switch (mode) {
      case 2: return x + (tt - x) * a;
      case 3: return Math.min(x + tt * a, 255);
      case 5: return x + (tt * x / 255 - x) * a;
      case 8: return Math.min(x / (255 - tt * a) * 255, x <= 3 ? 0 : 255);
      case 14: return x + (Math.min(tt + x, 255) - x) * a;
      case 17: return x + (255 - (255 - tt) * (255 - x) / 255 - x) * a;
      case 18: { const r = x < 128 ? 2 * x * t : 255 - (255 - x) * (2 - 2 * t); return x + (r - x) * a; }
      default: return x;
    }
  }
  function gradeChannels(p, v) {
    const amount = Math.max(0, Math.min(1, p.amount));
    if (amount > 0) {
      for (let c = 0; c < 3; c++) {
        const x = v[c];
        if (p.keepZero && c > 0 && x === 0) continue;
        const g = p.gain[c];
        const curve = g <= 0 ? 0 : g === 1 ? x : Math.pow(x / 255, 1 / g) * 255;
        const lv = 255 * p.low[c] + (p.high[c] - p.low[c]) * curve;
        v[c] = x + amount * (lv - x);
      }
    }
    for (const t of p.tints) for (let c = 0; c < 3; c++) v[c] = gradeTint(v[c], t.rgb[c], t.a, t.mode);
    for (let c = 0; c < 3; c++) v[c] = Math.max(0, Math.min(255, v[c]));
    return v;
  }
  // pre_alter's first step on a source byte, in 0..255 levels (sRGB source):
  // sRGB-decode, then pow(..., 1/2.2).
  const GRADE_PRE = (() => {
    const t = new Float32Array(256);
    for (let x = 0; x < 256; x++) {
      const s = x / 255;
      const lin = s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      t[x] = 255 * Math.pow(lin, 1 / 2.2);
    }
    return t;
  })();
  function gradeTone(x, bright, contrast) {
    x = Math.max(0, Math.min(255, x + 255 * bright - 255));
    let k;
    if (contrast <= 1) k = (contrast * 200 + 55) / 255;
    else { const t = contrast * 100 - 100; k = (t / (127.5 - t) * 127.5 + 127.5) / 127.5; }
    return Math.max(0, Math.min(255, (x - 127.5) * k + 127.5)) / 255;
  }
  function gradeSrgbByte(l) {
    l = Math.max(0, Math.min(1, l));
    const e = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
    return Math.round(e * 255);
  }
  // Bake an image with an STEC grade row and SNX2/SNX3 factors.
  // gradeRow null = no grade (tone only). Returns a canvas, or the input
  // unchanged when nothing needs baking. Alpha is untouched.
  // No sRGB re-encode at the end, deliberately: knife's pre_alter works
  // in the GRADE_PRE space and its output IS the frame value (the
  // present shader's pow 2.2 + the sRGB swapchain bring it back on
  // display); this port displays frame values directly (Canvas2D /
  // non-sRGB wgpu blit), so the baked canvas must hold pre_alter's
  // output as-is. The old code re-encoded with gradeSrgbByte here and
  // double-gamma'd every baked texture (wood byte 80 -> 153 at neutral
  // tone, 174 with SNX2 27 — the v13 wall-cut regression).
  function bakeGradeImage(img, gradeRow, bright, contrast) {
    bright = bright === undefined ? 1 : bright; contrast = contrast === undefined ? 1 : contrast;
    if (!gradeRow && bright === 1 && contrast === 1) return img;
    const c = document.createElement("canvas");
    c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0);
    try {
      const id = x.getImageData(0, 0, c.width, c.height);
      const d = id.data;
      const p = gradeRow ? gradeParams(gradeRow) : null;
      if (p && !p.grey) {
        // channels() is per-channel for non-grey grades: one LUT per channel
        const lut = [new Uint8Array(256), new Uint8Array(256), new Uint8Array(256)];
        for (let ch = 0; ch < 3; ch++) {
          for (let b = 0; b < 256; b++) {
            const v = gradeChannels(p, [GRADE_PRE[b], GRADE_PRE[b], GRADE_PRE[b]]);
            lut[ch][b] = Math.round(gradeTone(v[ch], bright, contrast) * 255);
          }
        }
        for (let i = 0; i < d.length; i += 4) {
          d[i] = lut[0][d[i]]; d[i + 1] = lut[1][d[i + 1]]; d[i + 2] = lut[2][d[i + 2]];
        }
      } else {
        for (let i = 0; i < d.length; i += 4) {
          let v;
          if (p) {
            const g = (GRADE_PRE[d[i]] * 54 + GRADE_PRE[d[i + 1]] * 183 + GRADE_PRE[d[i + 2]] * 19) / 256;
            v = gradeChannels(p, [g, g, g]);
          } else v = [GRADE_PRE[d[i]], GRADE_PRE[d[i + 1]], GRADE_PRE[d[i + 2]]];
          d[i] = Math.round(gradeTone(v[0], bright, contrast) * 255);
          d[i + 1] = Math.round(gradeTone(v[1], bright, contrast) * 255);
          d[i + 2] = Math.round(gradeTone(v[2], bright, contrast) * 255);
        }
      }
      x.putImageData(id, 0, 0);
    } catch (e) { /* tainted canvas: fall back to the raw image */ return img; }
    return c;
  }
  KP.bakeGrade = bakeGradeImage;
  // ---- knife-render shader.wgsl, shared with the WebGPU path ----
  // nexl_nxshader_transition: visible where the rule is below the edge.
  function ruleMask(r, p) {
    const v = 128.0 / 255.0;
    const t = Math.max(0, Math.min(1, (r - ((1.0 + 2.0 * v) * p - v) + 0.5 * v) / v));
    return 1.0 - t * t * (3.0 - 2.0 * t);
  }
  KP.ruleMask = ruleMask;
  // fs_fill: solid colour keeping the texture alpha.
  function fillImage(tex, rgb) {
    const c = document.createElement("canvas");
    c.width = tex.naturalWidth || tex.width; c.height = tex.naturalHeight || tex.height;
    const x = c.getContext("2d");
    x.drawImage(tex, 0, 0);
    x.globalCompositeOperation = "source-in";
    x.fillStyle = `rgb(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)})`;
    x.fillRect(0, 0, c.width, c.height);
    return c;
  }
  KP.fillImage = fillImage;
  // STRA haze displacement (haze_uv): both offsets are waves along v.
  function hazeShift(haze, v) {
    const tau = 6.2831853;
    const hx = haze[0], hy = haze[1];
    const frac = (x) => x - Math.floor(x);
    return [
      Math.sin(tau * (frac(v * hx[1]) + frac(hx[2]))) * hx[0],
      Math.cos(tau * (frac(v * hy[1]) + frac(hy[2]))) * hy[0],
    ];
  }
  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas ? canvas.getContext("2d") : null;
      this.cache = new Map(); // key -> canvas|HTMLImageElement
      this.bakeCache = new Map(); // (image, stec, snx) -> baked canvas|image
      this.fillCache = new Map(); // (image, fill rgb) -> fill canvas
      this.tintCache = new Map(); // texture -> (rgb -> tinted canvas), clip bands
      this.pending = new Map(); // key -> in-flight load promise (dedup)
      this.grades = null;
      this.lastFrame = null;
      this.oldCanvas = null; // FADS rule-transition capture (boot fills it)
      this.ruleMaskCache = new Map(); // (rule src, flip, progress) -> mask canvas
      this.scratch = null; // ghost pass canvases, lazy
    }
    // Capture the presented frame before a rule transition draws over it.
    captureFrame() {
      if (!this.ctx) return;
      if (!this.oldCanvas) {
        this.oldCanvas = document.createElement("canvas");
        this.oldCanvas.width = this.canvas.width; this.oldCanvas.height = this.canvas.height;
      }
      const x = this.oldCanvas.getContext("2d");
      x.clearRect(0, 0, this.oldCanvas.width, this.oldCanvas.height);
      x.drawImage(this.canvas, 0, 0);
    }
    // Screen-space rule mask at the rule texture's resolution: white
    // with alpha = ruleMask(r, progress). progress quantized to 1/128
    // and cached (a wipe sweeps it, so each frame builds at most one).
    ruleMaskCanvas(ruleImg, progress, flip) {
      const key = (ruleImg.src || ruleImg) + "|" + flip + "|" + Math.round(progress * 128);
      let mc = this.ruleMaskCache.get(key);
      if (mc) return mc;
      const w = ruleImg.naturalWidth || ruleImg.width, h = ruleImg.naturalHeight || ruleImg.height;
      mc = document.createElement("canvas");
      mc.width = w; mc.height = h;
      const x = mc.getContext("2d");
      const fx = (flip & 1) !== 0, fy = (flip & 2) !== 0;
      if (fx || fy) x.drawImage(ruleImg, fx ? w : 0, fy ? h : 0, fx ? -w : w, fy ? -h : h);
      else x.drawImage(ruleImg, 0, 0);
      const id = x.getImageData(0, 0, w, h);
      const d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const a = Math.round(ruleMask(d[i] / 255, progress) * 255);
        d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = a;
      }
      x.putImageData(id, 0, 0);
      this.ruleMaskCache.set(key, mc);
      if (this.ruleMaskCache.size > 8) { const k0 = this.ruleMaskCache.keys().next().value; this.ruleMaskCache.delete(k0); }
      return mc;
    }
    setGrades(g) { this.grades = g; }
    // Title unload: drop every cached image and baked canvas, so a
    // finished scene stops holding (decoded) texture memory.
    releaseTextures() { this.cache.clear(); this.bakeCache.clear(); this.pending.clear(); }
    async loadImage(url, bakeKey) {
      const key = url + "|" + (bakeKey || "");
      if (this.cache.has(key)) return this.cache.get(key);
      // in-flight dedup: draw() used to call loadImage every frame for a
      // missing texture, and the cache only filled after the load, so
      // one absent texture spawned dozens of parallel Images.
      if (this.pending.has(key)) return this.pending.get(key);
      const p = (async () => {
        const img = await new Promise((res) => {
          const im = new Image();
          // split deployment: cross-origin media must load with CORS,
          // or the canvas taints and thumbnails / frame capture break
          if (/^https?:\/\//.test(url)) im.crossOrigin = "anonymous";
          im.onload = () => res(im);
          im.onerror = () => res(null);
          im.src = url;
        });
        if (!img) { this.cache.set(key, null); return null; }
        this.cache.set(key, img);
        return img;
      })();
      this.pending.set(key, p);
      p.then(() => { if (this.pending.get(key) === p) this.pending.delete(key); });
      return p;
    }
    // grade bake: faithful port of knife grade.rs pre_alter (shader 44) +
    // Bake::tone, applied to an sRGB image. grades.json row layout, per
    // channel: [gain, low, high] x3 (0..255 levels, -9 = unset), flag at
    // [9] (1/2 = grey, 3 = keep_zero), two tints at [10..15] and [15..20]
    // as (r, g, b, amount 0..255, blend mode). The old layout here was
    // wrong (it read grey/low/high/gain shifted by one) and, worse, this
    // method was never called from the draw path at all — STEC grades
    // were silently ignored by both renderers.
    bakeGrade(img, gradeRow, snx) {
      return bakeGradeImage(img, gradeRow, snx ? snx[0] : 1, snx ? snx[1] : 1);
    }
    // Per-(image, stec, snx) baked texture for one quad; raw image when
    // no bake applies (stec < 2 and SNX2/SNX3 at 1).
    bakedFor(q, tex) {
      // STEC-1 fill first: solid colour, texture alpha (fs_fill); the
      // grade/tone bake does not apply to a fill (knife bakes the fill
      // into the texture rgb at build time)
      if (q.fill) {
        const key = (q.name || "") + "|fill|" + q.fill.join(",");
        let f = this.fillCache.get(key);
        if (!f) { f = fillImage(tex, q.fill); this.fillCache.set(key, f); }
        return f;
      }
      const stec = q.stec || 0;
      const snx = q.snx || [1, 1];
      if (stec < 2 && snx[0] === 1 && snx[1] === 1) return tex;
      const key = (q.name || "") + "|" + stec + "|" + snx[0] + "|" + snx[1];
      let b = this.bakeCache.get(key);
      if (!b) {
        const row = this.grades ? this.grades[stec] : null;
        b = bakeGradeImage(tex, row, snx[0], snx[1]);
        this.bakeCache.set(key, b);
      }
      return b;
    }
    // knife fs_sprite multiplies texture rgb by the vertex colour; Canvas2D
    // has no tinted blit, so bake it once per (texture, colour): exact
    // ImageData multiply, alpha untouched (WebGPU does this in-shader).
    tinted(tex, rgb) {
      if (!rgb || (rgb[0] === 1 && rgb[1] === 1 && rgb[2] === 1)) return tex;
      let per = this.tintCache.get(tex);
      if (!per) { per = new Map(); this.tintCache.set(tex, per); }
      const key = rgb.join(",");
      let out = per.get(key);
      if (out) return out;
      const c = document.createElement("canvas"); c.width = tex.width; c.height = tex.height;
      const x = c.getContext("2d"); x.drawImage(tex, 0, 0);
      const img = x.getImageData(0, 0, c.width, c.height), d = img.data;
      for (let i = 0; i < d.length; i += 4) { d[i] *= rgb[0]; d[i + 1] *= rgb[1]; d[i + 2] *= rgb[2]; }
      x.putImageData(img, 0, 0);
      per.set(key, c);
      return c;
    }
    // One quad onto ctx (alpha/composite set by the caller through j).
    drawOne(ctx, j, W, H) {
      const q = j.q;
      ctx.save();
      ctx.globalAlpha = j.alpha;
      ctx.globalCompositeOperation = j.composite;
      if (q.clip) {
        ctx.beginPath();
        q.clip.forEach((p, i) => { if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); });
        ctx.closePath();
        ctx.clip();
      }
      if (j.fill) {
        const rgb = q.rgb || [0, 0, 0];
        ctx.fillStyle = `rgb(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)})`;
        ctx.fillRect(j.x0, j.y0, j.x1 - j.x0, j.y1 - j.y0);
      } else {
        // affine map: unit square -> quad (pos[0] TL, pos[1] TR, pos[3] BL)
        const [p0, p1, , p3] = q.pos;
        const a = p1[0] - p0[0], b = p1[1] - p0[1];
        const cc = p3[0] - p0[0], d = p3[1] - p0[1];
        const uv = j.uv || q.uv || [0, 0, 1, 1];
        const iw = j.tex.width, ih = j.tex.height;
        // Axis-aligned quads (the common case: STCH zoom, no rotation)
        // are drawn viewport-cropped: a 17.72x zoom (STZ4 1772) makes a
        // ~24000px quad, and rasterizing all of it every frame is what
        // tanks weak GPUs. Intersecting with the canvas first turns it
        // into one viewport-sized blit with identical output.
        const eps = 0.001;
        if (Math.abs(b) < eps && Math.abs(cc) < eps && a > 0 && d > 0) {
          const x0 = Math.max(0, p0[0]), y0 = Math.max(0, p0[1]);
          const x1 = Math.min(W, p0[0] + a), y1 = Math.min(H, p0[1] + d);
          if (x1 > x0 && y1 > y0) {
            if (q.haze) {
              // STRA haze: both offsets are waves along v, so a
              // horizontal strip at v samples one (dx, dy) — exact for
              // axis-aligned quads (rotated haze quads fall back plain)
              const STRIP = 4;
              for (let y = y0; y < y1; y += STRIP) {
                const sh = Math.min(STRIP, y1 - y);
                const vc = uv[1] + ((y + sh / 2 - p0[1]) / d) * (uv[3] - uv[1]);
                const [dxUv, dyUv] = hazeShift(q.haze, vc);
                const dxPx = (uv[2] - uv[0]) !== 0 ? dxUv / (uv[2] - uv[0]) * a : 0;
                const dyPx = (uv[3] - uv[1]) !== 0 ? dyUv / (uv[3] - uv[1]) * d : 0;
                const sx = (uv[0] + ((x0 + dxPx - p0[0]) / a) * (uv[2] - uv[0])) * iw;
                const sy = (uv[1] + ((y + dyPx - p0[1]) / d) * (uv[3] - uv[1])) * ih;
                const sw = (x1 - x0) / a * (uv[2] - uv[0]) * iw;
                const sh2 = sh / d * (uv[3] - uv[1]) * ih;
                if (sw > 0 && sh2 > 0) ctx.drawImage(j.tex, sx, sy, sw, sh2, x0, y, x1 - x0, sh);
              }
            } else {
              const ux0 = (x0 - p0[0]) / a, uy0 = (y0 - p0[1]) / d;
              const ux1 = (x1 - p0[0]) / a, uy1 = (y1 - p0[1]) / d;
              const sx = (uv[0] + ux0 * (uv[2] - uv[0])) * iw;
              const sy = (uv[1] + uy0 * (uv[3] - uv[1])) * ih;
              const sw = (ux1 - ux0) * (uv[2] - uv[0]) * iw;
              const sh = (uy1 - uy0) * (uv[3] - uv[1]) * ih;
              if (sw > 0 && sh > 0) ctx.drawImage(j.tex, sx, sy, sw, sh, x0, y0, x1 - x0, y1 - y0);
            }
          }
        } else {
          ctx.transform(a, b, cc, d, p0[0], p0[1]);
          ctx.drawImage(j.tex, uv[0] * iw, uv[1] * ih, (uv[2] - uv[0]) * iw, (uv[3] - uv[1]) * ih, 0, 0, 1, 1);
        }
      }
      ctx.restore();
    }
    drawQuads(quads, images, opts) {
      const ctx = this.ctx;
      if (!ctx) return Promise.resolve();
      opts = opts || {};
      const W = this.canvas.width, H = this.canvas.height;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      const jobs = [];
      for (const q of quads) {
        if (q.alpha <= 0) continue;
        // STNS grain: the layer shows the noise canvas instead of its
        // image, uv full (knife stage.rs: tex = RT40, uv [0,0,1,1])
        if (q.noise && opts.noise) { jobs.push({ fill: false, q, tex: opts.noise, uv: [0, 0, 1, 1], alpha: q.alpha, composite: COMPOSITE[q.blend] || "source-over" }); continue; }
        const tex = images[q.name] || images[(q.name || "").toLowerCase()];
        if (tex) { const t = q.tint ? this.tinted(tex, q.rgb) : tex; jobs.push({ fill: false, q, tex: this.bakedFor(q, t), alpha: q.alpha, composite: COMPOSITE[q.blend] || "source-over" }); continue; }
        // no texture: a colour layer (BLACK/WHITE) — fill the quad's box
        if (q.rgb) {
          const xs = q.pos.map((p) => p[0]), ys = q.pos.map((p) => p[1]);
          jobs.push({ fill: true, q, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), alpha: q.alpha, composite: COMPOSITE[q.blend] || "source-over" });
        }
      }
      // STTR per-layer rule wipes go through a full-canvas temp: the
      // layer is drawn at alpha 1, masked by the screen-space rule at
      // progress = the layer's alpha, then composited at that alpha
      // (fs_rule: a = t.a * color.a * m)
      let tmp = null, tmpCtx = null;
      const ruleTmp = () => {
        if (!tmp) {
          tmp = document.createElement("canvas"); tmp.width = W; tmp.height = H;
          tmpCtx = tmp.getContext("2d");
        }
        return tmpCtx;
      };
      for (const j of jobs) {
        const q = j.q;
        if (q.rule && opts.rules && opts.rules["rule_" + q.rule.n]) {
          const tctx = ruleTmp();
          tctx.clearRect(0, 0, W, H);
          tctx.globalCompositeOperation = "source-over";
          this.drawOne(tctx, { ...j, alpha: 1, composite: "source-over" }, W, H);
          const mask = this.ruleMaskCanvas(opts.rules["rule_" + q.rule.n], q.rule.progress, q.rule.flip);
          tctx.globalCompositeOperation = "destination-in";
          tctx.drawImage(mask, 0, 0, W, H);
          ctx.save();
          ctx.globalAlpha = q.alpha;
          ctx.globalCompositeOperation = j.composite;
          ctx.drawImage(tmp, 0, 0);
          ctx.restore();
        } else {
          this.drawOne(ctx, j, W, H);
        }
      }
      // FADS rule transition: the captured old frame, masked by the
      // rule at the transition progress, over the new stage
      // (fs_transition: mix(old, new, mask))
      if (opts.transition && opts.transition.ruleImg && this.oldCanvas) {
        const t = opts.transition;
        const tctx = ruleTmp();
        tctx.clearRect(0, 0, W, H);
        tctx.globalCompositeOperation = "source-over";
        tctx.drawImage(this.oldCanvas, 0, 0);
        const mask = this.ruleMaskCanvas(t.ruleImg, t.progress, t.flip || 0);
        tctx.globalCompositeOperation = "destination-in";
        tctx.drawImage(mask, 0, 0, W, H);
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        ctx.drawImage(tmp, 0, 0);
        ctx.restore();
      }
      // FADE 40/41 ghost pass over the finished frame
      if (opts.ghost && opts.ghost.alpha > 0) this.ghostPass(opts.ghost);
      return Promise.resolve();
    }
    // knife game/ghost.rs render(): the frame, channel-isolated and
    // shifted per channel, recombined, then overlaid at the effect alpha
    ghostPass(g) {
      const ctx = this.ctx;
      const W = this.canvas.width, H = this.canvas.height;
      if (!this.scratch) {
        const mk = () => { const c = document.createElement("canvas"); c.width = W; c.height = H; return c; };
        this.scratch = { src: mk(), chan: mk(), shift: mk(), out: mk() };
      }
      const s = this.scratch;
      const sctx = s.src.getContext("2d");
      sctx.clearRect(0, 0, W, H);
      sctx.drawImage(this.canvas, 0, 0);
      const octx = s.out.getContext("2d");
      octx.clearRect(0, 0, W, H);
      for (let c = 0; c < 3; c++) {
        const col = g.cols[c];
        const css = `rgb(${Math.round(col[0] * 255)},${Math.round(col[1] * 255)},${Math.round(col[2] * 255)})`;
        const cctx = s.chan.getContext("2d");
        cctx.clearRect(0, 0, W, H);
        cctx.globalCompositeOperation = "source-over";
        cctx.drawImage(s.src, 0, 0);
        cctx.globalCompositeOperation = "multiply";
        cctx.fillStyle = css;
        cctx.fillRect(0, 0, W, H);
        // shifted copy, masked the same way, over the base (Opaque)
        const [ox, oy] = g.offs[c];
        const shctx = s.shift.getContext("2d");
        shctx.clearRect(0, 0, W, H);
        shctx.globalCompositeOperation = "source-over";
        shctx.drawImage(s.src, ox, oy);
        shctx.globalCompositeOperation = "multiply";
        shctx.fillStyle = css;
        shctx.fillRect(0, 0, W, H);
        // the multiply fill made the borders opaque black; restore the
        // shifted frame's alpha shape before compositing it over
        shctx.globalCompositeOperation = "destination-in";
        shctx.drawImage(s.src, ox, oy);
        cctx.globalCompositeOperation = "source-over";
        cctx.drawImage(s.shift, 0, 0);
        // red replaces the result, green and blue add
        octx.globalCompositeOperation = c === 0 ? "source-over" : "lighter";
        octx.drawImage(s.chan, 0, 0);
      }
      ctx.save();
      ctx.globalCompositeOperation = "overlay";
      ctx.globalAlpha = g.alpha;
      ctx.drawImage(s.out, 0, 0);
      ctx.restore();
    }
  }
  KP.Renderer = Renderer;
  if (typeof module !== "undefined") module.exports = KP;
})();
