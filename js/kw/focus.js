"use strict";
/* kw/focus.js — literal port of knife/src/game/focus.rs, lines path only.
   FCLN starts a manga focus-lines effect (4..=33), FCSP fades it out.
   Effects 1..=3 (falling notes) are NOT used by any script (verified
   25.10.2026: FCLN arg5 values are 4..27, 29, 32), so the notes path is
   skipped: start() accepts 1..=3 but quads() renders nothing for them.
   Positions are kept in knife's 640x448 draw space; quads come out in
   canvas px (1920x1080). FocusLine texture is 1920x128. */
var KW = globalThis.KW || (globalThis.KW = {});
(function () {
  const N = [-1, -1, -1, -1, -1, -1, -1, -1, -1];
  // LINES[effect-4]: 4 keyframes x [time ms, cx, cy, rMin, rMax, nMin, nMax, alpha, interval ms]
  const LINES = [
    [[0, 640, 360, 600, 200, 300, 400, 255, 32], N, N, N],
    [[0, 640, 360, 184, 400, 70, 90, 169, 32], N, N, N],
    [[0, 806, 360, 288, 479, 40, 80, 255, 50], [1100, 734, 417, 323, 407, 40, 80, 255, 50], [1200, 734, 417, 323, 407, 40, 80, 255, 50], N],
    [[0, 817, 956, 800, 300, 60, 100, 255, 50], N, N, N],
    [[0, 800, 327, 300, 400, 50, 60, 255, 32], N, N, N],
    [[0, 420, 360, 300, 100, 25, 50, 80, 50], N, N, N],
    [[0, 850, 360, 400, 100, 25, 50, 80, 50], N, N, N],
    [[0, 600, 360, 400, 100, 25, 50, 80, 50], N, N, N],
    [[0, 700, 360, 400, 100, 25, 50, 80, 50], N, N, N],
    [[0, 600, 360, 400, 100, 25, 50, 150, 50], N, N, N],
    [[0, 600, 360, 400, 100, 25, 50, 120, 50], N, N, N],
    [[0, 600, 360, 2000, 100, 25, 400, 255, 30], N, N, N],
    [[0, 650, 360, 2000, 100, 100, 200, 255, 30], N, N, N],
    [[0, 650, 360, 2000, 100, 70, 120, 255, 30], N, N, N],
    [[0, 878, 279, 242, 329, 10, 15, 0, 50], [200, 878, 279, 242, 329, 10, 15, 128, 50], N, N],
    [[0, 540, 453, 119, 324, 25, 50, 0, 20], [200, 540, 453, 119, 324, 25, 50, 255, 20], N, N],
    [[0, 428, 376, 175, 395, 25, 50, 0, 20], [200, 428, 376, 175, 395, 25, 50, 255, 20], N, N],
    [[0, 540, 453, 119, 324, 25, 50, 0, 20], [0, 540, 453, 119, 324, 125, 150, 255, 20], N, N],
    [[0, 540, 453, 119, 324, 25, 50, 255, 20], [0, 540, 453, 119, 324, 25, 50, 255, 20], N, N],
    [[0, 540, 453, 119, 324, 40, 60, 0, 20], [200, 540, 453, 119, 324, 40, 60, 255, 20], N, N],
    [[0, 587, 463, 256, 423, 25, 50, 255, 50], N, N, N],
    [[0, 640, 487, 189, 384, 25, 50, 255, 50], N, N, N],
    [[0, 256, 313, 50, 100, 25, 50, 255, 50], [300, 256, 313, 131, 296, 10, 20, 255, 50], N, N],
    [[0, 256, 313, 131, 296, 25, 50, 255, 50], [400, 386, 390, 155, 413, 50, 60, 255, 32], N, N],
    [[0, 540, 453, 119, 324, 25, 50, 0, 20], N, N, N],
    [[0, 540, 453, 119, 324, 25, 50, 0, 20], [200, 626, 382, 228, 467, 10, 20, 255, 20], N, N],
    [[0, 626, 382, 228, 467, 10, 20, 255, 20], [100, -361, 809, 228, 467, 10, 20, 0, 20], N, N],
    [[0, 441, 510, 228, 467, 50, 75, 255, 20], N, N, N],
    [[0, 441, 510, 228, 467, 50, 75, 255, 20], [150, 811, 395, 228, 467, 50, 75, 255, 20], N, N],
    [[0, 640, 360, 100, 200, 10, 20, 0, 1000], N, N, N],
  ];
  const SINGLE = 0x29303FFB;
  function lineUv(idx) {
    switch (idx) {
      case 2: return [0, 10];
      case 3: return [0, 40];
      case 6: return [0, 30];
      case 14: return [850, 120];
      default: return [0, 0];
    }
  }
  const rad = (a) => a * Math.PI / 32768;
  const wrapI16 = (v) => { v = v % 65536; if (v > 32767) v -= 65536; if (v < -32768) v += 65536; return v; };
  const MASK64 = (1n << 64n) - 1n;
  class Rng {
    constructor(seed) { this.s = BigInt(seed | 1); }
    rand() {
      let x = this.s;
      x = (x ^ (x << 13n)) & MASK64;
      x = (x ^ (x >> 7n)) & MASK64;
      x = (x ^ (x << 17n)) & MASK64;
      this.s = x;
      return Number(x >> 33n);
    }
  }
  const FREE = () => ({ kind: -1, tick: 0, total: 0, step: 0, frame: 0, key: 0, angle: 0, x: 0, y: 0, alpha: 0, vx: 0, vy: 0, ax: 0, ay: 0 });
  class Focus {
    constructor() {
      this.mode = 0; this.effect = 0; this.level = 0; this.rate = 1;
      this.slots = Array.from({ length: 400 }, FREE);
      this.clock = 0; this.since = 0;
      this.rng = new Rng(0x005CAC1D);
      this.acc = 0;
    }
    active() { return this.mode !== 0; }
    start(effect, frames) {
      const rate = frames > 0 ? 1 / frames : 1;
      if (effect === 0 && frames <= 0) { this.level = 0; this.mode = 0; this.rate = 1; }
      else if (effect === 0) { this.mode = 3; this.rate = rate; }
      else if (effect >= 4 && effect <= 33) {
        if (this.mode === 2 && this.effect === effect) return;
        this.mode = 1; this.effect = effect; this.level = 0; this.rate = rate;
        this.slots = Array.from({ length: 400 }, FREE);
        this.clock = 0; this.since = 0;
      } else if (effect >= 1 && effect <= 3) {
        // notes: state tracked, quads() renders nothing (no script uses them)
        this.mode = 1; this.effect = effect; this.level = 0; this.rate = rate;
        for (let i = 0; i < 50; i++) this.slots[i] = FREE();
      }
    }
    advance(dtMs) {
      if (!this.active()) { this.acc = 0; return; }
      this.acc += dtMs;
      const FRAME_MS = 1000 / 60;
      while (this.acc >= FRAME_MS && this.active()) { this.acc -= FRAME_MS; this.step(1); }
    }
    step(n) {
      if (this.mode === 3) {
        this.level -= this.rate * n;
        if (this.level <= 0) { this.level = 0; this.mode = 0; return; }
      } else if (this.mode === 1) {
        this.level += this.rate * n;
        if (this.level >= 1) { this.level = 1; this.mode = 2; }
      } else if (this.mode === 0) return;
      if (this.effect >= 4 && this.effect <= 33) this.stepLines(n);
    }
    stepLines(n) {
      const idx = this.effect - 4;
      const table = LINES[idx];
      this.clock = wrapI16(this.clock + n);
      if (this.clock < 0) this.clock = 180;
      this.since = wrapI16(this.since + n);
      const t = this.clock * 1000 / 60;
      const t1 = table[1][0];
      let k, next;
      if (t < table[0][0] || (((SINGLE >> idx) & 1) === 0 && t >= t1)) {
        const t2 = table[2][0];
        if (t >= t1 && (idx !== 2 || t < t2)) { k = 1; next = table[2][0]; }
        else if (t >= t2) { k = 2; next = table[3][0]; }
        else { k = 0; next = table[1][0]; }
      } else { k = 0; next = table[1][0]; }
      const kf = table[k];
      let alpha = kf[7];
      if (next >= 0) alpha += (t - kf[0]) * (table[k + 1][7] - kf[7]) / (next - kf[0]);
      if (this.since * 1000 / 60 < kf[8]) return;
      this.since = 0;
      const span = Math.max(Math.abs(kf[6] - kf[5]), 1);
      let count = Math.min(this.rng.rand() % span + kf[5], 400);
      if (this.effect <= 8) count = Math.trunc(count / 2);
      count = Math.max(count, 0);
      for (let i = 0; i < count; i++) {
        this.slots[i].key = k;
        this.rollLine(i, idx);
        this.slots[i].alpha = alpha / 255;
      }
      for (let i = count; i < this.slots.length; i++) this.slots[i] = FREE();
    }
    rollLine(i, idx) {
      const s = this.slots[i];
      const kf = LINES[idx][s.key];
      const angle = (this.rng.rand() % 65536) - 32768;
      const lo = Math.min(kf[3], kf[4]);
      const span = Math.max(Math.abs(kf[4] - kf[3]), 1);
      const r = (this.rng.rand() % span + lo) * 0.7;
      const th = rad(angle);
      s.kind = idx + 4; s.angle = angle;
      s.x = (r * Math.cos(th) + kf[1]) * 640 / 1280;
      s.y = (r * Math.sin(th) + kf[2]) * 448 / 720;
    }
    quads() {
      if (!this.active() || this.effect < 4 || this.effect > 33) return [];
      const tw = 1920, th = 128; // FocusLine texture size
      const kx = 1920 / 640, ky = 1080 / 448;
      const native = [640 / 1920, 448 / 1080];
      let sx = native[0], sy = native[1];
      const out = [];
      for (const s of this.slots) {
        if (!(s.alpha > 0 && s.kind >= 0)) continue;
        const u = s.angle < 0 ? s.angle + 65536 : s.angle;
        const near = ((u + 7999) & 0xFFFF) <= 0x3E7E;
        let scale = null;
        if (s.kind === 7) scale = [2 / 3, native[1] / 2];
        else if (s.kind === 8 && near) scale = [1 / 6, native[1]];
        else if (s.kind === 8 && ((u + 27000) & 0xFFFF) >= 0xD2F1) scale = [0.4, native[1]];
        else if (s.kind === 9 || s.kind === 10) scale = [0.5, native[1]];
        else if (s.kind === 13 || s.kind === 19) scale = [0.4, native[1]];
        else if (s.kind >= 15 && s.kind <= 17) scale = [0.6, native[1]];
        else if (s.kind === 18 && ((u + 21000) & 0xFFFF) >= 0xA411) scale = [0.43333334, native[1]];
        else if (s.kind === 20 && near) scale = [0.4, native[1]];
        else if (s.kind >= 21 && s.kind <= 23 && u >= 0xE0C1) scale = [0.4, native[1]];
        else if ((s.kind === 26 || s.kind === 27) && near) scale = [0.6, native[1]];
        else if (s.kind >= 28 && s.kind <= 31) scale = [0.5333333, native[1]];
        else if (s.kind === 32 && ((u + 27000) & 0xFFFF) >= 0xD2F1) scale = [0.5333333, native[1]];
        if (scale) { sx = scale[0]; sy = scale[1]; }
        // knife's GPU clamps the alpha; Canvas2D ignores out-of-range
        // globalAlpha (keeps the previous quad's), so clamp here
        const a = Math.min(1, Math.max(0, s.alpha * this.level));
        const th_ = rad(s.angle);
        const c = Math.cos(th_), nn = Math.sin(th_);
        const len = 960 * sx, wid = 2 * sy;
        const p = (dl, dw) => [(s.x + c * dl - nn * dw) * kx, (s.y + nn * dl + c * dw) * ky];
        const [u0, v0] = lineUv(s.kind - 4);
        out.push({
          name: "focusline",
          pos: [p(0, 0), p(len, 0), p(len, wid), p(0, wid)],
          uv: [u0 / tw, v0 / th, (u0 + 960) / tw, (v0 + 2) / th],
          alpha: a, rgb: [1, 1, 1], clip: null, blend: "alpha",
        });
      }
      return out;
    }
    toJSON() {
      return {
        mode: this.mode, effect: this.effect, level: this.level, rate: this.rate,
        clock: this.clock, since: this.since, rng: this.rng.s.toString(),
        slots: this.slots.filter((s) => s.kind >= 0).map((s) => ({ kind: s.kind, key: s.key, angle: s.angle, x: s.x, y: s.y, alpha: s.alpha })),
      };
    }
    static fromJSON(d) {
      const f = new Focus();
      f.mode = d.mode; f.effect = d.effect; f.level = d.level; f.rate = d.rate;
      f.clock = d.clock; f.since = d.since;
      f.rng = new Rng(0x005CAC1D); f.rng.s = BigInt(d.rng);
      f.slots = Array.from({ length: 400 }, FREE);
      (d.slots || []).forEach((s, i) => { if (i < 400) Object.assign(f.slots[i], s); });
      return f;
    }
  }
  KW.Focus = Focus;
})();
