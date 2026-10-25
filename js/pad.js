// KP.Pad — Gamepad API polling with knife pad.rs semantics: all
// controllers act as one, Standard mapping, direction repeat (fire on
// press, again after 15 frames, then every 5 frames) with one shared
// counter for all directions. Right stick drives Up/Down/Left/Right;
// the left stick has its own LUp/LDown/LLeft/LRight. Stick threshold
// 80/128, like knife.
(function () {
  "use strict";
  const BTN = { A: 0, B: 1, X: 2, Y: 3, L: 4, R: 5, ZL: 6, ZR: 7, Minus: 8, Plus: 9, R3: 11 };
  const TH = 0.625;
  function axisDir(v, neg, pos) { if (v < -TH) return neg; if (v > TH) return pos; return null; }
  class Pad {
    constructor() {
      this.cb = null; this.raf = 0; this.lastT = 0;
      this.btnHeld = {};
      this.dirHeld = null; this.dirAcc = 0; this.dirFired = -1;
    }
    start(cb) {
      this.cb = cb;
      if (this.raf) return;
      this.lastT = performance.now();
      const loop = (now) => {
        this.raf = requestAnimationFrame(loop);
        let dt = now - this.lastT; this.lastT = now;
        if (dt > 100) dt = 100;
        this.poll(dt);
      };
      this.raf = requestAnimationFrame(loop);
    }
    stop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }
    // test hook (CDP): deliver a pad event without a physical controller
    inject(pad, pressed, repeat) { if (this.cb) this.cb(pad, pressed, !!repeat); }
    poll(dtMs) {
      if (!this.cb) return;
      const pads = (navigator.getGamepads ? navigator.getGamepads() : []) || [];
      const btn = {};
      const dirs = [];
      for (const gp of pads) {
        if (!gp || !gp.connected) continue;
        const b = gp.buttons || [], ax = gp.axes || [];
        const pr = (i) => !!(b[i] && b[i].pressed);
        for (const name of Object.keys(BTN)) if (pr(BTN[name])) btn[name] = true;
        if (pr(12)) dirs.push("Up");
        if (pr(13)) dirs.push("Down");
        if (pr(14)) dirs.push("Left");
        if (pr(15)) dirs.push("Right");
        const ry = axisDir(ax[3] || 0, "Up", "Down"), rx = axisDir(ax[2] || 0, "Left", "Right");
        if (ry && !dirs.includes(ry)) dirs.push(ry);
        if (rx && !dirs.includes(rx)) dirs.push(rx);
        const ly = axisDir(ax[1] || 0, "LUp", "LDown"), lx = axisDir(ax[0] || 0, "LLeft", "LRight");
        if (ly) dirs.push(ly);
        if (lx) dirs.push(lx);
      }
      for (const name of Object.keys(BTN)) {
        const held = !!btn[name];
        if (held && !this.btnHeld[name]) this.cb(name, true, false);
        else if (!held && this.btnHeld[name]) this.cb(name, false, false);
        this.btnHeld[name] = held;
      }
      const cur = dirs[0] || null;
      if (cur !== this.dirHeld) {
        if (this.dirHeld) this.cb(this.dirHeld, false, false);
        this.dirHeld = cur; this.dirAcc = 0; this.dirFired = -1;
        if (cur) this.cb(cur, true, false);
      } else if (cur) {
        this.dirAcc += Math.min(dtMs / (1000 / 60), 2);
        const f = Math.floor(this.dirAcc);
        if (f >= 15 && f !== this.dirFired && (f - 15) % 5 === 0) { this.dirFired = f; this.cb(cur, true, true); }
      }
    }
  }
  globalThis.KP = globalThis.KP || {};
  globalThis.KP.Pad = Pad;
})();
