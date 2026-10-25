"use strict";
/* ghost.js — literal port of knife game/ghost.rs: the FADE(40/41)
   channel-split screen effect. State is a plain object (JSON-safe, so
   snapshots carry it). advance() runs the 60 Hz steps; params() gives
   the renderers what they need: per-channel shift offsets (canvas px)
   and channel-mask colours from the exe's wrapping maths. */
(function (global) {
  const PI = Math.PI;
  function preset(q) {
    switch (q) {
      case 6: case 7: case 12: return [2.5, 200.0, 50.0];
      case 8: return [3.5, 200.0, 70.0];
      case 9: return [3.1, 105.0, 62.0];
      case 10: return [3.1, 150.0, 62.0];
      case 13: return [1.5, 105.0, 30.0];
      default: return [3.1, 200.0, 62.0];
    }
  }
  function ramp(p, frame) { return Math.min(0, p + Math.trunc(frame * 90.0 * 0.125 / 60.0)); }
  function fresh() {
    return { mode: 0, alpha: 0, bright: 0, latched: 0, base: 0, wobble: 0,
      frame: 0, sub: 0, phase: 0, curve: 0, wrapped: false, up: false,
      amp: 0, angle: 30.0, acc: 0, p: 0, q: 0 };
  }
  function resetPhase(g, init) {
    g.frame = 0; g.sub = 0; g.phase = 0; g.curve = 0; g.wrapped = false; g.up = false;
    g.amp = init / 100.0; g.angle = 30.0;
  }
  // FADE(40): reset when the screen mode was 0 before; a repeated FADE(40)
  // only changes brightness and preset of the running effect.
  function start(g, p, q, reset) {
    g = g || fresh();
    g.mode = 4;
    const [base, wobble, init] = preset(q);
    g.base = base; g.wobble = wobble;
    g.bright = (q === 16 && !reset) ? ramp(p, g.frame) : p;
    if (reset) resetPhase(g, init);
    if (p !== 0) g.alpha = 1.0;
    g.p = p; g.q = q;
    return g;
  }
  function setMode(g, mode, p, q) {
    g = g || fresh();
    g.mode = mode;
    if (mode === 4) {
      const [base, wobble, init] = preset(q);
      g.base = base; g.wobble = wobble; g.bright = p;
      resetPhase(g, init);
      if (p !== 0) g.alpha = 1.0;
      g.p = p; g.q = q;
    }
    return g;
  }
  function active(g) { return !!g && (g.mode === 4 || g.mode === 5); }
  function step(g, p, q) {
    if (g.mode === 4) g.alpha = Math.min(1.0, g.alpha + 0.016667);
    else {
      g.alpha -= 0.016667;
      if (g.alpha <= 0) { g.mode = 0; g.alpha = 0; }
    }
    g.frame += 1;
    const [base, wobble] = preset(q);
    g.base = base; g.wobble = wobble;
    g.bright = q === 16 ? ramp(p, g.frame) : p;
    const tick = g.sub >= 5;
    g.sub += 1;
    if (!tick) return;
    g.sub = 0;
    g.phase += 100;
    if (g.phase >= 3334) { g.phase -= 3333; g.wrapped = true; }
    const folded = g.phase > 1666 ? 3333 - g.phase : g.phase;
    g.curve = 0.5 - Math.cos(folded * PI / 1666.0) * 0.5;
    if (!g.wrapped) g.curve += g.wobble / 100.0 * Math.sin(g.phase * PI / 3333.0);
    g.amp = g.base * ((g.curve * 80.0 + 20.0) / 100.0);
    if (g.up) {
      g.angle += 3.0;
      if (g.angle > 30.0) { g.angle = 30.0 - (g.angle - 30.0); g.up = false; }
    } else {
      g.angle -= 3.0;
      if (g.angle < -30.0) { g.angle = -30.0 - (g.angle + 30.0); g.up = true; }
    }
  }
  function advance(g, dtMs) {
    if (!g || !active(g)) { if (g) g.acc = 0; return; }
    g.acc += dtMs;
    const FRAME_MS = 1000 / 60;
    while (g.acc >= FRAME_MS && active(g)) { g.acc -= FRAME_MS; step(g, g.p, g.q); }
  }
  // Render parameters for one frame. trans (0..1) eases a brightness
  // change in while a transition runs; otherwise bright latches.
  function params(g, trans) {
    if (!g || g.alpha <= 0 || !active(g)) return null;
    let bright;
    if (trans !== null && trans !== undefined) bright = g.latched + trans * (g.bright - g.latched);
    else { g.latched = g.bright; bright = g.bright; }
    const k = g.amp * 1920 / 960.0;
    const th = g.angle * PI / 180, opp = th + PI;
    const offs = [
      [Math.cos(th) * k, -(Math.sin(th) * k)],
      [Math.cos(opp) * k, -(Math.sin(opp) * k)],
      [2.0 * k * Math.cos(opp), -(2.0 * k * Math.sin(opp))],
    ];
    // vertex colours 0xAARRGGBB, exe wrapping maths, verbatim
    const v = Math.trunc(bright) + 255;
    const words = [(Math.imul(v, 65536) - 0x01000000) | 0, (Math.imul(v, 256) - 0x01000000) | 0, (v - 0x01000000) | 0];
    const cols = words.map((b) => [((b >>> 16) & 0xff) / 255, ((b >>> 8) & 0xff) / 255, (b & 0xff) / 255, ((b >>> 24) & 0xff) / 255]);
    return { alpha: g.alpha, offs, cols };
  }
  global.KW = global.KW || {};
  Object.assign(global.KW, { Ghost: { fresh, start, setMode, active, advance, params } });
  if (typeof module !== "undefined") module.exports = global.KW.Ghost;
})(typeof window !== "undefined" ? window : globalThis);
