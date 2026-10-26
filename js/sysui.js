"use strict";
/* sysui.js — DOM screens for KP.System: pause menu, CONFIG, flowchart,
   CG gallery. Layout follows the original's shell: a top strip with a
   big serif title and a Note, a left column (pause menu / config /
   gallery sections), and a footer hint bar, over the frozen scene.
   Labels are plain text: knife's own labels are baked UI textures
   (CONF_PARTS / SYSMES sheets) that dist does not carry, so the port
   uses English labels with the same meanings. */
var KP = globalThis.KP || (globalThis.KP = {});
(function () {
  const S = KP.System;
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function btn(text, fn) {
    const b = el("button", "sys-btn", text);
    b.onclick = fn;
    return b;
  }
  // choice-option text for the log: same markup as the textbox (@i/@r/@b,
  // ruby, line breaks), HTML-escaped first like text.js formatLine
  function escLog(t) {
    let s = String(t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    s = s.replace(/&lt;([^&<>|]+)\|([^&<>]+)&gt;/g, "<ruby>$1<rt>$2</rt></ruby>");
    s = s.replace(/@i/g, "<i>").replace(/@r/g, "</i>").replace(/@b/g, "<b>");
    s = s.replace(/@[a-zA-Z]\d?/g, "");
    return s.replace(/\r\n/g, "<br>").replace(/\r/g, "<br>").replace(/\n/g, "<br>");
  }
  // The original's slider: chevron −/+ buttons, a ticked track with a
  // glowing handle, and — for text sliders — a sample line below with
  // the value right-aligned to the track's end. A single toggle
  // (Display End of Page Instantly / Mute) sits right of the + button.
  function sliderRow(label, value, min, max, step, onChange, opts) {
    opts = opts || {};
    const row = el("div", "cfg-row");
    row.appendChild(el("span", "cfg-label", label));
    const main = el("div", "cfg-main");
    const top = el("div", "cfg-top");
    const minus = btn("−", () => { const v = Math.max(min, value - step); if (v !== value) { onChange(v); sysSnd(1); } });
    minus.classList.add("cfg-chev", "minus");
    const wrap = el("div", "cfg-trackwrap");
    const range = el("input", "cfg-range");
    range.type = "range"; range.min = min; range.max = max; range.step = step; range.value = value;
    range.oninput = () => onChange(+range.value);
    range.addEventListener("change", () => sysSnd(1));
    wrap.appendChild(range);
    for (let i = 0; i <= 4; i++) {
      const t = el("span", "cfg-tick");
      t.style.left = (i * 25) + "%";
      wrap.appendChild(t);
    }
    const plus = btn("+", () => { const v = Math.min(max, value + step); if (v !== value) { onChange(v); sysSnd(1); } });
    plus.classList.add("cfg-chev", "plus");
    top.append(minus, wrap, plus);
    if (opts.toggle) {
      const tg = el("button", "cfg-opt", opts.toggle.text);
      tg.classList.toggle("on", !!opts.toggle.on);
      tg.onclick = () => { opts.toggle.onChange(!opts.toggle.on); sysSnd(1); };
      top.appendChild(tg);
    }
    const val = el("span", "cfg-val");
    val.appendChild(document.createTextNode(String(value)));
    if (opts.unit) val.appendChild(el("span", "cfg-unit", opts.unit));
    if (opts.sample || opts.valueBelow) {
      // the original's System tab puts the value under the slider,
      // right-aligned to the track's end (with the sample line, if any)
      const sub = el("div", "cfg-sub");
      if (opts.sample) sub.appendChild(el("div", "cfg-sample", opts.sample));
      else { const sp = el("div", ""); sp.style.flex = "1"; sub.appendChild(sp); }
      sub.appendChild(val);
      main.append(top, sub);
    } else {
      top.appendChild(val);
      if (opts.test) top.appendChild(opts.test);
      main.appendChild(top);
    }
    row.appendChild(main);
    return row;
  }
  // knife ui.rs FACE_RECTS / NAME_RECTS_EN ([x, y, w, h] cells of the
  // CONF_PARTS_EN atlases conf_faceicon 688x1008 / conf_name_en 504x624)
  const VOICE_FACE = [
    [32, 32, 304, 80], [32, 128, 304, 80], [32, 224, 304, 80], [32, 320, 304, 80], [32, 416, 304, 80],
    [32, 512, 304, 80], [32, 608, 304, 80], [32, 704, 304, 80], [32, 800, 304, 80], [32, 896, 304, 80],
    [352, 32, 304, 80], [352, 128, 304, 80], [352, 320, 304, 80], [352, 224, 304, 80], [352, 416, 304, 80],
    [352, 512, 304, 80], [352, 608, 304, 80], [352, 704, 304, 80], [352, 896, 304, 80], [352, 800, 304, 80],
  ];
  const VOICE_NAME_EN = [
    [32, 32, 136, 48], [32, 96, 136, 48], [32, 160, 136, 48], [32, 480, 200, 48], [32, 288, 136, 48],
    [32, 352, 136, 48], [248, 480, 200, 48], [184, 32, 136, 48], [184, 96, 136, 48], [184, 160, 136, 48],
    [32, 544, 200, 48], [184, 288, 136, 48], [184, 416, 136, 48], [184, 352, 136, 48], [336, 32, 136, 48],
    [336, 96, 136, 48], [336, 160, 136, 48], [248, 544, 200, 48], [336, 352, 136, 48], [336, 416, 136, 48],
  ];
  // knife ui.rs refresh_voice_rows cell pick. The port's G-words carry
  // only the spoken bit (bit 4, via voiceRowsShown); bits 1/2 are set
  // by the exe's route logic, which no script drives, so the port reads
  // them as 0: rows 15/16 take face 18, mask rows (0x3CF36) name 19.
  // Returns [face, name] or null (row 0 hidden while F023 == 0).
  function voiceRowCells(row, inGame, f023, sceneIdx, visited) {
    if (row === 0) {
      if (inGame) {
        if (f023 === 0) return null;
        if (sceneIdx === 2 || sceneIdx === 3) return [18, 19];
        if (sceneIdx === 1) return [19, 0];
        return [0, 0];
      }
      if (!visited.has(485)) return [18, 19];
      return [visited.has(1) ? 0 : 19, 0];
    }
    const face = (row === 15 || row === 16) ? 18 : row;
    const name = (0x3CF36 >> row & 1) ? 19 : row;
    return [face, name];
  }
  // One borderless option: ○ unselected, ◎ + cyan glow selected.
  function optBtn(text, on, onChange) {
    const b = el("button", "cfg-opt", text);
    b.classList.toggle("on", !!on);
    b.onclick = () => { onChange(); sysSnd(1); };
    return b;
  }
  // The original's option rows: label left, options stacked vertically.
  // extra (a single toggle) renders in a right column, aligned with the
  // first option — as "Show Confirmation Message" sits beside Auto Skip.
  function optRow(label, options, current, onChange, extra) {
    const row = el("div", "cfg-row");
    row.appendChild(el("span", "cfg-label", label));
    const col = el("div", "cfg-opts");
    for (const [v, t] of options) col.appendChild(optBtn(t, current === v, () => onChange(v)));
    row.appendChild(col);
    if (extra) {
      const right = el("div", "cfg-opt-right");
      right.appendChild(optBtn(extra.text, extra.on, () => extra.onChange(!extra.on)));
      row.appendChild(right);
    }
    return row;
  }

  // knife system sounds via the host (boot playSys): module-level so
  // the config builders below (plain functions, not methods) can use it
  let sysSnd = () => {};
  class SystemUI {
    constructor(hooks) {
      this.h = hooks;
      sysSnd = (n) => { if (hooks.playSys) hooks.playSys(n); };
      this.root = document.querySelector("#system");
      this.panel = document.querySelector("#sys-panel");
      this.topTitle = document.querySelector("#sys-topbar-title");
      this.topNote = document.querySelector("#sys-topbar-note");
      this.navEl = document.querySelector("#sys-nav");
      this.body = document.querySelector("#sys-body");
      this.title = document.querySelector("#sys-title");
      this.foot = document.querySelector("#sys-foot");
      this.open = null; // 'menu' | 'config' | 'flow' | 'gallery'
      this.navItems = null; // [{button, onClick, hint}]
      this.navSel = -1;
      document.querySelector("#sys-close").onclick = () => this.userBack();
      this.root.addEventListener("pointerdown", (e) => {
        if (e.target === this.root) this.userBack();
      });
    }
    show(name) {
      clearInterval(this.musicTimer); this.musicTimer = null;
      this.open = name;
      this.panel.classList.remove("flow-shell");
      this.panel.classList.remove("log-shell");
      this.panel.classList.remove("sl-shell");
      this.root.classList.remove("log-mode");
      this.root.classList.toggle("solid", !this.h.isInGame());
      this.root.style.display = "block";
      document.querySelector("#sys-head").style.display = "";
      document.querySelector("#sys-close").style.display = "";
      this.h.onOpenChange(true);
    }
    // knife system sounds: 0 cursor, 1 decide, 2 cancel (via the host)
    snd(n) { if (this.h.playSys) this.h.playSys(n); }
    // 0034: UI textures live on the media host; the boot hands the
    // resolver through h.mediaUrl (identity when there is no media base)
    media(p) { return this.h.mediaUrl ? this.h.mediaUrl(p) : p; }
    // a user back action (Esc / B / ✕ / backdrop): knife cancel() — one
    // level back, not straight to the game. Screens stack: flow / config /
    // saveload / gallery sit over the pause menu, the log over the game.
    userBack() { this.backOneLevel(); }
    backOneLevel() {
      if (!this.open) return;
      const was = this.open;
      // CG viewer above the grid: back closes just the viewer
      if (this.cgViewerEl) { this.snd(2); this.closeCgViewer(); return; }
      // a gallery movie playing: back skips it (knife MoviePlay: no sound 2)
      if (was === "gallery" && this.galMovie) { this.closeGalMovie(); return; }
      // SELA opened the save screen: back closes it and ends the choice
      if (was === "saveload" && this.slFromChoice) { this.snd(2); this.close(); return; }
      if (was === "menu" || was === "log") { this.snd(2); this.close(); return; }
      this.snd(2);
      if (this.h.isInGame()) this.openMenu();
      else this.close();
    }
    close(opts) {
      if (!this.open) return;
      this.stopMusicSection();
      this.slFromChoice = false;
      this.galContentIdx = -1;
      if (this.cgViewerEl) this.closeCgViewer();
      const was = this.open;
      this.open = null;
      this.navItems = null;
      this.navSel = -1;
      this.root.style.display = "none";
      this.root.classList.remove("solid");
      this.root.classList.remove("log-mode");
      this.panel.classList.remove("log-shell");
      this.panel.classList.remove("sl-shell");
      this.h.onOpenChange(false);
      // closing a screen from the title goes back to the title menu,
      // unless the close is for a load that leaves the title anyway
      if (!this.h.isInGame() && was !== "menu" && !(opts && opts.noTitle)) this.h.toTitle();
    }
    closeCgViewer() {
      if (this.cgViewerEl) { this.cgViewerEl.remove(); this.cgViewerEl = null; }
      this.cgViewImg = null; this.cgViewState = null;
    }
    // CG viewer transforms (knife CgView, discrete steps): Minus fills
    // the screen, R3 resets to fit centred, the left stick pans, the
    // right stick's vertical axis zooms about the picture centre
    cgViewApply() {
      const s = this.cgViewState, img = this.cgViewImg;
      if (!s || !img) return;
      const sc = (s.fill ? (s.fillScale || 1) : 1) * s.zoom;
      img.style.transform = `translate(${s.panX}px, ${s.panY}px) scale(${sc})`;
      img.style.transformOrigin = "center";
    }
    cgToggleFill() {
      const s = this.cgViewState, box = this.cgViewerEl ? this.cgViewerEl.querySelector(".cg-view-box") : null;
      if (!s || !box) return;
      s.fill = !s.fill;
      if (s.fill) { const r = box.getBoundingClientRect(); s.fillScale = Math.max(innerWidth / r.width, innerHeight / r.height); }
      this.cgViewApply();
    }
    cgViewReset() {
      if (!this.cgViewState) return;
      Object.assign(this.cgViewState, { zoom: 1, panX: 0, panY: 0, fill: false });
      this.cgViewApply();
    }
    cgViewPan(dx, dy) {
      if (!this.cgViewState) return;
      this.cgViewState.panX += dx; this.cgViewState.panY += dy;
      this.cgViewApply();
    }
    cgViewZoom(f) {
      if (!this.cgViewState) return;
      this.cgViewState.zoom = Math.max(1, Math.min(8, this.cgViewState.zoom * f));
      this.cgViewApply();
    }
    closeGalMovie() {
      const movieEl = document.querySelector("#movie");
      if (!movieEl) return;
      this.galMovie = false;
      movieEl.style.display = "none";
      movieEl.onended = null; movieEl.onerror = null; movieEl.onclick = null;
      movieEl.removeAttribute("src"); movieEl.load();
    }
    setTop(title, note) {
      this.topTitle.textContent = title || "";
      this.topNote.textContent = note || "";
    }
    setFoot(text) {
      this.foot.textContent = text || "";
    }
    setFootHtml(html) {
      this.foot.innerHTML = html || "";
    }
    // The original's top strip names the current scene ("Prologue"), not
    // the screen: prologue scenes are the 00_* ones; from the title the
    // context is the title itself.
    contextName() {
      const sc = this.h.currentScene();
      if (!sc) return "Title";
      if (/^00_/.test(sc)) return "Prologue";
      return sc;
    }
    // left column: items [{label, hint, onClick}], selected index or -1.
    // Keyboard nav (arrows + Enter, wired in boot's keydown) shares the
    // selection with mouse hover.
    renderNav(items, selected) {
      const nav = this.navEl;
      nav.innerHTML = "";
      nav.style.display = "flex";
      const hint = el("div", "");
      hint.id = "sys-nav-hint";
      this.navItems = items.map((it, i) => {
        const b = el("button", "sys-nav-item", it.label);
        // .cur marks the open screen (stays cyan); .sel is the cursor
        // (dot + underline) shared by mouse hover and keyboard nav.
        if (it.selected) b.classList.add("cur");
        b.onclick = (e) => { this.navSelect(i); this.snd(1); it.onClick(e); };
        b.onmouseenter = () => this.navSelect(i, true);
        nav.appendChild(b);
        return { button: b, onClick: it.onClick, hint: it.hint || "" };
      });
      nav.appendChild(hint);
      this.navSelect(selected >= 0 ? selected : -1);
    }
    hideNav() {
      this.navEl.innerHTML = "";
      this.navEl.style.display = "none";
      this.navItems = null;
      this.navSel = -1;
    }
    navSelect(i, sound) {
      const old = this.navSel;
      this.navSel = i;
      const hint = document.querySelector("#sys-nav-hint");
      (this.navItems || []).forEach((it, j) => it.button.classList.toggle("sel", j === i));
      if (hint) hint.textContent = (i >= 0 && this.navItems[i]) ? this.navItems[i].hint : "Right-click or Esc to resume.";
      // knife cursor_sound: a move (keyboard or pointer onto an entry)
      // plays sound 0; opening a screen does not
      if (sound && i >= 0 && i !== old) this.snd(0);
    }
    navActive() { return !!(this.navItems && this.navItems.length); }
    navMove(d) {
      if (!this.navActive()) return;
      const n = this.navItems.length;
      this.navSelect(((this.navSel < 0 ? -d : this.navSel) + d + n) % n, true);
    }
    navActivate() {
      if (this.navSel >= 0 && this.navItems[this.navSel]) { this.snd(1); this.navItems[this.navSel].onClick(); }
    }
    // the pause menu's left column, shared by the menu and config screens
    systemNav(selected) {
      const h = this.h;
      return [
        { label: "Save", hint: "Save the current progress.", onClick: () => this.openSaveLoad(true) },
        { label: "Load", hint: "Load the saved progress.", onClick: () => this.openSaveLoad(false) },
        { label: "Config", hint: "Configure system settings.", onClick: () => this.openConfig() },
        { label: "FlowChart", hint: "View the story flowchart.", onClick: () => this.openFlow() },
        { label: "Title", hint: "Return to the title screen.", onClick: () => { this.close(); h.toTitle(); } },
      ].map((it, i) => ({ ...it, selected: i === selected }));
    }
    openMenu() {
      const h = this.h;
      this.show("menu");
      const ctx = this.contextName();
      this.setTop(ctx, "Note.\n" + ctx);
      this.renderNav(this.systemNav(-1), -1);
      this.body.innerHTML = "";
      this.setFoot("Right-click / Esc: Back");
    }
    // ----- config -----
    // Rebuilt to the original's Config: one segmented tab bar with
    // Recommended Settings on the same row, blue section bars, chevron
    // sliders with ticked tracks and sample lines, vertical ○/◎ option
    // lists, the Controls button table, gamepad footer hints, and no ✕.
    openConfig() {
      const h = this.h, cfg = h.getConfig();
      this.show("config");
      const ctx = this.contextName();
      this.setTop(ctx, "Note.\n" + ctx);
      // the original has no close button on this screen
      document.querySelector("#sys-head").style.display = "none";
      const items = this.systemNav(2);
      this.renderNav(items, 2);
      const b = this.body;
      b.innerHTML = "";
      const headRow = el("div", "cfg-headrow");
      const tabs = el("div", "cfg-tabs");
      const tabNames = ["System", "Sound", "Controls"];
      let tab = 0;
      const tabBtns = tabNames.map((t, i) => {
        const x = el("button", "", t);
        x.onclick = () => { tab = i; render(); };
        tabs.appendChild(x);
        return x;
      });
      headRow.appendChild(tabs);
      const rec = el("button", "cfg-rec", "Recommended Settings");
      rec.onclick = () => {
        const lang = cfg.lang;
        Object.assign(cfg, S.defaultConfig());
        cfg.lang = lang;
        h.saveConfig(); h.applyAll(); render();
      };
      headRow.appendChild(rec);
      const recHint = el("div", "cfg-hint", "Apply recommended settings.");
      rec.onmouseenter = () => recHint.classList.add("show");
      rec.onmouseleave = () => recHint.classList.remove("show");
      const tabHint = el("div", "cfg-hint", "Show control descriptions.");
      const content = el("div", "sys-tab-body");
      const stick = el("div", "cfg-stick");
      stick.append(headRow, recHint, tabHint);
      b.append(stick, content);
      const refresh = () => { h.saveConfig(); h.applyAll(); render(); };
      const section = (t) => {
        const s = el("div", "cfg-section", t);
        content.appendChild(s);
        return s;
      };
      const FOOT_PAD = '<span class="pad-b">B</span> Back <span class="pad-a">A</span> Confirm <span class="pad-cross"></span> Move Cursor <span class="pad-sh2"><i>L</i><i>R</i></span> Switch Page <span class="pad-stick"></span> Scroll';
      const FOOT_CTL = '<span class="pad-b">B</span> Back <span class="pad-sh2"><i>L</i><i>R</i></span> Switch Page';
      const render = () => {
        tabBtns.forEach((x, i) => x.classList.toggle("on", i === tab));
        tabHint.classList.toggle("show", tab === 2);
        this.setFootHtml(tab === 2 ? FOOT_CTL : FOOT_PAD);
        content.innerHTML = "";
        if (tab === 0) {
          section("Text Settings");
          content.appendChild(sliderRow("Unseen Text Display Speed", cfg.textMs[0], 0, 250, 1, (v) => { cfg.textMs[0] = v; refresh(); }, { unit: "ms", sample: "First-time text.", toggle: { text: "Display End of Page Instantly", on: cfg.pageAtOnce[0], onChange: (v) => { cfg.pageAtOnce[0] = v; refresh(); } } }));
          content.appendChild(sliderRow("Seen Text Display Speed", cfg.textMs[1], 0, 250, 1, (v) => { cfg.textMs[1] = v; refresh(); }, { unit: "ms", sample: "Previously read text.", toggle: { text: "Display End of Page Instantly", on: cfg.pageAtOnce[1], onChange: (v) => { cfg.pageAtOnce[1] = v; refresh(); } } }));
          section("Auto");
          content.appendChild(sliderRow("Auto-Mode Advance Page Speed", cfg.autoPageMs, 0, 10000, 50, (v) => { cfg.autoPageMs = v; refresh(); }, { unit: "ms", valueBelow: true }));
          content.appendChild(sliderRow("Auto-Mode Wait Time", cfg.autoClickMs, 0, 10000, 50, (v) => { cfg.autoClickMs = v; refresh(); }, { unit: "ms", valueBelow: true }));
          section("Skip");
          content.appendChild(optRow("Auto Skip Cleared Scenes", [[true, "ON"], [false, "OFF"]], cfg.autoSkipRead, (v) => { cfg.autoSkipRead = v; refresh(); }, { text: "Show Confirmation Message", on: cfg.skipConfirm, onChange: (v) => { cfg.skipConfirm = v; refresh(); } }));
          content.appendChild(optRow("Fast-Forward", [[true, "All Text"], [false, "Read Only"]], cfg.skipUnread, (v) => { cfg.skipUnread = v; refresh(); }));
          section("Text Animations");
          content.appendChild(optRow("Text Display Animations", [[true, "Fade-in"], [false, "None (Display instantly)"]], cfg.textFadeIn, (v) => { cfg.textFadeIn = v; refresh(); }));
          content.appendChild(optRow("Seen Text Display Animations", [[true, "Fade-out"], [false, "None (Hide instantly)"]], cfg.textFadeOut, (v) => { cfg.textFadeOut = v; refresh(); }));
          section("Language");
          const langOpts = [["ja", "日本語"], ["en", "English"], ["ru", "Русский"], ["zc", "简体中文"], ["zt", "繁體中文"]];
          const ci0 = h.getCustomInfo ? h.getCustomInfo() : null;
          if (ci0) langOpts.push(["custom", ci0.name.length > 28 ? ci0.name.slice(0, 27) + "…" : ci0.name]);
          content.appendChild(optRow("Language", langOpts, cfg.lang, (v) => { cfg.lang = v; refresh(); h.onLang(v); }));
          // Custom translation (0040): load a single-file translation
          // ({scene: {$id: line}}, same shape as texts_ru.json) or export
          // the selected language in that shape as an example/template.
          {
            const langNames = { ja: "日本語", en: "English", ru: "Русский", zc: "简体中文", zt: "繁體中文" };
            const ci = h.getCustomInfo ? h.getCustomInfo() : null;
            const row = el("div", "cfg-row");
            row.appendChild(el("span", "cfg-label", "Custom Translation"));
            const col = el("div", "cfg-opts");
            const loadBtn = optBtn("Load file…", false, () => {
              const inp = document.createElement("input");
              inp.type = "file"; inp.accept = ".json,application/json";
              inp.onchange = async () => {
                const f = inp.files[0];
                if (!f) return;
                try {
                  await h.importCustom(f);
                  if (cfg.lang === "custom") h.onLang("custom");
                  refresh();
                } catch (e) { h.showDialog("Could not load custom translation: " + (e && e.message ? e.message : e)); }
              };
              inp.click();
            });
            col.appendChild(loadBtn);
            const curLang = cfg.lang === "custom" && ci ? ci.name : (langNames[cfg.lang] || cfg.lang);
            const expBtn = optBtn("Export " + curLang, false, async () => {
              expBtn.textContent = "Exporting…"; expBtn.disabled = true;
              try {
                const r = await h.exportLang(cfg.lang);
                h.showDialog("Exported " + r.scenes + " scenes, " + r.lines + " lines.");
              } catch (e) { h.showDialog("Export failed: " + (e && e.message ? e.message : e)); }
              expBtn.textContent = "Export " + curLang; expBtn.disabled = false;
            });
            col.appendChild(expBtn);
            if (ci) {
              const delBtn = optBtn("Remove", false, async () => {
                if (!(await h.showDialog("Remove the custom translation (" + ci.name + ")?"))) return;
                await h.removeCustom();
                refresh();
              });
              col.appendChild(delBtn);
            }
            row.appendChild(col);
            content.appendChild(row);
          }
        } else if (tab === 1) {
          section("Sound Settings");
          const mute = (key) => ({ text: "Mute", on: cfg[key], onChange: (v) => { cfg[key] = v; refresh(); } });
          content.appendChild(sliderRow("Music", cfg.bgm, 0, 100, 1, (v) => { cfg.bgm = v; refresh(); }, { unit: "%", toggle: mute("muteBgm") }));
          const test = el("button", "cfg-test", "▶ Test");
          test.onclick = () => h.playTestSe();
          content.appendChild(sliderRow("SFX", cfg.se, 0, 100, 1, (v) => { cfg.se = v; refresh(); }, { unit: "%", toggle: mute("muteSe"), test }));
          content.appendChild(sliderRow("System Effects", cfg.sysSe, 0, 100, 1, (v) => { cfg.sysSe = v; refresh(); }, { unit: "%", toggle: mute("muteSys") }));
          section("Voice Settings");
          content.appendChild(optRow("Play All Voices", [[true, "ON"], [false, "OFF"]], cfg.voiceOn, (v) => { cfg.voiceOn = v; refresh(); }));
          content.appendChild(optRow("Interrupt Voices on Advancing Text", [[true, "ON"], [false, "OFF"]], cfg.voiceStop, (v) => { cfg.voiceStop = v; refresh(); }));
          // character voice rows (knife ui.rs refresh_voice_rows): one
          // row per character who has spoken, below the fixed rows —
          // face + name cells from the CONF_PARTS_EN atlases, slider,
          // Mute, Test. Wrongly removed in 0023; the engine side
          // (charVoice, playTestVoice) survived untouched.
          {
            const prog = h.getProgress();
            const inGame = h.isInGame();
            const visited = new Set(prog.nodesVisited || []);
            const sceneIdx = (h.sceneOrder ? h.sceneOrder() : []).indexOf(h.currentScene());
            const f023 = h.gameVar ? h.gameVar("F023") : 0;
            for (let r = 0; r < 19; r++) {
              if (!S.rowShown(prog, r)) continue;
              const cells = voiceRowCells(r, inGame, f023, sceneIdx, visited);
              if (!cells) continue;
              const [face, name] = cells;
              const test = el("button", "cfg-test", "▶ Test");
              test.onclick = () => h.playTestVoice(r);
              const row = sliderRow("", cfg.charVoice[r], 0, 100, 1, (v) => { cfg.charVoice[r] = v; refresh(); }, { unit: "%", toggle: { text: "Mute", on: cfg.charMute[r], onChange: (v) => { cfg.charMute[r] = v; refresh(); } }, test });
              row.classList.add("cfg-voice-row");
              const fc = VOICE_FACE[face], nc = VOICE_NAME_EN[name];
              const fEl = el("div", "cfg-voice-face");
              fEl.style.backgroundPosition = `-${fc[0] / 2}px -${fc[1] / 2}px`;
              const nEl = el("div", "cfg-voice-name");
              nEl.style.width = (nc[2] / 2) + "px";
              nEl.style.backgroundPosition = `-${nc[0] / 2}px -${nc[1] / 2}px`;
              row.replaceChild(fEl, row.querySelector(".cfg-label"));
              row.insertBefore(nEl, row.querySelector(".cfg-main"));
              content.appendChild(row);
            }
          }
        } else {
          // the original's fixed Switch-controller table, then the web
          // port's keyboard rebinds below it
          const table = el("div", "ctl-table");
          const circ = (t) => {
            const w = el("span", "ctl-ic");
            w.appendChild(el("span", "ctl-btn", t));
            return w;
          };
          const sh = (t) => {
            const w = el("span", "ctl-ic");
            w.appendChild(el("span", "ctl-sh", t));
            return w;
          };
          const dpad = (on) => {
            const w = el("span", "ctl-ic");
            const d = el("span", "ctl-dpad");
            for (const dir of ["up", "right", "down", "left"]) {
              const dot = el("i", dir);
              if (dir === on) dot.classList.add("on");
              d.appendChild(dot);
            }
            w.appendChild(d);
            return w;
          };
          const ctlRow = (label, ic) => {
            const row = el("div", "ctl-row");
            row.appendChild(el("span", "ctl-label", label));
            row.appendChild(ic);
            table.appendChild(row);
          };
          ctlRow("Confirm, Advance Text", circ("A"));
          ctlRow("Cancel, Skip Mode Off", circ("B"));
          ctlRow("System Menu", circ("Y"));
          ctlRow("Log", circ("X"));
          ctlRow("Control Panel", dpad("up"));
          ctlRow("Advance Text, Close Control Panel", dpad("down"));
          ctlRow("Skip Mode On/Off", sh("R"));
          ctlRow("Auto Mode On/Off", sh("L"));
          ctlRow("Fast-Forward", sh("ZR"));
          ctlRow("Rewind", sh("ZL"));
          content.appendChild(table);
          section("Keyboard");
          const rebindRow = (label, key, extra) => {
            const row = el("div", "cfg-row");
            row.appendChild(el("span", "cfg-label", label));
            const kb = btn(cfg.keys[key], () => {
              kb.textContent = "Press a key…";
              const cap = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.code === "Escape") { kb.textContent = cfg.keys[key]; }
                else { cfg.keys[key] = e.code; refresh(); }
                removeEventListener("keydown", cap, true);
              };
              addEventListener("keydown", cap, true);
            });
            kb.classList.add("cfg-key");
            row.appendChild(kb);
            if (extra) row.appendChild(el("span", "sys-note", extra));
            content.appendChild(row);
          };
          const staticRow = (label, text) => {
            const row = el("div", "cfg-row");
            row.appendChild(el("span", "cfg-label", label));
            row.appendChild(el("span", "cfg-keyval", text));
            content.appendChild(row);
          };
          rebindRow("Confirm, Advance Text", "advance");
          staticRow("Cancel, Skip Mode Off", cfg.keys.menu);
          rebindRow("System Menu", "menu");
          rebindRow("Auto Mode On/Off", "auto");
          rebindRow("Skip Mode On/Off", "skip", "(hold)");
          staticRow("Fast-Forward", cfg.keys.skip + " (hold)");
          staticRow("Rewind", "⏮ dock button");
          staticRow("Advance Text (mouse)", "Left-click");
          staticRow("System Menu (mouse)", "Right-click");
          content.appendChild(el("div", "sys-note", "Clicking the stage always advances. Enter also advances."));
        }
      };
      render();
    }
    // ----- flowchart -----
    openFlow() {
      const h = this.h, prog = h.getProgress();
      this.show("flow");
      this.panel.classList.add("flow-shell");
      this.hideNav();
      // the original has no close button here (gamepad B), but a mouse
      // user needs a visible exit: keep the port's ✕, title text cleared
      document.querySelector("#sys-title").textContent = "";
      const b = this.body;
      b.innerHTML = "";
      // the original's footer: gamepad hints only
      this.setFootHtml('<span class="pad-b">B</span> Back <span class="pad-a">A</span> Confirm <span class="pad-cross"></span> Navigate');
      const visited = new Set(prog.nodesVisited || []);
      const done = new Set(prog.nodesDone || []);
      const route = new Set(h.routeNodes ? h.routeNodes() : []);
      const gallery = !h.isInGame(); // title Extra = gallery mode (no playthrough)
      const lang = (h.getConfig() && h.getConfig().lang) || "en";
      const idmap = h.idmap() || {};
      const curName = h.currentScene();
      let curId = -1;
      for (const [k, v] of Object.entries(idmap)) if (v === curName) { curId = +k; break; }

      // ----- chart build: a literal port of knife flow.rs build() -----
      // record fields: [node, conn kind, edge, sceneId, title, thumb, preview, name, desc]
      const rows = S.flowRows() || [];
      const extra = S.flowExtra();
      const LINES = (extra && extra.lines) || [];
      const TITLES_EN = (extra && extra.titles_en) || [];
      const completed = (n) => n >= 1 && done.has(n);
      const read = (n) => n >= 1 && visited.has(n);
      const routeHas = (n) => n >= 1 && route.has(n);
      // knife flow.rs: edges are E bits (flag numbers 564+), set by the
      // story's JUMPs (flow_jump.rs) — persistent for `edge`, this
      // playthrough's for `routeEdge`. Never derived from reached nodes
      const edgeIds = new Set(h.edges ? h.edges() : []);
      const routeEdgeIds = new Set(h.routeEdges ? h.routeEdges() : []);
      const edge = (f) => f >= 1 && edgeIds.has(f);
      const routeEdge = (f) => f >= 1 && routeEdgeIds.has(f);
      const DRAWN = 1, LIT = 2;
      const kept = [];
      for (let i = 0; i < rows.length; i++) {
        const phase = rows[i][0], recs = rows[i][1];
        let shown = 0, wide = 0;
        for (let j = 0; j < recs.length; j++) {
          const r = recs[j], n = r[0];
          if (!(n >= 1 && completed(n)) && !edge(r[2])) continue;
          shown++;
          if (i === 0) { if (n !== 0) wide++; continue; }
          if (n > 0) { wide++; continue; }
          if (n === 0) continue;
          const prev = rows[i - 1][1];
          const above = j < prev.length ? prev[j][0] : 0;
          if (!completed(-n)) { if (j > prev.length || above + n !== 0) wide++; continue; }
          if (j > prev.length || Math.abs(above) !== Math.abs(n)) { wide++; continue; }
          if (i <= 0x113) {
            for (let k = i + 1; k < rows.length; k++) {
              const ph2 = rows[k][0], next = rows[k][1];
              if (j > next.length) { wide++; break; }
              if (ph2 > phase) break;
              const x = j < next.length ? next[j] : null;
              if (x && x[0] === n && x[2] === r[2]) continue;
              wide++; break;
            }
          }
        }
        if ((wide > 0 && shown > 1) || (shown === 1 && (wide === 1 || recs.length === 1))) {
          kept.push({ index: i, phase, recs: recs.map((f) => ({ f: f.slice(), flags: 0 })) });
        }
      }
      const sprites = []; // {tex, x, y, w, h, sx?, sy?, t?, lit?}
      const nodes = [];   // selectable nodes: {node, x, y, preview, name, desc, phase, rowK, colJ, sceneId}
      const titles = [];  // per phase: [{x, y, w, h, sx, sy}]
      const limits = [];
      const rec = (k, j) => (kept[k] && kept[k].recs[j]) || null;
      const recAt = (k, j) => (j < 0 ? null : rec(k, j));
      const greyOn = (k, j) => { const r = recAt(k, j); return !!r && ((r.flags & DRAWN) !== 0 || (r.f[0] >= 1 && completed(r.f[0])) || edge(r.f[2])); };
      const litOn = (k, j) => { const r = recAt(k, j); return !!r && ((r.flags & LIT) !== 0 || (r.f[0] >= 1 && routeHas(r.f[0])) || routeEdge(r.f[2])); };
      const upWith = (k, j, fn) => { if (k < 1) return false; const p = rec(k - 1, j); return !!p && p.f[0] !== 0 && fn(Math.abs(p.f[0])); };
      const selfGrey = (k, j) => { const r = rec(k, j); if (!r) return false; const n = r.f[0]; if (n === 0) return false; if (n < 0) return completed(-n) || k + 1 === kept.length; return completed(n) || edge(r.f[2]); };
      const selfLit = (k, j) => { const r = rec(k, j); return !!r && r.f[0] !== 0 && routeHas(Math.abs(r.f[0])); };
      function shape(kind, k, j, lit) {
        const on = (jj) => lit ? litOn(k, jj) : greyOn(k, jj);
        const up = lit ? upWith(k, j, (n) => routeHas(n)) : upWith(k, j, (n) => completed(n));
        const me = () => lit ? selfLit(k, j) : selfGrey(k, j);
        const left = on(j - 1), right = on(j + 1);
        if (kind === 5) {
          if (!up) return 4;
          if (right) return me() ? 5 : 2;
          return me() ? 3 : 5;
        }
        if (kind === 8) {
          if (!up) return 7;
          if (left) return right ? 8 : 6;
          return right ? 2 : 8;
        }
        if (kind === 10) {
          if (!up) return 9;
          if (left) return me() ? 10 : 6;
          return me() ? 3 : 10;
        }
        if (kind === 11) {
          if (!me()) return 7;
          if (left) return right ? 11 : 9;
          return right ? 4 : 11;
        }
        return kind;
      }
      function line(k, j, first, lit, kind, x, yy) {
        const base = lit ? 13 : 0;
        const kk = (kind >= 0 && kind <= 25) ? kind : 12;
        const cell = LINES[kk + base] || [0, 0, 4, 4];
        sprites.push({ tex: "line", x, y: yy, w: cell[2], h: cell[3], sx: cell[0], sy: cell[1], lit });
        const n = (rec(k, j) || { f: [0] }).f[0];
        if (kk === 3) {
          if (first) {
            const c0 = LINES[base] || [0, 0, 4, 4];
            sprites.push({ tex: "line", x, y: yy - 13, w: c0[2], h: c0[3], sx: c0[0], sy: c0[1], lit });
          }
        } else if (kk <= 11 && ((0xE30 >> kk) & 1) !== 0 && n < 0) {
          let c = read(-n);
          if (lit && !c) c = routeHas(-n);
          if (c) {
            const c1 = LINES[base + 1] || [0, 0, 4, 4];
            sprites.push({ tex: "line", x, y: yy + 14, w: c1[2], h: c1[3], sx: c1[0], sy: c1[1], lit });
          }
        }
      }
      function grey(k, j, first, x, yy) {
        const r = rec(k, j);
        if (!r) return false;
        if ((r.flags & DRAWN) === 0 && !edge(r.f[2])) return false;
        const n = r.f[0];
        let kind = r.f[1];
        if (kind === 3 && n < 0) {
          if (k < 1) return false;
          const p = rec(k - 1, j);
          if (!p) return false;
          const ok = (p.flags & DRAWN) !== 0 && (p.f[0] === 0 ? false : (p.f[0] < 0 ? read(-p.f[0]) : completed(p.f[0])));
          if (!ok) return false;
        } else if (kind === 5 || kind === 8 || kind === 10 || kind === 11) kind = shape(kind, k, j, false);
        if (kind < 0) return false;
        line(k, j, first, false, kind, x, yy);
        return true;
      }
      function litFn(k, j, first, x, yy) {
        const r = rec(k, j);
        if (!r) return false;
        if ((r.flags & LIT) === 0 && !routeEdge(r.f[2])) return false;
        const n = r.f[0];
        let kind = r.f[1];
        if (kind === 3 && n < 0) {
          const ok = k >= 1 && (() => { const p = rec(k - 1, j); if (!p) return false; const a = Math.abs(p.f[0]); return (p.flags & LIT) !== 0 && a >= 1 && routeHas(a); })();
          if (!ok) return true;
        } else if (kind === 5 || kind === 8 || kind === 10 || kind === 11) kind = shape(kind, k, j, true);
        if (kind >= 0) line(k, j, first, true, kind, x, yy);
        return true;
      }
      function nodeSpr(k, j, x, yy) {
        const r = rec(k, j);
        const phase = kept[k].phase;
        const n = r.f[0], ed = r.f[2], kind = r.f[1];
        if (n === 0) return false;
        if (n < 0) {
          if (completed(-n) || !edge(ed) || read(-n) || (!gallery && routeHas(-n)) || kind === 3) return false;
        } else if (!completed(n) && !edge(ed)) return false;
        let thumb, select;
        if (gallery) { const c = n >= 1 && completed(n); thumb = c; select = c; }
        else if (n < 1) { thumb = false; select = false; }
        else {
          const rt = routeHas(n);
          if (rt) kept[k].recs[j].flags |= LIT;
          thumb = completed(n); select = phase > 0 && rt;
        }
        const t = r.f[5];
        if (thumb && t >= 0) sprites.push({ tex: "thumb", x: x + 1, y: yy + 1, w: 102, h: 62, t });
        else sprites.push({ tex: "samnon", x, y: yy, w: 104, h: 64 });
        return select;
      }
      let y = 0, titleY = 0, bandTop = 0, phase = 0, count = 0, lastTitle = -1;
      for (let k = 0; k < kept.length; k++) {
        const first = kept[k].phase !== phase;
        if (first) {
          sprites.push({ tex: "band", x: 0, y: bandTop, w: 1440, h: (y + 8) - bandTop + 3 });
          bandTop = (y + 8) + 10;
          sprites.push({ tex: "under", x: 0, y: y + 8, w: 1440, h: 5 });
          sprites.push({ tex: "upper", x: 0, y: y + 16, w: 1440, h: 5 });
          limits.push(y + 16);
          y += 13;
          phase = kept[k].phase;
          titleY = y;
          count = 0; lastTitle = -1;
        }
        const nodeY = y + 4;
        const slot = kept[k].phase;
        while (titles.length <= slot) titles.push([]);
        for (let j = 0; j < kept[k].recs.length; j++) {
          const f = kept[k].recs[j].f;
          const title = f[4];
          if (title >= 0 && count <= 2 && title > lastTitle && edge(f[2])) {
            const cell = TITLES_EN[title] || [0, 0, 0, 0];
            titles[slot].push({ x: 2, y: titleY + 8, w: cell[2], h: cell[3], sx: cell[0], sy: cell[1] });
            titleY += 32;
            lastTitle = title;
            if (title !== 0) count += 1;
            else {
              const last = TITLES_EN[TITLES_EN.length - 1] || [0, 0, 0, 0];
              titles[slot].push({ x: 2, y: titleY + 8, w: last[2], h: last[3], sx: last[0], sy: last[1] });
              titleY += 32;
              count += 2;
            }
          }
          const x = j * 96 + 438;
          if (nodeSpr(k, j, x, nodeY)) {
            nodes.push({ node: f[0], x, y: nodeY, preview: f[6], name: f[7], desc: f[8], phase: kept[k].phase, rowK: k, colJ: j, sceneId: f[3] });
          }
          if (grey(k, j, first, x, nodeY - 5)) kept[k].recs[j].flags |= DRAWN;
          if (!gallery && litFn(k, j, first, x, nodeY - 5)) kept[k].recs[j].flags |= LIT;
        }
        y += 56;
      }
      const end = Math.max(y, titleY) + 8;
      sprites.push({ tex: "band", x: 0, y: bandTop, w: 1440, h: end - bandTop + 3 });
      sprites.push({ tex: "under", x: 0, y: end, w: 1440, h: 5 });
      let scrollMax = end + 56 + 4 - 1022;
      if (scrollMax - 28 <= 1022) scrollMax -= 28;
      if (kept.length && kept[kept.length - 1].index === 276) scrollMax -= 56;
      scrollMax = Math.max(0, scrollMax);

      // ----- DOM: knife's z-order is prio desc (bands 460, dividers +
      // grey lines 450, lit lines 440, nodes 400; titles + cursor above)
      const screen = el("div", "flow-screen");
      const bg = el("img", "flow-bg");
      bg.src = this.media("data/flow/flow_bg.webp");
      const scrollEl = el("div", "flow-scroll");
      this.flowScrollEl = scrollEl;
      const content = el("div", "flow-content");
      content.style.height = end + "px";
      const prioOf = (sp) => sp.tex === "line" ? (sp.lit ? 440 : 450) : ({ band: 460, under: 450, upper: 450, thumb: 400, samnon: 400 }[sp.tex] || 0);
      const sorted = sprites.slice().sort((a, b) => prioOf(b) - prioOf(a));
      for (const sp of sorted) {
        if (sp.tex === "band") {
          const d = el("div", "flow-band-bg");
          d.style.cssText = `left:0px;top:${sp.y}px;width:1440px;height:${sp.h}px;`;
          content.appendChild(d);
        } else if (sp.tex === "under" || sp.tex === "upper") {
          const img = el("img", "flow-strip");
          img.src = this.media(sp.tex === "under" ? "data/flow/flow_sam_bg_under_fullhd.webp" : "data/flow/flow_sam_bg_upper_fullhd.webp");
          img.style.cssText = `left:0px;top:${sp.y}px;`;
          content.appendChild(img);
        } else if (sp.tex === "line") {
          const d = el("div", "flow-line");
          d.style.cssText = `left:${sp.x}px;top:${sp.y}px;width:${sp.w}px;height:${sp.h}px;background-position:-${sp.sx}px -${sp.sy}px;`;
          content.appendChild(d);
        } else if (sp.tex === "thumb") {
          const d = el("div", "flow-thumb");
          const t = sp.t;
          d.style.cssText = `left:${sp.x}px;top:${sp.y}px;background-position:-${104 * (t % 20) + 1}px -${64 * Math.floor(t / 20) + 1}px;`;
          content.appendChild(d);
        } else if (sp.tex === "samnon") {
          const img = el("img", "flow-samnon");
          img.src = this.media("data/flow/flow_sam_non.webp");
          img.style.cssText = `left:${sp.x}px;top:${sp.y}px;`;
          content.appendChild(img);
        }
      }
      // hit areas (transparent, above sprites) + cursor + flash
      const hits = [];
      nodes.forEach((nd, idx) => {
        const hit = el("div", "flow-hit");
        hit.style.cssText = `left:${nd.x}px;top:${nd.y}px;`;
        hit.title = S.sysmesText(nd.name, lang) || ("Scene " + nd.sceneId);
        hit.onmouseenter = () => setCursor(idx);
        hit.onclick = () => { this.snd(1); this.close({ noTitle: true }); h.jumpToScene(nd.sceneId); };
        content.appendChild(hit);
        hits.push(hit);
      });
      const cursorEl = el("div", "flow-cursor");
      const flashEl = el("div", "flow-flash");
      content.appendChild(cursorEl);
      content.appendChild(flashEl);
      scrollEl.appendChild(content);
      // phase titles: pinned overlay, repositioned on scroll (sub_11EB4)
      const titlesEl = el("div", "flow-titles");
      const titleDivs = [];
      titles.forEach((list, p) => {
        for (const t of list) {
          const d = el("div", "flow-title");
          d.style.cssText = `left:${t.x}px;width:${t.w}px;height:${t.h}px;background-position:-${t.sx}px -${t.sy}px;`;
          titlesEl.appendChild(d);
          titleDivs.push({ div: d, phase: p, y: t.y });
        }
      });
      // detail panel: infobase card + thumcg preview + SYSMES title/desc
      const panel = el("div", "flow-panel");
      const tab = el("img", "flow-panel-tab");
      tab.src = this.media("data/flow/flow_info_en.webp");
      const prevImg = el("img", "flow-panel-img");
      const pTitle = el("div", "flow-panel-title");
      const pDesc = el("div", "flow-panel-desc");
      panel.append(tab, prevImg, pTitle, pDesc);
      screen.append(bg, scrollEl, titlesEl, panel);
      b.appendChild(screen);

      let curIdx = -1;
      const nodesByRow = new Map();
      nodes.forEach((nd, idx) => {
        if (!nodesByRow.has(nd.rowK)) nodesByRow.set(nd.rowK, []);
        nodesByRow.get(nd.rowK).push(idx);
      });
      const updateTitles = () => {
        const off = -Math.trunc(scrollEl.scrollTop);
        const byPhase = new Map();
        for (const td of titleDivs) {
          if (!byPhase.has(td.phase)) byPhase.set(td.phase, []);
          byPhase.get(td.phase).push(td);
        }
        for (const [p, list] of byPhase) {
          const first = list[0], last = list[list.length - 1];
          let o = off;
          if (first.y + o < 8) o = 8 - first.y;
          const bottom = last.y + o + 32;
          const lim = limits[p];
          if (lim !== undefined && lim + off < bottom) o -= bottom - (lim + off);
          for (const td of list) td.div.style.top = (td.y + o) + "px";
        }
      };
      const setCursor = (idx) => {
        if (idx < 0 || idx >= nodes.length || idx === curIdx) return;
        curIdx = idx;
        const nd = nodes[idx];
        cursorEl.style.left = nd.x + "px";
        cursorEl.style.top = nd.y + "px";
        cursorEl.style.display = "block";
        flashEl.style.left = nd.x + "px";
        flashEl.style.top = nd.y + "px";
        flashEl.classList.remove("go");
        void flashEl.offsetWidth;
        flashEl.classList.add("go");
        const stem = S.flowThumbStem(nd.preview);
        if (stem) {
          prevImg.src = this.media("data/flow/thumbs/" + stem + ".webp");
          prevImg.style.display = "block";
        } else prevImg.style.display = "none";
        pTitle.textContent = S.sysmesText(nd.name, lang) || ("Scene " + nd.sceneId);
        pDesc.textContent = (S.sysmesText(nd.desc, lang) || "").replace(/\^/g, "\n");
        const st = scrollEl.scrollTop, vh = scrollEl.clientHeight || 1022;
        if (nd.y < st) scrollEl.scrollTop = nd.y;
        else if (nd.y + 64 > st + vh) scrollEl.scrollTop = nd.y + 64 - vh;
      };
      scrollEl.addEventListener("scroll", updateTitles);
      // knife open_cursor (sub_F8FC): (0,0), then every shown row's node
      // with id F110, the last one found winning; fall back to the
      // current scene, then the first node
      let startIdx = -1;
      const f110 = h.gameVar ? h.gameVar("F110") : 0;
      if (f110 >= 1) for (let i = 0; i < nodes.length; i++) if (nodes[i].node === f110) startIdx = i;
      if (startIdx < 0) startIdx = nodes.findIndex((nd) => nd.sceneId === curId);
      if (startIdx < 0) startIdx = 0;
      if (nodes.length) {
        setCursor(startIdx);
        scrollEl.scrollTop = Math.max(0, Math.min(scrollMax, nodes[startIdx].y - 200));
        updateTitles();
      } else {
        cursorEl.style.display = "none";
        flashEl.style.display = "none";
        prevImg.style.display = "none";
        pTitle.textContent = "???";
        pDesc.textContent = "";
      }
      // phase titles are positioned only by updateTitles, which used to
      // run solely on scroll / with a non-empty node list: a short chart
      // (no selectable nodes, e.g. in-game prologue) left every title
      // div at top:0, stacked on top of each other
      updateTitles();
      this.flowState = { nodes, nodesByRow, rowLens: kept.map((r) => r.recs.length), rowPhase: kept.map((r) => r.phase), scrollEl, cur: () => curIdx, setCursor };
    }
    // knife flow.rs move_left / move_right (sub_1262C / sub_1280C) and
    // in-game move_up / move_down = route_step: the nearest row above /
    // below with a cursor node, landing on its first node; up stops at
    // a phase-0 row. (Gallery line-following moves stay unported.)
    flowMove(dx, dy) {
      const st = this.flowState;
      if (!st || !st.nodes.length) return;
      let cur = st.cur();
      if (cur < 0) cur = 0;
      const nd = st.nodes[cur];
      const j = nd.colJ, k = nd.rowK;
      const rowsN = st.rowLens ? st.rowLens.length : 0;
      const last = rowsN - 1;
      const spriteAt = (c, r) => {
        const row = st.nodesByRow.get(r) || [];
        const hit = row.find((i) => st.nodes[i].colJ === c);
        return hit === undefined ? -1 : hit;
      };
      let next = -1;
      if (dx < 0) {
        const row = st.nodesByRow.get(k) || [];
        const left = row.filter((i) => st.nodes[i].colJ < j).sort((a, b) => st.nodes[b].colJ - st.nodes[a].colJ);
        if (left.length) next = left[0];
        else if (k < last) {
          if (j >= 1) {
            for (const c of [j - 1, j - 2]) {
              if (c < 0) break;
              const d = spriteAt(c, k + 1);
              if (d >= 0) { next = d; break; }
              if (k >= 1) { const u = spriteAt(c, k - 1); if (u >= 0) { next = u; break; } }
            }
          }
        } else if (k > 0) {
          for (const c of [j - 1, j - 2]) { if (c < 0) continue; const u = spriteAt(c, k - 1); if (u >= 0) { next = u; break; } }
        }
      } else if (dx > 0) {
        const row = st.nodesByRow.get(k) || [];
        const right = row.filter((i) => st.nodes[i].colJ > j).sort((a, b) => st.nodes[a].colJ - st.nodes[b].colJ);
        if (right.length) next = right[0];
        else if (k < last) {
          for (const [c, max] of [[j + 1, 7], [j + 2, 6]]) {
            if (j > max) break;
            const d = spriteAt(c, k + 1);
            if (d >= 0) { next = d; break; }
            if (k >= 1) { const u = spriteAt(c, k - 1); if (u >= 0) { next = u; break; } }
          }
        } else if (k > 0) {
          for (const [c, max] of [[j + 1, 7], [j + 2, 6]]) {
            if (j > max) break;
            const u = spriteAt(c, k - 1);
            if (u >= 0) { next = u; break; }
          }
        }
      } else if (dy !== 0) {
        let r = k;
        for (;;) {
          r += dy;
          if (r < 0 || r >= rowsN || (dy < 0 && (st.rowPhase ? st.rowPhase[r] : 0) === 0)) break;
          const row = st.nodesByRow.get(r) || [];
          if (row.length) { next = row[0]; break; }
          if ((dy < 0 && r < 1) || (dy > 0 && r >= rowsN - 1)) break;
        }
      }
      if (next >= 0 && next !== cur) { st.setCursor(next); this.snd(0); }
    }
    flowActivate() {
      const st = this.flowState;
      if (!st) return;
      const cur = st.cur();
      if (cur < 0) return;
      const nd = st.nodes[cur];
      if (nd.sceneId >= 0) { this.snd(1); this.close({ noTitle: true }); this.h.jumpToScene(nd.sceneId); }
    }
    // ----- backlog (Log, knife ui.rs Screen::Backlog + game.rs backlog_quads) -----
    // one finished page at a time over the scene dimmed 75% black, newest
    // first (scroll 0 = newest); up = older, down = newer, left = oldest,
    // right = newest, Enter / click the page = quick jump with the SYSMES
    // 231 confirmation. Choice options follow the page's messages.
    openLog() {
      this.show("log");
      this.root.classList.add("log-mode");
      this.panel.classList.add("log-shell");
      this.hideNav();
      document.querySelector("#sys-head").style.display = "none";
      this.logScroll = 0;
      this.logRender();
    }
    logPages() { const p = this.h.logPages ? this.h.logPages() : []; return Array.isArray(p) ? p : []; }
    logCur() {
      const pages = this.logPages(), n = pages.length;
      if (!n) return null;
      const s = Math.max(0, Math.min(this.logScroll || 0, n - 1));
      return { page: pages[n - 1 - s], back: s, n };
    }
    logMove(d) {
      const pages = this.logPages(), n = pages.length;
      if (!n) return;
      // fresh presses wrap past either end (knife sub_28A90; the port's
      // keydown drops repeats, so every press is fresh)
      let s = (this.logScroll || 0) + d;
      if (s > n - 1) s = 0;
      if (s < 0) s = n - 1;
      if (s !== (this.logScroll || 0)) this.snd(0);
      this.logScroll = s;
      this.logRender();
    }
    logOldest() { const n = this.logPages().length; if (n && this.logScroll !== n - 1) { this.logScroll = n - 1; this.snd(0); this.logRender(); } }
    logNewest() { if (this.logPages().length && this.logScroll !== 0) { this.logScroll = 0; this.snd(0); this.logRender(); } }
    async logJump() {
      const cur = this.logCur();
      if (!cur) return;
      const lang = (this.h.getConfig() && this.h.getConfig().lang) || "en";
      const msg = (S.sysmesText ? S.sysmesText(231, lang) : "") || "Do you want to perform a quick jump?";
      if (!(await this.h.showDialog(msg))) return;
      const page = cur.page;
      this.close();
      if (this.h.logJump) await this.h.logJump(page);
    }
    logRender() {
      const b = this.body;
      b.innerHTML = "";
      const cur = this.logCur();
      const scr = el("div", "log-screen");
      if (!cur) {
        scr.appendChild(el("div", "log-empty", "No log entries yet."));
        b.appendChild(scr);
        this.setFoot("B Back");
        return;
      }
      const pageEl = el("div", "log-page");
      for (const html of (cur.page.lines || [])) {
        const d = el("div", "log-line");
        d.innerHTML = html;
        pageEl.appendChild(d);
      }
      for (const ch of (cur.page.choices || [])) {
        pageEl.appendChild(el("div", "log-blank"));
        for (const t of (ch.opts || [])) {
          const d = el("div", "log-choice");
          d.innerHTML = escLog(t);
          pageEl.appendChild(d);
        }
      }
      pageEl.onclick = () => this.logJump();
      scr.appendChild(pageEl);
      // scroll widget (knife sub_9B0C4): only with more than one page
      if (cur.n > 1) {
        const track = el("div", "log-track");
        const thumb = el("div", "log-thumb");
        thumb.style.top = (cur.back / (cur.n - 1)) * 90 + "%";
        track.appendChild(thumb);
        scr.appendChild(track);
      }
      scr.addEventListener("wheel", (e) => {
        e.preventDefault();
        this.logMove(e.deltaY > 0 ? 1 : -1);
      }, { passive: false });
      b.appendChild(scr);
      this.setFootHtml('<span class="pad-b">B</span> Back <span class="pad-a">A</span> Jump <span class="pad-cross"></span> Pages &nbsp;·&nbsp; Page ' + (cur.back + 1) + "/" + cur.n);
    }
    // ----- save/load (knife Screen::SaveLoad: 4 rows a page on Switch,
    // here a scrollable list — save mode leads with the first free slot,
    // load mode with the autosave, then used slots newest first) -----
    openSaveLoad(save, opts) {
      if (save && !this.h.isInGame()) return;
      this.slFromChoice = !!(opts && opts.fromChoice);
      this.show("saveload");
      this.panel.classList.add("sl-shell");
      this.hideNav();
      document.querySelector("#sys-head").style.display = "none";
      this.slMode = save;
      this.slCursor = 0;
      this.slScroll = 0;
      this.slRowsCache = [];
      this.slError = false;
      this.slRender();
    }
    async slFetchRows() {
      let slots = [];
      try { slots = await S.listSlots(); } catch (e) { this.slError = true; return []; }
      const used = slots.filter((s) => s && s.scene).sort((a, b) => (b.ts || 0) - (a.ts || 0));
      if (this.slMode) {
        const ids = new Set(used.map((s) => s.id));
        let freeId = -1;
        for (let i = 0; i < 100; i++) if (!ids.has(i)) { freeId = i; break; }
        const rows = [];
        if (freeId >= 0) rows.push({ kind: "free", id: freeId, slot: null });
        for (const s of used) rows.push({ kind: "used", id: s.id, slot: s });
        return rows;
      }
      const rows = [];
      const auto = this.h.autosave ? this.h.autosave() : null;
      if (auto && auto.scene) rows.push({ kind: "auto", id: -1, slot: auto });
      for (const s of used) rows.push({ kind: "used", id: s.id, slot: s });
      return rows;
    }
    slDate(ts) {
      if (!ts) return "";
      const d = new Date(ts);
      const p = (n) => String(n).padStart(2, "0");
      return d.getFullYear() + "/" + p(d.getMonth() + 1) + "/" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
    }
    slSys(i, fb) {
      const lang = (this.h.getConfig() && this.h.getConfig().lang) || "en";
      return (S.sysmesText ? S.sysmesText(i, lang) : "") || fb;
    }
    slFoot() {
      const base = "Esc: Back · ↑↓: Select · Enter: Confirm · X: Delete · Click a slot";
      const rows = this.slRowsCache || [];
      if (!rows.length) return base;
      const pages = Math.max(1, Math.ceil(rows.length / 4));
      return base + " · Page " + (Math.floor((this.slScroll || 0) / 4) + 1) + "/" + pages;
    }
    slRowEl(row, i) {
      const r = el("div", "sl-row");
      r.dataset.idx = i;
      r.onclick = () => { this.slCursor = i; this.slSelect(i, true); this.slActivateRow(row); };
      if (row.kind === "free") {
        r.appendChild(el("div", "sl-thumb-none", "Empty"));
        const info = el("div", "sl-info");
        info.appendChild(el("div", "sl-slot", "Slot " + row.id));
        info.appendChild(el("div", "sl-scene", "No data"));
        r.appendChild(info);
      } else {
        const s = row.slot;
        if (s.thumb) { const img = el("img", "sl-thumb"); img.src = s.thumb; r.appendChild(img); }
        else r.appendChild(el("div", "sl-thumb-none", "No image"));
        const info = el("div", "sl-info");
        info.appendChild(el("div", "sl-slot", row.kind === "auto" ? "Autosave" : "Slot " + row.id));
        info.appendChild(el("div", "sl-scene", s.title || s.scene || ""));
        info.appendChild(el("div", "sl-date", this.slDate(s.ts)));
        r.appendChild(info);
        if (row.kind === "auto") r.appendChild(el("span", "sl-auto", "AUTO"));
        else {
          const del = el("button", "sl-del", "×");
          del.onclick = (e) => { e.stopPropagation(); this.slDeleteRow(row); };
          r.appendChild(del);
        }
      }
      return r;
    }
    async slRender() {
      const b = this.body;
      b.innerHTML = "";
      const head = el("div", "sl-head");
      head.appendChild(el("div", "sl-title", this.slMode ? "Save Game" : "Load Game"));
      const exp = el("button", "sys-btn", "Export all");
      exp.onclick = () => this.slExport();
      head.appendChild(exp);
      const imp = el("button", "sys-btn", "Import");
      imp.onclick = () => this.slImport();
      head.appendChild(imp);
      b.appendChild(head);
      const list = el("div", "sl-list");
      this.slListEl = list;
      b.appendChild(list);
      this.setFoot(this.slFoot());
      const rows = await this.slFetchRows();
      this.slRowsCache = rows;
      if (this.slError) { list.appendChild(el("div", "sl-empty", "Save storage unavailable.")); return; }
      if (!rows.length) { list.appendChild(el("div", "sl-empty", this.slMode ? "No saves yet." : "No save data found.")); return; }
      list.addEventListener("wheel", (e) => { e.preventDefault(); this.slMove(e.deltaY > 0 ? 1 : -1); }, { passive: false });
      this.slRenderWindow();
      this.slSelect(Math.min(this.slCursor || 0, rows.length - 1), false);
    }
    // knife SLOTS_PER_PAGE = 4: only the window around the cursor shows
    slRenderWindow() {
      const list = this.slListEl;
      if (!list) return;
      const rows = this.slRowsCache || [];
      if (!rows.length) return;
      this.slScroll = Math.max(0, Math.min(this.slScroll || 0, rows.length - 1));
      list.innerHTML = "";
      const end = Math.min(rows.length, this.slScroll + 4);
      for (let i = this.slScroll; i < end; i++) list.appendChild(this.slRowEl(rows[i], i));
      this.setFoot(this.slFoot());
    }
    slSelect(i, scroll) {
      const rows = this.slRowsCache || [];
      if (!rows.length) return;
      this.slCursor = Math.max(0, Math.min(i, rows.length - 1));
      const oldScroll = this.slScroll || 0;
      // knife SLOTS_PER_PAGE = 4: pages are fixed blocks, not a sliding
      // window — crossing a page edge jumps the whole window, so the foot
      // "Page N/M" always matches the rows on screen
      const page = Math.floor(this.slCursor / 4);
      if (Math.floor(oldScroll / 4) !== page) this.slScroll = page * 4;
      if (this.slScroll !== oldScroll) this.slRenderWindow();
      const els = this.slListEl ? [...this.slListEl.querySelectorAll(".sl-row")] : [];
      els.forEach((r) => r.classList.toggle("sel", +r.dataset.idx === this.slCursor));
    }
    slMove(d) { const old = this.slCursor || 0; this.slSelect(old + d, true); if (this.slCursor !== old) this.snd(0); }
    // knife shoulder(): first / last save in the list
    slFirst() { this.slSelect(0, true); }
    slLast() { this.slSelect((this.slRowsCache || []).length - 1, true); }
    slActivateCursor() { const row = this.slRowsCache[this.slCursor || 0]; if (row) this.slActivateRow(row); }
    async slActivateRow(row) {
      if (this.slMode) {
        if (row.kind !== "free" && row.slot) {
          if (!(await this.h.showDialog(this.slSys(180, "Do you want to overwrite this data?")))) { this.setFoot(this.slFoot()); return; }
        } else this.snd(1);
        const rec = this.h.captureSave ? this.h.captureSave() : null;
        if (!rec) return;
        const slot = { id: row.kind === "free" ? row.id : row.slot.id, ts: Date.now(), ...rec };
        try { await S.putSlot(slot); } catch (e) { this.slNote("Save failed."); return; }
        if (this.h.refreshContinue) this.h.refreshContinue();
        await this.slRender();
        const idx = this.slRowsCache.findIndex((r) => r.kind === "used" && r.id === slot.id);
        this.slSelect(idx >= 0 ? idx : 0, true);
        this.setFoot("Saved to slot " + slot.id + " · " + this.slFoot());
      } else {
        // knife: the empty-list popup (SYSMES 193) plays sound 2
        if (row.kind === "free" || !row.slot) { this.snd(2); this.slNote(this.slSys(193, "No save data found.")); return; }
        if (!(await this.h.showDialog(this.slSys(179, "Do you want to load this data?")))) { this.setFoot(this.slFoot()); return; }
        const rec = row.slot;
        this.close({ noTitle: true });
        if (this.h.loadSave) await this.h.loadSave(rec);
      }
    }
    slNote(text) {
      this.setFoot(text);
      clearTimeout(this._slNoteT);
      this._slNoteT = setTimeout(() => this.setFoot(this.slFoot()), 2000);
    }
    async slDeleteRow(row) {
      if (row.kind !== "used") return;
      if (!(await this.h.showDialog(this.slSys(182, "Do you want to delete this data?")))) { this.setFoot(this.slFoot()); return; }
      try { await S.deleteSlot(row.id); } catch (e) {}
      if (this.h.refreshContinue) this.h.refreshContinue();
      await this.slRender();
    }
    slDeleteCursor() { const row = this.slRowsCache[this.slCursor || 0]; if (row) this.slDeleteRow(row); }
    async slExport() {
      try {
        const data = await S.buildExport();
        const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
        const a = document.createElement("a");
        const d = new Date();
        const p = (n) => String(n).padStart(2, "0");
        a.download = "knife-port-saves-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + ".json";
        a.href = URL.createObjectURL(blob);
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        this.slNote("Exported " + data.slots.length + " slots.");
      } catch (e) { this.slNote("Export failed."); }
    }
    slImport() {
      const inp = document.createElement("input");
      inp.type = "file"; inp.accept = ".json,application/json";
      inp.onchange = async () => {
        const f = inp.files[0];
        if (!f) return;
        try {
          const data = JSON.parse(await f.text());
          if (!data || data.app !== "knife-port-saves" || data.version !== 1) { this.slNote("Not a knife-port save file."); return; }
          const parts = [];
          if (data.progress) parts.push("progress");
          if (data.qsave !== undefined) parts.push("quick save");
          if (data.autosave !== undefined) parts.push("autosave");
          parts.push((data.slots || []).length + " slots");
          if (!(await this.h.showDialog("Import will replace all saves (" + parts.join(", ") + ") and reload the page. Continue?"))) return;
          await S.applyImport(data);
          location.reload();
        } catch (e) { this.slNote("Import failed."); }
      };
      inp.click();
    }

    // ----- gallery -----
    openGallery() {
      const h = this.h, prog = h.getProgress();
      this.show("gallery");
      this.setTop("CG Gallery", "Note.\n" + (h.currentScene() || "—"));
      const sections = [
        { label: "CG Gallery", hint: "Browse unlocked CGs.", onClick: () => this.renderGalleryMain("cg") },
        { label: "Music Player", hint: "Listen to unlocked music.", onClick: () => this.renderGalleryMain("music") },
        { label: "Flowchart", hint: "View the story flowchart.", onClick: () => this.openFlow() },
        { label: "Movie", hint: "Watch unlocked movies.", onClick: () => this.renderGalleryMain("movie") },
        { label: "Ending List", hint: "Endings reached so far.", onClick: () => this.renderGalleryMain("ending") },
        { label: "Title", hint: "Return to the title screen.", onClick: () => { this.close(); h.toTitle(); } },
      ];
      this.renderNav(sections, 0);
      this.renderGalleryMain("cg");
      this.setFoot("Esc: Close · Click a CG to view it");
    }
    // leaving the music section stops the track and restores the BGM
    // under it (game BGM, or the title BGM from the title screen)
    stopMusicSection() {
      clearInterval(this.musicTimer); this.musicTimer = null;
      this.musicPlaying = null; this.musicPaused = null;
      if (this.h.musicStopped) this.h.musicStopped();
      const row = this.body ? this.body.querySelector(".gal-music-row.playing") : null;
      if (row) row.classList.remove("playing");
    }
    renderGalleryMain(section) {
      const h = this.h, prog = h.getProgress();
      const b = this.body;
      b.innerHTML = "";
      this.galContentIdx = -1;
      this.galSection = section;
      if (section !== "music") this.stopMusicSection();
      if (section === "music") { this.renderMusic(b, prog); return; }
      if (section === "movie") { this.renderMovies(b, prog); return; }
      if (section === "ending") { this.renderEndings(b, prog); return; }
      if (section !== "cg") {
        b.appendChild(el("div", "sys-note", section + " is not ported yet."));
        return;
      }
      const unlocked = S.galleryUnlocked(prog, prog.nodesDone || []);
      const groups = S.galleryGroups();
      let total = 0, got = 0;
      groups.forEach((g, gi) => { total += g.entries.length; got += (unlocked[gi] || []).length; });
      b.appendChild(el("div", "sys-note", `Unlocked ${got} / ${total} CGs. CGs unlock when their image is shown in-game.`));
      const grid = el("div", "gal-grid");
      b.appendChild(grid);
      groups.forEach((g, gi) => {
        const allowed = S.groupAllowed(g.cond, (n) => (prog.nodesVisited || []).includes(n));
        if (!allowed) return;
        this.buildCgGrid(grid, g, unlocked[gi] || []);
      });
    }
    // ----- music player (knife cGalleryMusic) -----
    renderMusic(b, prog) {
      const h = this.h, cfg = h.getConfig();
      const rows = S.musicRows(), ok = S.musicUnlocked(prog);
      const got = ok.filter(Boolean).length;
      b.appendChild(el("div", "sys-note", `Unlocked ${got} / ${rows.length} tracks. Tracks unlock when their BGM plays in-game.`));
      const list = el("div", "gal-music-list");
      rows.forEach((r, i) => {
        const lang = (cfg && cfg.lang) || "en";
        const title = (S.sysmesText ? S.sysmesText(r.title, lang) : "") || ("BGM " + r.bgm);
        const d = el("div", ok[i] ? "gal-music-row" : "gal-music-row gal-locked");
        if (ok[i]) {
          const mm = Math.floor(r.lenMs / 60000), ss = Math.floor((r.lenMs % 60000) / 1000);
          d.appendChild(el("span", "gal-music-title", title));
          d.appendChild(el("span", "gal-music-len", mm + ":" + String(ss).padStart(2, "0")));
          if (this.musicPlaying === i) d.classList.add("playing");
          d.onclick = () => {
            this.snd(1);
            // A on the playing track stops the player (silence until
            // another track plays or the section is left)
            if (this.musicPlaying === i) { this.musicStop(); return; }
            this.musicPlayRow(i);
          };
        } else {
          d.appendChild(el("span", "gal-music-title", "???"));
          // A on a locked row stops the player, like the original
          d.onclick = () => {
            if (this.musicPlaying == null && !this.musicPaused) return;
            this.musicStop();
          };
        }
        list.appendChild(d);
      });
      b.appendChild(list);
      // knife gallery music panel: play / pause / stop / repeat /
      // previous / next + the running time
      const ctl = el("div", "gal-music-ctl");
      for (const [act, label] of [["prev", "⏮"], ["play", "▶"], ["stop", "⏹"], ["next", "⏭"], ["repeat", "🔁"]]) {
        const btn = el("button", "", label);
        btn.dataset.act = act;
        if (act === "repeat" && this.musicRepeat) btn.classList.add("on");
        btn.onclick = () => {
          this.snd(1);
          if (act === "prev") this.musicPrev();
          else if (act === "next") this.musicNext();
          else if (act === "stop") this.musicStop();
          else if (act === "play") this.musicTogglePlay();
          else if (act === "repeat") {
            this.musicRepeat = !this.musicRepeat;
            btn.classList.toggle("on", this.musicRepeat);
            if (this.h.setBgmLoop) this.h.setBgmLoop(this.musicRepeat);
          }
          this.musicTick();
        };
        ctl.appendChild(btn);
      }
      ctl.appendChild(el("span", "gal-music-time", ""));
      b.appendChild(ctl);
      this.setFoot("Click a track to play it · Click the playing track to stop");
      clearInterval(this.musicTimer);
      this.musicTimer = setInterval(() => this.musicTick(), 500);
      this.musicTick();
    }
    musicPlayRow(i) {
      const h = this.h, prog = h.getProgress();
      const rows = S.musicRows(), ok = S.musicUnlocked(prog);
      if (!ok[i]) return;
      const r = rows[i];
      this.musicPlaying = i; this.musicPaused = null; this.musicWasPlaying = false;
      if (h.playMusic) h.playMusic(r.bgm, this.musicRepeat);
      if (!(prog.heardBgms || []).includes(r.bgm)) { prog.heardBgms.push(r.bgm); if (h.saveProgress) h.saveProgress(); }
      const list = this.body ? this.body.querySelector(".gal-music-list") : null;
      if (list) list.querySelectorAll(".gal-music-row.playing").forEach((x) => x.classList.remove("playing"));
      const rowEl = list ? list.querySelectorAll(".gal-music-row")[i] : null;
      if (rowEl) rowEl.classList.add("playing");
    }
    musicStop() {
      this.musicPlaying = null; this.musicPaused = null; this.musicWasPlaying = false;
      if (this.h.stopMusic) this.h.stopMusic();
      const list = this.body ? this.body.querySelector(".gal-music-list") : null;
      if (list) list.querySelectorAll(".gal-music-row.playing").forEach((x) => x.classList.remove("playing"));
    }
    musicPrev() {
      const cur = this.musicPlaying ?? (this.musicPaused ? this.musicPaused.row : -1);
      if (cur < 0) return;
      const ok = S.musicUnlocked(this.h.getProgress());
      for (let i = cur - 1; i >= 0; i--) if (ok[i]) { this.musicPlayRow(i); return; }
    }
    musicNext() {
      const cur = this.musicPlaying ?? (this.musicPaused ? this.musicPaused.row : -1);
      if (cur < 0) return;
      const ok = S.musicUnlocked(this.h.getProgress());
      for (let i = cur + 1; i < ok.length; i++) if (ok[i]) { this.musicPlayRow(i); return; }
    }
    async musicTogglePlay() {
      if (this.musicPlaying !== null && this.musicPlaying !== undefined) {
        const info = this.h.pauseMusic ? this.h.pauseMusic() : null;
        this.musicPaused = { row: this.musicPlaying, info };
        this.musicPlaying = null;
        const list = this.body ? this.body.querySelector(".gal-music-list") : null;
        if (list) list.querySelectorAll(".gal-music-row.playing").forEach((x) => x.classList.remove("playing"));
        return;
      }
      if (this.musicPaused) {
        const p = this.musicPaused;
        this.musicPaused = null;
        if (p.info && this.h.resumeMusic) await this.h.resumeMusic(p.info);
        else if (this.h.playMusic) { const r = S.musicRows()[p.row]; if (r) this.h.playMusic(r.bgm, this.musicRepeat); }
        this.musicPlaying = p.row;
        const list = this.body ? this.body.querySelector(".gal-music-list") : null;
        const rowEl = list ? list.querySelectorAll(".gal-music-row")[p.row] : null;
        if (rowEl) rowEl.classList.add("playing");
        return;
      }
      const ok = S.musicUnlocked(this.h.getProgress());
      for (let i = 0; i < ok.length; i++) if (ok[i]) { this.musicPlayRow(i); return; }
    }
    musicTick() {
      const tEl = this.body ? this.body.querySelector(".gal-music-time") : null;
      if (!tEl) return;
      const fmt = (s) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
      const cur = this.musicPlaying ?? (this.musicPaused ? this.musicPaused.row : -1);
      if (cur < 0) { tEl.textContent = ""; return; }
      const rows = S.musicRows();
      const total = rows[cur] ? Math.floor(rows[cur].lenMs / 1000) : 0;
      const pos = this.musicPaused
        ? Math.floor(this.musicPaused.info ? this.musicPaused.info.pos : 0)
        : Math.floor(this.h.bgmPosition ? this.h.bgmPosition() : 0);
      tEl.textContent = fmt(pos) + " / " + fmt(total);
      // the track ended with repeat off: the engine cleared the BGM.
      // Only a was-playing -> silent transition counts: playBgm loads
      // async, so bgmPlaying() is false for the first ticks after a click
      if (this.musicPlaying !== null && this.musicPlaying !== undefined && !this.musicPaused && this.h.bgmPlaying) {
        if (this.h.bgmPlaying()) this.musicWasPlaying = true;
        else if (this.musicWasPlaying) {
          this.musicPlaying = null; this.musicWasPlaying = false;
          const list = this.body.querySelector(".gal-music-list");
          if (list) list.querySelectorAll(".gal-music-row.playing").forEach((x) => x.classList.remove("playing"));
        }
      }
      const playBtn = this.body.querySelector('[data-act="play"]');
      if (playBtn) playBtn.textContent = (this.musicPlaying !== null && this.musicPlaying !== undefined) ? "⏸" : "▶";
    }
    // flowchart stick scroll (knife flow_scroll_by_hand, discrete steps)
    flowScrollBy(dy) { if (this.flowScrollEl) this.flowScrollEl.scrollTop += dy; }
    // ----- gallery content cursor (controller): the rows/cells of the
    // open gallery section. Lists are single-column; the CG grid has 5.
    galContentEls() {
      if (!this.body) return { els: [], cols: 1 };
      const cells = [...this.body.querySelectorAll(".cg-thumb")];
      if (cells.length) return { els: cells, cols: 5 };
      return { els: [...this.body.querySelectorAll(".gal-music-row:not(.gal-locked)")], cols: 1 };
    }
    galContentFocus(i) {
      const { els } = this.galContentEls();
      if (!els.length) { this.galContentIdx = -1; return false; }
      this.galContentIdx = Math.max(0, Math.min(els.length - 1, i));
      els.forEach((e, j) => e.classList.toggle("focus", j === this.galContentIdx));
      els[this.galContentIdx].scrollIntoView({ block: "nearest" });
      return true;
    }
    galContentMove(dRow, dCol) {
      const { els, cols } = this.galContentEls();
      if (!els.length) return false;
      const i = this.galContentIdx < 0 ? 0 : this.galContentIdx;
      let next;
      if (cols > 1) {
        const col = i % cols, row = Math.floor(i / cols);
        const nc = col + dCol, nr = row + dRow;
        if (nc < 0 || nc >= cols) return false;
        next = nr * cols + nc;
        if (next < 0 || next >= els.length) {
          if (dRow > 0 && nr * cols < els.length) next = els.length - 1;
          else return false;
        }
      } else {
        next = i + dRow;
        if (next < 0 || next >= els.length) return false;
      }
      if (next !== i) this.snd(0);
      return this.galContentFocus(next);
    }
    galContentActivate() {
      const { els } = this.galContentEls();
      if (this.galContentIdx < 0 || !els[this.galContentIdx]) return false;
      els[this.galContentIdx].click();
      return true;
    }
    // ----- movie gallery (knife cGalleryMovie: prologue + openings) -----
    renderMovies(b, prog) {
      b.innerHTML = "";
      const rows = S.movieRows(), ok = S.movieUnlocked(prog);
      b.appendChild(el("div", "sys-note", "The prologue is always available; openings unlock after watching them in-game. Movie files live in assets/movie/ (not in the zip)."));
      const list = el("div", "gal-music-list");
      rows.forEach((m, i) => {
        const d = el("div", ok[i] ? "gal-music-row" : "gal-music-row gal-locked");
        if (ok[i]) {
          d.appendChild(el("span", "gal-music-title", m.label));
          d.appendChild(el("span", "gal-music-len", m.file.replace("assets/movie/", "")));
          d.onclick = () => { this.snd(1); this.playGalleryMovie(m); };
        } else {
          d.appendChild(el("span", "gal-music-title", "???"));
          d.appendChild(el("span", "gal-music-len", "Watch the opening in-game to unlock"));
        }
        list.appendChild(d);
      });
      b.appendChild(list);
      this.setFoot("Click a movie to watch it · Click the video to skip");
    }
    playGalleryMovie(m) {
      const movieEl = document.querySelector("#movie");
      if (!movieEl) return;
      const base = m.file;
      const url = this.h.movieUrlForLang ? this.h.movieUrlForLang(base) : base;
      this.galMovie = true;
      const done = () => { this.galMovie = false; this.closeGalMovie(); };
      const showMissing = () => {
        done();
        this.renderMovies(this.body, this.h.getProgress());
        const note = this.body.querySelector(".sys-note");
        if (note) note.textContent = "Movie file missing: " + base + " — copy it from dist/assets/movie/ (see MOVIE_FILES.md).";
      };
      movieEl.style.display = "block";
      movieEl.onended = done;
      movieEl.onclick = done;
      if (url !== base) {
        movieEl.onerror = () => { movieEl.onerror = null; movieEl.src = base; movieEl.play().catch(showMissing); };
        movieEl.addEventListener("playing", () => { movieEl.onerror = null; }, { once: true });
      } else {
        movieEl.onerror = showMissing;
      }
      movieEl.src = url;
      movieEl.play().catch(() => { if (url === base) showMissing(); });
    }
    // ----- ending list (knife cGalleryEnding: Teach Me, Miss Ciel) -----
    renderEndings(b, prog) {
      const h = this.h, cfg = h.getConfig();
      const rows = S.endingRows(), qa = S.endingQa();
      const lang = (cfg && cfg.lang) || "en";
      const titleOf = (rec) => {
        const t = (S.sysmesText ? S.sysmesText(rec[2], lang) : "") || "";
        const m = t.match(/^Play "(.*)"\?$/);
        return m ? m[1] : ("Ending " + rec[1]);
      };
      let got = 0;
      rows.forEach((_, i) => { if (S.endingOk(prog, i)) got++; });
      const qaOk = S.endingOk(prog, 24);
      b.appendChild(el("div", "sys-note", `Reached ${got} / ${rows.length} episodes${qaOk ? " + Q&A" : ""}. Episodes unlock as their endings are reached in-game.`));
      const list = el("div", "gal-music-list");
      rows.forEach((rec, i) => {
        const ok = S.endingOk(prog, i);
        const d = el("div", ok ? "gal-music-row" : "gal-music-row gal-locked");
        d.appendChild(el("span", "gal-music-title", ok ? titleOf(rec) : "???"));
        if (ok) d.onclick = async () => {
          const q = (S.sysmesText ? S.sysmesText(rec[2], lang) : "") || ("Play this episode?");
          if (!(await this.h.showDialog(q))) return;
          const name = (h.idmap ? h.idmap() : {})[rec[1]];
          if (!name) return;
          this.close({ noTitle: true });
          if (h.jumpToScene) h.jumpToScene(rec[1]);
        };
        list.appendChild(d);
      });
      if (qa) {
        const d = el("div", qaOk ? "gal-music-row" : "gal-music-row gal-locked");
        d.appendChild(el("span", "gal-music-title", qaOk ? titleOf(qa) : "???"));
        if (qaOk) d.onclick = async () => {
          const q = (S.sysmesText ? S.sysmesText(qa[2], lang) : "") || ("Play this episode?");
          if (!(await this.h.showDialog(q))) return;
          this.close({ noTitle: true });
          if (h.jumpToScene) h.jumpToScene(qa[1]);
        };
        list.appendChild(d);
      }
      b.appendChild(list);
      this.setFoot("Click a reached episode to play it from the gallery");
    }
    buildCgGrid(grid, group, unlockedIdx) {
      const h = this.h, cfg = h.getConfig();
      const unlockedSet = new Set(unlockedIdx);
      group.entries.forEach((e, i) => {
        if (!unlockedSet.has(i)) {
          grid.appendChild(el("div", "cg-locked", "???"));
          return;
        }
        const wrap = el("div", "cg-thumb");
        wrap.style.aspectRatio = e.w + " / " + e.h;
        const img = new Image();
        const thumbUrl = h.cgImageUrl(e.name);
        if (/^https?:\/\//.test(thumbUrl)) img.crossOrigin = "anonymous";
        img.src = thumbUrl;
        img.alt = e.name;
        img.onload = () => {
          const [ox, oy0] = S.galleryEntryRect(e.name);
          let oy = oy0;
          if (S.isStrip(e.name)) oy = oy0 + S.stripBand(cfg.lang) * e.h;
          img.style.width = (img.naturalWidth / e.w * 100) + "%";
          img.style.left = (-(ox / e.w * 100)) + "%";
          img.style.top = (-(oy / e.h * 100)) + "%";
        };
        wrap.appendChild(img);
        wrap.onclick = () => this.openCgViewer(e);
        grid.appendChild(wrap);
      });
    }
    openCgViewer(e) {
      this.snd(1);
      const h = this.h, cfg = h.getConfig();
      const view = el("div", "cg-viewer");
      const box = el("div", "cg-view-box");
      box.style.aspectRatio = e.w + " / " + e.h;
      box.style.width = "min(92vw, calc(88vh * " + e.w + " / " + e.h + "))";
      const img = new Image();
      const viewUrl = h.cgImageUrl(e.name);
      if (/^https?:\/\//.test(viewUrl)) img.crossOrigin = "anonymous";
      img.src = viewUrl;
      img.onload = () => {
        const [ox, oy0] = S.galleryEntryRect(e.name);
        let oy = oy0;
        if (S.isStrip(e.name)) oy = oy0 + S.stripBand(cfg.lang) * e.h;
        img.style.width = (img.naturalWidth / e.w * 100) + "%";
        img.style.left = (-(ox / e.w * 100)) + "%";
        img.style.top = (-(oy / e.h * 100)) + "%";
      };
      box.appendChild(img);
      const cap = el("div", "cg-view-cap", e.name);
      view.append(box, cap);
      view.onclick = () => { this.snd(2); this.closeCgViewer(); };
      document.body.appendChild(view);
      this.cgViewerEl = view;
      this.cgViewImg = img;
      this.cgViewState = { zoom: 1, panX: 0, panY: 0, fill: false };
    }
  }
  KP.SystemUI = SystemUI;
})();
