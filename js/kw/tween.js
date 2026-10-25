"use strict";
/* tween.js — port of knife stage.rs Tween (sub_31F30/sub_32630/sub_326E0/sub_32820 + sub_3C970).
   Progress word starts at 4096, stepped once per 60 Hz frame by int(-4096 / frames).
   Value = to + diff * (1 - penner(kind, prog/4096 - 1, 0, 1, -1)). */
(function (global) {
  const penner = (global.KW && global.KW.penner) || require("./penner.js").penner;
  class Tween {
    constructor(from, to, frames, ease) {
      let prog = 0, step = 0;
      if (frames >= 1) { prog = 4096; step = Math.trunc(-4096 / frames); }
      this.to = to;
      this.diff = frames !== 0 ? from - to : 0;
      this.prog = prog;
      this.step = step;
      this.ease = ease;
    }
    static fixed(v) { return new Tween(v, v, 0, 0); }
    frac() { return this.prog * 0.00024414; }
    left() { const f = this.frac(); return f > 0 ? 1 - penner(this.ease, f - 1, 0, 1, -1) : 0; }
    value() { return this.to + this.diff * this.left(); }
    valueX() { const k = this.ease === 16 ? this.frac() : this.left(); return this.to + this.diff * k; }
    valueRot() { const a = Math.round(this.diff * 100); const b = (Math.trunc(a * this.left()) << 16) >> 16; return this.to + b / 100; }
    done() { return this.prog <= 0; }
    stepFrame() {
      if (this.prog >= 1) {
        const n = Math.trunc(this.step + this.prog);
        if (this.step < 0 && n >= 1) this.prog = n; else { this.prog = 0; this.step = 0; }
      }
    }
    finish() { this.prog = 0; this.step = 0; }
  }
  global.KW = global.KW || {};
  global.KW.Tween = Tween;
  if (typeof module !== "undefined") module.exports = { Tween };
})(typeof window !== "undefined" ? window : globalThis);
