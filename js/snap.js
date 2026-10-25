"use strict";
/* snap.js — full state snapshots for rewind (dock back), quick save/load
   and CONTINUE: vars, stage layers (with tween/motion/quake progress),
   BGM, looping SE, the line's voice and the text page. Snapshots are
   plain JSON-safe data, so the same object works in memory (back
   history) and in localStorage (kp-save/kp-qsave); unsnap rebuilds the
   live instances (Tween/ClipRect/Quake prototypes matter: resolved()
   calls clip.clone(), quads read tween values, quakePx calls q.active()).
   A snapshot restores EXACTLY, with no replay: replay re-runs commands
   from scene start, which picks choice option 0 (SELD instant), restarts
   motions (background jump), leaves later layers on stage (wrong
   textures at the cut) and keeps the later BGM (OST never changes). */
(function (global) {
  const KW = global.KW || {};
  const Tween = KW.Tween || (typeof require !== "undefined" ? require("./kw/tween.js").Tween : null);
  const ClipRect = KW.ClipRect || (typeof require !== "undefined" ? require("./kw/stage.js").ClipRect : null);
  const Quake = (global.KP && global.KP.Quake) || (typeof require !== "undefined" ? require("./shake.js").Quake : null);
  function cp(v) {
    if (Array.isArray(v)) return v.map(cp);
    if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v)) o[k] = cp(v[k]); return o; }
    return v;
  }
  function snapTween(t) { return { to: t.to, diff: t.diff, prog: t.prog, step: t.step, ease: t.ease }; }
  function unsnapTween(d) { return Object.assign(Object.create(Tween.prototype), d); }
  function snapClip(c) { return c ? { x: c.x, y: c.y, w: c.w, h: c.h, rot: c.rot, inset: c.inset, mode: c.mode } : null; }
  function unsnapClip(d) { return d ? Object.assign(Object.create(ClipRect.prototype), d) : null; }
  function snapQuake(q) {
    if (!q) return null;
    if (typeof q.step === "function") {
      return { q: 1, mode: q.mode, delay: q.delay, remaining: q.remaining, params: q.params.slice(),
        elapsed: q.elapsed, counter: q.counter, counterY: q.counterY, amp: q.amp.slice(),
        period: q.period.slice(), sign: q.sign.slice(), offset: q.offset.slice() };
    }
    return { q: 0, offset: (q.offset || [0, 0]).slice(), mode: q.mode || 0 };
  }
  function unsnapQuake(d) {
    if (!d) return null;
    if (d.q === 1) {
      return Object.assign(Object.create(Quake.prototype), { mode: d.mode, delay: d.delay, remaining: d.remaining,
        params: d.params.slice(), elapsed: d.elapsed, counter: d.counter, counterY: d.counterY,
        amp: d.amp.slice(), period: d.period.slice(), sign: d.sign.slice(), offset: d.offset.slice() });
    }
    return { offset: d.offset.slice(), mode: d.mode, active: () => false };
  }
  function snapLayer(l) {
    return {
      name: l.name,
      source: l.source.kind === "image" ? { kind: "image", img: cp(l.source.img) } : { kind: "color", rgb: l.source.rgb.slice() },
      x: snapTween(l.x), y: snapTween(l.y),
      zoomX: snapTween(l.zoomX), zoomY: snapTween(l.zoomY),
      alpha: snapTween(l.alpha), rotation: snapTween(l.rotation),
      prio: l.prio, parent: l.parent, base: l.base, absolute: l.absolute,
      pending: l.pending, blend: l.blend, stbr: l.stbr, shade: l.shade,
      fill: l.fill, stecMode: l.stecMode, stecColor: l.stecColor.slice(), snx: l.snx.slice(),
      keepsTexture: l.keepsTexture,
      motion: l.motion ? { ...l.motion } : null,
      motionStartY: l.motionStartY,
      motionAlpha: l.motionAlpha, motionZoom: l.motionZoom.slice(),
      rot2: l.rot2, clipInset: l.clipInset, clipMode: l.clipMode, soxy: l.soxy.slice(),
      pivot: l.pivot ? l.pivot.slice() : null, shift: l.shift ? l.shift.slice() : null,
      stagePivot: l.stagePivot ? l.stagePivot.slice() : null, stageShift: l.stageShift ? l.stageShift.slice() : null,
      stageRot: l.stageRot,
      staged: { stbr: l.staged.stbr ? l.staged.stbr.slice() : null, prio: l.staged.prio, rot2: l.staged.rot2,
        absolute: l.staged.absolute, base: l.staged.base, soxy: l.staged.soxy ? l.staged.soxy.slice() : null },
      quake: [snapQuake(l.quake[0]), snapQuake(l.quake[1])],
      noise: l.noise, clip: snapClip(l.clip), rule: l.rule,
      haze: l.haze ? { ...l.haze } : null,
    };
  }
  function unsnapLayer(d) {
    return {
      name: d.name,
      source: d.source.kind === "image" ? { kind: "image", img: cp(d.source.img) } : { kind: "color", rgb: d.source.rgb.slice() },
      x: unsnapTween(d.x), y: unsnapTween(d.y),
      zoomX: unsnapTween(d.zoomX), zoomY: unsnapTween(d.zoomY),
      alpha: unsnapTween(d.alpha), rotation: unsnapTween(d.rotation),
      prio: d.prio, parent: d.parent, base: d.base, absolute: d.absolute,
      pending: d.pending, blend: d.blend, stbr: d.stbr, shade: d.shade,
      fill: d.fill, stecMode: d.stecMode, stecColor: d.stecColor.slice(), snx: d.snx.slice(),
      keepsTexture: d.keepsTexture,
      motion: d.motion ? { ...d.motion } : null,
      motionStartY: d.motionStartY,
      motionAlpha: d.motionAlpha, motionZoom: d.motionZoom.slice(),
      rot2: d.rot2, clipInset: d.clipInset, clipMode: d.clipMode, soxy: d.soxy.slice(),
      pivot: d.pivot ? d.pivot.slice() : null, shift: d.shift ? d.shift.slice() : null,
      stagePivot: d.stagePivot ? d.stagePivot.slice() : null, stageShift: d.stageShift ? d.stageShift.slice() : null,
      stageRot: d.stageRot,
      staged: { stbr: d.staged.stbr ? d.staged.stbr.slice() : null, prio: d.staged.prio, rot2: d.staged.rot2,
        absolute: d.staged.absolute, base: d.staged.base, soxy: d.staged.soxy ? d.staged.soxy.slice() : null },
      quake: [unsnapQuake(d.quake[0]), unsnapQuake(d.quake[1])],
      noise: d.noise, clip: unsnapClip(d.clip), rule: d.rule,
      haze: d.haze ? { ...d.haze } : null,
    };
  }
  function snapStage(stage) {
    return { layers: stage.layers.map((l) => l ? snapLayer(l) : null), shown: stage.shown.slice(), shake: stage.shake.slice(),
      rules: (stage.rules || []).map((r) => r ? { ...r } : null) };
  }
  function unsnapStage(stage, data) {
    stage.layers = data.layers.map((l) => l ? unsnapLayer(l) : null);
    stage.shown = data.shown.slice();
    stage.shake = data.shake.slice();
    stage.rules = (data.rules || []).map((r) => r ? { ...r } : null);
    while (stage.rules.length < 40) stage.rules.push(null);
  }
  global.KP = global.KP || {};
  global.KP.Snap = { snapLayer, unsnapLayer, snapStage, unsnapStage, snapTween, unsnapTween, snapClip, unsnapClip, snapQuake, unsnapQuake };
  if (typeof module !== "undefined") module.exports = global.KP.Snap;
})(typeof window !== "undefined" ? window : globalThis);
