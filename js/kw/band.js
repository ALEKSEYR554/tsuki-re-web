"use strict";
/* kw/band.js — literal port of knife stage.rs ClipRect::band (sub_36520's
   coloured ridge for clip modes 1..6). Input: the layer's clip rect in
   canvas px (x, y, w, h, rot degrees, inset canvas px, mode) plus the
   layer quad's clip polygon (shrunk corners; null for rotated clips —
   knife sets the band quads' clip to None when rotated).
   Output quads: plain colour quads (nameless, rgb = mode colour) and
   textured strips (name border_K, K = radius index 0..5 or 6..11 for _inv,
   tinted by rgb at draw time). Alpha is filled in by the caller (the
   layer's alpha: knife's band_draw scales the band to it in both paths).
   All 226 band-eligible STCH uses in the scripts are parentless, so the
   standalone band_draw path is the only one the port needs. */
var KW = globalThis.KW || (globalThis.KW = {});
(function () {
  const RADII = [10, 32, 40, 64, 128, 256];
  function bandQuads(clip, quadClip, alpha) {
    const half = clip.inset * 0.5;
    if (half < 1 || !(clip.mode >= 1 && clip.mode <= 6)) return [];
    const l = clip.x * 0.5, t = clip.y * 0.5;
    const rx = (clip.x + clip.w) * 0.5, by = (clip.y + clip.h) * 0.5;
    const w = rx - l, h = by - t;
    const r = Math.min(half, w * 0.5, h * 0.5);
    if (r <= 0) return [];
    let k = RADII.findIndex((n) => r < n);
    if (k < 0) k = 5;
    const n = RADII[k];
    const rgb = clip.mode === 2 ? [1, 1, 1] : clip.mode === 3 ? [1, 0, 0]
      : clip.mode === 4 ? [45 / 255, 19 / 255, 0]
      : clip.mode === 5 ? [246 / 255, 244 / 255, 232 / 255]
      : clip.mode === 6 ? [1, 232 / 255, 210 / 255] : [0, 0, 0];
    const s = 1920 / 960;
    const cx = (l + rx) * 0.5 * s, cy = (t + by) * 0.5 * s;
    const sin = Math.sin(clip.rot * Math.PI / 180), cos = Math.cos(clip.rot * Math.PI / 180);
    const clipPoly = clip.rot === 0 ? quadClip : null;
    const out = [];
    const quad = (tex, x, y, qw, qh) => {
      const p = (px, py) => { const dx = px * s - cx, dy = py * s - cy; return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos]; };
      let name, uv, tint, border;
      if (tex === null) { name = ""; uv = [0, 0, 1, 1]; tint = false; border = null; }
      else {
        const m = n;
        let x0, y0, x1, y1;
        switch (tex & 15) {
          case 0: [x0, y0, x1, y1] = [0, 0, m, m]; break;
          case 1: [x0, y0, x1, y1] = [m - 1, 0, m, m]; break;
          case 2: [x0, y0, x1, y1] = [m, 0, 2 * m, m]; break;
          case 3: [x0, y0, x1, y1] = [0, m - 1, m, m]; break;
          case 4: [x0, y0, x1, y1] = [m, m - 1, 2 * m, m]; break;
          case 5: [x0, y0, x1, y1] = [0, m, m, 2 * m]; break;
          case 6: [x0, y0, x1, y1] = [m - 1, m, m, 2 * m]; break;
          default: [x0, y0, x1, y1] = [m, m, 2 * m, 2 * m];
        }
        name = "border_" + (tex >> 4);
        uv = [x0 / (2 * n), y0 / (2 * n), x1 / (2 * n), y1 / (2 * n)];
        tint = true; border = tex >> 4;
      }
      out.push({ name, pos: [p(x, y), p(x + qw, y), p(x + qw, y + qh), p(x, y + qh)], uv, alpha, rgb, clip: clipPoly, blend: "alpha", band: true, border, tint });
    };
    const gr = k << 4, inv = (k + 6) << 4;
    if (clip.rot === 0) {
      const rl = (l + r <= 0 || (l === 0 && w === 960)) ? 0 : r;
      const rr = (rx - r >= 960 || (l === 0 && w === 960)) ? 0 : r;
      const rt = (t + r <= 0 || (t === 0 && h === 540)) ? 0 : r;
      const rb = (by - r >= 540 || (t === 0 && h === 540)) ? 0 : r;
      for (const [on, x, y, piece, ix, iy] of [
        [rt > 0 && rl > 0, l, t, 0, l + r, t + r],
        [rb > 0 && rl > 0, l, by - r, 5, l + r, by - 2 * r],
        [rr > 0 && rt > 0, rx - r, t, 2, rx - 2 * r, t + r],
        [rb > 0 && rr > 0, rx - r, by - r, 7, rx - 2 * r, by - 2 * r],
      ]) {
        if (on) { quad(null, x, y, r, r); quad(inv | piece, ix, iy, r, r); }
      }
      const along = w - 2 * rl - 2 * rr, down = h - 2 * rt - 2 * rb;
      if (rt > 0) { quad(null, l + rl, t, w - rl - rr, rt); quad(gr | 6, l + 2 * rl, t + rt, along, r); }
      if (rb > 0) { quad(null, l + rl, by - rb, w - rl - rr, rb); quad(gr | 1, l + 2 * rl, by - 2 * rb, along, r); }
      if (rl > 0) { quad(null, l, t + rt, rl, h - rt - rb); quad(gr | 4, l + rl, t + 2 * rt, r, down); }
      if (rr > 0) { quad(null, rx - rr, t + rt, rr, h - rt - rb); quad(gr | 3, rx - 2 * rr, t + 2 * rt, r, down); }
    } else {
      const x0 = l + r * 0.5, x1 = rx - r * 0.5, y0 = t + r * 0.5, y1 = by - r * 0.5;
      const at = (piece, px, py, ax, ay, qw, qh) => quad(piece, px - ax * qw, py - ay * qh, qw, qh);
      for (const [[px, py], g, ga, ii, ia] of [
        [[x0, y0], 0, [1, 1], 0, [0, 0]],
        [[x0, y1], 5, [1, 0], 5, [0, 1]],
        [[x1, y0], 2, [0, 1], 2, [1, 0]],
        [[x1, y1], 7, [0, 0], 7, [1, 1]],
      ]) {
        at(gr | g, px, py, ga[0], ga[1], r, r);
        at(inv | ii, px, py, ia[0], ia[1], r, r);
      }
      const mid = [(l + rx) * 0.5, (t + by) * 0.5];
      for (const y of [y0, y1]) {
        at(gr | 1, mid[0], y, 0.5, 1, w - 2 * r, 2 * r);
        at(gr | 6, mid[0], y, 0.5, 0, w - 4 * r, r);
      }
      for (const x of [x0, x1]) {
        at(gr | 3, x, mid[1], 1, 0.5, 2 * r, h - 2 * r);
        at(gr | 4, x, mid[1], 0, 0.5, r, h - 4 * r);
      }
    }
    return out;
  }
  KW.bandQuads = bandQuads;
})();
