"use strict";
/* vm.js — KP.Game: a faithful port of knife's game.rs script_dispatch loop.
   Every arm cites knife's behaviour (addresses in comments where knife gives
   them); v2's models are deliberately NOT reused. Gaps are marked GAP. */
var KP = globalThis.KP || (globalThis.KP = {});
(function () {
  const KW = globalThis.KW;
  const LAYERS = 40;
  function imgRecord(tableEntry) {
    // exe table entry: [w, h, center_x, center_y, kind, level, flags65, flags67]
    if (!tableEntry) return null;
    const [w, h, cx, cy, kind, level, f65] = tableEntry;
    return {
      width: w, height: h, centerX: cx, centerY: cy, kind,
      level, levelScale: level === 1 ? 0.5 : level === 2 ? 0.25 : level === 3 ? 0.125 : 1,
      noShake: !!(f65 & 2), ownBlend: !!(f65 & 1), uv: [1, 1],
    };
  }
  class Game {
    constructor(opts) {
      this.images = opts.images || {};       // exe image table (name -> entry)
      this.motions = opts.motions || null;   // KW.MotionTable
      this.imageUrl = opts.imageUrl || (() => null);
      this.audio = opts.audio || null;
      this.onText = opts.onText || (() => {});
      this.onPage = opts.onPage || (() => {});
      this.onPageClear = opts.onPageClear || (() => {});
      this.onTextHidden = opts.onTextHidden || (() => {});
      this.pageMsgCount = 0; // messages on the current page (F823 rule)
      this.voiceToPlay = null; // VPLY-staged voice for the next message start
      this.onChoice = opts.onChoice || null; // async (opts, extra?) -> index
      this.onRdas = opts.onRdas || null; // (node) -> void, boot gates it
      this.textResolver = opts.textResolver || null; // (ref) -> text, i18n-aware
      this.onMovie = opts.onMovie || null;   // async (id) -> void
      this.onSceneEnd = opts.onSceneEnd || (() => {});
      this.onBgm = opts.onBgm || null;
      this.onSe = opts.onSe || null;
      this.onSeFired = opts.onSeFired || null; // (resolved entry) -> void, for key-68 delayed SE ops
      this.onAtsv = opts.onAtsv || null; // () -> void, boot flushes the backlog page + writes a save point
      this.onStaffStart = opts.onStaffStart || null; // () -> void, boot saves auto/skip modes and clears them
      this.onStaffEnd = opts.onStaffEnd || null; // () -> void, boot restores the saved modes
      this.staffTask = false; // XSTP staff roll task (knife game.rs staff_task)
      this.focus = new KW.Focus(); // FCLN/FCSP manga focus lines (kw/focus.js)
      this.seDelayed = []; // knife se_delayed queue, ticked per 60 Hz frame in stepFrame
      this.onVoice = opts.onVoice || null;
      this.idmap = opts.idmap || {};
      this.sceneLoader = opts.sceneLoader || null;
      this.vars = {};
      this.stage = new KW.Stage();
      this.stageDirty = false;
      this.trans = null;      // {kind:'fade'|'hold', dur, t} | null
      this.transFrom = null;  // pre-FADS presented quads, faded out over the new stage
      this.wnty = 0;          // WNTY: 0 = line-break icon, 1 = page-break icon
      this.fads = null;       // {hold, started} | null
      this.snapshot = false;
      this.stageBackup = null;
      this.wait = { kind: "none" };
      this.pc = 0;
      this.script = null; this.sceneName = "";
      this.jumpTo = null;
      this.instant = false;
      this.ended = false;
      this.shake = new KP.ScreenShake();
      this.msgQuake = null;
      this.rng = KP.makeRng(0x12345678);
      this.nodesVisited = new Set(); this.nodesDone = new Set(); this.edges = new Set();
      this.lastPick = 0; this.keepBgmAtEnd = false;
      this.flowMarks = opts.flowMarks || null; this.sceneOrder = opts.sceneOrder || null;
      this.seen = new Set();
      this.read = new Array(4020).fill(0);
      this.readKey = null;
      this.skip = false; this.auto = false;
      this.voicePlaying = false;
      this.selOpts = [];
      this.msgQuakeOff = [0, 0];
      this.frame = 0;
      this.fadsRule = -1;
      this.hazeTable = opts.hazeTable || null;
      this.ghost = null;
    }
    var(n) { return this.vars[n] ?? 0; }
    setVar(n, v) { this.vars[n] = v | 0; }
    // knife play bits (game.rs set_play_bit): 'R' route words F201+,
    // 'E' route-edge words F600+, bit i % 8 of word base + i / 8.
    playWord(key, i) { return "F" + String((key === "R" ? 201 : 600) + Math.trunc(i / 8)).padStart(3, "0"); }
    playBit(key, i) { return ((this.var(this.playWord(key, i)) >> (i % 8)) & 1) !== 0; }
    setPlayBit(key, i) { const w = this.playWord(key, i); this.setVar(w, this.var(w) | (1 << (i % 8))); }
    clearPlayBit(key, i) { const w = this.playWord(key, i); this.setVar(w, this.var(w) & ~(1 << (i % 8))); }
    // ---- stage helpers (knife stage.rs / game.rs) ----
    layer(i) { return (i >= 0 && i < LAYERS) ? this.stage.layers[i] : null; }
    stageBytes() {
      // GAP: knife serialises the stage to a byte block; JSON snapshot is
      // equivalent for FADS backup/restore inside one session.
      return JSON.stringify(this.stage.layers.map((l) => l ? {
        name: l.name, x: l.x.to, y: l.y.to, zx: l.zoomX.to, zy: l.zoomY.to,
        alpha: l.alpha.to, rot: l.rotation.to, prio: l.prio,
        parent: l.parent, base: l.base, absolute: l.absolute,
        clip: l.clip, clipInset: l.clipInset, clipMode: l.clipMode,
        rot2: l.rot2, soxy: l.soxy, stbr: l.stbr, stecMode: l.stecMode,
        stecColor: l.stecColor, snx: l.snx, pending: l.pending,
      } : null));
    }
    refreshBackup() {
      if (this.var("F991") !== 0) return;
      this.stageBackup = this.stageBytes();
      this.setVar("F991", 1);
    }
    noteStageChange(cmd) {
      const name = cmd.name;
      if (name === "FADS") return;
      if (name === "STMA" && (cmd.int(2) === 1 || (cmd.int(2) === 2 && false))) this.setVar("F1103", 1);
      if (name === "VPLY" || name === "MSAD" || name === "WTTM") { this.refreshBackup(); return; }
      const stchOk = (() => { const l = cmd.int(0); return l !== null && l >= 0 && l <= 39; })();
      const backsUp = ["STCH", "SCH2", "SOXY", "STTR"].includes(name) ? stchOk
        : name === "STZ4" ? true
        : ["STCC", "STBR", "STCL", "STCP", "STRT", "STRC", "STRR", "STGS", "STRA", "STNS", "FCSP", "FCLN", "FLNT", "STMA", "SPMA", "SGMA", "SQK2", "SQS2", "SHK2", "SHS2", "SSW2", "SSS2"].includes(name)
        || (name === "STEC" && stchOk)
        || ((name === "SNX2" || name === "SNX3") && (cmd.int(0) ?? -1) >= 0);
      if (backsUp && this.var("F991") === 0) { this.stageBackup = this.stageBytes(); this.setVar("F991", 1); }
      if (name === "STCH" ? stchOk : ["STZ4", "STGS", "SQS2", "SHS2", "SSS2", "SQK2"].includes(name) || name === "STRR" || name === "STMA" || name === "SGMA" || name === "SPMA" || name === "FCSP" || name === "FCLN" || name === "FLNT") this.setVar("F996", 1);
      if ((name === "STCH" && stchOk) || (name === "STCC") || (name === "STNS")) this.setVar("F997", 1);
    }
    variantDelta(name) { return KP.variantDelta(name, this.images); }
    imageInfo(name) { return this.images[name] || this.images[name.toLowerCase()] || null; }
    // ---- frame loop (knife Game::advance order) ----
    endStaffTask() {
      if (!this.staffTask) return;
      this.staffTask = false;
      if (this.onStaffEnd) this.onStaffEnd();
    }
    stepFrame(dtMs) {
      this.frame++;
      // knife game.rs:1320: the staff roll task ends once the script clears F36
      if (this.staffTask && this.var("F36") === 0) this.endStaffTask();
      // 0. delayed SE ops (knife se_delayed, one frame per stepFrame)
      this.tickSeDelayed();
      // 1. effects: tweens, motions, quakes, shakes (sub_3FBD0 / sub_3C970)
      this.stage.stepTweens();
      this.stepMotions(dtMs);
      this.stepQuakes();
      this.shake.advance(dtMs);
      // 2. script dispatch (sub_802C0, up to 1000 commands)
      if (this.script && !this.ended) this.dispatch();
      // 3. waits tick
      this.tickWait(dtMs);
      // 4. dispatch-return tail: present a dirty stage (sub_5D3A0(0,0))
      if (this.stageDirty) {
        this.stage.commit();
        this.stageDirty = false;
        this.trans = null;
        if (this.wait.kind === "transition") this.wait = { kind: "none" };
      }
      if (this.trans && this.trans.kind === "fade") {
        this.trans.t += dtMs;
        if (this.trans.t >= this.trans.dur) {
          this.trans = null;
          this.transFrom = null;
          if (this.wait.kind === "transition") this.wait = { kind: "none" };
        }
      }
      return this.present();
    }
    stepMotions(dtMs) {
      if (!this.motions) return;
      for (let i = 0; i < LAYERS; i++) {
        const l = this.stage.layers[i];
        if (!l || !l.motion) continue;
        const cur = KW.motionCur(this.stage, i, (n) => KP.variantOf(n, this.imageInfo(n)));
        const f = this.motions.advance(l.motion, dtMs, cur);
        KW.applyMotion(this.stage, i, f, {
          motionVariant: (li, fr) => {
            const layer = this.stage.layers[li];
            if (!layer) return null;
            const [a, b] = [fr.variant[0], fr.variant[1]];
            if (a === null && b === null) return null;
            const cur2 = /_(\d\d)_(\d\d)$/.exec(layer.name);
            const va = a !== null ? a : (cur2 ? +cur2[1] : 0);
            const vb = b !== null ? b : (cur2 ? +cur2[2] : 0);
            if (va === 0 && vb === 0) return layer.name.replace(/_\d\d_\d\d$/, "");
            const base = layer.name.replace(/_\d\d_\d\d$/, "");
            return `${base}_${String(va).padStart(2, "0")}_${String(vb).padStart(2, "0")}`;
          },
          variantDelta: (n) => this.variantDelta(n),
          applyVariant: (li, name) => {
            const layer = this.stage.layers[li];
            if (!layer) return;
            const entry = this.imageInfo(name);
            if (!entry) return;
            const old = this.variantDelta(layer.name);
            const nw = this.variantDelta(name);
            const img = imgRecord(entry);
            if (layer.pivot) { layer.pivot[0] += nw[0] - old[0]; layer.pivot[1] += nw[1] - old[1]; }
            else layer.pivot = [img.centerX, img.centerY];
            layer.shift = [-img.centerX, -img.centerY];
            layer.source = { kind: "image", img };
            layer.name = name;
          },
        });
        if (l.motion.done) l.motion = null;
      }
    }
    stepQuakes() {
      // stage.rs step_quakes: layers in order, slots 0/1, follow = layer 1's
      // (else layer 0's) already-stepped offset for layers >= 2
      let lead = null;
      for (let i = 0; i < LAYERS; i++) {
        const l = this.stage.layers[i];
        if (!l) continue;
        for (let s = 0; s < 2; s++) {
          const q = l.quake[s];
          if (q && q.active()) q.step(this.rng, i >= 2 ? lead : null);
        }
        if (i === 1) lead = l.quake[0].offset;
        else if (i === 0 && !lead) lead = l.quake[0].offset;
      }
      // feed offsets into the stage's quakePx path: stage.js quakePx sums a
      // layer's own slots, so copy KP quake offsets into the stub slots
      for (let i = 0; i < LAYERS; i++) {
        const l = this.stage.layers[i];
        if (!l) continue;
        // stage.js Layer.quake entries are plain objects; replace with live ones
        if (!l._kpQuakeLinked) {
          l.quake = l.quake || [{}, {}];
          l._kpQuakeLinked = true;
        }
      }
      this.stage.shake = this.shake.offset;
    }
    tickWait(dtMs) {
      const w = this.wait;
      if (w.kind === "time") {
        w.left -= dtMs;
        if (w.left <= 0) this.wait = { kind: "none" };
      } else if (w.kind === "layer") {
        if (!this.stage.animating(w.slot, w.mask)) this.wait = { kind: "none" };
      } else if (w.kind === "voice") {
        if (!this.voicePlaying) this.wait = { kind: "none" };
      }
    }
    click() {
      const w = this.wait;
      if (w.kind === "time" && w.click) this.wait = { kind: "none" };
      else if (w.kind === "click") { this.wait = { kind: "none" }; if (this.onTextAdvance) this.onTextAdvance(); }
      else if (w.kind === "fads") { /* FADS waits are frame-driven, not clicks */ }
    }
    present() {
      const quads = this.stage.quads();
      return { quads, veil: this.veil || 0, trans: this.trans, transFrom: this.transFrom, fadsHold: !!this.fads };
    }
    // ---- script dispatch ----
    async enterScene(name, label) {
      if (!this.sceneLoader) return false;
      const pack = await this.sceneLoader(name);
      if (!pack) return false;
      this.script = pack;
      this.sceneName = name;
      this.stage.sceneId = name;
      this.pc = 0;
      if (label && pack.labels && pack.labels[label] !== undefined) this.pc = pack.labels[label];
      return true;
    }
    dispatch() {
      // knife: pc advances as each command is fetched; a wait only pauses
      // the loop — the waited command is NOT re-executed (the v2-0007 bug
      // was re-running WTTM every frame because pc stayed put).
      const cmds = this.script.commands;
      let n = 0;
      while (this.pc < cmds.length && n < 1000) {
        if (this.wait.kind !== "none") break;
        if (this.jumpTo) break;
        const cmd = new KP.Cmd(cmds[this.pc]);
        this.pc++;
        this.noteStageChange(cmd);
        const r = this.exec(cmd);
        n++;
        if (r === "break") break;
        if (r === "jump") break;
        if (this.ended) break;
      }
      if (this.jumpTo) {
        const j = this.jumpTo; this.jumpTo = null;
        this._pendingJump = j;
      }
    }
    exec(cmd) {
      const c = cmd, name = cmd.name;
      switch (name) {
        case "JUMP": {
          const target = this.idmap[c.arg(0)];
          // knife jump_marks (flow_jump.rs): the flowchart marks of the
          // jump, from this scene's node to the target scene's node
          if (this.flowMarks && globalThis.KW && KW.flowJump && this.sceneOrder) {
            const tid = c.int(0);
            if (tid !== null) KW.flowJump.jumpMarks(this, this.flowMarks, this.sceneOrder.indexOf(this.sceneName), tid);
          }
          if (target) this.jumpTo = { name: target, label: c.arg(1) || null };
          return "jump";
        }
        case "GOTO": {
          const p = this.script.labels[c.arg(0)];
          if (p !== undefined) { this.pc = p; return "cont-nopc"; }
          return "cont";
        }
        case "GOTS": {
          const idx = this.var(c.arg(0));
          const p = this.script.labels[c.args[1 + idx]];
          if (p !== undefined) { this.pc = p; return "cont-nopc"; }
          return "cont";
        }
        case "IF__": {
          // knife: go on if holds, else jump
          const a = this.operand(c.arg(0)), b = this.operand(c.arg(2));
          if (!KP_CMP(a, c.arg(1), b)) {
            const p = this.script.labels[c.arg(3)];
            if (p !== undefined) { this.pc = p; return "cont-nopc"; }
          }
          return "cont";
        }
        case "IFP4": {
          const p = this.script.labels[c.arg(1)];
          if (p !== undefined) { this.pc = p; return "cont-nopc"; }
          return "cont";
        }
        case "IFSC": {
          // story play (no gallery entry in this port): jump
          const p = this.script.labels[c.arg(1)];
          if (p !== undefined) { this.pc = p; return "cont-nopc"; }
          return "cont";
        }
        case "IFUR": {
          let all = true;
          for (let nd = 533; nd <= 556; nd++) if (!this.nodesDone.has(nd)) { all = false; break; }
          if (all) {
            const p = this.script.labels[c.arg(1)];
            if (p !== undefined) { this.pc = p; return "cont-nopc"; }
          }
          return "cont";
        }
        case "WKST": {
          const rhs = (c.arg(1) && c.arg(1)[0] === "e") ? this.operand(c.arg(2)) : this.operand(c.arg(1));
          this.setVar(c.arg(0), rhs ?? 0);
          return "cont";
        }
        case "WKAD": this.setVar(c.arg(0), this.var(c.arg(0)) + (this.operand(c.arg(1)) ?? 0)); return "cont";
        case "WKOR": this.setVar(c.arg(0), this.var(c.arg(0)) | (this.operand(c.arg(1)) ?? 0)); return "cont";
        case "SELR": {
          // knife cmd_selr APPENDS (value, text, disabled): options keep
          // SELR order and the pick stores the option's VALUE, not its
          // position. Indexing by value (as the port did until 0027)
          // collapsed duplicate values — e.g. 03_00_ARC03_5B lists value
          // 1 three times (twice disabled, once enabled) — and with it
          // the disabled options themselves.
          let text = c.arg(1) || "";
          if (text.startsWith("$")) text = this.textFor(text) || "";
          this.selOpts.push({ v: c.int(0), t: text, disabled: c.arg(2) === "1" });
          return "cont";
        }
        case "SELD": {
          if (this.onChoice && !this.instant) {
            const opts = this.selOpts.map((o, i) => ({ i, v: o.v, t: o.t, disabled: !!o.disabled }));
            this.selOpts = [];
            this._choicePromise = this.onChoice(opts).then((k) => { this.setVar(c.arg(0), k); });
            this.wait = { kind: "choice", promise: this._choicePromise };
            return "break";
          }
          this.setVar(c.arg(0), 0); this.selOpts = [];
          return "cont";
        }
        case "SELA": case "SELS": {
          // knife cmd_select, non-Page kinds: a two-button dialog (No 0 /
          // Yes 1) over a hidden message window (sub_83B20: F823 = 0,
          // F1103 = 1). SELA asks SYSMES 216 ("save your progress?");
          // Yes opens the save screen and stores nothing. SELS asks
          // SYSMES 1445 + F027 (a hint segment) and stores the button.
          const kind = c.name === "SELA" ? "save" : "hint";
          if (this.onChoice && !this.instant) {
            this.setVar("F823", 0);
            this.setVar("F1103", 1);
            const q = kind === "save" ? 216 : 1445 + this.var("F027");
            this._choicePromise = this.onChoice(
              [{ i: 0, t: "", disabled: false }, { i: 1, t: "", disabled: false }],
              { kind, question: q, varName: c.arg(0) },
            ).then((k) => { if (kind === "hint") this.setVar(c.arg(0), k); });
            this.wait = { kind: "choice", promise: this._choicePromise };
            return "break";
          }
          // instant replay: SELA / SELS answer No (knife auto_choice);
          // SELA stores nothing, SELS stores 0
          if (kind === "hint") this.setVar(c.arg(0), 0);
          return "cont";
        }
        case "RDAS": {
          // knife (game.rs:2999): with auto skip of read scenes on, the
          // node completed, no flowchart replay and no skip-all, the
          // engine jumps to the next scene; the boot side gates it
          const n = c.int(0);
          if (n !== null && this.onRdas) this.onRdas(n);
          return "cont";
        }
        case "RDST": { const nd = c.int(0); if (nd !== null && nd >= 0 && nd < 0x240) this.nodesVisited.add(nd); return "cont"; }
        // knife RTST (route_enter): the playthrough reaches node n; F110
        // records it for nodes 533..557 or while F024 (gallery replay) is set
        case "RTST": {
          const nd = c.int(0);
          if (nd !== null && nd >= 0 && nd < 0x240) {
            this.setPlayBit("R", nd);
            if ((nd >= 533 && nd <= 557) || this.var("F024") !== 0) this.setVar("F110", nd);
          }
          return "cont";
        }
        // knife RDED: node n completes only when it is the current node
        // F110 and was reached in this playthrough (RTST)
        case "RDED": {
          const nd = c.int(0);
          if (nd !== null && nd >= 0 && nd < 0x240 && nd === this.var("F110") && this.playBit("R", nd)) this.nodesDone.add(nd);
          return "cont";
        }
        case "RTM_": case "RTMN": case "RTM2": {
          // knife: RTMN / RTM2 keep the BGM playing past the scene end
          if (name === "RTMN" || name === "RTM2") this.keepBgmAtEnd = true;
          this.pc = this.script.commands.length;
          this.ended = true;
          this.onSceneEnd();
          return "break";
        }
        case "WTTM": {
          const frames = Math.max(1, Math.trunc(c.intOr(0, 0) * 3 / 50));
          this.wait = { kind: "time", left: frames * 50 / 3, click: c.intOr(1, 0) === 0 };
          return "break";
        }
        case "PGST": this.setVar("F1122", c.intOr(0, 0)); this.onPage(c.intOr(0, 0)); return "cont";
        case "WNTY": this.wnty = c.intOr(0, 0); this.setVar("F799", this.wnty !== 0 ? 1 : 0); return "cont";
        case "CLO2": this.onPage(-2); return "cont";
        case "CLO3": this.onPage(-3); return "cont";
        case "CLO4": this.onPage(-4); return "cont";
        case "CLO5": this.onPage(-5); return "cont";
        case "STCH": case "SCH2": case "STCG": return this.cmdStch(c);
        case "STCC": {
          const l = c.intOr(0, 0);
          if (l <= 39) {
            const range = l < 0 ? [0, LAYERS] : [l, l + 1];
            // knife: STCC clears the slot's render rule at once
            for (let i = range[0]; i < range[1]; i++) { this.stage.layers[i] = null; this.stage.rules[i] = null; }
            this.stageDirty = true;
          }
          return "cont";
        }
        case "SOXY": {
          // SOXY(layer, _, _, a, b): only args 3/4 are stored, as a
          // draw offset (stage.soxy, applied in layerQuad)
          const l = this.layer(c.intOr(0, 0));
          if (l) {
            const i16 = (v) => { v &= 0xffff; return v >= 0x8000 ? v - 0x10000 : v; };
            l.staged.soxy = [i16(c.intOr(3, 0)), i16(c.intOr(4, 0))];
          }
          return "cont";
        }
        case "STRR": {
          // STRR(layer, r): the clip rotation its children are
          // composited with; -99999 follows the child's own rotation
          const v = c.int(1);
          const l = this.layer(c.intOr(0, 0));
          if (l) l.staged.rot2 = v === null ? 0 : v === -99999 ? -32768 : KW.wrapRot2(v);
          return "cont";
        }
        case "STNS": {
          // STNS(layer, n): grain overlay; 0 clears (the noise canvas
          // is painted by boot, the layer shows it instead of its image)
          const l = this.layer(c.intOr(0, 0));
          if (l) l.noise = c.intOr(1, 0) > 0 ? c.intOr(1, 0) : null;
          return "cont";
        }
        case "STTR": {
          // STTR(layer, rule, b): following alpha fades wipe through
          // RULE_nn; -1/0 clears. The slot rule survives STCH (knife
          // stage.rules); it lands only while the slot is shown.
          const li = c.intOr(0, 0);
          if (li < 0 || li > 39) return "cont";
          const n = c.intOr(1, 0), b = c.intOr(2, 0);
          const word = n >= 1 ? (((n - 1) & 0xffff) | (b << 12)) : -1;
          const rule = word >= 0 ? { n: (word & 0xfff) + 1, flip: (word >> 12) & 7 } : null;
          const l = this.layer(li);
          if (l) l.rule = rule;
          if (this.stage.shown[li]) this.stage.rules[li] = rule;
          return "cont";
        }
        case "SACL": {
          const l = this.layer(c.intOr(0, 0));
          if (l) l.staged.absolute = c.intOr(1, 0) !== 0;
          return "cont";
        }
        case "SBAS": {
          const b = c.intOr(1, -1);
          const l = this.layer(c.intOr(0, 0));
          if (l) l.staged.base = (b >= 0 && b < LAYERS) ? b : null;
          return "cont";
        }
        case "STCP": {
          const l = this.layer(c.intOr(0, 0));
          if (l) l.staged.prio = c.intOr(1, 0);
          return "cont";
        }
        case "STZ4": {
          const l = this.layer(c.intOr(0, 0));
          if (l) {
            const frames = c.int(5) !== null ? Math.trunc(60 * c.int(5) / 1000) : 0;
            const ease = c.intOr(6, 0);
            const last = (t) => Math.round(t.to * 1000);
            const zx = last(l.zoomX), zy = last(l.zoomY);
            const fx = c.intOr(1, zx), fy = c.intOr(2, zy);
            const tx = c.intOr(3, zx), ty = c.intOr(4, zy);
            l.zoomX = new KW.Tween(fx / 1000, tx / 1000, frames, ease);
            l.zoomY = new KW.Tween(fy / 1000, ty / 1000, frames, ease);
          }
          return "cont";
        }
        case "STCL": {
          const rel = c.intOr(0, 0) !== 0;
          const l = this.layer(c.intOr(1, 0));
          if (l) {
            l.motion = null;
            const cx = l.x.to, cy = l.y.to;
            const f = (i, d) => { const v = c.int(i); return v === null ? d : v; };
            let from, to, ms, ease;
            if (rel) { from = [cx, cy]; to = [cx + f(2, 0), cy + f(3, 0)]; ms = c.int(4); ease = c.intOr(5, 0); }
            else { from = [f(2, cx), f(3, cy)]; to = [f(4, from[0]), f(5, from[1])]; ms = c.int(6); ease = c.intOr(7, 0); }
            const frames = ms !== null ? Math.trunc(60 * ms / 1000) : 0;
            l.x = new KW.Tween(from[0], to[0], frames, ease);
            l.y = new KW.Tween(from[1], to[1], frames, ease);
          }
          return "cont";
        }
        case "STRT": {
          const l = this.layer(c.intOr(0, 0));
          if (l) {
            const frames = c.int(3) !== null ? Math.trunc(60 * c.int(3) / 1000) : 0;
            const ease = c.intOr(4, 0);
            const from = c.int(1) !== null ? c.int(1) / 100 : (l.stageRot !== null && l.stageRot !== undefined ? l.stageRot : l.rotation.to);
            const to = c.intOr(2, 0) / 100;
            l.rotation = new KW.Tween(from, to, frames, ease);
            l.stageRot = null;
          }
          return "cont";
        }
        case "STGS": {
          const l = this.layer(c.intOr(0, 0));
          if (l) {
            const frames = c.int(3) !== null ? Math.trunc(60 * c.int(3) / 1000) : 0;
            const ease = c.intOr(4, 0);
            const from = Math.min(255, c.int(1) !== null ? c.int(1) : Math.round(l.alpha.to * 255));
            const to = Math.min(255, c.intOr(2, 0));
            l.alpha = new KW.Tween(from / 255, to / 255, frames, ease);
          }
          return "cont";
        }
        case "STPV": {
          const li = c.intOr(0, -1);
          const l = this.layer(li);
          if (l) {
            const delta = this.variantDelta(l.name);
            const centre = l.source.kind === "image" ? [l.source.img.centerX, l.source.img.centerY] : [0, 0];
            const k = l.source.kind === "image" ? l.source.img.levelScale : 1;
            let piv = l.stagePivot ? l.stagePivot.slice() : centre.slice();
            if (c.int(1) !== null) piv[0] = c.int(1) * 1.875 / 0.46875 * k * 0.33333 + delta[0];
            if (c.int(2) !== null) piv[1] = c.int(2) * 1.875 * 576 / 272 * k * 362 / 1080 + delta[1];
            l.stagePivot = piv; l.pivot = piv.slice();
            l.stageShift = [Math.trunc(-piv[0]), Math.trunc(-piv[1])];
            if (c.int(3) !== null) l.stageRot = c.int(3) / 100;
          }
          return "cont";
        }
        case "STCF": {
          let l = c.intOr(0, 0);
          if (l < 0 || l > 39) l = -1;
          const mask = c.intOr(1, 63);
          if (this.stage.animating(l, mask)) { this.wait = { kind: "layer", slot: l, mask }; return "break"; }
          return "cont";
        }
        case "STEC": {
          // knife: mode 1 fills with the colour (fs_fill: colour rgb,
          // texture alpha); every other mode resets the fill
          const mode = c.intOr(1, 0);
          const color = c.int(2) !== null ? KP.rgb(c.int(2)) : null;
          const l = this.layer(c.intOr(0, -1));
          if (l && mode >= 0 && mode <= 82) {
            l.stecMode = mode;
            l.stecColor = mode === 1 ? (color || [0, 0, 0]) : [1, 1, 1];
            l.fill = mode === 1 ? (color || [0, 0, 0]) : null;
          }
          return "cont";
        }
        case "STBR": {
          const mode = c.int(2) !== null && c.int(2) >= 0 ? c.int(2) & 0xff : c.intOr(1, 0);
          const l = this.layer(c.intOr(0, 0));
          if (l) l.staged.stbr = [mode, KW.blendMode(mode)];
          return "cont";
        }
        case "STMA": {
          const id = c.intOr(1, 0);
          const start = c.intOr(3, 0);
          const li = c.intOr(0, -1);
          const l = this.layer(li);
          if (l) {
            if (id > 0 && this.motions && this.motions.exists(id)) {
              const cur = KW.motionCur(this.stage, Math.max(0, li), (n) => KP.variantOf(n, this.imageInfo(n)));
              const m = KW.newMotionState(id, start);
              const f = this.motions.advance(m, 0, cur);
              l.motionStartY = l.y.value();
              l.motion = m;
              KW.applyMotion(this.stage, li, f, this.motionHost());
            } else { l.motion = null; l.motionStartY = undefined; }
          }
          return "cont";
        }
        case "SGMA": {
          const id = c.intOr(1, 0);
          const key = Math.max(0, c.intOr(2, 0));
          const l = this.layer(c.intOr(0, -1));
          if (l && this.motions) {
            const cur = KW.motionCur(this.stage, Math.max(0, c.intOr(0, 0)), (n) => KP.variantOf(n, this.imageInfo(n)));
            const vals = [[0, Math.round(cur[0])], [1, Math.round(cur[1])], [5, Math.round(cur[5])], [8, Math.round(cur[8])], [9, Math.round(cur[9])], [10, Math.round(cur[10])]];
            if (l.clip && (l.clip.w !== 0 || l.clip.h !== 0)) vals.push([11, Math.trunc(l.clip.x)], [12, Math.trunc(l.clip.y)], [13, Math.trunc(l.clip.w)], [14, Math.trunc(l.clip.h)]);
            this.motions.patchKey(id, key, vals);
          }
          return "cont";
        }
        case "SPMA": {
          const pause = c.intOr(0, 0) === 1;
          for (const l of this.stage.layers) if (l && l.motion) l.motion.paused = pause;
          return "cont";
        }
        case "STRA": {
          // knife sub_645F0 + Haze::set, verbatim: ms == 0 sets the
          // haze at once; ms > 0 with an id only schedules a fade-in
          // of the current haze, ms > 0 with id 0 fades it out
          const li = c.intOr(0, -1);
          const i16 = (v) => { v &= 0xffff; return v >= 0x8000 ? v - 0x10000 : v; };
          const id = i16(c.intOr(1, 0)), ms = i16(c.intOr(2, 0));
          const entry = (this.hazeTable && id > 0 && id < this.hazeTable.length) ? this.hazeTable[id] : null;
          const apply = (l) => {
            if (l && l.source.kind === "image") {
              if (!l.haze) l.haze = { id: 0, phase: 0, acc: 0, fadeIn: 0, fadeTotal: 0, fadeLeft: 0, entry: null };
              KW.hazeSet(l.haze, id, ms, entry);
            }
          };
          if (li === -1) this.stage.layers.forEach(apply);
          else { const l = this.layer(li); if (l) apply(l); }
          return "cont";
        }
        case "SPFC": case "SPRD": return "cont"; // precache: renderer warms on STCH
        case "SQK2": case "SHK2": case "SSW2": return this.cmdQuake(c);
        case "SQS2": case "SHS2": case "SSS2": {
          const li = c.intOr(0, -1);
          const slot = name === "SQS2" ? 0 : name === "SHS2" ? 0 : 1;
          const stop = (l) => { if (l) l.quake[slot] = KP.Quake.fresh(); };
          if (li < 0) this.stage.layers.forEach(stop); else stop(this.layer(li));
          return "cont";
        }
        case "SHAF": {
          const ms = c.intOr(0, 0);
          if (ms === 0) this.shake.stop(); else this.shake.fadeOut(ms);
          return "cont";
        }
        case "SHOK": {
          // SHOK(ax, ay, period_ms, count, delay_ms) via sub_2EE70 type 1
          this.shake.start(c.intOr(0, 0), c.intOr(1, 0), c.intOr(2, 100), c.intOr(3, 1), c.intOr(4, 0));
          return "cont";
        }
        case "MSQK": {
          this.msgQuakeOff = [0, 0];
          this._msgQuake = { ms: c.intOr(0, 1000), ax: c.intOr(1, 5), ay: c.intOr(2, 5), elapsed: 0 };
          return "cont";
        }
        case "FADS": return this.cmdFads(c);
        case "FADE": {
          // knife game.rs FADE arm: 40 = ghost channel-split on, 41 =
          // ghost off (mode 5 fades out) — NOT a fade to black
          if (c.intOr(0, 0) === 40) {
            const reset = this.var("F1100") === 0;
            const p = c.intOr(1, 0), q = c.intOr(2, 0);
            this.setVar("F1100", 4);
            this.setVar("F1120", p + 127);
            this.setVar("F1121", q);
            this.ghost = KW.Ghost.start(this.ghost, p, q, reset);
          } else if (c.intOr(0, 0) === 41) {
            this.setVar("F1100", 0);
            this.ghost = KW.Ghost.setMode(this.ghost, 5, 0, 0);
          }
          return "cont";
        }
        case "FCLN": { this.focus.start(c.intOr(5, 0), 0); return "cont"; }
        case "FCSP": { this.focus.start(0, Math.trunc(60 * c.intOr(0, 0) / 1000)); return "cont"; }
        case "ATSV": {
          // knife game.rs:2940: flags&8 = no-op; else a backlog ring entry
          // (the port's page flush) and a save point when F823 <= 1.
          // The scene-ring push is skipped: snapshots supersede it.
          const flags = c.intOr(0, 0);
          if (flags & 8) return "cont";
          if (this.onAtsv) this.onAtsv();
          return "cont";
        }
        case "XSTP": {
          // knife game.rs:2650: end any previous task, F36 = 1, staff task on
          this.endStaffTask();
          this.setVar("F36", 1);
          this.staffTask = true;
          if (this.onStaffStart) this.onStaffStart();
          return "cont";
        }
        case "XRSM": { this.endStaffTask(); return "cont"; }
        case "SNX2": case "SNX3": {
          const l = this.layer(c.intOr(0, 0));
          if (l) {
            const v = c.int(1);
            if (name === "SNX2") l.snx[0] = v === null ? 1 : 1 + v / 255;
            else l.snx[1] = v === null ? 1 : 1 + v / 100;
          }
          return "cont";
        }
        case "SNX4": case "FANX": case "STQK": case "TRPY": case "WTSV": case "IFNX": return "cont"; // no-op on Switch (knife)
        case "MPLY": {
          if (this.onBgm) this.onBgm(c);
          return "cont";
        }
        case "MVOL": case "MFAD": case "MSTP": {
          if (this.onBgm) this.onBgm(c);
          return "cont";
        }
        case "SEPL": case "SEFD": case "SEVL": case "SESP": {
          // knife cmd_se: SESP stops at once and is never delayed; the
          // others with key 68 go to the delay queue (frames from ms,
          // -32..0 ms meaning 1 frame) instead of firing now. Queuing
          // for a channel first flushes that channel's pending op.
          if (name !== "SESP" && !this.instant && c.keyedInt(68) !== null) { this.queueSe(c); return "cont"; }
          if (this.onSe) this.onSe(c);
          return "cont";
        }
        case "VPLY": case "VPL2": {
          // knife: VPLY only stages the voice — it plays at the next
          // message start, which first stops both voice players. VPL2
          // plays at once and leaves the last voice playing (overlap).
          if (name === "VPLY") { this.voiceToPlay = c; }
          else if (this.onVoice) this.onVoice(c, false);
          return "cont";
        }
        case "VCWT": {
          if (this.voicePlaying && !this.instant) { this.wait = { kind: "voice" }; return "break"; }
          return "cont";
        }
        case "TOMP": {
          if (this.onMovie && !this.instant) {
            this._moviePromise = this.onMovie(c.intOr(0, 0));
            this.wait = { kind: "movie", promise: this._moviePromise };
            return "break";
          }
          return "cont";
        }
        case "TOMW": {
          if (this._moviePromise && !this.instant) { this.wait = { kind: "movie", promise: this._moviePromise }; return "break"; }
          return "cont";
        }
        default: {
          if (name.startsWith("ZM")) {
            // knife Op::Message (sub_6E0D0): a message start clears F1103;
            // in page mode (F822 == 1) the page starts over when F823 <= 1
            // (the scripts count F823 up per message, zero it at page end);
            // the message starts F(847 + page index) extra lines down.
            this.setVar("F1103", 0);
            const pageMode = this.var("F822") === 1;
            if (this.var("F823") <= 1 || !pageMode) {
              this.onPageClear();
              this.pageMsgCount = 0;
            }
            let extra = this.var("F" + (847 + this.pageMsgCount));
            if (extra > 32) extra -= 63;
            if (extra < 0) extra = 0;
            this.pageMsgCount++;
            // knife sub_6E0D0: the message takes VPLY's staged voice and
            // plays it (stopping both voice players first, unless skipping)
            if (this.voiceToPlay) {
              const vc = this.voiceToPlay;
              this.voiceToPlay = null;
              if (this.onVoice) this.onVoice(vc, true);
            }
            // text command: [ZMssssss, $NNNNNN] — the line id is arg 0
            const lineId = c.arg(0);
            this.onText(c, lineId, extra);
            this.wait = { kind: "click" };
            return "break";
          }
          return "cont"; // ZZ/ZY markers, DMMY, unknown: no-op
        }
      }
    }
    // scene-pack map lookup, mirroring boot's lookupPackMap (used here
    // so a delayed SE resolves its file against the scene that queued
    // it, not whatever scene runs when the delay expires).
    packLookup(mapName, key) {
      const m = this.script ? this.script[mapName] : null;
      if (!m) return null;
      if (m[key] !== undefined) return m[key];
      const low = String(key).toLowerCase();
      for (const k of Object.keys(m)) if (k.toLowerCase() === low) return m[k];
      return null;
    }
    queueSe(c) {
      const name = c.name;
      const ms = c.keyedInt(68);
      const frames = (ms >= -32 && ms <= 0) ? 1 : Math.trunc((3 * ms + 49) / 50);
      const ch = c.intOr(0, name === "SEPL" ? 0 : -1);
      const channels = ch < 0 ? Array.from({ length: 20 }, (_, i) => i) : [((ch % 20) + 20) % 20];
      for (const k of channels) {
        // a new op for a channel runs that channel's pending op at once
        const pend = this.seDelayed.filter((e) => e.channel === k);
        if (pend.length) {
          this.seDelayed = this.seDelayed.filter((e) => e.channel !== k);
          for (const e of pend) this.fireSe(e);
        }
        let e = null;
        if (name === "SEPL") {
          const snd = c.arg(2);
          const sp = c.keyedInt(70);
          e = { kind: "SEPL", channel: k, url: snd ? this.packLookup("ses", snd) : null,
            vol: (c.keyedInt(17) ?? 100) / 100, fadeIn: (c.keyedInt(1) ?? 0) / 1000,
            looping: c.intOr(1, 0) === 1,
            pan: (() => { const p = c.keyedInt(18); return p === null ? 0 : (1000 * p - 64000) / 64000; })(),
            speakerRow: (sp !== null && sp >= 0 && sp < 19) ? sp : null };
        } else if (name === "SEFD") {
          e = { kind: "SEFD", channel: k, fade: (c.keyedInt(1) ?? 0) / 1000 };
        } else {
          const vol = c.keyedInt(17);
          if (vol === null) continue; // SEVL without key 17: volume word unchanged
          e = { kind: "SEVL", channel: k, vol: vol / 100, fade: (c.keyedInt(1) ?? 0) / 1000 };
        }
        this.seDelayed.push({ frames, ...e });
      }
    }
    fireSe(e) {
      if (this.onSeFired) this.onSeFired(e);
    }
    tickSeDelayed() {
      if (!this.seDelayed.length) return;
      const fire = [];
      for (const e of this.seDelayed) { e.frames--; if (e.frames <= 0) fire.push(e); }
      if (!fire.length) return;
      const set = new Set(fire);
      this.seDelayed = this.seDelayed.filter((e) => !set.has(e));
      for (const e of fire) this.fireSe(e);
    }
    cmdQuake(c) {
      const name = c.name;
      const li = c.intOr(0, 0);
      const ms = (i, d) => { const v = c.int(i); return v === null ? d : Math.trunc(3 * v / 50); };
      let q = null;
      if (name === "SQK2") {
        const p = [c.intOr(1, 0), c.intOr(2, 0), ms(3, 0), ms(4, 0), c.intOr(5, 0), c.intOr(6, 0)];
        q = new KP.Quake(1, p, c.intOr(7, -1), c.intOr(8, 0));
      } else if (name === "SHK2") {
        const p = [c.intOr(1, 0), c.intOr(2, 0), ms(3, 0), ms(4, 0), c.intOr(5, 0), c.intOr(6, 0)];
        q = new KP.Quake(2, p, c.intOr(7, -1), c.intOr(8, 0));
      } else {
        const p = [c.intOr(1, 7), c.intOr(2, 15), ms(3, 60), ms(4, 120), c.intOr(5, 1), 0];
        q = new KP.Quake(3, p, c.intOr(6, -1), c.intOr(7, 0));
      }
      const put = (l) => { if (l) { if (!l.quake) l.quake = [KP.Quake.fresh(), KP.Quake.fresh()]; l.quake[name === "SSW2" ? 1 : 0] = q; } };
      if (li < 0) this.stage.layers.forEach(put); else put(this.layer(li));
      return "cont";
    }
    cmdFads(c) {
      // Exact FADS state machine (game.rs "FADS" arm, sub_77a40/sub_60610):
      // the command re-runs every frame (knife: pc -= 1) until the run
      // after the transition flag clears ends it.
      if (this.fads === null) {
        this.snapshot = true;
        // knife sub_A46F0: the crossfade draws the OLD presented frame
        // fading out over the new stage — snapshot it before any commit
        // (order() already excludes pending layers, i.e. the not-yet-
        // presented ones, so this is exactly the last drawn frame).
        this.transFrom = this.stage.quads();
        if (this.stage.layers.some((l) => l && l.pending)) {
          this.stage.commit();
          this.stageDirty = false;
          this.trans = { kind: "hold", dur: 0, t: 0 };
          this.fads = { hold: 1, started: false };
        } else {
          this.fadsStart(c);
        }
        this.pc--;
      } else if (!this.fads.started && this.fads.hold > 0) {
        this.fads.hold -= 1;
        this.pc--;
      } else if (!this.fads.started) {
        this.fadsStart(c);
        this.pc--;
      } else {
        this.fads = null;
        if (this.trans && this.trans.kind === "hold") this.trans = null;
      }
      return "break";
    }
    fadsStart(c) {
      // sub_60610: args are (mode, dur_ms, rule, wnd). mode 1 or dur<=0 =
      // instant; mode 0 = crossfade; mode 2 = rule wipe (v1: fade fallback).
      // wnd 1 hides the text until the next message (F1103).
      this.stage.commit();
      this.stageDirty = false;
      this.stageBackup = this.stageBytes();
      for (const f of ["F996", "F997", "F985"]) this.setVar(f, 0);
      const wnd = c.int(3);
      if (wnd === 1 || (wnd === 2 && (c.int(1) ?? 0) >= 2)) {
        this.setVar("F1103", 1);
        if (this.onTextHidden) this.onTextHidden();
      }
      const mode = c.intOr(0, 1);
      const dur = c.intOr(1, 0);
      const rule = c.intOr(2, 0);
      this.fadsRule = rule >= 1 ? rule - 1 : -1;
      if (mode === 1 || dur <= 0) {
        this.trans = null;
        this.fads = { hold: 0, started: true };
      } else {
        this.trans = { kind: "fade", dur, t: 0, rule: mode === 2 ? rule : 0 };
        // knife fads_start: a running crossfade holds the script in
        // Wait::Transition until it completes — without this, dispatch
        // ran on into STCC + instant FADS and killed the fade unseen.
        this.wait = { kind: "transition" };
        this.fads = { hold: 0, started: true };
      }
    }
    cmdStch(c) {
      // Exact port of game.rs cmd_stch (sub_7b214 STCG + cmd_STCH_impl)
      const li = c.intOr(0, -1);
      if (c.name === "STCG") {
        const idx = c.arg(0) ? this.imageIndex(c.arg(0)) : null;
        if (idx !== null && idx < 2701) this.seen.add(idx);
        return "cont";
      }
      const base = c.arg(1);
      if (base === null) return "cont";
      const srcLayerIdx = (() => { const s = c.int(18); return s !== null && s >= 0 ? s : null; })();
      const prev = (srcLayerIdx !== null ? this.layer(srcLayerIdx) : this.layer(Math.max(0, li))) || null;
      const variant = (() => {
        const a = c.int(9), b = c.int(10);
        return (a !== null && b !== null && (a !== 0 || b !== 0)) ? `${base}_${String(a).padStart(2, "0")}_${String(b).padStart(2, "0")}` : null;
      })();
      const upper = base.toUpperCase();
      let source;
      if (upper === "BLACK") source = { kind: "color", rgb: [0, 0, 0] };
      else if (upper === "WHITE") source = { kind: "color", rgb: [1, 1, 1] };
      else {
        const name = variant || base;
        const entry = this.imageInfo(name) || this.imageInfo(base);
        if (!entry) return "cont";
        source = { kind: "image", img: imgRecord(entry) };
      }
      const x = c.int(2) !== null ? c.int(2) : (prev ? prev.x.valueX() : 240);
      const y = c.int(3) !== null ? c.int(3) : (prev ? prev.y.value() : 136);
      const prio = c.int(6) !== null ? c.int(6) : (prev ? (prev.staged.prio !== null && prev.staged.prio !== undefined ? prev.staged.prio : prev.prio) : li * 10);
      const l = KW.newLayer(variant || base, source, x, y, prio);
      l.quake = [KP.Quake.fresh(), KP.Quake.fresh()];
      if (prev) {
        l.zoomX = KW.Tween.fixed(prev.zoomX.value());
        l.zoomY = KW.Tween.fixed(prev.zoomY.value());
        l.alpha = KW.Tween.fixed(prev.alpha.value());
        l.rotation = KW.Tween.fixed(prev.rotation.valueRot());
        l.stageRot = prev.stageRot;
        if (srcLayerIdx !== null) l.parent = prev.parent;
        l.base = prev.staged.base !== undefined ? prev.staged.base : prev.base;
        l.clip = prev.clip ? prev.clip.clone() : null;
        l.rot2 = prev.staged.rot2 !== null && prev.staged.rot2 !== undefined ? prev.staged.rot2 : prev.rot2;
        l.clipInset = prev.clipInset;
        l.soxy = prev.staged.soxy !== null && prev.staged.soxy !== undefined ? prev.staged.soxy : prev.soxy;
        if (srcLayerIdx !== null) l.quake = prev.quake;
        if (srcLayerIdx !== null && prev.source.kind === "image" && source.kind === "image") {
          const sp = prev.stagePivot || [prev.source.img.centerX, prev.source.img.centerY];
          const moved = [sp[0] - prev.source.img.centerX + source.img.centerX, sp[1] - prev.source.img.centerY + source.img.centerY];
          l.stagePivot = moved;
          l.stageShift = [Math.trunc(-moved[0]), Math.trunc(-moved[1])];
          l.pivot = moved.slice();
          l.shift = l.stageShift.slice();
        }
        if (srcLayerIdx === null && prev.name === l.name && (!prev.pending || prev.keepsTexture)) {
          l.keepsTexture = true;
          l.source = prev.source;
          l.fill = prev.fill; // knife cmd_stch keeps the STEC-1 fill here
        }
      }
      const f982 = this.var("F982");
      const ownBlend = (() => { const e = this.imageInfo(upper); return e ? !!(e[6] & 1) : false; })();
      l.stbr = (f982 >= 1 && !ownBlend) ? f982 : -1;
      l.blend = l.stbr >= 0 ? KW.blendMode(l.stbr) : "alpha";
      if (c.int(4) !== null) { l.zoomX = KW.Tween.fixed(c.int(4) / 1000); l.zoomY = KW.Tween.fixed(c.int(4) / 1000); }
      if (c.int(5) !== null) l.alpha = KW.Tween.fixed(c.int(5) / 255);
      if (c.int(11) !== null) l.parent = c.int(11) >= 0 ? c.int(11) : null;
      const clipArgs = [c.int(12), c.int(13), c.int(14), c.int(15)];
      if (clipArgs.some((v) => v !== null)) {
        const cr = l.clip ? l.clip.clone() : new KW.ClipRect();
        const keys = ["x", "y", "w", "h"];
        clipArgs.forEach((v, i) => { if (v !== null) cr[keys[i]] = v; });
        l.clip = cr;
      }
      if (c.int(16) !== null) l.clipInset = c.int(16);
      l.clipMode = c.intOr(17, 0);
      if (l.parent !== null && l.parent !== li && l.parent < LAYERS) {
        const p = this.stage.layers[l.parent];
        if (p) { l.clip = p.clip ? p.clip.clone() : null; l.clipInset = p.clipInset; l.clipMode = p.clipMode; }
        else { l.clip = null; l.clipInset = 0; l.clipMode = 0; }
      }
      if (c.int(19) !== null) l.rot2 = KW.wrapRot2(c.int(19));
      this.stage.set(li, l);
      this.stageDirty = true;
      return "cont";
    }
    motionHost() {
      const self = this;
      return {
        motionVariant(li, fr) {
          const layer = self.stage.layers[li];
          if (!layer) return null;
          const [a, b] = [fr.variant[0], fr.variant[1]];
          if (a === null && b === null) return null;
          const cur = /_(\d\d)_(\d\d)$/.exec(layer.name);
          const va = a !== null ? a : (cur ? +cur[1] : 0);
          const vb = b !== null ? b : (cur ? +cur[2] : 0);
          if (va === 0 && vb === 0) return layer.name.replace(/_\d\d_\d\d$/, "");
          const base = layer.name.replace(/_\d\d_\d\d$/, "");
          return `${base}_${String(va).padStart(2, "0")}_${String(vb).padStart(2, "0")}`;
        },
        variantDelta: (n) => self.variantDelta(n),
        applyVariant(li, name) {
          const layer = self.stage.layers[li];
          if (!layer) return;
          const entry = self.imageInfo(name);
          if (!entry) return;
          const old = self.variantDelta(layer.name);
          const nw = self.variantDelta(name);
          const img = imgRecord(entry);
          if (layer.pivot) { layer.pivot[0] += nw[0] - old[0]; layer.pivot[1] += nw[1] - old[1]; }
          else layer.pivot = [img.centerX, img.centerY];
          layer.shift = [-img.centerX, -img.centerY];
          layer.source = { kind: "image", img };
          layer.name = name;
        },
      };
    }
    operand(tok) {
      if (tok === undefined || tok === null) return null;
      const t = String(tok).trim();
      if (/^(_D|F|G|C)\d+$/.test(t)) return this.var(t);
      return KP.argInt(t);
    }
    textFor(ref) {
      if (this.textResolver) { const v = this.textResolver(ref); if (v !== undefined) return v; }
      if (!this.script) return undefined;
      return this.script.texts ? this.script.texts[ref] : undefined;
    }
    imageIndex(name) {
      const keys = Object.keys(this.images);
      const up = name.toUpperCase();
      const i = keys.findIndex((k) => k.toUpperCase() === up);
      return i >= 0 ? i : null;
    }
  }
  function KP_CMP(a, op, b) {
    switch (op) {
      case "eq": return a === b;
      case "ne": return a !== b;
      case "gt": return a > b;
      case "ge": return a >= b;
      case "lt": return a < b;
      case "le": return a <= b;
      case "an": return (a & b) !== 0;
      default: return false;
    }
  }
  KP.Game = Game; KP.imgRecord = imgRecord;
  if (typeof module !== "undefined") module.exports = KP;
})();
