"use strict";
/* motion.js — literal JS port of knife motion.rs (STMA evaluator, sub_97B80/sub_97710/sub_972C0).
   Data: { "<id>": { len, mask, keys: [[28 fields]...] }, "__loops": { "<id>": ms } }
   Field numbers match the exe accessor sub_99FF0. */
(function (global) {
  const penner = (global.KW && global.KW.penner) || require("./penner.js").penner;
  const ease = (kind, p) => penner(kind, Math.min(1, Math.max(0, p)), 0, 1, 1);

  const NO_KEY = -32767, HOLD = -32766, NO_KEY_WIDE = -100001, HOLD_WIDE = -100000;
  const EASED_WHOLE = 9999;
  const F = { TIME: 0, EASE: 1, INTERP: 2, X: 3, Y: 4, ALPHA: 5, PIVOT_X: 6, PIVOT_Y: 7, ROT: 8,
              ZOOM_X: 9, ZOOM_Y: 10, CLIP_MODE: 15, CLIP_INSET: 16, BLEND: 17, FILL: 18,
              VARIANT_A: 22, VARIANT_B: 23, SNX2: 24, SNX3: 25, GRAIN: 26, PRIO: 27 };
  const GATE = { X: 0x40880n, Y: 0x5100000n, ALPHA: 0x4000n, PIVOT_X: 0x10002n, PIVOT_Y: 0x20004n,
                 ROT: 0x88000n, ROT2: 0x400000000n, ZOOM_X: 0x80200000n, ZOOM_Y: 0x100400000n,
                 CLIP_X: 0x10000080n, CLIP_Y: 0x4000400n, CLIP_MODE: 0x10n, CLIP_INSET: 0x20n,
                 BLEND: 0x2000000n, FILL: 0x200n, COLOR: 0x200000000n, SNX2: 0x40n, SNX3: 0x100n,
                 GRAIN: 0x1000n, PRIO: 0x1n, VARIANT_A: 0x20000000n, VARIANT_B: 0x40000000n };
  const sentinels = (f) => (f === F.TIME || f === F.ROT) ? [NO_KEY_WIDE, HOLD_WIDE] : [NO_KEY, HOLD];

  class MotionTable {
    constructor(data) {
      this.keys = [];           // flat [28] rows, like the exe pool
      this.ranges = new Map();  // id -> [start, end)
      this.lens = new Map();
      this.masks = new Map();   // id -> BigInt
      this.loops = new Map();
      for (const [idStr, m] of Object.entries(data)) {
        if (idStr === "__loops") continue;
        const id = +idStr, start = this.keys.length;
        for (const k of m.keys) this.keys.push(k);
        this.ranges.set(id, [start, this.keys.length]);
        this.lens.set(id, m.len);
        if (m.mask != null) this.masks.set(id, BigInt(m.mask));
      }
      if (data.__loops) for (const [id, ms] of Object.entries(data.__loops)) this.loops.set(+id, ms);
    }
    addData(data) { const t = new MotionTable(data); for (const [id, r] of t.ranges) if (!this.ranges.has(id)) { const s = this.keys.length; for (let i = r[0]; i < r[1]; i++) this.keys.push(t.keys[i]); this.ranges.set(id, [s, this.keys.length]); this.lens.set(id, t.lens.get(id)); if (t.masks.has(id)) this.masks.set(id, t.masks.get(id)); } for (const [id, ms] of t.loops) this.loops.set(id, ms); }
    exists(id) { const r = this.ranges.get(id); return !!r && r[1] > r[0]; }
    length(id) { return id < 1 ? 0 : (this.lens.get(id) || 0); }
    patchKey(id, key, values) {
      const r = this.ranges.get(id); if (!r) return;
      if (r[0] + key >= r[1]) return;
      for (const [f, v] of values) this.keys[r[0] + key][f] = v;
    }
    localTime(id, t) {
      const len = this.length(id);
      if (t <= len || len <= 0) return [Math.min(t, Math.max(len, 0)), t >= len];
      const lp = this.loops.get(id);
      if (lp === undefined) return [len, true];
      if (lp <= 1 || lp >= len) return [t % len, false];
      return [(t - lp) % (len - lp) + lp, false];
    }
    easedTime(id, t) {
      const r = this.ranges.get(id);
      if (!r || id !== EASED_WHOLE) return t;
      const total = this.keys[r[1] - 1][F.TIME];
      let kind = this.keys[r[0]][F.EASE];
      if (kind === NO_KEY || kind === HOLD) kind = 0;
      return total <= 0 ? t : ease(kind, t / total) * total;
    }
    gated(id, t) { const r = this.ranges.get(id); return !!r && t >= this.keys[r[0]][F.TIME]; }
    maskAt(id, t) {
      let m = this.masks.get(id) || 0n;
      const r = this.ranges.get(id); if (!r) return 0n;
      const keys = this.keys.slice(r[0], r[1]);
      const atStart = keys.some((k) => k[F.TIME] >= t) && (keys.find((k) => k[F.TIME] >= t) || [])[F.TIME] === 0;
      const present = (f) => atStart || keys.some((k) => k[F.TIME] !== 0 && k[f] !== NO_KEY && k[f] !== NO_KEY_WIDE);
      if (!present(F.X)) m &= ~GATE.X;
      if (!present(F.Y)) m &= ~GATE.Y;
      if (!present(F.ALPHA)) m &= ~GATE.ALPHA;
      if (!present(F.VARIANT_A)) m &= ~GATE.VARIANT_A;
      if (!present(F.VARIANT_B)) m &= ~GATE.VARIANT_B;
      if (!present(F.ZOOM_X)) m &= ~GATE.ZOOM_X;
      if (!present(F.ZOOM_Y)) m &= ~GATE.ZOOM_Y;
      if (!present(F.BLEND)) m &= ~GATE.BLEND;
      return m;
    }
    alphaAt(id, t, cur) {
      const [lt] = this.localTime(id, t);
      const et = this.easedTime(id, lt);
      if (!this.gated(id, et)) return null;
      if ((this.maskAt(id, et) & GATE.ALPHA) === 0n) return null;
      return this.sample(id, F.ALPHA, et, cur);
    }
    sample(id, f, t, cur) {
      const r = this.ranges.get(id); if (!r) return null;
      const [a2, e] = r, a3 = e - 1;
      const k = (i, g) => this.keys[i][g];
      const time = (i) => k(i, F.TIME), val = (i) => k(i, f);
      const [none, hold] = sentinels(f);
      const isSentinel = (v) => v === NO_KEY || v === HOLD;
      if (time(a2) > t) return cur;
      let a4 = -1;
      for (let i = a2; i < e; i++) if (time(i) >= t) { a4 = i; break; }
      if (a4 < 0) return null;
      let v20 = a4, v7, v24;
      for (;;) { const v21 = v20; v7 = val(v20); v24 = time(v20); v20 += 1; if (!(v21 < a3 && v7 === hold)) break; }
      let v8, v9 = 0;
      if (a4 === a2 || v24 <= t) {
        for (;;) { v20 -= 1; v8 = val(v20); if (!((v8 === none || v8 === hold) && v20 > a2)) break; }
      } else {
        let v25 = a4;
        for (;;) { v25 -= 1; v8 = val(v25); v9 = time(v25); if (!(v25 > a2 && v8 === hold)) break; }
        if (v7 !== none && v8 === none && v25 > a2) {
          let v28 = v25 - 1;
          for (;;) { v8 = val(v28); if ((v8 !== hold && v8 !== none) || v28 <= a2) break; v28 -= 1; }
        }
      }
      if (v7 === none) {
        let i = a4;
        for (;;) { v7 = val(i); if ((v7 !== none && v7 !== hold) || i <= a2) break; i -= 1; }
        if (v7 === none || v7 === hold) return cur;
        return f === F.X ? v7 * 640 / 1280 * 1280 / 640 : f === F.Y ? v7 * 480 / 720 * 720 / 480 : v7;
      }
      if (v8 === none) return cur;
      if (v7 === hold) {
        for (let i = a3 - 1; i >= a2; i--) if (val(i) !== hold) return val(i);
        return cur;
      }
      if (v8 === hold) return cur;
      const discrete = f >= 17 && f < 28;
      let u;
      if (v9 >= v24) u = 1;
      else {
        let kind;
        if (id === EASED_WHOLE) kind = 0;
        else if (a4 === a2) kind = k(a4, F.EASE);
        else {
          kind = NO_KEY;
          for (let i = a4 - 1; i >= a2; i--) { if (val(i) === hold) continue; const v = k(i, F.EASE); if (!isSentinel(v)) { kind = v; break; } }
        }
        u = ease(isSentinel(kind) ? 0 : kind, (t - v9) / (v24 - v9));
      }
      if (discrete || f === F.CLIP_MODE) return v8;
      let interp;
      if (a4 === a2) interp = k(a4, F.INTERP);
      else {
        interp = NO_KEY;
        for (let i = a4 - 1; i >= a2; i--) { const v = k(i, F.INTERP); if (!isSentinel(v)) { interp = v; break; } }
        if (interp === NO_KEY) interp = k(a2, F.INTERP);
      }
      if (interp === 2) return v8;
      if (interp === 1) {
        const sp = this.spline(f, a2, a3, a4, cur);
        if (sp) { const [m0, m1] = sp; return v8 + u * ((v7 - v8) - (m1 + (m0 + m0)) + u * (m0 * 3 + u * (m1 - m0))); }
      }
      return v8 + (v7 - v8) * u;
    }
    spline(f, a2, a3, a4, a7) {
      if (a2 === a4 || a3 - a2 < 2) return null;
      const [none, hold] = sentinels(f);
      const v = (i) => this.keys[i][f];
      const knot = (x) => (x === hold || x === none) ? a7 : x;
      const p = [knot(v(a2))];
      const map = new Array(a3 - a2 + 1).fill(0);
      for (let i = a2 + 1; i < a3; i++) {
        const vp = v(i - 1), vi = v(i), vn = v(i + 1);
        if (vi !== hold && (vp !== vi || vi !== vn)) {
          let j = i;
          while ((v(j) === hold || v(j) === none) && j > a2) j -= 1;
          p.push(knot(v(j)));
        }
        map[i - a2] = p.length - 1;
      }
      const vl = v(a3 - 1), vz = v(a3);
      if (vl !== vz && vz !== none) {
        let j = a3;
        while ((v(j) === hold || v(j) === none) && j > a2) j -= 1;
        p.push(knot(v(j)));
        map[a3 - a2] = p.length - 1;
      }
      const n = p.length;
      if (n < 3) return null;
      const d = new Array(n + 1).fill(0), s = new Array(n + 1).fill(0);
      for (let j = 1; j < n; j++) d[j] = p[j] - p[j - 1];
      let prev = d[2];
      s[1] = d[2] - d[1];
      d[1] = 4;
      let diag = 4;
      for (let j = 2; j < n - 1; j++) {
        const inv = 1 / diag, next = d[j + 1];
        s[j] = (next - prev) - diag * inv;
        diag = 4 - inv;
        d[j] = diag;
        prev = next;
      }
      const m = n - 2;
      s[m] -= s[m + 1];
      s[m] = (s[m] - s[m + 1]) / d[m];
      for (let j = m; j >= 2; j--) s[j - 1] = (s[j - 1] - s[j]) / d[j - 1];
      const i = map[a4 - 1 - a2];
      return [s[i], s[i + 1]];
    }
    advance(st, ms, cur) {
      if (!st.paused) st.t += ms;
      const [t0, done] = this.localTime(st.id, st.t);
      st.done = done;
      const t = this.easedTime(st.id, t0);
      const frame = { x: null, y: null, alpha: null, rot: null, zoomX: null, zoomY: null, prio: null,
                      clip: [null, null, null, null], clipMode: null, clipInset: null,
                      pivot: [null, null], rot2: null, blend: null, fill: null, fillColor: 0,
                      color: null, variant: [null, null], snx2: null, snx3: null, grain: null };
      if (!this.gated(st.id, t)) return frame;
      const m = this.maskAt(st.id, t);
      const s = (g, f) => (m & g) !== 0n ? this.sample(st.id, f, t, cur[f]) : null;
      const even = (v) => ((v | 0) & ~1);
      const rgb = () => {
        const c = (f) => { const v = this.sample(st.id, f, t, 0); return v == null ? 0 : ((v | 0) & 0xff); };
        return (c(19) << 16) | (c(20) << 8) | c(21);
      };
      frame.x = s(GATE.X, F.X);
      frame.y = s(GATE.Y, F.Y);
      const al = s(GATE.ALPHA, F.ALPHA); frame.alpha = al == null ? null : Math.min(255, Math.max(0, al)) / 255;
      const rt = s(GATE.ROT, F.ROT); frame.rot = rt == null ? null : rt / 100;
      const zx = s(GATE.ZOOM_X, F.ZOOM_X); frame.zoomX = zx == null ? null : zx / 1000;
      const zy = s(GATE.ZOOM_Y, F.ZOOM_Y); frame.zoomY = zy == null ? null : zy / 1000;
      const pr = s(GATE.PRIO, F.PRIO); frame.prio = pr == null ? null : pr | 0;
      frame.clip = [s(GATE.CLIP_X, 11), s(GATE.CLIP_Y, 12),
                    (() => { const v = s(GATE.CLIP_X, 13); return v == null ? null : even(v); })(),
                    (() => { const v = s(GATE.CLIP_Y, 14); return v == null ? null : even(v); })()];
      const cm = s(GATE.CLIP_MODE, F.CLIP_MODE); frame.clipMode = cm == null ? null : Math.max(0, cm) | 0;
      const ci = s(GATE.CLIP_INSET, F.CLIP_INSET); frame.clipInset = ci == null ? null : Math.max(0, ci) | 0;
      frame.pivot = [s(GATE.PIVOT_X, F.PIVOT_X), s(GATE.PIVOT_Y, F.PIVOT_Y)];
      const r2 = s(GATE.ROT2, F.ROT); frame.rot2 = r2 == null ? null : r2 | 0;
      const bl = s(GATE.BLEND, F.BLEND); frame.blend = bl == null ? null : bl | 0;
      const fl = s(GATE.FILL, F.FILL); frame.fill = fl == null ? null : fl | 0;
      frame.fillColor = rgb();
      frame.color = (m & GATE.COLOR) !== 0n ? rgb() : null;
      frame.variant = [(() => { const v = s(GATE.VARIANT_A, F.VARIANT_A); return v == null ? null : v | 0; })(),
                         (() => { const v = s(GATE.VARIANT_B, F.VARIANT_B); return v == null ? null : v | 0; })()];
      const s2 = s(GATE.SNX2, F.SNX2); frame.snx2 = s2 == null ? null : s2 / 255 + 1;
      const s3 = s(GATE.SNX3, F.SNX3); frame.snx3 = s3 == null ? null : s3 * 0.01 + 1;
      const gr = s(GATE.GRAIN, F.GRAIN); frame.grain = gr == null ? null : gr | 0;
      return frame;
    }
  }
  function newMotionState(id, start) { return { id, t: start || 0, done: false, paused: false }; }
  global.KW = global.KW || {};
  global.KW.MotionTable = MotionTable;
  global.KW.newMotionState = newMotionState;
  global.KW.MOTION_FIELD = F;
  if (typeof module !== "undefined") module.exports = { MotionTable, newMotionState, F, GATE };
})(typeof window !== "undefined" ? window : globalThis);
