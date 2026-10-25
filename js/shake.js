"use strict";
/* shake.js — literal port of knife game/shake.rs (ScreenShake) and stage.rs
   Quake::step (modes 1/2/3). Offsets are in 640x448 draw units, exactly as
   knife's layer_quad consumes them (x/3 * CANVAS_W/640, y/3 * CANVAS_H/448). */
var KP = globalThis.KP || (globalThis.KP = {});
(function () {
  const TAU = 6.2832;
  class ScreenShake {
    constructor() { this.kind = 0; this.frames = 0; this.period = 0; this.count = 0; this.amp = [0, 0]; this.phase = 0; this.fade = 0; this.delay = 0; this.pending = null; this.offset = [0, 0]; this.acc = 0; }
    start(ax, ay, periodMs, count, delayMs) {
      const s = { ax, ay, periodMs, count };
      this.delay = delayMs;
      if (delayMs < 1) this.begin(s); else this.pending = s;
    }
    begin(s) {
      this.kind = 1;
      this.frames = Math.trunc(3 * s.periodMs * s.count / 50);
      const p = s.periodMs * 3 / 50;
      this.period = p === 0 ? 1 : p;
      this.count = Math.max(1, s.count);
      this.amp = [s.ax, s.ay];
      this.phase = 0; this.fade = 1;
    }
    stop() { this.kind = -1; this.frames = 0; }
    fadeOut(ms) {
      const f = Math.trunc(60 * ms / 1000);
      this.frames = f;
      if (f > 0) { this.phase = -(this.amp[0] / f); this.fade = -(this.amp[1] / f); }
      else this.stop();
    }
    advance(dt) {
      this.acc += dt;
      while (this.acc >= KP.FRAME_MS) { this.acc -= KP.FRAME_MS; this.step(); }
    }
    step() {
      if (this.delay >= 1) {
        this.delay = Math.max(0, this.delay - 1000 / 60);
        if (this.delay === 0 && this.pending) this.begin(this.pending);
      }
      if (this.frames === 0) { this.offset = [0, 0]; return; }
      if (this.kind !== 1) return;
      if (this.frames >= 1) {
        this.frames = Math.max(0, this.frames - 1);
        if (this.frames === 0) {
          this.kind = 0; this.period = 0; this.amp = [0, 0]; this.phase = 0; this.fade = 0;
          this.offset = [0, 0]; return;
        }
      }
      this.phase += TAU / this.period;
      this.fade = Math.max(0, this.fade - 1 / this.period / this.count);
      const s = Math.sin(this.phase);
      this.offset = [s * this.amp[0] * this.fade * 640 / 1280, s * this.amp[1] * this.fade * 480 / 720];
    }
  }
  class Quake {
    constructor(mode, params, durMs, delayMs) {
      this.mode = mode;
      this.delay = Math.trunc(3 * delayMs / 50);
      this.remaining = durMs < 0 ? -1 : Math.trunc(3 * durMs / 50);
      this.params = params.slice(0, 6);
      this.elapsed = 0; this.counter = 0; this.counterY = 0;
      this.amp = [0, 0]; this.period = [0, 0]; this.sign = [0, 0];
      this.offset = [0, 0];
    }
    static fresh() { return new Quake(0, [0, 0, 0, 0, 0, 0], -1, 0); }
    active() { return this.mode !== 0; }
    step(rng, lead) {
      if (this.delay >= 1) { this.delay = Math.max(0, this.delay - 1); return; }
      if (this.remaining === 0) return;
      this.elapsed = Math.min(30000, this.elapsed + 1);
      if (this.remaining >= 1 && this.remaining < this.elapsed) {
        const f = Quake.fresh(); Object.assign(this, f); return;
      }
      const p = this.params.map(Number);
      const e = this.elapsed;
      if (this.mode === 1) {
        this.counter += 1;
        if (this.params[2] >= this.counter) return;
        this.counter = 0;
        if (lead && this.params[5] !== 0) { this.offset = lead; return; }
        let k = 1;
        if (e >= p[3]) {
          if (this.remaining >= 1) {
            const t = this.remaining - p[4];
            if (t < e) k = 1 - (e - t) / p[4];
          }
        } else k = e / p[3];
        const r = () => rng.f() * 2 - 1;
        this.offset = [p[0] * k * r(), p[1] * k * r()];
      } else if (this.mode === 2) {
        const period = this.params[2] === 0 ? 60 : this.params[2];
        const ap = Math.abs(period);
        let c = this.counter + 1;
        while (c >= ap) c -= ap;
        this.counter = c;
        let s = Math.sin(c * TAU / period);
        if (this.params[4] >= 1 && this.elapsed < this.params[4]) s *= e / p[4];
        if (this.params[3] !== 0 && this.remaining >= 1) {
          const rem = this.remaining;
          s *= (rem - Math.min(e, rem)) / rem;
        }
        if (this.params[5] > 1) s = (rng.rand() % 5 === 0) ? s / p[5] : 0;
        this.offset = [s * p[0], s * p[1]];
      } else if (this.mode === 3) {
        const axis = (ci, ai, pi, si) => {
          let c = ci.v + 1;
          if (pi.v < c) {
            c = 0;
            const u1 = rng.rand() * 4.6566e-10;
            ai.v = Math.trunc(u1 * (p[1] - p[0]) + p[0]);
            const u2 = rng.rand() * 4.6566e-10;
            pi.v = Math.trunc(u2 * (p[3] - p[2]) + p[2]);
            if (si.v === 0) si.v = (rng.rand() * 4.6566e-10) < 0.5 ? 1 : -1;
          }
          ci.v = c;
          const v = si.v * ai.v * p[4] * Math.sin(c * TAU / pi.v);
          return isNaN(v) ? 0 : v;
        };
        const cx = { v: this.counter }, ax = { v: this.amp[0] }, px = { v: this.period[0] }, sx = { v: this.sign[0] };
        const cy = { v: this.counterY }, ay = { v: this.amp[1] }, py = { v: this.period[1] }, sy = { v: this.sign[1] };
        const x = axis(cx, ax, px, sx), y = axis(cy, ay, py, sy);
        this.counter = cx.v; this.amp[0] = ax.v; this.period[0] = px.v; this.sign[0] = sx.v;
        this.counterY = cy.v; this.amp[1] = ay.v; this.period[1] = py.v; this.sign[1] = sy.v;
        this.offset = [x, y];
      } else this.offset = [0, 0];
    }
  }
  KP.ScreenShake = ScreenShake; KP.Quake = Quake;
  if (typeof module !== "undefined") module.exports = KP;
})();
