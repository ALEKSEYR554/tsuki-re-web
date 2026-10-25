"use strict";
/* stage.js — port of knife stage.rs geometry: Layer, the stage's commit (sub_5D3A0),
   resolved() (sub_37F50) and layer_quad() (sub_3BBA0/sub_34440). DOM-free: a quad is
   { pos: [[x,y]x4] canvas px, uv, alpha, rgb, clip: corners|null, layer }.
   Shake/quake offsets are injected (shake = stage shake, layer.quakeOffset(i) -> [x,y])
   until fx.js ports game/shake.rs. Blend/grade stay symbolic here. */
(function (global) {
  const Tween = (global.KW && global.KW.Tween) || require("./tween.js").Tween;
  const CANVAS_W = 1920, CANVAS_H = 1080;
  const SCRIPT_W = 480, SCRIPT_H = 272, UNIT_W = 640, UNIT_H = 362;
  const scriptToPx = (x, y) => [x / SCRIPT_W * CANVAS_W, y / SCRIPT_H * CANVAS_H];

  function clipSpin(rot2, rot) {
    if (rot2 === 0) return 0;
    if (rot2 === -32768) {
      let d = Math.trunc(rot * 100) % 36000;
      if (d > 18000) d -= 36000; else if (d <= -18001) d += 36000;
      return Math.min(d, 35999) / 100;
    }
    return rot2 / 100;
  }
  function wrapRot2(v) { // STCH arg 19 / STRR: wrapped to +-18000 centidegrees
    let d = v % 36000;
    if (d > 18000) d -= 36000; else if (d < -18000) d += 36000;
    return d;
  }
  class ClipRect {
    constructor(x = 0, y = 0, w = 0, h = 0) { this.x = x; this.y = y; this.w = w; this.h = h; this.rot = 0; this.inset = 0; this.mode = 0; }
    clone() { const c = new ClipRect(this.x, this.y, this.w, this.h); c.rot = this.rot; c.inset = this.inset; c.mode = this.mode; return c; }
    insetRect() {
      const c = this.clone();
      if (c.rot === 0 && c.mode >= 1 && c.mode <= 6) {
        const d = c.inset;
        if (c.w < CANVAS_W) { c.x += d; c.w -= 2 * d; }
        if (c.h < CANVAS_H) { c.y += d; c.h -= 2 * d; }
      }
      return c;
    }
    corners() {
      const c = this.insetRect();
      const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
      const rad = this.rot * Math.PI / 180, s = Math.sin(rad), cs = Math.cos(rad);
      const p = (dx, dy) => [cx + dx * cs - dy * s, cy + dx * s + dy * cs];
      const hw = c.w / 2, hh = c.h / 2;
      return [p(-hw, -hh), p(hw, -hh), p(hw, hh), p(-hw, hh)];
    }
    // knife stage.rs ClipRect::soft (sub_32E30): the rounded-rectangle
    // feather mask of a clip with an inset. Modes 1..6 unrotated get no
    // soft mask (their scissor shrinks and cuts the band away; the
    // coloured ridge from band() is a separate, unimplemented feature).
    // Returns the inner rect's edges relative to the clip centre (pivot),
    // the pivot, the rotation and the band radius — all in canvas px.
    // A side reaching past the screen (or spanning it) gets no fade: its
    // inner edge touches the clip edge, and the hard scissor cuts the rest.
    soft() {
      const band = this.mode >= 1 && this.mode <= 6;
      if (this.inset === 0 || (band && this.rot === 0)) return null;
      const half = ((this.inset & 1) + this.inset) * 0.5; // 960x540 units
      const r0 = this.mode === 7 ? half * 2 : half;
      const l = this.x * 0.5, t = this.y * 0.5;
      const rx = (this.x + this.w) * 0.5, by = (this.y + this.h) * 0.5;
      const r = Math.min(r0, (rx - l) * 0.5, (by - t) * 0.5);
      if (r <= 0) return null;
      const over = (this.rot === 0 || band) ? 0 : 0.25;
      let [rl, rr, rt, rb] = [r + over, r + over, r + over, r + over];
      if (this.rot === 0) {
        rl = (l + r <= 0) ? 0 : r;
        rr = (rx - r >= 960) ? 0 : r;
        rt = (t + r <= 0) ? 0 : r;
        rb = (by - r >= 540) ? 0 : r;
        if (l === 0 && this.w * 0.5 === 960) { rl = 0; rr = 0; }
        if (t === 0 && this.h * 0.5 === 540) { rt = 0; rb = 0; }
      }
      const s = CANVAS_W / 960;
      const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
      return {
        inner: [(l + rl) * s - cx, (t + rt) * s - cy, (rx - rr) * s - cx, (by - rb) * s - cy],
        pivot: [cx, cy],
        rot: this.rot * Math.PI / 180,
        radius: (r + 2 * over) * s,
      };
    }
  }
  function newLayer(name, source, x, y, prio) {
    return {
      name, source, // {kind:'image', img:{width,height,centerX,centerY,level,noShake,texW,texH,uv:[u1,v1]}} | {kind:'color', rgb:[r,g,b]}
      x: Tween.fixed(x), y: Tween.fixed(y),
      zoomX: Tween.fixed(1), zoomY: Tween.fixed(1),
      alpha: Tween.fixed(1), rotation: Tween.fixed(0),
      prio, parent: null, base: null, absolute: false,
      pending: true, blend: "alpha", stbr: -1, shade: "sprite",
      fill: null, stecMode: 0, stecColor: [1, 1, 1], snx: [1, 1],
      keepsTexture: false, motion: null, motionAlpha: 1, motionZoom: [1, 1],
      rot2: 0, clipInset: 0, clipMode: 0, soxy: [0, 0],
      pivot: null, shift: null, stagePivot: null, stageShift: null, stageRot: null,
      staged: { stbr: null, prio: null, rot2: null, absolute: null, base: undefined, soxy: null },
      quake: [{ offset: [0, 0], mode: 0, active: () => false }, { offset: [0, 0], mode: 0, active: () => false }],
      noise: null, clip: null, rule: null,
    };
  }
  const stagePrio = (l) => l.staged.prio != null ? l.staged.prio : l.prio;
  const stageRot2 = (l) => l.staged.rot2 != null ? l.staged.rot2 : l.rot2;
  const stageBase = (l) => l.staged.base !== undefined ? l.staged.base : l.base;
  const stageSoxy = (l) => l.staged.soxy != null ? l.staged.soxy : l.soxy;

  // ---- STRA haze (knife stage.rs Haze), verbatim ----
  function hazeSet(h, id, ms, entry) {
    const frames = Math.trunc(60 * ms / 1000);
    if (ms === 0) {
      h.id = id; h.entry = entry; h.phase = 0;
      if (id !== 0) h.fadeIn = 0; else { h.fadeTotal = 0; h.fadeLeft = 0; }
    } else if (id !== 0) h.fadeIn = frames;
    else { h.fadeTotal = frames; h.fadeLeft = frames; }
  }
  function hazeAdvance(h, dtMs) {
    h.acc = (h.acc || 0) + dtMs * 0.06;
    const d = Math.floor(h.acc);
    h.acc -= d;
    if (d === 0) return;
    if (h.id <= 0) { h.phase = 0; return; }
    h.phase = (h.phase + d) % 31416;
    if (h.fadeIn >= 1 && h.phase >= h.fadeIn) h.fadeIn = 0;
    if (h.fadeTotal >= 1) {
      h.fadeLeft -= d;
      if (h.fadeLeft <= 0) { h.id = 0; h.entry = null; h.fadeTotal = 0; h.fadeLeft = 0; }
    }
  }
  // Shader parameters (sub_362A0) for a wxh texel texture whose logical
  // image spans uvm of the texture coordinates; null when no entry.
  function hazeParams(h, w, hPx, uvm) {
    if (!h || h.id <= 0 || !h.entry) return null;
    const e = h.entry;
    const t = h.phase / 60.0;
    let amp;
    if (h.fadeIn !== 0) {
      const v = Math.min(Math.trunc(1000 * h.phase / 60), Math.trunc(e[9]));
      const a = e[9] === 0 ? 0 : v * 1000.0 / e[9];
      amp = Number.isFinite(a) ? Math.trunc(a) : 0;
    } else if (h.fadeTotal >= 1) amp = Math.trunc(h.fadeLeft * 1000.0 / h.fadeTotal);
    else amp = 1000;
    const v26 = 1920 * 0.00097656 * 0.001 * amp;
    const ax = v26 * e[6] * e[2], ay = v26 * e[6] * e[5];
    const kx = (e[0] + e[7] * 0.1) * (hPx / 1080) * 0.5;
    const ky = (e[3] + e[7] * 0.1) * (w / 1920) * 0.5;
    const px = ((e[8] * 0.33333 * (t + e[1])) % 1 + 1) % 1;
    const py = ((e[8] * 0.33333 * (t + e[4])) % 1 + 1) % 1;
    return [
      [w > 0 ? ax / w * uvm[0] : 0, kx / uvm[1], px, 1.0],
      [hPx > 0 ? ay / hPx * uvm[1] : 0, ky / uvm[1], py, 0.0],
    ];
  }

  class Stage {
    constructor() { this.layers = new Array(40).fill(null); this.shown = new Array(40).fill(false); this.shake = [0, 0]; this.rules = new Array(40).fill(null); }
    get(i) { return (i >= 0 && i < 40) ? this.layers[i] : null; }
    set(i, layer) { if (i >= 0 && i < 40) this.layers[i] = layer; }
    clear(i) {
      if (i < 0) { this.layers.fill(null); this.rules.fill(null); }
      else if (i < 40) { this.layers[i] = null; this.rules[i] = null; }
    }
    commit() {
      for (let i = 0; i < 40; i++) this.shown[i] = !!this.layers[i];
      for (const l of this.layers) {
        if (!l) continue;
        l.pending = false;
        const s = l.staged;
        if (s.stbr) { l.stbr = s.stbr[0]; l.blend = s.stbr[1]; }
        if (s.prio != null) l.prio = s.prio;
        if (s.rot2 != null) l.rot2 = s.rot2;
        if (s.absolute != null) l.absolute = s.absolute;
        if (s.base !== undefined) l.base = s.base;
        if (s.soxy != null) l.soxy = s.soxy;
        l.staged = { stbr: null, prio: null, rot2: null, absolute: null, base: undefined, soxy: null };
        l.pivot = l.stagePivot;
        l.shift = l.stageShift;
        if (l.stageRot != null) { l.rotation.to = l.stageRot; l.stageRot = null; }
        l.zoomX = Tween.fixed(l.zoomX.to);
        l.zoomY = Tween.fixed(l.zoomY.to);
      }
    }
    stepTweens() { for (const l of this.layers) if (l) for (const t of [l.x, l.y, l.zoomX, l.zoomY, l.alpha, l.rotation]) t.stepFrame(); }
    layerAnimating(l, mask) {
      return ((mask & 0x20) !== 0 && l.motion && !l.motion.done && !l.motion.paused)
        || ((mask & 1) !== 0 && !(l.x.done() && l.y.done()))
        || ((mask & 4) !== 0 && !l.rotation.done())
        || ((mask & 8) !== 0 && !l.alpha.done());
    }
    animating(i, mask) {
      if (i < 0) return this.layers.some((l) => l && this.layerAnimating(l, mask));
      const l = this.get(i);
      return !!l && this.layerAnimating(l, mask);
    }
    resolved(i, depth = 0) {
      const l = this.layers[i];
      const r = { x: 0, y: 0, alpha: 0, clip: null, zoom: [1, 1], rot: 0 };
      if (!l) return r;
      r.x = l.x.valueX();
      r.y = l.y.value();
      r.alpha = l.alpha.value() * l.motionAlpha;
      r.clip = l.clip ? (() => { const c = l.clip.clone(); c.inset = l.clipInset; c.mode = l.clipMode; return c; })() : null;
      r.zoom = [l.zoomX.value() * l.motionZoom[0], l.zoomY.value() * l.motionZoom[1]];
      r.rot = l.rotation.valueRot();
      const b = stageBase(l);
      if (b != null && b !== i && b < 40 && depth < 8 && this.layers[b]) {
        const bl = this.layers[b], br = this.resolved(b, depth + 1);
        let ax, ay, k;
        if (bl.source.kind === "image") {
          const sp = bl.stagePivot || [bl.source.img.centerX, bl.source.img.centerY];
          const lvl = bl.source.img.level || 0;
          ax = sp[0] * SCRIPT_W / UNIT_W; ay = sp[1] * SCRIPT_H / UNIT_H;
          k = lvl === 1 ? 0.5 : lvl === 2 ? 0.25 : lvl === 3 ? 0.125 : 1;
        } else { ax = SCRIPT_W / 2; ay = SCRIPT_H / 2; k = 1; }
        r.x *= k; r.y *= k;
        r.zoom = [r.zoom[0] * k, r.zoom[1] * k];
        const kx = CANVAS_W / SCRIPT_W, ky = CANVAS_H / SCRIPT_H;
        const dx = (r.x - ax) * br.zoom[0] * kx, dy = (r.y - ay) * br.zoom[1] * ky;
        const rad = br.rot * Math.PI / 180, sin = Math.sin(rad), cos = Math.cos(rad);
        r.x = br.x + (dx * cos - dy * sin) / kx;
        r.y = br.y + (dx * sin + dy * cos) / ky;
        r.zoom = [r.zoom[0] * br.zoom[0], r.zoom[1] * br.zoom[1]];
        r.rot += br.rot;
        r.clip = r.clip || br.clip;
      }
      if (r.clip) r.clip.rot = clipSpin(l.rot2, r.rot);
      const p = l.parent;
      if (p != null && p !== i && p < 40 && depth < 8 && this.layers[p]) {
        const pl = this.layers[p], pr = this.resolved(p, depth + 1);
        if (!l.absolute) {
          if (pl.clip) { r.x += pl.clip.x * SCRIPT_W / CANVAS_W; r.y += pl.clip.y * SCRIPT_H / CANVAS_H; }
          else { r.x += pr.x - SCRIPT_W / 2; r.y += pr.y - SCRIPT_H / 2; }
        }
        r.alpha *= pr.alpha;
        if (!l.absolute) {
          r.clip = pr.clip ? (() => { const c = pr.clip.clone(); c.inset = pl.clipInset; c.mode = pl.clipMode; c.rot = clipSpin(pl.rot2, r.rot); return c; })() : null;
        }
      }
      return r;
    }
    order() {
      const idx = [];
      for (let i = 0; i < 40; i++) { const l = this.layers[i]; if (l && !l.pending && l.prio >= 1) idx.push(i); }
      // Wall-cut beat (00_00): knife's prio order puts the white slabs
      // (36/37, prio 3614/1450) UNDER the opaque wood (5530) for their whole
      // life, so their fall motions are invisible — yet the script animates
      // them falling for 2.3 s, which only makes sense if the original shows
      // them. Once a slab has actually started falling (Y moved > 10 script
      // px from its STMA position) it sorts above the wood (5700) but below
      // the black veils (5886) and the blue slash (6214). Before the fall
      // starts the frame is unchanged (slabs hidden, as approved in 0018).
      // Sort key only — l.prio itself is never mutated.
      const key = (i) => {
        const l = this.layers[i];
        if (this.sceneId === "00_00" && (i === 36 || i === 37) && l.motion && !l.motion.done &&
            l.motionStartY !== undefined && (l.y.value() - l.motionStartY) > 10) return 5700;
        return l.prio;
      };
      idx.sort((a, b2) => (key(a) - key(b2)) || (a - b2));
      return idx;
    }
    quakePx(i) { // sub_34440 simplified: own slots only; parent-follow modes land with fx.js
      const l = this.layers[i]; if (!l) return [0, 0];
      let x = 0, y = 0;
      for (let s = 0; s < 2; s++) { const q = l.quake[s]; if (q && q.active()) { x += q.offset[0]; y += q.offset[1]; } }
      return [x / 3 * CANVAS_W / 640, y / 3 * CANVAS_H / 448];
    }
    layerQuad(i) {
      const l = this.layers[i]; if (!l) return null;
      const res = this.resolved(i, 0);
      if (res.alpha <= 0) return null;
      let [cx, cy] = scriptToPx(res.x, res.y);
      const exempt = l.source.kind === "color" || (l.source.img && l.source.img.noShake);
      const full = [2 * this.shake[0] * CANVAS_W / 640, 2 * this.shake[1] * CANVAS_H / 448];
      const shake = exempt ? [0, 0] : full;
      let clip = res.clip ? res.clip.clone() : null;
      if (clip) { clip.x += shake[0]; clip.y += shake[1]; }
      const parent = (l.parent != null && l.parent !== i && l.parent < 40) ? this.layers[l.parent] : null;
      if (parent && clip && !l.absolute) {
        const pExempt = parent.source.kind === "color" || (parent.source.img && parent.source.img.noShake);
        if (parent.clip && !pExempt) { cx += full[0]; cy += full[1]; }
      } else { cx += shake[0]; cy += shake[1]; }
      const so = stageSoxy(l);
      cx += so[0] * 0.33333 * CANVAS_W / 640;
      cy += so[1] * 0.41481 * CANVAS_H / 448;
      const [qx, qy] = this.quakePx(i);
      cx += qx; cy += qy;
      const rot = res.rot * Math.PI / 180, sin = Math.sin(rot), cos = Math.cos(rot);
      const sx = CANVAS_W / UNIT_W, sy = CANVAS_H / UNIT_H;
      let w, h, ox, oy, uv;
      if (l.source.kind === "image") {
        const img = l.source.img;
        const centre = [Math.trunc(img.centerX), Math.trunc(img.centerY)];
        const piv = l.pivot || centre;
        const sh = l.shift || [-centre[0], -centre[1]];
        cx += (piv[0] + sh[0]) * CANVAS_W / UNIT_W;
        cy += (piv[1] + sh[1]) * 1.25 * CANVAS_H / 448;
        w = img.width * sx; h = img.height * sy;
        ox = piv[0] * sx; oy = piv[1] * sy;
        uv = [0, 0, img.uv ? img.uv[0] : 1, img.uv ? img.uv[1] : 1];
      } else {
        w = CANVAS_W * 1.2; h = CANVAS_H * 1.2; ox = CANVAS_W * 0.6; oy = CANVAS_H * 0.6; uv = [0, 0, 1, 1];
      }
      const [zx, zy] = res.zoom;
      const corner = (px, py) => { const dx = (px - ox) * zx, dy = (py - oy) * zy; return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos]; };
      const alpha = Math.min(1, Math.max(0, res.alpha));
      // STTR: the slot's rule (stage.rules, not the layer: STCH keeps it),
      // progress = the layer's alpha; flip clamped to 0..3 like knife.
      const sr = this.rules[i];
      const rule = sr ? { n: sr.n, flip: sr.flip <= 3 ? sr.flip : 0, progress: alpha } : null;
      // STRA haze: image layers without grain only.
      const haze = (l.source.kind === "image" && !l.noise && l.haze)
        ? hazeParams(l.haze, l.source.img.width, l.source.img.height, [uv[2], uv[3]]) : null;
      // STEC-1 fill on an image layer: the fill colour replaces rgb
      // (fs_fill keeps the texture alpha); the renderer bakes it.
      const isFillImg = l.source.kind === "image" && !!l.fill;
      return {
        layer: i, name: l.name, pos: [corner(0, 0), corner(w, 0), corner(w, h), corner(0, h)],
        uv, alpha,
        rgb: isFillImg ? [1, 1, 1] : l.fill ? l.fill : l.source.kind === "color" ? (l.stecMode !== 1 ? l.source.rgb.map((v, j) => v * l.stecColor[j]) : l.source.rgb) : (l.stecMode !== 1 ? l.stecColor : [1, 1, 1]),
        blend: l.blend, stbr: l.stbr, stec: l.stecMode, snx: l.snx,
        clip: clip && clip.w !== 0 && clip.h !== 0 ? clip.corners() : null,
        clipRect: clip,
        soft: clip ? clip.soft() : null,
        rule, noise: l.noise || null, haze, fill: isFillImg ? l.fill : null,
      };
    }
    quads() {
      const out = [];
      for (const i of this.order()) {
        const q = this.layerQuad(i);
        if (!q) continue;
        out.push(q);
        // knife band_draw: a standalone clipped layer's ridge follows its
        // own quad (all band-eligible STCH uses in the scripts are
        // parentless, so the group end_group path never applies here)
        if (q.clipRect && q.clipRect.w !== 0 && q.clipRect.h !== 0) {
          for (const b of KW.bandQuads(q.clipRect, q.clip, q.alpha)) { b.layer = i; out.push(b); }
        }
      }
      return out;
    }
  }
  global.KW = global.KW || {};
  Object.assign(global.KW, { Stage, ClipRect, newLayer, scriptToPx, clipSpin, wrapRot2, stagePrio, stageRot2, stageBase, stageSoxy, hazeSet, hazeAdvance, hazeParams, CANVAS_W, CANVAS_H });
  if (typeof module !== "undefined") module.exports = { Stage, ClipRect, newLayer, scriptToPx, clipSpin, wrapRot2 };
})(typeof window !== "undefined" ? window : globalThis);
