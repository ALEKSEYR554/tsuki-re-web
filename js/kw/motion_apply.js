"use strict";
/* motion_apply.js — port of knife game.rs motion_cur() + apply_motion() (the layer-state part).
   Variant image swaps go through host.onMotionVariant(li, name) -> bool; the host returns the
   new image record so pivot/shift can be adjusted exactly like sub_97B80 does. */
(function (global) {
  const Tween = (global.KW && global.KW.Tween) || require("./tween.js").Tween;
  const F = global.KW.MOTION_FIELD;
  function motionCur(stage, li, variantOf) {
    const v = new Array(28).fill(0);
    const l = stage.layers[li]; if (!l) return v;
    const centre = l.source.kind === "image" ? [Math.trunc(l.source.img.centerX), Math.trunc(l.source.img.centerY)] : [0, 0];
    const piv = l.pivot || centre;
    const c = l.clip || { x: 0, y: 0, w: 0, h: 0 };
    const [va, vb] = variantOf(l.name);
    v[F.X] = l.x.valueX();
    v[F.Y] = l.y.value();
    v[F.ALPHA] = l.alpha.value() * 255;
    v[F.PIVOT_X] = piv[0] * 1280 / 640;
    v[F.PIVOT_Y] = piv[1] * 720 / 480;
    v[F.ROT] = Math.trunc(l.rotation.valueRot() * 100);
    v[F.ZOOM_X] = Math.trunc(l.zoomX.value() * 1000);
    v[F.ZOOM_Y] = Math.trunc(l.zoomY.value() * 1000);
    v[11] = c.x; v[12] = c.y; v[13] = c.w; v[14] = c.h;
    v[F.CLIP_MODE] = l.clipMode;
    v[F.CLIP_INSET] = l.clipInset;
    v[F.BLEND] = l.stbr;
    v[F.FILL] = l.stecMode;
    v[F.VARIANT_A] = va;
    v[F.VARIANT_B] = vb;
    v[F.GRAIN] = l.noise || 0;
    return v;
  }
  /* blend_mode() from game.rs: STBR id -> symbolic blend + shade. 2 = default shader;
     3 and 27 have no shader; 0 / -1 = none (all fall back to plain alpha here). */
  function blendMode(mode) {
    const ps = { 1: "add", 11: "add", 4: "darken", 13: "darken", 5: "dodge-alpha", 6: "lighten", 20: "lighten",
                 7: "multiply", 21: "multiply", 8: "noalpha", 9: "screen", 23: "screen", 10: "sub", 12: "burn",
                 14: "difference", 15: "difference-alpha", 16: "dodge", 17: "dodge-alpha", 18: "exclusion",
                 /* 0018: mode 19 (HardLight) deliberately maps to plain alpha, NOT
                    knife's Ps(HardLight). At the 00_00 wall-cut beat (STBR 35 19)
                    HardLight blends the wood with the white layers beneath it, so
                    a light parallelogram shows through the wood in the centre of
                    the frame — the reported "white on top" bug. v3 (no blends at
                    all, user-validated as correct for this beat) renders the wood
                    opaque: uniform dark wood, white visible only as edge slivers
                    where the wood does not cover it. Other modes are untouched. */
                 22: "overlay", 24: "soft-light", 25: "linear-burn", 26: "hard-light-ex",
                 28: "add-noalpha", 29: "sub-noalpha" };
    return ps[mode] || "alpha";
  }
  function applyMotion(stage, li, f, host) {
    const l = stage.layers[li]; if (!l) return;
    const variant = host && host.motionVariant ? host.motionVariant(li, f) : null;
    const pivotInfo = l.source.kind === "image" && host && host.variantDelta
      ? [l.source.img.levelScale != null ? l.source.img.levelScale : 1, host.variantDelta(l.name)] : null;
    if (f.x != null) l.x = Tween.fixed(f.x);
    if (f.y != null) l.y = Tween.fixed(f.y);
    if (f.alpha != null) l.alpha = Tween.fixed(f.alpha);
    if (f.pivot[0] != null || f.pivot[1] != null) {
      const [k, [dx, dy]] = pivotInfo || [1, [0, 0]];
      const centre = l.source.kind === "image" ? [Math.trunc(l.source.img.centerX), Math.trunc(l.source.img.centerY)] : [0, 0];
      const piv = (l.pivot || centre).slice(), sh = (l.shift || [-centre[0], -centre[1]]).slice();
      const spiv = (l.stagePivot || centre).slice(), ssh = (l.stageShift || [-centre[0], -centre[1]]).slice();
      [f.pivot[0], f.pivot[1]].forEach((v, a) => {
        if (v == null) return;
        const d = a === 0 ? dx : dy;
        const p = a === 0 ? v * 1.875 / 0.46875 * k * 0.33333 : v * 1.875 * 576 / 272 * k * 362 / 1080;
        piv[a] = d + p; sh[a] = -p; spiv[a] = p; ssh[a] = Math.trunc(-p);
      });
      l.pivot = piv; l.shift = sh; l.stagePivot = spiv; l.stageShift = ssh;
    }
    if (f.rot != null) { l.rotation = Tween.fixed(f.rot); l.stageRot = null; }
    if (f.rot2 != null) { l.rot2 = f.rot2; l.staged.rot2 = null; }
    if (f.zoomX != null) l.zoomX = Tween.fixed(f.zoomX);
    if (f.zoomY != null) l.zoomY = Tween.fixed(f.zoomY);
    if (f.clip.some((c) => c != null)) {
      const c = l.clip ? l.clip.clone() : new (global.KW.ClipRect)();
      if (f.clip[0] != null) c.x = f.clip[0];
      if (f.clip[1] != null) c.y = f.clip[1];
      if (f.clip[2] != null) c.w = f.clip[2];
      if (f.clip[3] != null) c.h = f.clip[3];
      l.clip = c;
    }
    if (f.clipMode != null) l.clipMode = f.clipMode;
    if (f.clipInset != null) l.clipInset = f.clipInset;
    if (f.blend != null) {
      const mode = (f.blend === 0 || (f.blend === 8 && l.alpha.value() < 1)) ? -1 : f.blend;
      if (mode !== l.stbr) { l.stbr = mode; l.blend = blendMode(mode); l.staged.stbr = null; }
    }
    const rgb = (n) => [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    if (f.fill === 1 && l.stecMode !== 1) l.stecColor = rgb(f.fillColor);
    if (f.color != null) l.stecColor = rgb(f.color);
    if (f.snx2 != null) l.snx[0] = f.snx2;
    if (f.snx3 != null) l.snx[1] = f.snx3;
    if (f.grain != null && (l.noise || 0) !== f.grain) l.noise = f.grain > 0 ? f.grain : null;
    if (f.prio != null && f.prio !== 0 && (l.staged.prio != null ? l.staged.prio : l.prio) !== 0) { l.prio = f.prio; l.staged.prio = null; }
    if (variant && host && host.applyVariant) host.applyVariant(li, variant);
  }
  global.KW = global.KW || {};
  Object.assign(global.KW, { motionCur, applyMotion, blendMode });
  if (typeof module !== "undefined") module.exports = { motionCur, applyMotion, blendMode };
})(typeof window !== "undefined" ? window : globalThis);
