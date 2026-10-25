"use strict";
/* kp.js — knife-port helpers. No v2 code lives here: argument parsing mirrors
   knife-core's script parse (tokens are already split in the scene packs) and
   knife's Command::int semantics, plus the small "258-18" arithmetic the packs
   kept from the script source. */
var KP = globalThis.KP || (globalThis.KP = {});
(function () {
  function argInt(s) {
    if (s === undefined || s === null || s === "") return null;
    s = String(s).trim();
    // knife-core eval_int: 0x/0X hex first (u32, wrapped to i32).
    // Without this, every hex literal (STEC colours above all) read as
    // 0 via parseFloat — every coloured fill rendered black.
    if (/^0[xX][0-9a-fA-F]+$/.test(s)) return parseInt(s.slice(2), 16) | 0;
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    const m = s.match(/^(-?\d+)\s*([+-])\s*(-?\d+)$/);
    if (m) return m[2] === "-" ? (+m[1]) - (+m[3]) : (+m[1]) + (+m[3]);
    const n = parseFloat(s);
    return isNaN(n) ? null : Math.trunc(n);
  }
  function argFloat(s) {
    const v = argInt(s);
    return v === null ? null : v;
  }
  // knife Command accessors over a JSON command array [name, ...args]
  class Cmd {
    constructor(arr) { this.name = arr[0]; this.args = arr.slice(1); }
    arg(i) {
      const v = this.args[i];
      return (v === undefined || v === "") ? null : String(v);
    }
    int(i) { return argInt(this.args[i]); }
    intOr(i, d) { const v = this.int(i); return v === null ? d : v; }
    // keyed args: `NNN:value tokens inside the arg list (audio commands).
    // Tokens are 3-digit zero-padded (`017:80), but the key is numeric:
    // compare numerically so both padded and unpadded tokens match. The
    // old regex built `^` + key + ':' verbatim, so keyedInt(17) never
    // matched `017:... and every volume/fade/pan read as its default.
    keyedInt(key) {
      const want = parseInt(key, 10);
      for (const a of this.args) {
        const m = String(a).match(/^`(\d+):(-?\d+)$/);
        if (m && parseInt(m[1], 10) === want) return parseInt(m[2], 10);
      }
      return null;
    }
  }
  function rgb(v) {
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }
  function variantOf(name, info) {
    // (a, b) of a name_NN_NN image, (0, 0) when the name is not a variant
    if (!info || !info.variant) return [0, 0];
    if (name.length < 6) return [0, 0];
    const b = name.charCodeAt.bind(name);
    const n = name.length;
    const d = (i) => name.charCodeAt(i) - 48;
    return [d(n - 5) * 10 + d(n - 4), d(n - 2) * 10 + d(n - 1)];
  }
  function variantDelta(name, images) {
    const [a, b] = [0, 0];
    void a; void b;
    if (!images) return [0, 0];
    const m = /_(\d\d)_(\d\d)$/.exec(name);
    if (!m) return [0, 0];
    const base = name.slice(0, -6);
    const v = images[name], o = images[base];
    if (!v || !o) return [0, 0];
    return [v[2] - o[2], v[3] - o[3]];
  }
  // TinyMT-free deterministic RNG (knife fx::Rng): xorshift32, seeded per game
  function makeRng(seed) {
    let s = (seed >>> 0) || 0x9e3779b9;
    return {
      f() { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; },
      rand() { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; },
    };
  }
  // Every image a scene can show: pack.images keys plus all STCH/SCH2
  // references (bases and padded variants, exactly as cmdStch builds
  // them: base_NN_NN). pack.images alone misses 352 references across
  // 134 scenes — character sprites above all — and those used to
  // lazy-load at first appearance and render as a white box until the
  // texture landed: the appearance blink. BLACK/WHITE are colour
  // layers, not images, and are excluded.
  function sceneImageNames(pack) {
    const out = new Map(); // lower -> original-cased name
    for (const k of Object.keys(pack.images || {})) out.set(k.toLowerCase(), k);
    for (const c of pack.commands || []) {
      if (!c || (c[0] !== "STCH" && c[0] !== "SCH2") || !c[2]) continue;
      const base = String(c[2]);
      if (/^(black|white)$/i.test(base)) continue;
      let name = base;
      const a = parseInt(c[10], 10), b = parseInt(c[11], 10);
      if (!isNaN(a) && !isNaN(b) && (a !== 0 || b !== 0)) {
        name = base + "_" + String(a).padStart(2, "0") + "_" + String(b).padStart(2, "0");
      }
      const low = name.toLowerCase();
      if (!out.has(low)) out.set(low, name);
    }
    return [...out.values()];
  }
  // Images the first frame can show: STCH/SCH2 references placed before
  // the first text line (ZM). Everything else in the scene warms in the
  // background after the scene starts, so New Game no longer blocks on
  // the whole scene's texture set (91 textures / ~934 MB VRAM for 00_00,
  // up to 308 / ~4.5 GB on the heaviest scenes).
  function firstFrameImageNames(pack) {
    const out = new Map();
    for (const c of pack.commands || []) {
      if (!c) continue;
      if (typeof c[0] === "string" && c[0].startsWith("ZM")) break;
      if ((c[0] !== "STCH" && c[0] !== "SCH2") || !c[2]) continue;
      const base = String(c[2]);
      if (/^(black|white)$/i.test(base)) continue;
      let name = base;
      const a = parseInt(c[10], 10), b = parseInt(c[11], 10);
      if (!isNaN(a) && !isNaN(b) && (a !== 0 || b !== 0)) {
        name = base + "_" + String(a).padStart(2, "0") + "_" + String(b).padStart(2, "0");
      }
      const low = name.toLowerCase();
      if (!out.has(low)) out.set(low, name);
    }
    return [...out.values()];
  }
  // Image names a scene's motions can switch a layer to at runtime:
  // STMA binds (layer -> motion), STCH/SCH2 binds (layer -> base), and
  // a motion keyframe's VARIANT_A/B (fields 22/23) rewrites the layer's
  // base to base_NN_NN (motionVariant strips the old suffix first, so
  // the base is stable). Only names passing hasImage (the exe-table
  // gate applyVariant itself checks) are returned: 1304 names across
  // 169 scenes, vs a 106k blind base x pair cross product. These join
  // the background warm tier — warmTextures used to cover STCH names
  // only, so every motion-switched variant popped in on first use
  // (the v20 blink report's coverage gap, found after 0021 shipped).
  function motionVariantNames(pack, motionsData, hasImage) {
    const layerBases = new Map(), layerMotions = new Map();
    for (const c of pack.commands || []) {
      if (!c) continue;
      if ((c[0] === "STCH" || c[0] === "SCH2") && c[2] && !/^(black|white)$/i.test(String(c[2]))) {
        if (!layerBases.has(c[1])) layerBases.set(c[1], new Set());
        layerBases.get(c[1]).add(String(c[2]).toLowerCase());
      } else if (c[0] === "STMA" && c[1] !== undefined && c[2] !== undefined) {
        if (!layerMotions.has(c[1])) layerMotions.set(c[1], new Set());
        layerMotions.get(c[1]).add(String(c[2]));
      }
    }
    const pairsByMotion = new Map();
    for (const [id, m] of Object.entries(motionsData || {})) {
      const ps = new Set();
      for (const k of (m.keys || [])) {
        const a = k[22], b = k[23];
        if (typeof a === "number" && typeof b === "number" && a >= 0 && b >= 0 && (a !== 0 || b !== 0))
          ps.add(String(a).padStart(2, "0") + "_" + String(b).padStart(2, "0"));
      }
      if (ps.size) pairsByMotion.set(String(id), ps);
    }
    const out = new Map();
    for (const [li, mids] of layerMotions) {
      const bases = layerBases.get(li);
      if (!bases) continue;
      for (const mid of mids) {
        const ps = pairsByMotion.get(mid);
        if (!ps) continue;
        for (const base of bases) for (const p of ps) {
          const nm = base + "_" + p;
          if ((!hasImage || hasImage(nm)) && !out.has(nm)) out.set(nm, nm);
        }
      }
    }
    return [...out.values()];
  }
  // First-frame motion variants: a motion started before the first
  // text line (ZM) can show a variant on frame one via its key0
  // VARIANT_A/B pair. Same layer-base tracking as motionVariantNames,
  // restricted to pre-ZM commands. 89 scenes / 183 names corpus-wide,
  // so these join tier0 instead of the background queue.
  function firstFrameVariantNames(pack, motionsData, hasImage) {
    const firstZm = (pack.commands || []).findIndex((c) => c && typeof c[0] === "string" && c[0].startsWith("ZM"));
    const pre = firstZm >= 0 ? pack.commands.slice(0, firstZm) : (pack.commands || []);
    const layerBase = new Map();
    const out = new Map();
    for (const c of pre) {
      if (!c) continue;
      if ((c[0] === "STCH" || c[0] === "SCH2") && c[2] && !/^(black|white)$/i.test(String(c[2]))) {
        layerBase.set(c[1], String(c[2]).toLowerCase());
      } else if (c[0] === "STMA" && c[1] !== undefined && c[2] !== undefined) {
        const m = (motionsData || {})[String(c[2])];
        if (!m || !m.keys || !m.keys.length) continue;
        const k0 = m.keys[0];
        const a = k0[22], b = k0[23];
        if (typeof a !== "number" || typeof b !== "number" || a < 0 || b < 0 || (a === 0 && b === 0)) continue;
        const base = layerBase.get(c[1]);
        if (!base) continue;
        const nm = base + "_" + String(a).padStart(2, "0") + "_" + String(b).padStart(2, "0");
        if ((!hasImage || hasImage(nm)) && !out.has(nm)) out.set(nm, nm);
      }
    }
    return [...out.values()];
  }
  KP.argInt = argInt; KP.argFloat = argFloat; KP.Cmd = Cmd;
  KP.rgb = rgb; KP.variantOf = variantOf; KP.variantDelta = variantDelta;
  KP.sceneImageNames = sceneImageNames;
  KP.firstFrameImageNames = firstFrameImageNames;
  KP.motionVariantNames = motionVariantNames;
  KP.firstFrameVariantNames = firstFrameVariantNames;
  KP.makeRng = makeRng;
  KP.FRAME_MS = 1000 / 60;
  if (typeof module !== "undefined") module.exports = KP;
})();
