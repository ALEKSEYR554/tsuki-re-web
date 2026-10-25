// Literal port of knife/src/game/flow_jump.rs (jump_marks / jump_special /
// mark_edge, sub_95790 / sub_93D10 / sub_954B0): the flowchart marks of a
// scene JUMP, from the node of the scene being left to the node of the
// target scene id. `st` is the VM: var(name) / setVar(name, v) for the F
// words, nodesVisited / nodesDone / edges Sets for the persistent progress
// words (off_AE04E0: RDST bits at word 110, RDED bits at 300, edge flags
// at 400), setPlayBit('R'/'E', i) for the playthrough bits (F201+ / F600+),
// lastPick for the last choice's option / button index (off_AE0AA0).
// `marks` is data/flow_marks.json: {sceneNode, sceneIdNode, edges}.
(function (global) {
  const EDGE_BASE = 564, EDGE_BITS = 704;
  function wname(off) { return "F" + String(Math.trunc(off / 2)).padStart(3, "0"); }
  function progOr(st, off, mask) {
    const w = Math.trunc(off / 2);
    for (let b = 0; b < 16; b++) {
      if (!((mask >> b) & 1)) continue;
      if (w >= 110 && w < 300) st.nodesVisited.add((w - 110) * 16 + b);
      else if (w >= 300 && w < 400) st.nodesDone.add((w - 300) * 16 + b);
      // persistent edge flags are stored by flag number (564 + bit)
      else if (w >= 400) { const i = (w - 400) * 16 + b; if (i < EDGE_BITS) st.edges.add(i + EDGE_BASE); }
    }
  }
  function fw(st, off) { return st.var(wname(off)); }
  function fb(st, off) { return (fw(st, off & ~1) >> ((off % 2) * 8)) & 0xFF; }
  function fOr(st, off, mask) { const n = wname(off); st.setVar(n, st.var(n) | mask); }
  function f110if24(st, n) { if (fw(st, 0x30) !== 0) st.setVar("F110", n); }
  function markEdge(st, marks, from, to) {
    const e = (marks.edges || []).find((r) => r[0] === from && r[1] === to);
    if (e) {
      for (let k = 2; k < e.length; k++) {
        const f = e[k];
        if (k > 2 && f < 1) break;
        const i = f - EDGE_BASE;
        if (i >= 0 && i < EDGE_BITS) { st.edges.add(f); st.setPlayBit("E", i); }
      }
    }
    st.setVar("F110", to);
  }
  // Returns true when the pair is handled (no plain mark follows).
  function jumpSpecial(st, marks, a1, a2) {
    const pick = st.lastPick | 0;
    const pair = (v4, to) => { markEdge(st, marks, v4, to); return true; };
    switch (a1) {
      case 24: return a2 === 371;
      case 51: {
        if (a2 !== 69) return false;
        progOr(st, 0x11C, 0x80); fOr(st, 0x212, 0x80); f110if24(st, 519);
        progOr(st, 0x298, 0x80); progOr(st, 0x350, 0x800);
        markEdge(st, marks, 51, 519); return pair(519, 69);
      }
      case 52: if (a2 !== 312) return false; return pair(66, a2);
      case 55: if (a2 !== 58 || (fb(st, 0x1A0) & 2) === 0) return false; return pair(57, 58);
      case 57: return a2 === 55;
      case 66: {
        if (a2 === 53) {
          progOr(st, 0x11E, 4); fOr(st, 0x216, 4); f110if24(st, 530); progOr(st, 0x29A, 4);
          markEdge(st, marks, 66, 530); return pair(530, 53);
        } else if (a2 !== 52) return false;
        return fw(st, 0x64) !== 0;
      }
      case 67: {
        if (a2 !== 66) return false;
        if ((fb(st, 0x1A2) & 0x10) !== 0) return pair(68, 66);
        if ((fb(st, 0x1DE) & 0x80) === 0) return false;
        return pair(311, 66);
      }
      case 68: case 311: return a2 === 67;
      case 69: if (a2 !== 311) return false; return pair(519, a2);
      case 87: case 168: case 252: case 253: case 271: case 272: case 325: case 326: case 515: return false;
      case 98: if (a2 !== 203) return false; return pair(202, a2);
      case 101: {
        if (a2 !== 102) return false;
        let n;
        if (pick === 1) { progOr(st, 0x11A, 0x40); fOr(st, 0x20E, 0x40); f110if24(st, 502); progOr(st, 0x296, 0x40); n = 502; }
        else if (pick === 0) { progOr(st, 0x11A, 0x20); fOr(st, 0x20E, 0x20); f110if24(st, 501); progOr(st, 0x296, 0x20); n = 501; }
        else { progOr(st, 0x11A, 0x80); fOr(st, 0x20E, 0x80); f110if24(st, 503); progOr(st, 0x296, 0x80); n = 503; }
        markEdge(st, marks, 101, n); return pair(n, 102);
      }
      case 104: if (a2 !== 107 || (fb(st, 0x1AC) & 2) === 0) return false; return pair(105, 107);
      case 105: return a2 === 104 || a2 === 204;
      case 108: return a2 === 322;
      case 126: if (a2 !== 129 || (fb(st, 0x1B0) & 0x80) === 0) return false; return pair(127, 129);
      case 127: return a2 === 126;
      case 136: if (a2 === 137) progOr(st, 0x334, 0x400); return false;
      case 149: if (a2 !== 341 || (fb(st, 0x1B8) & 1) === 0) return false; return pair(152, 341);
      case 152: return a2 === 149;
      case 166: {
        if (a2 !== 342) return false;
        let n;
        if (pick !== 0) { progOr(st, 0x11A, 0x200); fOr(st, 0x210, 2); f110if24(st, 505); progOr(st, 0x296, 0x200); n = 505; }
        else { progOr(st, 0x11A, 0x100); fOr(st, 0x210, 1); f110if24(st, 504); progOr(st, 0x296, 0x100); n = 504; }
        markEdge(st, marks, 166, n); return pair(n, 342);
      }
      case 169: if (a2 !== 323 || (fb(st, 0x1BC) & 1) === 0) return false; return pair(168, 323);
      case 172: {
        if (a2 !== 11) return false;
        progOr(st, 0x11A, 0x400); fOr(st, 0x210, 4); f110if24(st, 506); progOr(st, 0x296, 0x400);
        markEdge(st, marks, 172, 506); return pair(506, 11);
      }
      case 181: {
        if (a2 !== 184) return false;
        progOr(st, 0x11C, 0x100); fOr(st, 0x214, 1); f110if24(st, 520); progOr(st, 0x298, 0x100);
        markEdge(st, marks, 181, 520);
        if (fw(st, 0x6C) === 0) return true;
        progOr(st, 0x350, 0x4000); return pair(520, 184);
      }
      case 184: if (a2 !== 314) return false; return pair(520, a2);
      case 202: return a2 === 98;
      case 204: if (a2 !== 207 || (fb(st, 0x1C4) & 0x20) === 0) return false; return pair(205, 207);
      case 205: return a2 === 105;
      case 213: if (a2 === 215) progOr(st, 0x342, 2); return false;
      case 221: {
        if (a2 !== 222) return false;
        let mask, f, n;
        if (pick === 1) { mask = 0x4000; f = 0x40; n = 510; }
        else if (pick === 0) { mask = 0x2000; f = 0x20; n = 509; }
        else { mask = 0x8000; f = 0x80; n = 511; }
        progOr(st, 0x11A, mask); fOr(st, 0x210, f); f110if24(st, n); progOr(st, 0x296, mask);
        markEdge(st, marks, 221, n); return pair(n, 222);
      }
      case 234: {
        if (a2 !== 236 && a2 !== 235) return false;
        progOr(st, 0x11C, 1); fOr(st, 0x212, 1); f110if24(st, 512); progOr(st, 0x298, 1);
        markEdge(st, marks, 234, 512); return pair(512, a2);
      }
      case 250: return a2 === 257;
      case 251: {
        if (a2 !== 252 && a2 !== 253 && a2 !== 254 && a2 !== 325 && a2 !== 326) return false;
        progOr(st, 0x11C, 2); fOr(st, 0x212, 2); f110if24(st, 513); progOr(st, 0x298, 2);
        markEdge(st, marks, 251, 513); return pair(513, a2);
      }
      case 256: if (a2 !== 259 || (fb(st, 0x1D2) & 4) === 0) return false; return pair(258, 259);
      case 258: return a2 === 256;
      case 261: if (a2 === 262) progOr(st, 0x36A, 0x100); return false;
      case 269: {
        if (a2 === 483) { progOr(st, 0x11C, 4); fOr(st, 0x212, 4); f110if24(st, 514); progOr(st, 0x298, 4); }
        else if (a2 === 270) { progOr(st, 0x34A, 0x20); fOr(st, 0x212, 4); progOr(st, 0x11C, 4); f110if24(st, 514); progOr(st, 0x298, 4); }
        else return false;
        markEdge(st, marks, 269, 514); return pair(514, a2);
      }
      case 270: case 483: return a2 === 523;
      case 274: {
        if (a2 !== 276 && a2 !== 275) return false;
        progOr(st, 0x11C, 0x10); fOr(st, 0x212, 0x10); f110if24(st, 516); progOr(st, 0x298, 0x10);
        markEdge(st, marks, 274, 516);
        if (a2 === 276) return pair(516, 276);
        markEdge(st, marks, 516, 275); progOr(st, 0x36A, 0x80); return true;
      }
      case 275: case 276: return a2 === 521;
      case 277: case 278: {
        if (a2 !== 280 && a2 !== 279) return false;
        progOr(st, 0x11C, 0x40); fOr(st, 0x212, 0x40); f110if24(st, 518); progOr(st, 0x298, 0x40);
        markEdge(st, marks, a1, 518);
        if (a2 === 280) return pair(518, 280);
        markEdge(st, marks, 518, 279); progOr(st, 0x36A, 0x20); return true;
      }
      case 279: case 280: return a2 === 1196;
      case 312: if (a2 === 493) progOr(st, 0x36E, 4); return false;
      case 322: if (a2 !== 112 || (fb(st, 0x1AC) & 0x10) === 0) return false; return pair(108, 112);
      case 324: return a2 === 329 && (fb(st, 0x1D6) & 1) !== 0;
      case 329: {
        if (a2 !== 274) return false;
        if ((fb(st, 0x1D4) & 0x80) !== 0) return pair(271, 274);
        if ((fb(st, 0x1D6) & 1) === 0) return false;
        return pair(272, 274);
      }
      case 331: if (a2 === 330) { progOr(st, 0x11C, 0x400); progOr(st, 0x298, 0x400); progOr(st, 0x36A, 4); } return false;
      case 355: if (a2 === 20) progOr(st, 0x33C, 0x800); return false;
      case 369: {
        if (a2 !== 29) return false;
        let mask, n;
        if (pick === 1) { mask = 8; n = 499; }
        else if (pick === 0) { mask = 4; n = 498; }
        else { mask = 0x10; n = 500; }
        progOr(st, 0x11A, mask); fOr(st, 0x20E, mask); f110if24(st, n); progOr(st, 0x296, mask);
        markEdge(st, marks, 369, n); return pair(n, 29);
      }
      case 371: return a2 === 24;
      case 410: {
        if (a2 !== 220) return false;
        let mask, f, n;
        if (pick !== 0) { mask = 0x1000; f = 0x10; n = 508; }
        else { mask = 0x800; f = 8; n = 507; }
        progOr(st, 0x11A, mask); fOr(st, 0x210, f); f110if24(st, n); progOr(st, 0x296, mask);
        markEdge(st, marks, 410, n); return pair(n, 220);
      }
      case 439: if (a2 === 327) progOr(st, 0x354, 1); return false;
      case 446: case 447: return a2 === 517;
      case 463: {
        if (a2 !== 300) return false;
        progOr(st, 0x11C, 0x6000); fOr(st, 0x214, 0x60); f110if24(st, 526); progOr(st, 0x298, 0x6000);
        markEdge(st, marks, 463, 525); markEdge(st, marks, 525, 526); return pair(526, 300);
      }
      case 478: {
        if (a2 === 331) { progOr(st, 0x36A, 2); return false; }
        if (a2 !== 330) return false;
        progOr(st, 0x11C, 0x400); fOr(st, 0x214, 4); f110if24(st, 522); progOr(st, 0x298, 0x400);
        markEdge(st, marks, 478, 522); return pair(522, 330);
      }
      case 480: {
        if (a2 !== 309) return false;
        progOr(st, 0x11C, 0x9000); fOr(st, 0x214, 0x90); f110if24(st, 527); progOr(st, 0x298, 0x9000);
        markEdge(st, marks, 480, 524); markEdge(st, marks, 524, 527); return pair(527, 309);
      }
      case 486: {
        if (a2 !== 1) return false;
        progOr(st, 0x11E, 2); fOr(st, 0x216, 2); f110if24(st, 529); progOr(st, 0x29A, 2);
        markEdge(st, marks, 486, 529); markEdge(st, marks, 529, 1); return true;
      }
      case 517: {
        if (a2 !== 278 && a2 !== 277) return false;
        progOr(st, 0x11C, 0x20); fOr(st, 0x212, 0x20); f110if24(st, 517); progOr(st, 0x298, 0x20);
        const from = ((fw(st, 0x200) & 0x40) !== 0) ? 446 : 447;
        markEdge(st, marks, from, 517); return pair(517, a2);
      }
      case 518: return a2 === 279 || a2 === 280;
      case 521: {
        if (a2 !== 447 && a2 !== 446) return false;
        progOr(st, 0x11C, 0x200); fOr(st, 0x214, 2); f110if24(st, 521); progOr(st, 0x298, 0x200);
        if ((fb(st, 0x1D6) & 8) !== 0) { markEdge(st, marks, 275, 521); if (a2 === 446) progOr(st, 0x36A, 0x40); }
        else markEdge(st, marks, 276, 521);
        return pair(521, a2);
      }
      case 523: {
        if (a2 === 515) {
          fOr(st, 0x214, 8); progOr(st, 0x11C, 0x808); f110if24(st, 523); progOr(st, 0x298, 0x808);
          fOr(st, 0x212, 8); f110if24(st, 515);
          if ((fb(st, 0x1D4) & 0x40) !== 0) { markEdge(st, marks, 270, 523); progOr(st, 0x36A, 0x400); }
          else markEdge(st, marks, 483, 523);
          return pair(523, 515);
        } else if (a2 === 271) {
          progOr(st, 0x11C, 0x800); fOr(st, 0x214, 8); f110if24(st, 523); progOr(st, 0x298, 0x800);
          const from = ((fw(st, 0x1D4) & 0x40) === 0) ? 483 : 270;
          markEdge(st, marks, from, 523); return pair(523, 271);
        }
        return false;
      }
      case 905: return a2 === 523;
      case 1196: if (a2 !== 281) return false; return pair(((fb(st, 0x1D6) & 0x80) !== 0) ? 279 : 280, 281);
      default: {
        // into the prologue's second half (node 486) through 485 and 528
        if (a2 !== 486) return false;
        fOr(st, 0x216, 1); progOr(st, 0x29A, 1); progOr(st, 0x11E, 1); progOr(st, 0x118, 0x20);
        fOr(st, 0x20A, 0x20); f110if24(st, 485); progOr(st, 0x294, 0x20);
        markEdge(st, marks, 485, 528); return pair(528, 486);
      }
    }
  }
  function sceneIdNode(marks, id) {
    if (!(id >= 1 && id <= 9999)) return -1;
    const hit = (marks.sceneIdNode || []).find((p) => p[0] === id);
    return hit ? hit[1] : -1;
  }
  // jump_marks(sceneIndex, targetId): sceneIndex is the 0-based index in
  // scene_order (START_SCRIPT = 0); SCENE_NODE[sceneIndex - 1] is the node
  // of the scene being left.
  function jumpMarks(st, marks, sceneIndex, targetId) {
    const from = sceneIndex >= 1 ? (marks.sceneNode[sceneIndex - 1] ?? -1) : -1;
    const to = sceneIdNode(marks, targetId);
    if (!jumpSpecial(st, marks, from, to) && to >= 1 && from >= 1 && from <= 530) {
      markEdge(st, marks, from, to);
    }
  }
  global.KW = global.KW || {};
  global.KW.flowJump = { jumpMarks, jumpSpecial, markEdge, sceneIdNode, EDGE_BASE, EDGE_BITS };
})(typeof window !== "undefined" ? window : globalThis);
