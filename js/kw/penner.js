"use strict";
/* penner.js — literal JS port of knife motion.rs penner() (sub_961B0 / sub_30C80).
   Penner (t, b, c, d) forms with the exe's own constants. Kinds 2..=41; else linear.
   Layer tweens call it with d = -1 (the in-out halves swap there). */
(function (global) {
  function bounce(x) {
    if (x < 0.363636364) return x * x * 7.5625;
    if (x < 0.727272727) { const y = x - 0.545454545; return y * 7.5625 * y + 0.75; }
    if (x < 0.909090909) { const y = x - 0.818181818; return y * 7.5625 * y + 0.9375; }
    const y = x - 0.954545455; return y * 7.5625 * y + 0.984375;
  }
  function elasticOutIn(t, b, c, d) {
    const tt = t + t, h = c * 0.5;
    if (d * 0.5 <= t) {
      const bb = h + b, u = tt - d;
      if (u === 0) return bb;
      const p = u / d;
      if (p === 1) return h + bb;
      const s = d * 0.3, q = p - 1;
      return bb - Math.pow(2, q * 10) * h * Math.sin(((q * d + s * -0.25) * 6.28318531) / s);
    }
    if (tt === 0) return b;
    const p = tt / d;
    if (p === 1) return h + b;
    const s = d * 0.3;
    return Math.pow(2, p * -10) * h * Math.sin(((p * d + s * -0.25) * 6.28318531) / s) + h + b;
  }
  function penner(kind, t, b, c, d) {
    const r = t / d, h = c * 0.5;
    switch (kind) {
      case 2: return r * (r * c) + b;
      case 3: return b - r * c * (r - 2);
      case 4: {
        const x = t / (d * 0.5);
        if (x < 1) return c * 0.5 * (x * x) + b;
        const y = (x - 1) * ((x - 1) - 2);
        return c * -0.5 * (y - 1) + b;
      }
      case 5: {
        const tt = t + t;
        if (d * 0.5 <= t) { const u = (tt - d) / d; return u * (u * h) + (h + b); }
        return b + (-h * (tt / d)) * ((tt / d) - 2);
      }
      case 6: return r * r * (r * c) + b;
      case 7: return ((r - 1) * (r - 1) * (r - 1) + 1) * c + b;
      case 8: {
        const x = t / (d * 0.5);
        if (x < 1) return c * 0.5 * Math.pow(x, 3) + b;
        return c * 0.5 * (Math.pow(x - 2, 3) + 2) + b;
      }
      case 9: {
        const tt = t + t;
        if (d * 0.5 <= t) { const u = (tt - d) / d; return u * u * (u * h) + (h + b); }
        const u = tt / d - 1; return (u * u * u + 1) * h + b;
      }
      case 10: return Math.pow(r, 3) * (r * c) + b;
      case 11: return b - (Math.pow(r - 1, 3) * (r - 1) - 1) * c;
      case 12: {
        const x = t / (d * 0.5);
        if (x < 1) return c * 0.5 * Math.pow(x, 4) + b;
        return c * -0.5 * (Math.pow(x - 2, 3) * (x - 2) - 2) + b;
      }
      case 13: {
        const tt = t + t;
        if (d * 0.5 > t) { const u = tt / d - 1; return (Math.pow(u, 3) * u - 1) * (-h) + b; }
        const u = (tt - d) / d; return Math.pow(u, 3) * (u * h) + (h + b);
      }
      case 14: return Math.pow(r, 4) * (r * c) + b;
      case 15: return (Math.pow(r - 1, 4) * (r - 1) + 1) * c + b;
      case 16: {
        const x = t / (d * 0.5);
        if (x >= 1) return c * 0.5 * (Math.pow(x - 2, 4) * (x - 2) + 2) + b;
        return c * 0.5 * Math.pow(x, 5) + b;
      }
      case 17: {
        const tt = t + t;
        if (d * 0.5 > t) { const u = tt / d - 1; return (Math.pow(u, 4) * u + 1) * h + b; }
        const u = (tt - d) / d; return Math.pow(u, 4) * (u * h) + (h + b);
      }
      case 18: return c - Math.cos(r * 1.57079633) * c + b;
      case 19: return Math.sin(r * 1.57079633) * c + b;
      case 20: return b + c * -0.5 * (Math.cos(t * 3.14159265 / d) - 1);
      case 21: {
        const tt = t + t;
        if (d * 0.5 <= t) { const u = (tt - d) / d; return h - Math.cos(u * 1.57079633) * h + (h + b); }
        return Math.sin((tt / d) * 1.57079633) * h + b;
      }
      case 22: return b - (Math.sqrt(1 - r * r) - 1) * c;
      case 23: return Math.sqrt(1 - (r - 1) * (r - 1)) * c + b;
      case 24: {
        const x = t / (d * 0.5);
        if (x >= 1) return c * 0.5 * (Math.sqrt(1 - (x - 2) * (x - 2)) + 1) + b;
        return c * -0.5 * (Math.sqrt(1 - x * x) - 1) + b;
      }
      case 25: {
        const tt = t + t;
        if (d * 0.5 > t) { const u = tt / d - 1; return h * Math.sqrt(1 - u * u) + b; }
        const u = (tt - d) / d; return (h + b) - (Math.sqrt(1 - u * u) - 1) * h;
      }
      case 26: {
        if (t === 0) return b;
        return Math.pow(2, (r - 1) * 10) * c + b + c * -0.001;
      }
      case 27: {
        if (t === d) return b + c;
        return c * 1.001 * (1 - Math.pow(2, (t * -10) / d)) + b;
      }
      case 28: {
        if (t === 0) return b;
        if (t === d) return b + c;
        const x = t / (d * 0.5);
        if (x < 1) return c * 0.5 * Math.pow(2, (x - 1) * 10) + b + c * -0.0005;
        return c * 0.5 * 1.0005 * (2 - Math.pow(2, (x - 1) * -10)) + b;
      }
      case 29: {
        const tt = t + t;
        if (d * 0.5 <= t) {
          const u = tt - d, bb = h + b;
          if (u === 0) return bb;
          return Math.pow(2, ((u / d) - 1) * 10) * h + bb + h * -0.001;
        }
        if (tt === d) return h + b;
        return h * 1.001 * (1 - Math.pow(2, (tt * -10) / d)) + b;
      }
      case 30: {
        if (t === 0) return b;
        if (r === 1) return b + c;
        const s = d * 0.3, q = r - 1;
        return b - Math.pow(2, q * 10) * c * Math.sin(((q * d + s * -0.25) * 6.28318531) / s);
      }
      case 31: {
        if (t === 0) return b;
        if (r === 1) return b + c;
        const s = d * 0.3;
        return Math.pow(2, r * -10) * c * Math.sin(((r * d + s * -0.25) * 6.28318531) / s) + c + b;
      }
      case 32: {
        if (t === 0) return b;
        const x = t / (d * 0.5);
        if (x === 2) return b + c;
        const s = d * 0.45, q = s * 0.25, u = x - 1;
        const w = Math.sin(((u * d - q) * 6.28318531) / s);
        if (x >= 1) return Math.pow(2, u * -10) * c * w * 0.5 + c + b;
        return b + Math.pow(2, u * 10) * c * w * -0.5;
      }
      case 33: return elasticOutIn(t, b, c, d);
      case 34: return r * (r * c) * (r * 2.7016 - 1.7016) + b;
      case 35: return ((r - 1) * (r - 1) * ((r - 1) * 2.7016 + 1.7016) + 1) * c + b;
      case 36: {
        const x = t / (d * 0.5);
        if (x < 1) return c * 0.5 * (x * x) * (x * 3.5949 - 2.5949) + b;
        const y = x - 2;
        return c * 0.5 * (y * y * (y * 3.5949 + 2.5949) + 2) + b;
      }
      case 37: {
        const tt = t + t;
        if (d * 0.5 <= t) { const u = (tt - d) / d; return u * (u * h) * (u * 2.7016 - 1.7016) + (h + b); }
        const u = tt / d - 1; return h * (u * u * (u * 2.7016 + 1.7016) + 1) + b;
      }
      case 38: {
        const v = bounce((d - t) / d) * c;
        return c - v + b;
      }
      case 39: return bounce(r) * c + b;
      case 40: {
        const tt = t + t;
        if (d * 0.5 <= t) { const v = bounce((tt - d) / d) * c; return c * 0.5 + v * 0.5 + b; }
        const v = bounce((d - tt) / d) * c; return ((c - v) * 0.5) + b;
      }
      case 41: {
        const tt = t + t;
        if (d * 0.5 <= t) { const v = bounce((d - (tt - d)) / d) * h; return (h - v) + (h + b); }
        return bounce(tt / d) * h + b;
      }
      default: return (t * c) / d + b;
    }
  }
  function ease(kind, p) { return penner(kind, Math.min(1, Math.max(0, p)), 0, 1, 1); }
  global.KW = global.KW || {};
  global.KW.penner = penner;
  global.KW.ease = ease;
  if (typeof module !== "undefined") module.exports = { penner, ease };
})(typeof window !== "undefined" ? window : globalThis);
