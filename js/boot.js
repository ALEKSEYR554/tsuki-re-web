"use strict";
/* boot.js — wires KP.Game to the browser: manifest/scenes/data loading, the
   60 Hz frame loop, Canvas2D rendering, DOM textbox, WebAudio, choices,
   movies, deep links. Layout: this folder ships symlinks manifest.json,
   scenes/ and assets/ pointing at dist/ (on Windows: directory junctions). */
(function () {
  const $ = (s) => document.querySelector(s);
  const stageEl = $("#stage");
  let canvasEl = $("#canvas");
  const textEl = $("#text"),
        boxEl = $("#textbox"), choicesEl = $("#choices"), hudScene = $("#hud-scene"),
        titleEl = $("#title"), movieEl = $("#movie"), veilEl = $("#veil"),
        titleVideoEl = $("#title-video"), titleFxEl = $("#title-fx"), titleLumiEl = $("#title-lumi"),
        titleBgFallbackEl = $("#title-bg-fallback"),
        bootVideoWrapEl = $("#boot-video-wrap"), bootVideoEl = $("#boot-video"), bootVideoHintEl = $("#boot-video-hint"),
        introEl = $("#intro"), introBgEl = $("#intro-bg"), introImgEl = $("#intro-img"), introWhiteEl = $("#intro-white");
  const BUILD = "knife-port-0042";
  // split deployment (nginx): the player code lives on one domain and
  // the unpacked media (assets/, scenes/) on another. media-base.json
  // at the code root (deploy/ template, server-only) names the media
  // origin; absent locally, every path stays relative and nothing
  // changes for the Windows / junction setup.
  let mediaBase = "";
  const mediaUrl = (p) => {
    if (!mediaBase || !p || p.startsWith("http://") || p.startsWith("https://") || p.startsWith("data:") || p.startsWith("blob:")) return p;
    return mediaBase + p;
  };
  // CONFIG (knife's option set, see js/system.js) + progress (seen lines /
  // images, flowchart nodes, voice rows) live in localStorage; LANG follows
  // the config and defaults to EN.
  let LANG = "en";
  let config = KP.System.loadConfig();
  let progress = KP.System.loadProgress();
  let sysUI = null, sysOpen = false;
  let autoOn = false, autoTimer = 0, skipHeld = false, autoSkip = false, pageFast = false, ffHeld = false, backHist = [], lastZm = null, savedStaffModes = null;
  // knife sub_B5650 boot_flag: true until the prologue (node 485) was
  // reached and the PRESS ANY BUTTON cautions have been shown
  let bootFlag = false, pressHandler = null;
  // keyboard navigation state for the open choice / dialog (null when none)
  let choiceNav = null;
  // SELA "Yes" opened the save screen: resolves when that screen closes
  // or is replaced (see onOpenChange); null otherwise
  let pendingSelaResolve = null;
  // flowchart-replay scene chain (knife gal_ret[0] == 2): set by a
  // flowchart jump, kept across JUMPs inside the chain, cleared by any
  // other startScene (RDAS never fires during a replay)
  let flowReplay = false;
  // backlog (0025, knife game.rs clear_page): the current page's lines +
  // its choice records; flushed to progress.backlog when the page ends
  let pageBuf = [], pageChoices = [], pendingChoice = null, pageScene = null, pageLastZmPc = 0;
  function flushLogPage() {
    if (!pageBuf.length && !pageChoices.length) return;
    if (!Array.isArray(progress.backlog)) progress.backlog = [];
    progress.backlog.push({ scene: pageScene, pc: pageLastZmPc, lines: pageBuf.slice(), choices: pageChoices.slice() });
    if (progress.backlog.length > 400) progress.backlog.splice(0, progress.backlog.length - 400);
    pageBuf = []; pageChoices = []; pendingChoice = null;
    saveProgressSoon();
  }
  // snapshot state for rewind (0015): the BGM / looping SE / line voice at
  // each live line, plus the latest full snapshot (stage + vars + audio +
  // page) for Q.SAVE / autosave. Replay alone cannot restore these: it
  // picks choice option 0, restarts motions, leaves later layers on stage
  // and never re-fires SEPL/MPLY, so after a rewind the OST stayed, the
  // background snapped and the cut showed the wrong textures.
  let lastBgm = null, seLoops = {}, lastVoiceCmd = null, lastSnap = null;
  let currentLineId = null, pageLineIds = [];
  let routeNodes = new Set(progress.routeNodes || []); // flowchart route (knife RTST play bits R, persisted)
  let routeEdges = new Set(progress.routeEdges || []); // playthrough edge flags (knife E bits, persisted)
  let storyMoviePlaying = false, storySkip = null; // story movie skip (knife B / Plus)
  let padTitleIdx = -1; // title menu cursor (controller)
  const padPanelBtns = ["#dock-back", "#dock-auto", "#dock-ff", "#dock-skip", "#dock-qsave", "#dock-qload", "#dock-mute"];
  let padPanelOpen = false, padPanelIdx = 0, padPanelLast = 0; // mode panel (knife Panel::Open)
  LANG = config.lang || "en";
  let renderer = null, rendererKind = "canvas2d";
  // WebGPU first (probed without touching the canvas, so a failed probe
  // leaves it free for Canvas2D); on device loss, swap in a fresh canvas
  // + the Canvas2D renderer and re-warm the current scene's textures.
  async function initRenderer() {
    if (typeof navigator !== "undefined" && navigator.gpu && KP.WgpuRenderer) {
      try {
        const w = new KP.WgpuRenderer(canvasEl);
        if (await w.init()) {
          renderer = w; rendererKind = "webgpu";
          w.onDeviceLost = () => { swapRendererToCanvas(); };
          return;
        }
      } catch (e) { /* fall through to Canvas2D */ }
    }
    renderer = new KP.Renderer(canvasEl);
    rendererKind = "canvas2d";
  }
  async function swapRendererToCanvas() {
    if (!renderer || renderer.kind !== "webgpu") return;
    rendererKind = "canvas2d";
    // a canvas that held a WebGPU context cannot take a 2d one: replace it
    const fresh = document.createElement("canvas");
    fresh.id = "canvas"; fresh.width = 1920; fresh.height = 1080;
    canvasEl.replaceWith(fresh);
    canvasEl = fresh;
    renderer = new KP.Renderer(canvasEl);
    if (grades) renderer.setGrades(grades);
    textures = {}; texDirty = true; lastSig = null;
    warmGen++; // stop any background warm still writing the old scene
    $("#hud-build").textContent = BUILD + " · canvas2d";
    if (game && game.script) await warmTextures(game.script);
  }
  const audio = new KP.AudioEngine();
  const textWin = new KP.TextWindow(textEl, { speed: 9, mediaUrl: (p) => mediaUrl(p) });
  // backlog line feed: every live shown line joins the current page; the
  // overflow restart flushes the old page first (onOverflow runs before
  // the new line's onShow), exactly like the VM's page restart below
  textWin.onShow = (html) => { if (game && !game.instant) pageBuf.push(html); };
  textWin.onOverflow = () => { flushLogPage(); if (game) game.pageMsgCount = 0; };
  // the window panel is the real txtwindow01 texture (an <img> in
  // #winpanel); its opacity follows the textbox — knife draws the window
  // with the content dim and hides it with hide_text
  const winpanelEl = $("#winpanel");
  textWin.onRender = (o) => { if (winpanelEl) winpanelEl.style.opacity = o; };
  let manifest = null, imagesTable = null, grades = null, hazeTable = null, bgmLoops = {}, flowMarks = null;
  // BFSAR loop points (seconds) by BGM number; null = whole-buffer loop.
  const bgmLoop = (id) => (bgmLoops && bgmLoops[String(id)]) || null;
  let game = null, motions = null, warmMotionsData = null;
  let voiceTok = 0;
  let textures = {}; // layer name (lowercase) -> canvas/img
  let loading = new Set(); // lowercase names with a draw-triggered load in flight
  let warmGen = 0; // bumps on every warm/unload: a stale background warm stops writing
  let typingDone = true, textWait = false;
  function applyConfigToEngine() {
    KP.System.applyAudio(config, audio);
    textWin.fadeIn = !!config.textFadeIn;
    textWin.fadeOut = !!config.textFadeOut;
    textWin.setLayout(config.lang);
  }
  applyConfigToEngine();
  function saveProgressSoon() { KP.System.saveProgress(progress); }
  function markLineSeen(id) {
    if (!id || progress.seenLines.includes(id)) return;
    progress.seenLines.push(id);
  }
  function isLineSeen(id) { return !!id && progress.seenLines.includes(id); }
  // one advance step: commit the line, mark it seen, stop the voice when
  // configured, then let the VM move on (shared by click / auto / skip)
  // one user advance (stage click, Space/Enter, pad A/Down): a hidden
  // window only shows again, it never advances (knife pad_story)
  function userAdvance() {
    if (!game) return;
    if (game.trans && game.trans.kind === "fade") return;
    if (!textWin.visible) { textWin.show(); return; }
    if (textWait && !typingDone) { textWin.finish(); typingDone = true; return; }
    if (game.wait.kind === "click") { doAdvance(); return; }
    game.click();
  }
  function doAdvance() {
    // a running FADS crossfade cannot be clicked through (user request):
    // the script is held in Wait::Transition until it completes
    if (game && game.trans && game.trans.kind === "fade") return;
    const seenBefore = isLineSeen(currentLineId);
    if (currentLineId) markLineSeen(currentLineId);
    textWin.commitLine();
    textWait = false;
    if (config.voiceStop) audio.stopVoice();
    if (game) {
      // page-at-once: keep advancing until the page clears
      if (config.pageAtOnce[seenBefore ? 1 : 0]) pageFast = true;
      game.click();
    }
  }

  async function fetchJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + " -> " + r.status);
    return r.json();
  }
  function lowerMap(d) {
    const o = {};
    for (const k of Object.keys(d || {})) o[k.toLowerCase()] = d[k];
    return o;
  }
  async function loadMotions(sceneName) {
    try {
      const r = await fetch("data/motions/" + sceneName + ".json");
      if (!r.ok) return undefined;
      const d = await r.json();
      if (!motions) motions = new KW.MotionTable(d);
      else motions.addData(d);
      if (game) game.motions = motions;
      warmMotionsData = d;
      return d;
    } catch (e) { return undefined; }
  }
  // images_i18n values are per-language dicts {en, zc, zt} (0039 fixed
  // a latent bug: the dict itself was passed to mediaUrl/loadImage, so
  // all 155 i18n textures silently failed on every non-JA language).
  // Resolve to the current language, EN fallback; JA never resolves
  // (its texture is the base one in pack.images / the default path).
  function i18nImage(pack, low) {
    if (!pack || !pack.images_i18n) return null;
    const v = pack.images_i18n[low];
    if (!v) return null;
    if (typeof v === "string") return v;
    if (LANG === "ja") return null;
    return v[LANG] || v.en || null;
  }
  function imageUrlFor(name, pack) {
    if (!name) return null;
    const low = name.toLowerCase();
    if (pack && pack.images) {
      // EN packs: the i18n texture wins when one exists (text-heavy images)
      if (LANG !== "ja") { const u = i18nImage(pack, low); if (u) return mediaUrl(u); }
      if (pack.images[low]) return mediaUrl(pack.images[low]);
    }
    return mediaUrl("assets/img/" + low + ".webp");
  }
  // Tiered warming (0021): the scene used to block on its whole texture
  // set before the first frame (00_00: 91 textures, ~934 MB VRAM; the
  // heaviest scene 308 / ~4.5 GB). Now only the first frame's images
  // (STCH/SCH2 before the first ZM) block the start; the rest load in
  // the background, 6 at a time, and draw()'s textureless-quad filter
  // keeps them invisible until they land. A newer warm or an unload
  // bumps warmGen and stops the stale background job.
  async function warmTextures(pack, motionsData, full) {
    const gen = ++warmGen;
    // renderer-swap re-warm passes no data: reuse the current scene's
    // motions (loadMotions always runs for the scene being shown).
    if (!motionsData) motionsData = warmMotionsData;
    const hasImage = (n) => !!(imagesTable && (imagesTable[n] || imagesTable[n.toLowerCase()]));
    const first = new Set(KP.firstFrameImageNames(pack).map((n) => n.toLowerCase()));
    if (motionsData) {
      for (const nm of KP.firstFrameVariantNames(pack, motionsData, hasImage)) first.add(nm.toLowerCase());
    }
    const all = KP.sceneImageNames(pack);
    const seen = new Set(all.map((n) => n.toLowerCase()));
    // motion-switched variants (background tier, first): names a motion
    // can rewrite a layer to, filtered by the exe-table gate that
    // applyVariant itself checks. Without these, every variant switch
    // popped in on first use.
    const mvarSet = new Set();
    if (motionsData) {
      for (const nm of KP.motionVariantNames(pack, motionsData, hasImage)) {
        const low = nm.toLowerCase();
        if (!seen.has(low)) { seen.add(low); all.push(nm); mvarSet.add(low); }
      }
    }
    const tier0 = all.filter((n) => first.has(n.toLowerCase()));
    for (const nm of first) if (!seen.has(nm)) { seen.add(nm); tier0.push(nm); }
    const restAll = all.filter((n) => !first.has(n.toLowerCase()));
    const rest = [...restAll.filter((n) => mvarSet.has(n.toLowerCase())), ...restAll.filter((n) => !mvarSet.has(n.toLowerCase()))];
    const loadOne = async (name) => {
      const url = imageUrlFor(name, pack);
      if (!url) return;
      const img = await renderer.loadImage(url, "");
      if (img) textures[name.toLowerCase()] = img;
    };
    await Promise.all(tier0.map(loadOne));
    const warmRest = async () => {
      for (let i = 0; i < rest.length; i += 6) {
        if (gen !== warmGen) return;
        await Promise.all(rest.slice(i, i + 6).map(async (name) => {
          if (gen !== warmGen) return;
          const url = imageUrlFor(name, pack);
          if (!url) return;
          const img = await renderer.loadImage(url, "");
          if (gen !== warmGen) return;
          if (img) { textures[name.toLowerCase()] = img; texDirty = true; }
        }));
      }
    };
    // Full gate (0036): a gated scene waits for ALL of its images, not
    // just the first frame — the rest used to trickle in mid-scene.
    if (full) await warmRest();
    else warmRest();
  }
  function lookupPackMap(pack, mapName, key) {
    const m = pack ? pack[mapName] : null;
    if (!m) return null;
    if (m[key] !== undefined) return mediaUrl(m[key]);
    const low = String(key).toLowerCase();
    for (const k of Object.keys(m)) if (k.toLowerCase() === low) return mediaUrl(m[k]);
    return null;
  }
  function makeGame(pack) {
    const g = new KP.Game({
      images: imagesTable,
      motions,
      hazeTable,
      idmap: manifest.idmap || {},
      flowMarks,
      sceneOrder: (manifest && manifest.scene_order) || [],
      sceneLoader: async (name) => {
        const meta = manifest.scenes[name];
        if (!meta) return null;
        const p = await fetchJSON(mediaUrl(meta.file));
        await loadMotions(name);
        return p;
      },
      imageUrl: (n) => imageUrlFor(n, game ? game.script : pack),
      onRdas: (n) => handleRdas(n),
      onAtsv: () => {
        // replay must not record backlog or autosave
        if (game.instant) return;
        flushLogPage();
        // knife save point: F823 <= 1, not in a movie, not in the staff task
        if (game.pageMsgCount <= 1 && game.wait.kind !== "movie" && !game.staffTask) writeAutosave();
      },
      onStaffStart: () => { savedStaffModes = { auto: autoOn, skip: autoSkip }; autoOn = false; autoSkip = false; },
      onStaffEnd: () => { if (savedStaffModes) { autoOn = savedStaffModes.auto; autoSkip = savedStaffModes.skip; savedStaffModes = null; } },
      // SELR resolved through game.textFor, which used the Japanese base
      // texts only — choices showed Japanese in every language until 0025
      textResolver: (ref) => {
        const p = game ? game.script : null;
        if (!p) return undefined;
        const m = p.texts_i18n && p.texts_i18n[LANG];
        return (m && m[ref]) || (p.texts ? p.texts[ref] : undefined);
      },
      audio,
      onText: (cmd, lineId, extra) => {
        const i18n = game.script.texts_i18n && game.script.texts_i18n[LANG];
        const raw = (i18n && i18n[lineId]) || game.textFor(lineId) ||
          (game.script.texts ? game.script.texts[lineId] : "") || "";
        currentLineId = lineId;
        // dock back button: live lines only (replay runs with instant set,
        // so CONTINUE / deep link / Q.LOAD / back never pollute history);
        // pc already points past the ZM = the click-wait pc; the ZM index
        // itself (pc - 1) is what a resume must start at, because
        // startScene wipes the replayed line (wait reset + clearPage) and
        // only a live ZM shows its text
        if (game && !game.instant) {
          lastZm = { scene: game.sceneName, zmPc: game.pc - 1 };
          pageScene = game.sceneName; pageLastZmPc = game.pc - 1;
          // hash writer: the URL follows the live line (replaceState, no
          // history spam), so a refresh resumes at the same line via the
          // deep-link reader; replay lines never write it
          try { history.replaceState(null, "", "#/" + game.sceneName + "/" + (game.pc - 1)); } catch (e) {}
          const snap = captureSnap();
          lastSnap = snap;
          const last = backHist[backHist.length - 1];
          if (!last || last.scene !== game.sceneName || last.pc !== game.pc) {
            backHist.push({ scene: game.sceneName, pc: game.pc, zmPc: game.pc - 1, snap });
            if (backHist.length > 200) backHist.shift();
          }
        }
        pageLineIds.push({ id: lineId, extra: extra || 0 });
        // knife: the message speed is the unread / read one by seen state
        textWin.speed = config.textMs[isLineSeen(lineId) ? 1 : 0];
        textWin.showMessage(raw, extra);
        typingDone = false;
        textWait = true;
      },
      onPageClear: () => { flushLogPage(); textWin.clearPage(); pageLineIds = []; pageFast = false; },
      onTextHidden: () => { textWin.hide(); },
      onPage: (id) => {
        if (id === -2) { flushLogPage(); textWin.clearPage(); textWin.hide(); } // knife CLO2 = clear_page(true)
        else if (id === -3) { textWin.hide(); }
        else if (id === -4) { textWin.hide(); } // CLO4: content fades out, page stays
        else if (id === -5) { textWin.show(); } // CLO5: window back at full alpha
      },
      onChoice: (opts, extra) => new Promise((res) => {
        // SELA / SELS dialog (knife choice.rs): the message window is
        // already hidden by the VM; a two-button dialog asks the SYSMES
        // question — No (0) left, Yes (1) right, like DIALOG_BUTTONS
        if (extra) {
          textWin.hide();
          const q = (KP.System.sysmesText(extra.question, config.lang) || "").replace(/\^/g, "\n");
          choicesEl.innerHTML = "";
          choicesEl.style.display = "flex";
          const qEl = document.createElement("div");
          qEl.className = "choice-q";
          qEl.textContent = q;
          choicesEl.appendChild(qEl);
          const btns = [];
          const pick = (v) => {
            choicesEl.style.display = "none";
            choiceNav = null;
            // knife off_AE0AA0: the dialog buttons write last_pick
            if (game) game.lastPick = v;
            // SELA Yes: fade to the save screen (knife state 5 -> 7);
            // the choice ends when that screen closes or is replaced
            if (extra.kind === "save" && v === 1) {
              pendingSelaResolve = () => res(1);
              sysUI.openSaveLoad(true, { fromChoice: true });
              if (sysUI.open !== "saveload") { pendingSelaResolve = null; res(1); }
            } else res(v);
          };
          for (const [label, v] of [["No", 0], ["Yes", 1]]) {
            const b = document.createElement("button");
            b.textContent = label;
            b.onclick = () => pick(v);
            choicesEl.appendChild(b);
            btns.push(b);
          }
          // knife choice_move / choice_side for non-Page dialogs: arrows
          // toggle the two buttons (from no focus, down -> No, up -> Yes)
          choiceNav = { kind: "dialog", btns, focus: null,
            move: (delta) => {
              const f = choiceNav.focus;
              let h;
              if (f === 1 && delta < 0) h = 0;
              else if (f === null && delta > 0) h = 0;
              else if (f === 0 && delta > 0) h = 1;
              else if (f !== null && delta > 0) h = 0;
              else h = 1;
              choiceNav.focus = h;
              btns.forEach((x, i) => x.classList.toggle("focus", i === h));
            },
            side: (right) => {
              choiceNav.focus = right ? 1 : 0;
              btns.forEach((x, i) => x.classList.toggle("focus", i === choiceNav.focus));
            },
            pick: () => { if (choiceNav.focus !== null) pick(choiceNav.focus); },
            cancel: () => pick(0) };
          return;
        }
        // knife cmd_selr (overseas): every option carries its "N. " prefix
        // (script lines $043960+); the port showed bare texts until 0025
        const fw = (n) => String(n).replace(/\d/g, (d) => "１２３４５６７８９０"[+d]);
        const disp = opts.map((o, j) => ({ i: o.i, v: o.v, t: (config.lang === "ja" ? fw(j + 1) + "．" : (j + 1) + ". ") + o.t, disabled: !!o.disabled }));
        // backlog (knife: SELD options listed after the page's messages)
        pendingChoice = { opts: disp.map((o) => o.t), picked: null };
        pageChoices.push(pendingChoice);
        choicesEl.innerHTML = "";
        choicesEl.style.display = "flex";
        const btns = [];
        for (const [h, o] of disp.entries()) {
          const b = document.createElement("button");
          b.textContent = o.t;
          if (o.disabled) {
            // knife pick_choice ignores disabled options, and navigation
            // skips them: greyed out, never focused, never clickable
            b.classList.add("dis");
            b.disabled = true;
          } else {
            b.onclick = () => { choicesEl.style.display = "none"; choiceNav = null; if (game) game.lastPick = h; if (pendingChoice) pendingChoice.picked = o.v ?? o.i; res(o.v ?? o.i); };
          }
          choicesEl.appendChild(b);
          btns.push(b);
        }
        // knife choice_move (Page): wrap, skipping disabled options;
        // from no focus, down takes the first enabled, up the last
        choiceNav = { kind: "page", btns, disp, focus: null,
          move: (delta) => {
            const n = disp.length;
            let h = choiceNav.focus === null ? (delta > 0 ? -1 : n) : choiceNav.focus;
            for (let k = 0; k < n; k++) {
              h = ((h + Math.sign(delta)) % n + n) % n;
              if (!disp[h].disabled) break;
            }
            if (disp[h].disabled) return;
            choiceNav.focus = h;
            btns.forEach((x, i) => x.classList.toggle("focus", i === h));
          },
          pick: () => {
            const h = choiceNav.focus;
            if (h === null || disp[h].disabled) return;
            choicesEl.style.display = "none";
            choiceNav = null;
            if (game) game.lastPick = h;
            if (pendingChoice) pendingChoice.picked = disp[h].v ?? disp[h].i;
            res(disp[h].v ?? disp[h].i);
          } };
      }),
      onMovie: async (id) => {
        const base = lookupPackMap(game.script, "movies", id) || mediaUrl("assets/movie/" + id + ".mp4");
        const url = movieUrlForLang(base);
        return new Promise((res) => {
          // knife: a story movie takes only B / Plus, which skip it
          storyMoviePlaying = true;
          const skip = () => {
            if (!storyMoviePlaying) return;
            storyMoviePlaying = false; storySkip = null;
            movieEl.style.display = "none";
            try { movieEl.pause(); } catch (e) {}
            movieEl.onended = null; movieEl.onerror = null; movieEl.onclick = null;
            if (cleanup13) cleanup13();
            res();
          };
          storySkip = skip;
          movieEl.onclick = skip;
          movieEl.style.display = "block";
          movieEl.onended = () => {
            storyMoviePlaying = false; storySkip = null;
            movieEl.style.display = "none";
            // knife stop_movie: a flagged story movie sets its viewing
            // flag when it ends (movie 5 -> bit 0, movie 6 -> bit 1)
            if (id === 5) progress.movieFlags |= 1;
            if (id === 6) progress.movieFlags |= 2;
            if (id === 5 || id === 6) saveProgressSoon();
            if (cleanup13) cleanup13();
            res();
          };
          // language variant: the Switch build picks *_en/*_zc/*_zt for
          // the matching language; a missing suffixed file falls back
          // to the base name (the play() rejection is ignored while a
          // fallback is in flight: the error event drives the switch)
          if (url !== base) {
            movieEl.onerror = () => { movieEl.onerror = null; movieEl.src = base; movieEl.play().catch(() => { storyMoviePlaying = false; storySkip = null; if (cleanup13) cleanup13(); res(); }); };
            movieEl.addEventListener("playing", () => { movieEl.onerror = null; }, { once: true });
          }
          movieEl.src = url;
          // knife story_movie: system sound 7 plays as a movie starts,
          // except ids 0..7, 13, 35..45 (mask 0x3FF8000020FF); movie 13
          // plays it again at frame 210 (3.5 s)
          const noSnd7 = (id >= 0 && id <= 7) || id === 13 || (id >= 35 && id <= 45);
          if (!noSnd7) movieEl.addEventListener("playing", () => playSys(7), { once: true });
          let cleanup13 = null;
          if (id === 13) {
            let fired = false;
            const t = () => { if (!fired && movieEl.currentTime >= 3.5) { fired = true; playSys(7); movieEl.removeEventListener("timeupdate", t); } };
            movieEl.addEventListener("timeupdate", t);
            cleanup13 = () => movieEl.removeEventListener("timeupdate", t);
          }
          movieEl.play().catch(() => { if (url === base) { storyMoviePlaying = false; storySkip = null; if (cleanup13) cleanup13(); res(); } });
        });
      },
      onSceneEnd: () => {
        // knife RTMN / RTM2: the scene BGM keeps playing over the title
        const keep = !!(game && game.keepBgmAtEnd);
        unloadScene({ keepBgm: keep });
        showTitle({ press: bootFlag, keepBgm: keep });
      },
      onBgm: (c) => {
        const name = c.name;
        if (name === "MPLY") {
          const id = c.intOr(0, 0);
          const url = lookupPackMap(game.script, "bgms", id);
          if (url) audio.playBgm(url, { volume: (c.keyedInt(17) ?? 100) / 100, fadeIn: (c.keyedInt(1) ?? 0) / 1000,
            fadeOut: (c.keyedInt(11) ?? c.keyedInt(1) ?? 0) / 1000, offsetSamples: c.keyedInt(69) ?? 0, loop: bgmLoop(id) });
          // snapshot state: the BGM at each line, so rewind restores it
          if (url) lastBgm = { id, url, vol: (c.keyedInt(17) ?? 100) / 100 };
          // knife: only MPLY marks a BGM heard (title/movie BGM do not)
          if (id > 0 && !(progress.heardBgms || []).includes(id)) {
            progress.heardBgms.push(id);
            saveProgressSoon();
          }
        } else if (name === "MVOL") {
          // knife set_bgm_volume(v, key 1 ms): a ramp, not a jump
          audio.setBgmVolume((c.keyedInt(17) ?? 100) / 100, Math.max(1, c.keyedInt(1) ?? 0) / 1000);
          if (lastBgm) lastBgm.vol = (c.keyedInt(17) ?? 100) / 100;
        } else if (name === "MFAD") {
          audio.stopBgm((c.keyedInt(1) ?? 0) / 1000);
          lastBgm = null;
        } else if (name === "MSTP") {
          audio.stopBgm(0);
          lastBgm = null;
        }
      },
      onSe: (c) => {
        const name = c.name;
        if (name === "SESP") {
          audio.stopSe(c.intOr(0, -1));
          const ch = c.intOr(0, -1);
          if (ch < 0) seLoops = {}; else { delete seLoops[ch]; delete seLoops[ch % 20]; }
          return;
        }
        if (name === "SEPL") {
          const snd = c.arg(2);
          const url = snd ? lookupPackMap(game.script, "ses", snd) : null;
          const channel = c.intOr(0, 0) % 20;
          const looping = c.intOr(1, 0) === 1;
          const vol = (c.keyedInt(17) ?? 100) / 100;
          const pan = (() => { const p = c.keyedInt(18); return p === null ? 0 : (1000 * p - 64000) / 64000; })();
          const sp = c.keyedInt(70);
          if (url) audio.playSe(url, {
            channel,
            volume: vol,
            fadeIn: (c.keyedInt(1) ?? 0) / 1000,
            looping,
            // knife cmd_se: no key 18 = centre; key 18 p -> pan
            // (1000p - 64000)/64 in thousandths (64 = centre). The old
            // formula defaulted a missing key to -1: every SE hard-left.
            pan,
            speakerRow: (sp !== null && sp >= 0 && sp < 19) ? sp : null,
          });
          // snapshot state: looping SEs persist like BGM; a one-shot on
          // the same channel replaces the loop (playSe stops the old node)
          if (looping) { if (url) seLoops[channel] = { url, vol, pan, channel }; }
          else delete seLoops[channel];
        } else if (name === "SEFD") {
          // knife SEFD fades out over key 1 ms (it used to cut at once)
          audio.stopSe(c.intOr(0, -1), (c.keyedInt(1) ?? 0) / 1000);
          const ch = c.intOr(0, -1);
          if (ch < 0) seLoops = {}; else { delete seLoops[ch]; delete seLoops[ch % 20]; }
        } else if (name === "SEVL") {
          // knife SEVL (kind 3): ramp a playing channel's volume to
          // key 17 over key 1 ms; no key 17 means the word is unchanged
          const vol = c.keyedInt(17);
          if (vol !== null) audio.setSeVolume(c.intOr(0, -1), vol / 100, (c.keyedInt(1) ?? 0) / 1000);
        }
      },
      // a key-68 delayed SE op fires here with everything resolved at
      // queue time (the scene may have changed since) — same audio and
      // snapshot bookkeeping as onSe, without the pack lookup
      onSeFired: (e) => {
        if (e.kind === "SEPL") {
          if (!e.url) { audio.stopSe(e.channel, 0); delete seLoops[e.channel]; return; }
          const url = mediaUrl(e.url);
          audio.playSe(url, { channel: e.channel, volume: e.vol, fadeIn: e.fadeIn, looping: e.looping, pan: e.pan, speakerRow: e.speakerRow });
          if (e.looping) seLoops[e.channel] = { url, vol: e.vol, pan: e.pan, channel: e.channel };
          else delete seLoops[e.channel];
        } else if (e.kind === "SEFD") {
          audio.stopSe(e.channel, e.fade);
          delete seLoops[e.channel];
        } else if (e.kind === "SEVL") {
          audio.setSeVolume(e.channel, e.vol, e.fade);
        }
      },
      onVoice: (c, stopAll) => {
        // snapshot state: a message-start voice belongs to its line; the
        // live ZM after a restore replays it from voiceToPlay
        if (stopAll !== false) lastVoiceCmd = [c.name, ...c.args];
        const snd = c.arg(0) || c.arg(1);
        const url = snd ? lookupPackMap(game.script, "voices", snd) : null;
        if (url) {
          // knife note_voice: the speaker's config row appears + keeps the
          // voice for the config test button
          if (snd) KP.System.noteVoice(progress, snd);
          game.voicePlaying = true;
          // a stopped voice fires onended too: only the newest voice may
          // clear the flag, or VCWT would release while a line still plays
          const tok = ++voiceTok;
          audio.playVoice(url, { stopAll: stopAll !== false, speakerRow: snd ? KP.System.voiceRow(snd) : null }).then((node) => {
            if (node && node.src) node.src.onended = () => { if (tok === voiceTok) game.voicePlaying = false; };
            else if (tok === voiceTok) game.voicePlaying = false;
          });
        }
      },
    });
    // flowchart / gallery progress survives a fresh Game (nodes are system
    // state, not scene state); the session route set is rebuilt per boot
    g.nodesVisited = new Set(progress.nodesVisited || []);
    g.nodesDone = new Set(progress.nodesDone || []);
    g.edges = new Set(progress.edges || []);
    return g;
  }
  // keep the persisted node sets in step with the live Game; the route
  // (RTST play bits R) and route edges (E bits) are read live from the
  // F words, so snapshots, rewinds and flowchart jumps stay exact
  function scanRoute() {
    routeNodes.clear(); routeEdges.clear();
    if (!game) return;
    for (let n = 0; n < 0x240; n++) if (game.playBit("R", n)) routeNodes.add(n);
    for (let i = 0; i < 704; i++) if (game.playBit("E", i)) routeEdges.add(i + 564);
  }
  function syncNodes() {
    if (!game) return;
    progress.nodesVisited = Array.from(game.nodesVisited || []);
    progress.nodesDone = Array.from(game.nodesDone || []);
    progress.edges = Array.from(game.edges || []);
    scanRoute();
    progress.routeNodes = Array.from(routeNodes);
    progress.routeEdges = Array.from(routeEdges);
  }
  // knife continue_slot: newest record of manual + auto (never quick);
  // the title CONTINUE button shows only when one exists
  function readAutosave() { try { return JSON.parse(localStorage.getItem("kp-save") || "null"); } catch (e) { return null; } }
  async function refreshContinue() {
    let has = false;
    const a = readAutosave();
    if (a && a.scene) has = true;
    if (!has) {
      try { has = (await KP.System.listSlots()).some((s) => s && s.scene); } catch (e) {}
    }
    const b = document.querySelector("#btn-continue");
    if (b) b.style.display = has ? "" : "none";
  }
  async function continueLoad() {
    let best = null, bestTs = -1;
    try {
      for (const s of await KP.System.listSlots()) {
        if (s && s.scene && (s.ts || 0) > bestTs) { best = s; bestTs = s.ts || 0; }
      }
    } catch (e) {}
    const a = readAutosave();
    if (a && a.scene && (a.ts || 0) > bestTs) best = a;
    if (!best) return;
    if (!(best.snap && await restoreSnap(best.snap))) await startScene(best.scene, null, best.pc || 0, false);
  }
  // a manual save: the line-anchored snapshot (lastSnap, else a fresh
  // capture) + the scene's current frame as a thumbnail
  function captureThumb() {
    try {
      const src = document.querySelector("#canvas");
      if (!src || !src.width) return null;
      const c = document.createElement("canvas"); c.width = 320; c.height = 180;
      c.getContext("2d").drawImage(src, 0, 0, 320, 180);
      return c.toDataURL("image/jpeg", 0.6);
    } catch (e) { return null; }
  }
  // IIFE level, not inside boot(): makeGame's onAtsv calls it, and
  // makeGame is a sibling of boot — a boot-local definition threw
  // ReferenceError on every ATSV (found by CDP probe, 0032)
  function writeAutosave() {
    if (game && game.sceneName) {
      const snap = (lastSnap && lastSnap.scene === game.sceneName) ? lastSnap : null;
      const zp = snap ? snap.zmPc : (lastZm && lastZm.scene === game.sceneName) ? lastZm.zmPc : game.pc;
      try { localStorage.setItem("kp-save", JSON.stringify({ scene: game.sceneName, pc: zp, ts: Date.now(), thumb: captureThumb(), snap: snap || undefined })); } catch (e) {}
    }
  }
  function captureSave() {
    if (!game) return null;
    const snap = (lastSnap && lastSnap.scene === game.sceneName) ? lastSnap : captureSnap();
    const linePc = (lastZm && lastZm.scene === game.sceneName) ? lastZm.zmPc : (snap ? snap.zmPc : game.pc);
    const ctx = game.sceneName;
    return {
      scene: game.sceneName, pc: linePc, zmPc: linePc, snap: snap || undefined,
      title: (/^00_/.test(ctx) ? "Prologue" : ctx), phase: game.var("F023") || 0,
      thumb: captureThumb(),
    };
  }
  async function loadSave(rec) {
    if (!rec || !rec.scene || !manifest.scenes[rec.scene]) return "nosave";
    if (rec.snap && await restoreSnap(rec.snap)) return "loaded";
    await startScene(rec.scene, null, rec.pc || 0, false);
    return "loaded";
  }
  // Loading gate (0036): the loader is visible in static HTML from the
  // first paint, so a slow media host never shows a bare black page.
  // Gates reveal it only if the wait lasts >150 ms (cached assets never
  // flash it) and always hide it, even on failure.
  function hideLoader() { const el = document.getElementById("loader"); if (el) el.classList.add("hide"); }
  function loaderGate() {
    const el = document.getElementById("loader");
    let t = null;
    if (el && el.classList.contains("hide")) t = setTimeout(() => el.classList.remove("hide"), 150);
    return () => { if (t) clearTimeout(t); hideLoader(); };
  }
  function preloadImage(src) {
    return new Promise((res) => {
      const im = new Image();
      im.onload = im.onerror = () => res();
      im.src = mediaUrl(src);
    });
  }
  // Title art gate: logo, menu atlas, lumi, note, particles and the
  // titlebg movie (canplay, not full download). Any failure counts as
  // done, and a 30 s cap guarantees the menu never hangs on a dead host.
  async function preloadTitle() {
    const n = titleBgStage();
    const videoReady = new Promise((res) => {
      if (!titleVideoEl) return res();
      if (titleVideoEl.dataset.n !== String(n)) {
        titleVideoEl.dataset.n = String(n);
        titleVideoEl.src = mediaUrl("assets/movie/titlebg" + n + ".mp4");
        titleVideoEl.load();
      }
      if (titleVideoEl.readyState >= 3) return res();
      const done = () => {
        titleVideoEl.removeEventListener("canplay", done);
        titleVideoEl.removeEventListener("error", done);
        res();
      };
      titleVideoEl.addEventListener("canplay", done);
      titleVideoEl.addEventListener("error", done);
    });
    const imgs = ["data/title/bg1.webp", "data/title/lumi.webp", "data/title/copy.webp", "data/title/logo.webp", "data/title/menu.webp", "data/title/particles.webp"];
    const cap = new Promise((res) => setTimeout(res, 30000));
    await Promise.race([Promise.all([...imgs.map(preloadImage), videoReady]), cap]);
  }
  async function showTitle(opts) {
    const press = !!(opts && opts.press);
    disarmPress();
    titleEl.classList.toggle("press", press);
    // Title gate (0036): the menu appears only once its art is in.
    const doneGate = loaderGate();
    try { await preloadTitle(); } finally { doneGate(); }
    titleEl.style.display = "flex";
    hudScene.textContent = "";
    refreshContinue();
    // no game on title: a refresh must show the title, not resume a
    // stale line hash left by the last session's hash writer
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    startTitleVideo();
    startTitleFx();
    if (!(opts && opts.keepBgm)) playTitleBgm();
    if (press) armPress();
  }
  function disarmPress() {
    if (!pressHandler) return;
    removeEventListener("keydown", pressHandler);
    titleEl.removeEventListener("pointerdown", pressHandler);
    pressHandler = null;
  }
  function armPress() {
    disarmPress();
    pressHandler = (e) => { if (e && e.repeat) return; disarmPress(); pressOut(); };
    addEventListener("keydown", pressHandler);
    titleEl.addEventListener("pointerdown", pressHandler);
  }
  // one intro frame loop: tick(f, skipped) draws, done(f, skipped) ends.
  // Inputs count as a skip only after minSkip frames (knife: the notice
  // skips anytime, a caution only after 240 frames at full alpha = frame
  // 290 with its 50-frame fade-in, WhiteOut never).
  function runIntroFrames(tick, done, minSkip) {
    return new Promise((res) => {
      let f = 0, skipped = false;
      const onIn = () => { if (f >= (minSkip || 0)) skipped = true; };
      addEventListener("keydown", onIn);
      addEventListener("pointerdown", onIn);
      const step = () => {
        f++; tick(f, skipped);
        if (done(f, skipped)) { removeEventListener("keydown", onIn); removeEventListener("pointerdown", onIn); res(); }
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }
  function introShow(imgSrc, bg) {
    introEl.style.display = "block";
    introBgEl.style.background = bg;
    introBgEl.style.opacity = 1;
    introWhiteEl.style.opacity = 0;
    if (imgSrc) { introImgEl.src = imgSrc; introImgEl.style.display = "block"; introImgEl.style.opacity = 0; }
    else introImgEl.style.display = "none";
  }
  // knife Intro::Notice: parts.mrg index 2 is the EN notice (1 = JP, 3 = ZC,
  // 4 = ZT); fades in over white (0.025/frame), shows up to 8 s, fades out
  async function showNotice() {
    introShow(mediaUrl("data/parts/parts_2_0.webp"), "#fff");
    let a = 0, t = 0, out = false;
    await runIntroFrames((f, skipped) => {
      if (skipped) out = true;
      if (!out) { a = Math.min(1, a + 0.025); if (a >= 1) t++; if (t >= 480) out = true; }
      else { a = Math.max(0, a - 0.025); introBgEl.style.background = "#000"; }
      introImgEl.style.opacity = a;
    }, () => out && a <= 0, 0);
    introEl.style.display = "none"; introImgEl.style.display = "none";
  }
  // knife Intro::Caution: TITLE_PARTS_EN caution_en / caution1_en (knife
  // looks the JA names up in the EN map and draws black — the port shows
  // the EN textures like the original). Fade 0.02/frame, at least 4 s at
  // full alpha (skippable after that), at most 12 s; the second fades
  // white in as it fades out. Returns the white level for WhiteOut.
  async function showCaution(idx) {
    introShow(mediaUrl(idx === 0 ? "data/caution/caution_en.webp" : "data/caution/caution1_en.webp"), "#000");
    let a = 0, t = 0, out = false, white = 0;
    await runIntroFrames((f, skipped) => {
      if (skipped) out = true;
      if (!out) { a = Math.min(1, a + 0.02); if (a >= 1) t++; if (t >= 720) out = true; }
      else { a = Math.max(0, a - 0.02); if (idx === 1) white = Math.min(1.2, white + 0.02); }
      introImgEl.style.opacity = a;
      introWhiteEl.style.opacity = Math.min(1, white);
    }, () => out && a <= 0, 290);
    return white;
  }
  async function whiteOut(startWhite) {
    let w = startWhite;
    await runIntroFrames(() => { w = Math.min(1.2, w + 0.01); introWhiteEl.style.opacity = Math.min(1, w); }, () => w >= 1.2, Infinity);
    introEl.style.display = "none"; introImgEl.style.display = "none"; introWhiteEl.style.opacity = 0;
  }
  // knife Intro::PressOut: sound 6, BGM out, title fades to black
  // (0.02/frame to 1.2), then the cautions, then WhiteOut -> START_SCRIPT
  async function pressOut() {
    playSys(6);
    try { audio.stopBgm(0.05); } catch (e) {}
    introEl.style.display = "block";
    introBgEl.style.background = "#000"; introBgEl.style.opacity = 0;
    introImgEl.style.display = "none"; introWhiteEl.style.opacity = 0;
    await runIntroFrames((f) => { introBgEl.style.opacity = Math.min(1, f * 0.02); }, (f) => f >= 60, Infinity);
    titleEl.style.display = "none";
    titleEl.classList.remove("press");
    const white = await showCaution(0).then(() => showCaution(1));
    await whiteOut(white);
    bootFlag = false;
    progress.backlog = []; pageBuf = []; pageChoices = []; pendingChoice = null;
    saveProgressSoon();
    // manifest is IIFE-level; boot()'s startName const is NOT visible here
    // (same scope bug as writeAutosave before the 0032 fix)
    startScene(manifest.start || "START_SCRIPT", null, 0, true);
  }
  // title BGM (knife play_title_bgm: 72 at stage 5, else 2).
  // Best-effort: autoplay may block it until the first gesture. 72
  // ships as a separate file (dist/assets/bgm/72.ogg); if the user's
  // dist predates it, the load fails and 2 plays instead of silence.
  function playTitleBgm() {
    try {
      const st = titleStage();
      // the probe load is NOT covered by playBgm's own generation
      // guard: if the title is left while it is in flight (flowchart
      // jump, NEW GAME), the .then would otherwise start the title
      // track over the new scene and loop it there. Skip the start
      // if any stopBgm landed meanwhile, or the title is already gone.
      const gen = audio.bgmGen;
      const ok = () => gen === audio.bgmGen && titleEl.style.display !== "none";
      audio.load(mediaUrl("assets/bgm/72.ogg")).then((buf) => {
        if (!ok()) return;
        const id = buf && st === 5 ? 72 : 2;
        audio.playBgm(mediaUrl("assets/bgm/" + id + ".ogg"), { volume: 1, loop: bgmLoop(id) });
      }).catch(() => { if (ok()) audio.playBgm(mediaUrl("assets/bgm/2.ogg"), { volume: 1, loop: bgmLoop(2) }); });
    } catch (e) {}
  }
  // knife system sounds (SYS_SOUNDS -> BFSAR wave names): 0 cursor,
  // 1 decide, 2 cancel, 3 menu open, 6 title/new game, 7 movie end
  // (on the SE volume, not the sys volume). 4/5/8 have no known caller
  // in knife's UI and are left unmapped. Dedicated SE channel 20, clear
  // of the script channels 0..19.
  const SYS_SE = ["MOON_SE00001", "MOON_SE00002", "MOON_SE00003", "MOON_SE00004", null, null, "MOON_SE00011", "MOON_SE00013", null];
  function playSys(n) {
    const name = SYS_SE[n];
    if (!name) return;
    try {
      if (n === 7) audio.playSe(mediaUrl("assets/se/" + name + ".ogg"), { channel: 20, volume: 1 });
      else audio.playSe(mediaUrl("assets/se/" + name + ".ogg"), { channel: 20, sys: true });
    } catch (e) {}
  }
  // language-suffixed movie file (op1_arc_en.mp4 etc.): the base name
  // is the Japanese file; ja (or an unknown language) uses the base.
  // RU and Living have no localized movies: they fall back to EN (0039).
  function movieUrlForLang(url) {
    const lang = (config && config.lang) || "en";
    const suf = lang === "en" || lang === "ru" || lang === "living" || lang === "custom" ? "_en" : lang === "zc" ? "_zc" : lang === "zt" ? "_zt" : "";
    if (!suf || !url.endsWith(".mp4")) return mediaUrl(url);
    return mediaUrl(url.slice(0, -4) + suf + ".mp4");
  }
  // leaving the music player: knife stops the track at once; the BGM
  // under it (game BGM, or the title BGM from the title screen) resumes.
  function musicStopped() {
    if (game && lastBgm) audio.playBgm(lastBgm.url, { volume: lastBgm.vol, loop: bgmLoop(lastBgm.id) });
    else if (!game) playTitleBgm();
    else audio.stopBgm(0);
  }
  // Title stage (knife title_stage_step, G002): flowchart nodes 560 ->
  // 1, 383 -> 3, 562 -> 5 (strictly sequential); the port derives the
  // stage from the node set directly, which converges to the same stage
  function titleStage() {
    const v = new Set(progress.nodesVisited || []);
    let s = 0;
    if (v.has(560)) s = 1;
    if (s === 1 && v.has(383)) s = 3;
    if (s === 3 && v.has(562)) s = 5;
    return s;
  }
  // Title background number (knife title_bg): 4 at stage 5, else
  // [1,2,3,3,2][stage]. Fresh progress -> titlebg1.
  function titleBgStage() {
    const s = titleStage();
    return s === 5 ? 4 : [1, 2, 3, 3, 2][Math.min(s, 4)];
  }
  function startTitleVideo() {
    if (!titleVideoEl) return;
    const n = titleBgStage();
    if (titleVideoEl.dataset.n !== String(n)) {
      titleVideoEl.dataset.n = String(n);
      titleVideoEl.src = mediaUrl("assets/movie/titlebg" + n + ".mp4");
      titleVideoEl.load();
    }
    titleBgFallbackEl.style.display = "none";
    titleVideoEl.onerror = () => { titleBgFallbackEl.style.display = "block"; };
    // knife loops the title movie from 8 s (loop_start 240/30)
    titleVideoEl.onended = () => { try { titleVideoEl.currentTime = 8; } catch (e) {} titleVideoEl.play().catch(() => {}); };
    titleVideoEl.play().catch(() => { titleBgFallbackEl.style.display = "block"; });
  }
  function stopTitleVideo() {
    if (!titleVideoEl) return;
    try { titleVideoEl.pause(); } catch (e) {}
    stopTitleFx();
  }
  // Title logo particles (knife fx.rs LogoFx, English values): shards
  // rise from under the logo, dots twinkle; clipped above y 519, the
  // logo's lower edge. Coordinates are 960x544 units, drawn x2.
  const FX_SHARDS = [[0, 0, 33, 44], [64, 0, 32, 55], [128, 0, 29, 45]];
  const FX_DOTS = [[15, 20], [78, 26], [141, 21]];
  let fxRunning = false, fxRAF = 0, fxImg = null, fxShards = [], fxDots = [], fxAcc = 0, fxClock = 0;
  function fxPhase(age, life) {
    const ai = Math.floor(age);
    if (ai <= 59) return [age / 60, 1];
    const left = life - age;
    if (left > 59) return [1, 1];
    return [Math.max(0, left) / 60, (ai & 2) === 0 ? 0.7 : 1];
  }
  function startTitleFx() {
    if (!titleFxEl || fxRunning) return;
    fxRunning = true; fxShards = []; fxDots = []; fxAcc = 0; fxClock = 0;
    if (!fxImg) { fxImg = new Image(); fxImg.src = mediaUrl("data/title/particles.webp"); }
    const ctx = titleFxEl.getContext("2d");
    let last = performance.now();
    const step = (now) => {
      if (!fxRunning) return;
      fxRAF = requestAnimationFrame(step);
      const frames = Math.min(4, (now - last) / (1000 / 60)); last = now;
      fxClock += frames / 60;
      // logo fade-in: alpha ramps over ~1 s (knife logo_a rising)
      const a = Math.min(1, fxClock / 1);
      // lumi pulse: 1 - |((t*0.5) % 2) - 1|, triangle over 4 s
      const pulse = 1 - Math.abs(((fxClock * 0.5) % 2) - 1);
      if (titleLumiEl) titleLumiEl.style.opacity = String(a * a * a * pulse);
      fxAcc += frames;
      while (fxAcc >= 2) {
        fxAcc -= 2;
        if (fxShards.length < 120) {
          const vy = Math.random() * 0.45 + 0.13333;
          const dir = Math.cos((Math.random() * 20 + 80) * Math.PI / 180);
          fxShards.push({ kind: Math.floor(Math.random() * 3), scale: 0.3 + Math.random() * 0.45,
            life: Math.floor(Math.random() * 150 + 120), age: 0, vx: vy * dir, vy,
            alpha: Math.random() * 0.5 + 0.5, angle: Math.random() * 640 * Math.PI / 180,
            spin: (Math.random() * 2.5 + 0.5) * Math.PI / 180,
            x: 480 - 337.5 + 675 * Math.random(), y: 260.25 - 25 + 50 * Math.random() });
        }
      }
      const ndot = Math.round(4 * frames);
      for (let i = 0; i < ndot && fxDots.length < 200; i++) {
        fxDots.push({ kind: Math.floor(Math.random() * 3), alpha: 0.25 + Math.random() * 0.75,
          life: Math.floor(Math.random() * 42 + 18), age: 0,
          x: -337.5 + 480 + 675 * Math.random(), y: 319.375 - Math.random() * 215.25 });
      }
      for (const s of fxShards) { s.x += s.vx * frames; s.y -= s.vy * frames; s.angle += s.spin * frames; s.age += frames; }
      fxShards = fxShards.filter((s) => s.age <= s.life);
      for (const d of fxDots) d.age += frames;
      fxDots = fxDots.filter((d) => d.age <= d.life);
      ctx.clearRect(0, 0, 1920, 1080);
      if (!fxImg.complete) return;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, 1920, 519); ctx.clip();
      for (const d of fxDots) {
        let t = 2 * d.age / d.life; t = t > 1 ? 2 - t : t;
        const [sx, sy] = FX_DOTS[d.kind];
        ctx.globalAlpha = a * d.alpha * t;
        ctx.drawImage(fxImg, sx, sy, 1, 1, d.x * 2 - 0.5, d.y * 2 - 0.5, 1, 1);
      }
      for (const s of fxShards) {
        const [sx, sy, sw, sh] = FX_SHARDS[s.kind];
        const [k, dim] = fxPhase(s.age, s.life);
        const c = Math.cos(s.angle);
        const w = sw * s.scale * k * c, h = sh * s.scale * k;
        ctx.globalAlpha = a * s.alpha * dim;
        if (w < 0) { ctx.save(); ctx.translate(s.x * 2, s.y * 2); ctx.scale(-1, 1); ctx.drawImage(fxImg, sx, sy, sw, sh, -Math.abs(w) / 2, -h / 2, Math.abs(w), h); ctx.restore(); }
        else ctx.drawImage(fxImg, sx, sy, sw, sh, s.x * 2 - w / 2, s.y * 2 - h / 2, w, h);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    };
    fxRAF = requestAnimationFrame(step);
  }
  function stopTitleFx() {
    fxRunning = false;
    if (fxRAF) cancelAnimationFrame(fxRAF);
    if (titleLumiEl) titleLumiEl.style.opacity = "0";
  }
  // Startup video (knife boot: TM_CI before the title). Skippable with
  // a click/key. Browsers block audible autoplay without a gesture, so
  // a blocked play falls back to muted autoplay at once (the video
  // still runs at launch) and the first click unmutes it instead of
  // skipping; a further click/key skips. Errors (missing file) skip
  // straight to title.
  function playBootVideo() {
    return new Promise((res) => {
      if (!bootVideoEl) return res();
      let done = false, awaitingGesture = false, startedAt = 0;
      const gesture = () => {
        if (done) return;
        try { audio.ensure(); if (audio.ctx && audio.ctx.state === "suspended") audio.ctx.resume(); } catch (e) {}
        if (awaitingGesture) {
          // first click: sound on (the video keeps playing muted until
          // now); only a further click skips
          awaitingGesture = false;
          bootVideoHintEl.style.display = "none";
          bootVideoEl.muted = false;
          bootVideoEl.play().catch(() => finish());
        } else if (performance.now() - startedAt >= 2000) finish(); // knife: Logo skips after 2 s
      };
      const onKey = () => gesture();
      const onClick = () => gesture();
      const finish = () => {
        if (done) return; done = true;
        hideLoader();
        bootVideoEl.removeEventListener("click", onClick);
        removeEventListener("keydown", onKey);
        bootVideoWrapEl.style.display = "none";
        bootVideoHintEl.style.display = "none";
        try { bootVideoEl.pause(); } catch (e) {}
        bootVideoEl.removeAttribute("src"); bootVideoEl.load();
        res();
      };
      bootVideoWrapEl.style.display = "block";
      startedAt = performance.now();
      bootVideoEl.src = mediaUrl("assets/movie/TM_CI.mp4");
      bootVideoEl.addEventListener("playing", hideLoader, { once: true });
      bootVideoEl.onended = finish;
      bootVideoEl.onerror = finish;
      bootVideoEl.addEventListener("click", onClick);
      addEventListener("keydown", onKey);
      const p = bootVideoEl.play();
      if (p && p.catch) p.catch(() => {
        // audible autoplay blocked: run muted at once (the video still
        // plays at launch) and let the first click unmute it
        awaitingGesture = true;
        bootVideoHintEl.style.display = "block";
        bootVideoEl.muted = true;
        bootVideoEl.play().catch(() => finish());
      });
    });
  }
  // Leaving for the title must actually unload the scene: without this,
  // the old scene's BGM and looping SEs keep playing, its textures stay
  // allocated in the renderer (WebGPU: real VRAM) and in the boot
  // texture map, and the canvas keeps its last frame — the title and
  // everything after it lag under the leftover scene.
  function unloadScene(opts) {
    if (game && game.staffTask) game.endStaffTask();
    storyMoviePlaying = false; storySkip = null;
    if (!(opts && opts.keepBgm)) { try { audio.stopBgm(0); } catch (e) {} }
    try { audio.stopSe(-1); } catch (e) {}
    try { audio.stopVoice(); } catch (e) {}
    seLoops = {}; lastBgm = null; lastVoiceCmd = null;
    try { movieEl.pause(); } catch (e) {}
    movieEl.style.display = "none";
    choicesEl.style.display = "none";
    textWin.hide();
    if (renderer && typeof renderer.releaseTextures === "function") {
      try { renderer.releaseTextures(); } catch (e) {}
    }
    textures = {}; texDirty = true; lastSig = null;
    warmGen++; // stop any background warm still writing the old scene
    // drawQuads([]) clears to black on both renderers (Canvas2D fills
    // black first; WebGPU clears the frame texture and blits it).
    if (renderer) { try { renderer.drawQuads([], {}, {}); } catch (e) {} }
  }
  function toTitle() {
    saveProgressSoon();
    unloadScene();
    game = null;
    autoOn = false; autoSkip = false; pageFast = false;
    flowReplay = false;
    textWin.hide();
    showTitle();
  }
  // styled two-button dialog (replaces native confirm() everywhere):
  // a body-level overlay above the system screens, navigable by
  // keyboard and controller through the dialog choiceNav; Yes plays
  // sound 1, No plays sound 2, B / Esc / right-click answer No
  let dialogActive = null;
  function showDialog(q) {
    return new Promise((res) => {
      let dlg = document.querySelector("#sys-dialog");
      if (!dlg) {
        dlg = document.createElement("div");
        dlg.id = "sys-dialog";
        dlg.innerHTML = '<div class="sys-dialog-box"><div class="sys-dialog-q"></div><div class="sys-dialog-btns"></div></div>';
        document.body.appendChild(dlg);
      }
      dlg.querySelector(".sys-dialog-q").textContent = q;
      const btnsEl = dlg.querySelector(".sys-dialog-btns");
      btnsEl.innerHTML = "";
      const finish = (v) => {
        dlg.style.display = "none";
        choiceNav = null;
        dialogActive = null;
        playSys(v ? 1 : 2);
        res(v);
      };
      const btns = [];
      for (const [label, v] of [["No", false], ["Yes", true]]) {
        const b = document.createElement("button");
        b.textContent = label;
        b.onclick = () => finish(v);
        btnsEl.appendChild(b);
        btns.push(b);
      }
      dlg.style.display = "flex";
      dialogActive = { cancel: () => finish(false) };
      choiceNav = { kind: "dialog", btns, focus: null,
        move: (delta) => {
          const f = choiceNav.focus;
          let h;
          if (f === 1 && delta < 0) h = 0;
          else if (f === null && delta > 0) h = 0;
          else if (f === 0 && delta > 0) h = 1;
          else if (f !== null && delta > 0) h = 0;
          else h = 1;
          choiceNav.focus = h;
          btns.forEach((x, i) => x.classList.toggle("focus", i === h));
        },
        side: (right) => {
          choiceNav.focus = right ? 1 : 0;
          btns.forEach((x, i) => x.classList.toggle("focus", i === choiceNav.focus));
        },
        pick: () => { if (choiceNav.focus !== null) finish(choiceNav.focus === 1); },
        cancel: () => finish(false) };
    });
  }
  // ---- RDAS: auto skip of read scenes (knife game.rs:2999, ui.rs:5950)
  let rdasPending = false;
  function handleRdas(n) {
    if (!game || game.ended || game.instant) return;
    if (!config.autoSkipRead || flowReplay) return;
    // knife's skip_all is CLI/seek-only (main.rs: it is set while a
    // --save-pc / --skip seek runs, never by the in-game skip key), so
    // RDAS fires even while the port's skip modes run — the port's
    // game.instant (resume replay) is the matching seek mode here
    if (!game.nodesDone || !game.nodesDone.has(n)) return;
    rdasPending = true;
  }
  // consumed in the frame loop after dispatch (never mid-dispatch: a
  // scene jump during stepFrame would corrupt the dispatch state).
  // Returns true when a jump started (the loop yields that tick).
  // knife ui/touch.rs start_scene_countdown: without a confirm the jump
  // waits 4 frames, with a Yes answer 20; the veil ramps as
  // 1.5 - frames/30 and input is blocked while it runs
  let rdasCount = null;
  async function consumeRdas() {
    if (!rdasPending || !game || game.ended) { rdasPending = false; return false; }
    rdasPending = false;
    // knife next_scene_allowed: F998 == 0 and not in a choice
    if (game.var("F998") !== 0 || game.wait.kind === "choice") return false;
    // knife: with the config's confirmation on, dialog 10 (SYSMES 232)
    if (config.skipConfirm) {
      const q = (KP.System.sysmesText(232, config.lang) || "").replace(/\^/g, "\n");
      if (!(await showDialog(q))) return false;
    }
    // knife next_scene(): the next scene in story order (manifest
    // scene_order is the pack order the port builds from)
    const order = (manifest && manifest.scene_order) || [];
    const idx = order.indexOf(game.sceneName);
    const next = idx >= 0 ? order[idx + 1] : null;
    if (!next) return false;
    veilEl.style.transition = "none";
    rdasCount = { frames: config.skipConfirm ? 20 : 4, next };
    return true;
  }
  // is the click wait at a page end? scan ahead for PGST before the next ZM
  function atPageEnd() {
    if (!game || !game.script) return false;
    const cmds = game.script.commands;
    for (let i = game.pc, n = 0; i < cmds.length && n < 40; i++, n++) {
      const nm = cmds[i] && cmds[i][0];
      if (nm === "PGST") return true;
      if (typeof nm === "string" && nm.startsWith("ZM")) return false;
    }
    return false;
  }
  // Built-in single-file translations (0039 ru, 0041 living): code-side
  // files, not part of scene packs, so scenes/media never need
  // re-uploading. Loaded lazily on first use.
  const LANG_FILES = { ru: "data/texts_ru.json", living: "data/texts_living.json" };
  let langFileCache = {}, langFilePromises = {};
  async function ensureLangFile(lang) {
    if (langFileCache[lang]) return langFileCache[lang];
    if (!langFilePromises[lang]) langFilePromises[lang] = fetchJSON(LANG_FILES[lang]).then((d) => { langFileCache[lang] = d; return d; }).catch(() => { langFilePromises[lang] = null; return null; });
    return langFilePromises[lang];
  }
  // Custom translations (0040): the same single-file shape as
  // texts_ru.json ({scene: {$id: line}}), loaded by the user from Config
  // and kept in its own IndexedDB (kp-i18n) so it survives sessions
  // without touching saves (kp-saves) or the code bundle.
  const I18N_DB = "kp-i18n", I18N_STORE = "kv";
  let i18nDbPromise = null, customTexts = null, customName = null;
  function openI18nDb() {
    if (i18nDbPromise) return i18nDbPromise;
    i18nDbPromise = new Promise((res, rej) => {
      try {
        const req = indexedDB.open(I18N_DB, 1);
        req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(I18N_STORE)) req.result.createObjectStore(I18N_STORE); };
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      } catch (e) { rej(e); }
    });
    return i18nDbPromise;
  }
  function i18nRun(mode, key, value) {
    return openI18nDb().then((db) => new Promise((res, rej) => {
      let out;
      const tx = db.transaction(I18N_STORE, mode);
      tx.oncomplete = () => res(out);
      tx.onerror = () => rej(tx.error);
      try {
        const r = mode === "readonly" ? tx.objectStore(I18N_STORE).get(key) : (value === undefined ? tx.objectStore(I18N_STORE).delete(key) : tx.objectStore(I18N_STORE).put(value, key));
        if (r && r.onsuccess !== undefined) r.onsuccess = () => { out = r.result; }; else out = r;
      } catch (e) { rej(e); }
    }));
  }
  function validateCustomTexts(d) {
    if (!d || typeof d !== "object" || Array.isArray(d)) return "Not a JSON object.";
    let scenes = 0, lines = 0;
    for (const [sc, dict] of Object.entries(d)) {
      if (!dict || typeof dict !== "object" || Array.isArray(dict)) return `Scene "${sc}" is not an object.`;
      for (const [id, line] of Object.entries(dict)) {
        if (!id.startsWith("$")) return `Key "${id}" in scene "${sc}" is not a $id.`;
        if (typeof line !== "string") return `Line ${sc} ${id} is not a string.`;
        lines++;
      }
      scenes++;
    }
    if (!scenes) return "Empty file.";
    return null;
  }
  async function importCustomTexts(file) {
    const d = JSON.parse(await file.text());
    const err = validateCustomTexts(d);
    if (err) throw new Error(err);
    const known = new Set(Object.keys(manifest.scenes));
    const matched = Object.keys(d).filter((s) => known.has(s)).length;
    if (!matched) throw new Error("No scene in this file matches the game.");
    // house format: every line ends \r\n (same as texts_ru.json)
    for (const dict of Object.values(d)) for (const k of Object.keys(dict)) dict[k] = dict[k].replace(/\r?\n$/, "") + "\r\n";
    let scenes = 0, lines = 0;
    for (const dict of Object.values(d)) { scenes++; lines += Object.keys(dict).length; }
    await i18nRun("readwrite", "custom", { name: file.name || "custom", data: d });
    customTexts = d; customName = file.name || "custom";
    return { scenes, lines };
  }
  async function removeCustomTexts() {
    await i18nRun("readwrite", "custom", undefined);
    customTexts = null; customName = null;
  }
  // ru/living/custom injection shared by startScene and applyLanguage:
  // the built-in packs carry only en/zc/zt, so ru/living/custom plug in
  // here (living falls back to Japanese for its untranslated lines,
  // exactly like the Switch mod it came from).
  async function injectLangTexts(pack, name) {
    if (LANG !== "ru" && LANG !== "living" && LANG !== "custom") return;
    const rt = LANG === "custom" ? customTexts : await ensureLangFile(LANG);
    if (rt && rt[name]) { pack.texts_i18n = pack.texts_i18n || {}; pack.texts_i18n[LANG] = rt[name]; }
  }
  function downloadJSON(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.download = filename;
    a.href = URL.createObjectURL(blob);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  // Export the selected language as one file in the texts_ru.json shape:
  // ru/living come from their single file, custom from memory, ja/en/zc/zt
  // are assembled from the scene packs (8 concurrent fetches).
  async function exportLangTexts(lang) {
    let data;
    if (LANG_FILES[lang]) data = await fetchJSON(LANG_FILES[lang]);
    else if (lang === "custom") {
      if (!customTexts) throw new Error("No custom translation loaded.");
      data = customTexts;
    } else {
      data = {};
      const names = manifest.scene_order || Object.keys(manifest.scenes);
      let idx = 0;
      const workers = Array.from({ length: 8 }, async () => {
        while (idx < names.length) {
          const name = names[idx++];
          const meta = manifest.scenes[name];
          if (!meta) continue;
          try {
            const pack = await fetchJSON(mediaUrl(meta.file));
            const dict = lang === "ja" ? pack.texts : (pack.texts_i18n && pack.texts_i18n[lang]);
            if (dict && Object.keys(dict).length) data[name] = dict;
          } catch (e) { /* unreadable scene: skipped */ }
        }
      });
      await Promise.all(workers);
    }
    let scenes = 0, lines = 0;
    for (const dict of Object.values(data)) { scenes++; lines += Object.keys(dict).length; }
    downloadJSON("texts_" + lang + ".json", data);
    return { scenes, lines };
  }
  async function startScene(name, label, resumePc, fresh, opts) {
    const meta = manifest.scenes[name];
    if (!meta) return;
    // RDAS never fires during a flowchart replay (knife !flow_replay):
    // only a flowchart jump arms it, JUMPs inside the chain keep it
    flowReplay = !!(opts && opts.flowReplay);
    // Hard load gate (0036): nothing plays until the scene pack, its
    // motions and ALL of its images are in. The loader shows only if
    // the wait lasts (cached scenes never flash it); finally hides it
    // even when the pack fails to load.
    const doneGate = loaderGate();
    let pack, motionsData;
    try {
      pack = await fetchJSON(mediaUrl(meta.file));
      await injectLangTexts(pack, name);
      motionsData = await loadMotions(name);
      await warmTextures(pack, motionsData, true);
    } finally { doneGate(); }
    // knife keeps ONE Game across scenes: vars (F822 page mode included),
    // nodes and the stage survive a JUMP. Only NEW GAME resets them.
    if (fresh || !game) game = makeGame(pack);
    else {
      game.ended = false;
      game.wait = { kind: "none" };
      game.fads = null; game.trans = null; game.transFrom = null; game.stageDirty = false;
      game._pendingJump = null; game._choicePromise = null; game._moviePromise = null;
    }
    game.script = pack;
    game.sceneName = name;
    game.stage.sceneId = name;
    game.pc = 0;
    if (label && pack.labels[label] !== undefined) game.pc = pack.labels[label];
    if (name !== "START_SCRIPT" && Object.keys(game.vars).length === 0) {
      // deep link / CONTINUE / flowchart jump without a START_SCRIPT
      // replay: story scenes always run under page mode (F822 = 1, set by
      // START_SCRIPT). Fresh games start at START_SCRIPT, so this skips them.
      game.setVar("F822", 1); game.setVar("F823", 0);
    }
    if (opts && opts.presetVars) {
      for (const [k, v] of Object.entries(opts.presetVars)) game.setVar(k, v);
    }
    // leaving the title must silence its BGM (knife: title music belongs
    // to the title state); in-game JUMPs keep the scene BGM — scripts own
    // it there — so only stop when the title was actually showing.
    const fromTitle = titleEl.style.display !== "none";
    titleEl.style.display = "none";
    stopTitleVideo();
    if (fromTitle) { try { audio.stopBgm(0); } catch (e) {} }
    choicesEl.style.display = "none";
    if (fresh) { backHist = []; lastZm = null; lastSnap = null; lastBgm = null; seLoops = {}; lastVoiceCmd = null; routeNodes.clear(); progress.routeNodes = []; routeEdges.clear(); progress.routeEdges = []; }
    hudScene.textContent = name;
    // knife auto-skip read scenes: arm it when the scene's first line is
    // already read (it stops at the first unread line or choice); with the
    // confirmation on, ask first
    autoSkip = false;
    if (config.autoSkipRead && name !== "START_SCRIPT") {
      const startPc = pack.labels.START !== undefined ? pack.labels.START : 0;
      let firstLine = null;
      for (let i = startPc; i < pack.commands.length; i++) {
        const c = pack.commands[i];
        if (c && typeof c[0] === "string" && c[0].startsWith("ZM") && c.length > 1) { firstLine = c[1]; break; }
      }
      if (firstLine && isLineSeen(firstLine)) {
        if (!config.skipConfirm || await showDialog("Skip read text?")) autoSkip = true;
      }
    }
    if (resumePc) {
      game.instant = true;
      const cmds = pack.commands;
      // Replay must stay silent: every VPLY/SEPL/MPLY before the resume
      // point would otherwise fire at once (the "CONTINUE plays all audio"
      // bug). Audio arms are skipped; only the BGM state at the resume
      // point is remembered and restored once, afterwards.
      const SKIP_AUDIO = new Set(["MPLY", "MVOL", "MFAD", "MSTP", "SEPL", "SEFD", "SEVL", "SESP", "VPLY", "VPL2", "VCWT", "TOMP", "TOMW"]);
      let pendingBgm = null; // {id, vol}
      while (game.pc < resumePc && game.pc < cmds.length) {
        const cmd = new KP.Cmd(cmds[game.pc]);
        // FADS re-runs every frame in live dispatch (pc -= 1); in a resume
        // replay it is a commit point instead, or the loop would stall.
        if (cmd.name === "FADS") { game.stage.commit(); game.stageDirty = false; }
        else if (cmd.name === "MPLY") { pendingBgm = { id: cmd.intOr(0, 0), vol: (cmd.keyedInt(17) ?? 100) / 100 }; }
        else if (cmd.name === "MVOL") { if (pendingBgm) pendingBgm.vol = (cmd.keyedInt(17) ?? 100) / 100; }
        else if (cmd.name === "MFAD" || cmd.name === "MSTP") { pendingBgm = null; }
        else if (!SKIP_AUDIO.has(cmd.name)) {
          game.exec(cmd);
          if (game.jumpTo) game.jumpTo = null;
        }
        game.pc++;
      }
      game.instant = false;
      if (pendingBgm) {
        const url = lookupPackMap(pack, "bgms", pendingBgm.id);
        if (url) audio.playBgm(url, { volume: pendingBgm.vol, loop: bgmLoop(pendingBgm.id) });
        // replay-path BGM, so lines after a deep link / CONTINUE carry it
        if (url) lastBgm = { id: pendingBgm.id, url, vol: pendingBgm.vol };
      }
      game.stage.commit();
      game.stageDirty = false;
      game.pageMsgCount = 0;
      // a replayed ZM leaves a stale click-wait behind; live dispatch must
      // start clean or the first message never shows until a stray click.
      game.wait = { kind: "none" };
      textWin.clearPage();
      // replay wiped the page: the replayed lines never enter the backlog
      pageBuf = []; pageChoices = []; pendingChoice = null;
    }
    loop();
  }
  // Full line snapshot (0015): taken at onText, live only. The page's
  // committed lines are exact at that point: the advance path commits the
  // previous current before the click, so current is null here; if some
  // path left a current behind, it counts as committed (fade 1: an old
  // line reads dim). pageMsgCount is post-increment at onText, so the
  // restore stores it minus one: the live ZM recomputes its extra offset
  // from the pre-line count, then increments back.
  function captureSnap() {
    if (!game) return null;
    const lines = textWin.lines.map((l) => ({ html: l.html, fade: l.fade }));
    if (textWin.current) lines.push({ html: textWin.current.full, fade: 1 });
    return {
      scene: game.sceneName, zmPc: game.pc - 1, pc: game.pc,
      vars: { ...game.vars }, pageMsgCount: game.pageMsgCount,
      stage: KP.Snap.snapStage(game.stage),
      ghost: game.ghost ? { ...game.ghost } : null,
      staffTask: game.staffTask,
      focus: game.focus ? game.focus.toJSON() : null,
      bgm: lastBgm ? { ...lastBgm } : null,
      seLoops: Object.fromEntries(Object.entries(seLoops).map(([k, v]) => [k, { ...v }])),
      voice: lastVoiceCmd ? lastVoiceCmd.slice() : null,
      textLines: lines, textAlpha: textWin.alpha, textVisible: textWin.visible,
    };
  }
  // Restore a snapshot and land on its line with NO replay: the live ZM
  // at zmPc shows the line, replays its voice from voiceToPlay and
  // recomputes its page offset from the restored vars. Returns false when
  // the scene cannot load (callers fall back to the replay path).
  async function restoreSnap(snap) {
    if (!snap || !snap.scene || !manifest.scenes[snap.scene] || !renderer) return false;
    try {
      const sameScene = game && game.sceneName === snap.scene;
      const pack = sameScene ? game.script : await fetchJSON(manifest.scenes[snap.scene].file);
      if (!sameScene) {
        const motionsData = await loadMotions(snap.scene);
        await warmTextures(pack, motionsData);
        // inherited layers may name images outside this scene's pack;
        // imageUrlFor falls back to assets/img/<name>.webp for those
        for (const l of snap.stage.layers) {
          if (!l || l.source.kind !== "image") continue;
          const low = l.name.toLowerCase();
          if (!textures[low]) {
            const url = imageUrlFor(l.name, pack);
            if (url) { const img = await renderer.loadImage(url, ""); if (img) textures[low] = img; }
          }
        }
      }
      if (!game) game = makeGame(pack);
      game.script = pack;
      game.sceneName = snap.scene;
      game.vars = { ...snap.vars };
      game.pageMsgCount = snap.pageMsgCount - 1;
      // snapshot carries the staff task: sync the mode lock to it
      if (snap.staffTask && !game.staffTask) { game.staffTask = true; savedStaffModes = { auto: autoOn, skip: autoSkip }; autoOn = false; autoSkip = false; }
      else if (!snap.staffTask && game.staffTask) game.endStaffTask();
      game.focus = snap.focus ? KW.Focus.fromJSON(snap.focus) : new KW.Focus();
      KP.Snap.unsnapStage(game.stage, snap.stage);
      game.ghost = snap.ghost ? { ...snap.ghost } : null;
      game.stage.sceneId = snap.scene;
      game.pc = snap.zmPc;
      game.wait = { kind: "none" };
      game.trans = null; game.fads = null; game.transFrom = null; game.stageDirty = false;
      game._pendingJump = null; game._choicePromise = null; game._moviePromise = null;
      game.ended = false;
      game.voiceToPlay = snap.voice ? new KP.Cmd(snap.voice) : null;
      game.shake.stop();
      // the page as at the snapshot; the live ZM creates the new current.
      // A page-start line's own ZM clears it again, exactly as originally.
      textWin.lines = snap.textLines.map((l) => ({ html: l.html, fade: l.fade }));
      textWin.current = null; textWin.fadeOutMs = 0;
      // backlog: the restored page continues, unless its ZM starts a new
      // page — then the live ZM's onPageClear flushes an empty buffer
      // (those lines already entered the backlog during live play)
      const pageStart = game.var("F822") !== 1 || game.var("F823") <= 1;
      pageBuf = pageStart ? [] : snap.textLines.map((l) => l.html);
      pageChoices = []; pendingChoice = null;
      pageScene = snap.scene; pageLastZmPc = snap.zmPc;
      textWin.alpha = snap.textAlpha; textWin.visible = snap.textVisible;
      textWin.render();
      movieEl.style.display = "none";
      try { movieEl.pause(); } catch (e) {}
      choicesEl.style.display = "none";
      titleEl.style.display = "none";
      stopTitleVideo();
      hudScene.textContent = snap.scene;
      // audio: stop everything, restart the snapshot's BGM + loops; the
      // line's voice comes back via the live ZM's voiceToPlay (stopAll)
      audio.stopBgm(0); audio.stopSe(-1); audio.stopVoice();
      lastBgm = snap.bgm ? { ...snap.bgm } : null;
      seLoops = {};
      for (const [k, v] of Object.entries(snap.seLoops || {})) seLoops[k] = { ...v };
      if (snap.bgm && snap.bgm.url) audio.playBgm(snap.bgm.url, { volume: snap.bgm.vol, loop: snap.bgm.id !== undefined ? bgmLoop(snap.bgm.id) : null });
      for (const v of Object.values(seLoops)) audio.playSe(v.url, { channel: v.channel, volume: v.vol, looping: true, pan: v.pan });
      lastVoiceCmd = snap.voice ? snap.voice.slice() : null;
      autoSkip = false;
      lastSnap = snap;
      loop();
      return true;
    } catch (e) { return false; }
  }
  let rafOn = false, lastT = 0, acc = 0, frameNo = 0;
  // STNS grain (knife stage.rs noise_pass): the never-cleared noise
  // canvas, painted once per frame while any grain layer is visible
  let noiseCanvas = null;
  const noiseImgs = {};
  let ruleTransCaptured = false;
  function preloadRule(n) {
    const key = "rule_" + n;
    if (!textures[key] && !loading.has(key)) {
      loading.add(key);
      renderer.loadImage(mediaUrl("data/rules/RULE_" + String(n).padStart(2, "0") + ".webp"), "").then((img) => {
        loading.delete(key);
        if (img) textures[key] = img;
      });
    }
  }
  function preloadBorder(k) {
    const key = "border_" + k;
    if (!textures[key] && !loading.has(key)) {
      loading.add(key);
      renderer.loadImage(mediaUrl("data/border/border_" + k + ".webp"), "").then((img) => {
        loading.delete(key);
        if (img) textures[key] = img;
      });
    }
  }
  function preloadNoise(n) {
    const name = (n % 10 === 2) ? "noisehd1" : "noisehd0";
    if (!noiseImgs[name] && !loading.has("noise_" + name)) {
      loading.add("noise_" + name);
      renderer.loadImage(mediaUrl("data/noise/" + name + ".webp"), "").then((img) => {
        loading.delete("noise_" + name);
        if (img) noiseImgs[name] = img && img.img ? img.img : img;
      });
    }
  }
  function paintNoise(n, frame) {
    const name = (n % 10 === 2) ? "noisehd1" : "noisehd0";
    const img = noiseImgs[name];
    if (!img) return false;
    if (!noiseCanvas) { noiseCanvas = document.createElement("canvas"); noiseCanvas.width = 1920; noiseCanvas.height = 1080; }
    // noise_pass: texture 390 (noisehd1) when n%10==2 else 389,
    // scaled 1.2x at a fresh random offset, mirrored on alternate ticks
    const tick = Math.floor(frame / (n > 2 ? 1 : 3));
    const rnd = (k) => {
      let v = (Math.imul(frame, 0x9E3779B9) ^ Math.imul(k, 0x85EBCA6B)) >>> 0;
      v ^= v >>> 15;
      v = Math.imul(v, 0x2C1B3C6D) >>> 0;
      v ^= v >>> 12;
      return (v & 0xFFFF) / 65535;
    };
    const x0 = -rnd(1) * 200, y0 = -rnd(2) * 90;
    const tw = 1920 * 1.2, th = 1080 * 1.2;
    const x = noiseCanvas.getContext("2d");
    if (tick % 2 === 1) x.drawImage(img, x0 + tw, y0, -tw, th);
    else x.drawImage(img, x0, y0, tw, th);
    return true;
  }
  function loop() {
    if (rafOn) return;
    rafOn = true;
    lastT = performance.now();
    const tick = (now) => {
      if (!game) { rafOn = false; return; }
      requestAnimationFrame(tick);
      let dt = now - lastT;
      lastT = now;
      if (dt > 100) dt = 100;
      // a system screen pauses the game (knife's config/flowchart/gallery
      // stop the scene behind them)
      if (sysOpen) { acc = 0; return; }
      acc += dt;
      // a styled dialog pauses the scene behind it (knife's modal UI)
      if (dialogActive) { acc = 0; return; }
      // RDAS countdown: the veil ramps to black, then the next scene
      if (rdasCount) {
        rdasCount.frames--;
        veilEl.style.opacity = Math.max(0, Math.min(1, 1.5 - rdasCount.frames / 30));
        if (rdasCount.frames <= 0) {
          const next = rdasCount.next;
          rdasCount = null;
          veilEl.style.transition = "";
          veilEl.style.opacity = 0;
          if (game && !game.ended) { flushLogPage(); startScene(next, null); }
        }
      }
      // typing head + read fades run on wall-clock dt, every frame the
      // window is visible (not only while a line is typing)
      if (textWin.visible) textWin.step(dt);
      typingDone = textWin.isTypingDone();
      // knife sub_38EC0 click icon: at a click wait with the text fully
      // out (hidden in auto mode, overseas); page icon when WNTY == 1 or
      // outside page mode, else the line-continue icon
      textWin.showIcon = !!game && game.wait.kind === "click" && typingDone && !autoOn;
      textWin.iconPage = !!game && (game.wnty === 1 || game.var("F822") !== 1);
      while (acc >= KP.FRAME_MS) {
        acc -= KP.FRAME_MS;
        const out = game.stepFrame(KP.FRAME_MS);
        frameNo++;
        // per-frame effect clocks (knife: layer haze advance, ghost
        // 60 Hz steps) run on the fixed step, not wall-clock rAF
        if (game.stage) for (const l of game.stage.layers) if (l && l.haze) KW.hazeAdvance(l.haze, KP.FRAME_MS);
        if (game.ghost) KW.Ghost.advance(game.ghost, KP.FRAME_MS);
        if (game.focus) game.focus.advance(KP.FRAME_MS);
        // resolve promise waits
        if (game.wait.kind === "choice" && game.wait.promise) {
          game.wait.promise.then(() => { if (game.wait.kind === "choice") game.wait = { kind: "none" }; });
        }
        if (game.wait.kind === "movie" && game.wait.promise) {
          game.wait.promise.then(() => { if (game.wait.kind === "movie") game.wait = { kind: "none" }; });
        }
        if (game._pendingJump) {
          const j = game._pendingJump;
          game._pendingJump = null;
          flushLogPage(); // the old scene's page is finished by the jump
          startScene(j.name, j.label, undefined, undefined, { flowReplay });
          return;
        }
        if (rdasPending) { consumeRdas(); }
        if (game.ended) { game = null; rafOn = false; return; }
        draw(out);
        // auto / skip / page-at-once advance (knife's auto mode, skip key
        // and page-at-once; a manual click still goes through the handler)
        // — all of them hold during a FADS crossfade, like manual clicks
        if (game.wait.kind === "click" && !(game.trans && game.trans.kind === "fade")) {
          if (!typingDone) {
            autoTimer = 0;
            if (pageFast || (!game.staffTask && (skipHeld || autoSkip)) || ffHeld) { textWin.finish(); typingDone = true; }
          } else if (pageFast) doAdvance();
          else if (autoOn && !game.voicePlaying) {
            // knife Wait::Click: the auto timer only runs while no voice
            // plays (it pauses, not resets, during a voice line). The
            // game's flag, not the engine's: boot's onVoice owns the
            // token-guarded end tracking (VCWT), the engine slot flag
            // is only a backstop
            autoTimer += KP.FRAME_MS;
            if (autoTimer >= (atPageEnd() ? config.autoPageMs : config.autoClickMs)) { autoTimer = 0; doAdvance(); }
          }
          if (!game.staffTask && (skipHeld || autoSkip) && game.wait.kind === "click" && typingDone) {
            if (!isLineSeen(currentLineId) && !config.skipUnread) autoSkip = false;
            else doAdvance();
          }
          // dock fast-forward: like skip, but never stops at unread lines
          if (ffHeld && game.wait.kind === "click" && typingDone) doAdvance();
        } else autoTimer = 0;
      }
    };
    requestAnimationFrame(tick);
  }
  let lastSig = null, texDirty = false;
  function draw(out) {
    // FADS crossfade (knife sub_A46F0): the old presented frame fades out
    // over the new stage — new quads first, then the snapshot quads with
    // alpha scaled by (1 - progress). One drawQuads call: both renderers
    // clear per call, so two calls would erase the first set.
    let quads = out.quads;
    let transSig = "-";
    let transRule = 0, transA = 0;
    if (out.trans && out.trans.kind === "fade") {
      const a = Math.min(1, out.trans.t / Math.max(1, out.trans.dur));
      transSig = (out.trans.t | 0) + "/" + out.trans.dur;
      transA = a;
      if (out.trans.rule > 0) {
        // FADS mode 2: the new stage draws as-is, the captured old
        // frame wipes over it through the rule. Capture BEFORE the
        // dirty-check return: the canvas still holds the old frame
        // on the first transition frame, and only then.
        transRule = out.trans.rule;
        preloadRule(transRule);
        if (!ruleTransCaptured) {
          try { if (renderer && renderer.captureFrame) renderer.captureFrame(); } catch (e) {}
          ruleTransCaptured = true;
        }
      } else if (out.transFrom && out.transFrom.length) {
        quads = quads.concat(out.transFrom.map((q) => ({ ...q, alpha: q.alpha * (1 - a) })));
      } else {
        // empty old frame = a black capture: the new stage fades in from black
        quads = quads.map((q) => ({ ...q, alpha: q.alpha * a }));
      }
    } else ruleTransCaptured = false;
    // keep the texture map fresh for layers the script just placed
    const pack = game ? game.script : null;
    for (const q of quads) {
      const low = (q.name || "").toLowerCase();
      // STTR rule textures preload like scene images
      if (q.rule) preloadRule(q.rule.n);
      // STNS grain layers show the noise canvas, not their image:
      // no scene texture, no gallery-seen tracking for them
      if (q.noise) { preloadNoise(q.noise); continue; }
      // clip-band quads: border textures preload like scene images,
      // and neither band kind pollutes gallery-seen tracking
      if (q.band) { if (q.border !== null && q.border !== undefined) preloadBorder(q.border); continue; }
      // gallery unlocks: an image counts as seen when it is shown
      if (q.alpha > 0 && low && !progress.seenImages.includes(low)) progress.seenImages.push(low);
      if (!textures[low] && pack && !loading.has(low)) {
        const url = imageUrlFor(q.name, pack);
        if (url) {
          loading.add(low);
          renderer.loadImage(url, "").then((img) => { loading.delete(low); if (img) { textures[low] = img; texDirty = true; } });
        }
      }
    }
    // A texture that is still loading must NOT render as a white box:
    // image quads always carry rgb (white by default), so both renderers
    // fill a textureless image quad with white — the appearance blink.
    // Only BLACK/WHITE colour layers (and nameless quads) may fill; every
    // other textureless quad waits, invisible, until its texture lands.
    // (The load trigger above still runs for the skipped quads.)
    quads = quads.filter((q) => {
      const low = (q.name || "").toLowerCase();
      if (!low || low === "black" || low === "white") return true;
      // STNS grain quads render from the noise canvas, not the image
      if (q.noise) return true;
      return !!(textures[q.name] || textures[low]);
    });
    // FCLN/FCSP focus lines (knife: drawn at the start of the text pass,
    // i.e. over the scene, under the DOM text window) — appended after
    // the filter so they never pollute gallery-seen tracking
    if (game.focus && game.focus.active() && game.var("F963") !== 1) {
      if (!textures["focusline"]) {
        if (renderer && !loading.has("focusline")) {
          loading.add("focusline");
          renderer.loadImage(mediaUrl("data/focus/focusline.webp"), "").then((img) => { loading.delete("focusline"); if (img) { textures["focusline"] = img; texDirty = true; } });
        }
      } else quads = quads.concat(game.focus.quads());
    }
    // Dirty-checked redraw: a static beat (no motion, tween, shake or
    // crossfade) redraws the same megapixel quads 60x/s for nothing — on a
    // weak GPU that starves the whole rAF loop. The canvas keeps its last
    // frame, so only draw when the stage output actually changed or a
    // texture just landed. Motions/tweens/fades change the signature every
    // frame, so they keep redrawing as before.
    let sig = "T" + transSig + ";";
    for (const q of quads) {
      sig += q.name + "|" + q.alpha.toFixed(3) + "|" + q.blend + "|" + (q.stec || 0) + "|" + (q.snx ? q.snx.join(",") : "1,1") + "|";
      for (const p of q.pos) sig += p[0].toFixed(1) + "," + p[1].toFixed(1) + ";";
      sig += (q.clip ? q.clip.length : 0) + "#";
      if (q.rule) sig += "R" + q.rule.n + "/" + q.rule.flip + ";";
      if (q.fill) sig += "F" + q.fill.join(",") + ";";
    }
    // Effects animate every frame (haze phase, noise offset, ghost
    // angle/alpha) without moving any quad, so a live effect forces a
    // redraw every step; otherwise the dirty check would freeze them
    const hasFx = quads.some((q) => q.noise || q.haze) || (game.ghost && KW.Ghost.active(game.ghost)) || (game.focus && game.focus.active());
    if (hasFx) sig += "FX" + frameNo + ";";
    if (sig === lastSig && !texDirty) return;
    lastSig = sig; texDirty = false;
    // Effect inputs, computed once per drawn frame: the noise paint
    // (never-cleared canvas), the ghost render params (which latch
    // brightness), the rule-transition capture made above
    let noiseUsed = null;
    {
      let nq = null;
      for (const q of quads) if (q.noise && (nq === null || q.layer < nq.layer)) nq = q;
      if (nq && paintNoise(nq.noise, frameNo)) noiseUsed = noiseCanvas;
    }
    const ghostParams = (game.ghost && KW.Ghost.active(game.ghost))
      ? KW.Ghost.params(game.ghost, (out.trans && out.trans.kind === "fade") ? transA : null) : null;
    const opts = { rules: textures };
    if (noiseUsed) { opts.noise = noiseUsed; opts.noiseCanvas = noiseUsed; }
    if (transRule) {
      const rk = "rule_" + transRule;
      opts.transition = { ruleImg: textures[rk], ruleRec: textures[rk], progress: transA, flip: 0 };
    }
    if (ghostParams) opts.ghost = ghostParams;
    renderer.drawQuads(quads, textures, opts);
    // The ghost pass draws the effect itself; the veil div stays down
    // (it is only for real full-screen fades, which the port has none of)
    veilEl.style.opacity = 0;
  }
  stageEl.addEventListener("pointerdown", () => {
    // a context created before the first gesture stays suspended
    // forever (nothing else resumes it except the boot-video click),
    // so every stage gesture retries the resume; without activation
    // the call just rejects and is ignored
    try { if (audio.ctx && audio.ctx.state === "suspended") audio.ctx.resume(); } catch (e) {}
    if (!game || sysOpen || dialogActive) return;
    userAdvance();
  });
  function fitStage() {
    const s = Math.min(innerWidth / 1920, (innerHeight - 45) / 1080);
    stageEl.style.transform = `scale(${s})`;
    stageEl.style.marginBottom = (1080 * (s - 1)) + "px";
    stageEl.style.marginRight = (1920 * (s - 1)) + "px";
  }
  addEventListener("resize", fitStage);
  async function applyLanguage(lang) {
    LANG = lang;
    config.lang = lang;
    KP.System.saveConfig(config);
    textures = {}; texDirty = true; lastSig = null;
    textWin.setLayout(lang);
    if (!game) return;
    await injectLangTexts(game.script, game.sceneName);
    // re-render the current page in the new language (fully shown);
    // the re-show must not re-append to the backlog page buffer
    const lines = pageLineIds.slice();
    textWin.lines = []; textWin.current = null; textWin.fadeOutMs = 0;
    pageLineIds = [];
    const savedOnShow = textWin.onShow; textWin.onShow = null;
    lines.forEach((l, idx) => {
      const i18n = game.script.texts_i18n && game.script.texts_i18n[LANG];
      const raw = (i18n && i18n[l.id]) || game.textFor(l.id) || "";
      textWin.showMessage(raw, l.extra);
      textWin.finish();
      if (idx < lines.length - 1) textWin.commitLine();
      pageLineIds.push(l);
    });
    textWin.onShow = savedOnShow;
    textWin.render();
    typingDone = true;
  }
  async function boot() {
    fitStage();
    await initRenderer();
    // boot JSON in parallel (was six sequential awaits): the page start
    // is 3.7 MB of JSON, and the round-trips were pure dead time.
    const [man, imgTab, grd, hazeData, flowData, galData, voiceData, sysmesData, flowExtraData, flowThumbsData, bgmLoopData, musicData, endingsData, moviesData, flowMarksData, mediaBaseData, customData] = await Promise.all([
      fetchJSON("manifest.json"),
      fetchJSON("data/images_en.json"),
      fetchJSON("data/grades.json").catch(() => null),
      fetchJSON("data/haze.json").catch(() => null),
      fetchJSON("data/flow_table.json").catch(() => null),
      fetchJSON("data/gallery.json").catch(() => null),
      fetchJSON("data/voice_rows.json").catch(() => null),
      fetchJSON("data/sysmes.json").catch(() => null),
      fetchJSON("data/flow_extra.json").catch(() => null),
      fetchJSON("data/flow_thumbs.json").catch(() => null),
      fetchJSON("data/bgm_loops.json").catch(() => null),
      fetchJSON("data/music.json").catch(() => null),
      fetchJSON("data/endings.json").catch(() => null),
      fetchJSON("data/movies.json").catch(() => null),
      fetchJSON("data/flow_marks.json").catch(() => null),
      fetchJSON("media-base.json").catch(() => null),
      i18nRun("readonly", "custom").catch(() => null),
    ]);
    if (mediaBaseData && mediaBaseData.base) {
      mediaBase = String(mediaBaseData.base);
      if (!mediaBase.endsWith("/")) mediaBase += "/";
    }
    // 0034: UI textures live on the media host, not in git. Static markup
    // and CSS cannot call mediaUrl, so re-point them here once the base
    // is known (relative fallback stays when there is no media-base.json)
    if (mediaBase) {
      ["#title-bg-fallback", "#title-lumi", "#title-note-img", "#winpanel-img"].forEach((sel) => {
        const el = document.querySelector(sel);
        if (el && el.getAttribute("src")) el.src = mediaUrl(el.getAttribute("src"));
      });
      const cssMedia = [
        ["#title-logo-slice1, #title-logo-slice2", "data/title/logo.webp"],
        [".title-btn", "data/title/menu.webp"],
        [".cfg-voice-face", "data/conf/conf_faceicon.webp"],
        [".cfg-voice-name", "data/conf/conf_name_en.webp"],
        [".flow-band-bg", "data/flow/flow_sam_bg_middle_fullhd.webp"],
        [".flow-line", "data/flow/flow_line_merge.webp"],
        [".flow-thumb", "data/flow/flow_thumb_all_en.webp"],
        [".flow-cursor, .flow-flash", "data/flow/flow_cur.webp"],
        [".flow-title", "data/flow/flow_phasetitle_en.webp"],
        [".flow-panel", "data/flow/flow_infobase_en.webp"],
      ];
      const st = document.createElement("style");
      st.textContent = cssMedia.map(([sel, url]) => sel + " { background-image: url(" + mediaUrl(url) + "); }").join("\n");
      document.head.appendChild(st);
    }
    flowMarks = flowMarksData;
    manifest = man;
    // custom translation from a previous session (0040); a saved
    // "custom" language with no data behind it falls back to EN
    if (customData && customData.data) { customTexts = customData.data; customName = customData.name || "custom"; }
    if (LANG === "custom" && !customTexts) { LANG = "en"; config.lang = "en"; KP.System.saveConfig(config); applyConfigToEngine(); }
    imagesTable = lowerMap(imgTab);
    grades = grd;
    hazeTable = hazeData;
    bgmLoops = bgmLoopData || {};
    if (musicData) KP.System.setMusicData(musicData);
    if (endingsData) KP.System.setEndingsData(endingsData);
    if (moviesData) KP.System.setMoviesData(moviesData);
    if (grades) renderer.setGrades(grades);
    if (flowData) KP.System.setFlowData(flowData);
    if (galData) KP.System.setGalleryData(galData);
    if (voiceData) KP.System.setVoiceData(voiceData);
    if (sysmesData) KP.System.setSysmesData(sysmesData);
    if (flowExtraData) KP.System.setFlowExtraData(flowExtraData);
    if (flowThumbsData) KP.System.setFlowThumbsData(flowThumbsData);
    $("#hud-build").textContent = BUILD + " · " + rendererKind;
    sysUI = new KP.SystemUI({
      getConfig: () => config,
      saveConfig: () => KP.System.saveConfig(config),
      applyAll: () => applyConfigToEngine(),
      getProgress: () => progress,
      saveProgress: () => saveProgressSoon(),
      isInGame: () => !!game,
      playSys: (n) => playSys(n),
      showDialog: (q) => showDialog(q),
      musicStopped: () => musicStopped(),
      playMusic: (id, repeat) => audio.playBgm(mediaUrl("assets/bgm/" + id + ".ogg"), { volume: 1, loop: bgmLoop(id), repeat: !!repeat }),
      stopMusic: () => audio.stopBgm(0),
      pauseMusic: () => audio.pauseBgm(),
      resumeMusic: (info) => audio.resumeBgm(info),
      bgmPosition: () => audio.bgmPosition(),
      bgmPlaying: () => audio.bgmPlaying(),
      setBgmLoop: (repeat) => audio.setBgmLoop(repeat),
      movieUrlForLang: (url) => movieUrlForLang(url),

      scenePack: async (name) => {
        const meta = manifest.scenes[name];
        if (!meta) return null;
        try { return await fetchJSON(mediaUrl(meta.file)); } catch (e) { return null; }
      },
      currentScene: () => (game ? game.sceneName : null),
      gameVar: (n) => (game ? game.var(n) : 0),
      sceneOrder: () => (manifest && manifest.scene_order) || [],
      currentPack: () => (game ? game.script : null),
      imageUrlForPack: (n, pack) => imageUrlFor(n, pack),
      mediaUrl: (p) => mediaUrl(p),
      toTitle: () => toTitle(),
      idmap: () => (manifest.idmap || {}),
      routeNodes: () => { scanRoute(); return Array.from(routeNodes); },
      routeEdges: () => { scanRoute(); return Array.from(routeEdges); },
      edges: () => (game ? Array.from(game.edges || []) : (progress.edges || [])),
      onOpenChange: (open) => {
        sysOpen = open;
        // SELA Yes opened the save screen: the choice ends when that
        // screen closes OR is replaced (e.g. by the pause menu), exactly
        // like knife's "save screen closed" (states 8 -> 4)
        if (pendingSelaResolve && sysUI.open !== "saveload") {
          const r = pendingSelaResolve;
          pendingSelaResolve = null;
          r(1);
        }
        // knife holds (pauses) the title movie under a submenu
        if (!game && titleVideoEl) {
          if (open) { try { titleVideoEl.pause(); } catch (e) {} }
          else titleVideoEl.play().catch(() => {});
        }
      },
      jumpToScene: (sceneId) => {
        const name = (manifest.idmap || {})[sceneId];
        if (!name) return;
        // knife sub_95800: a flowchart jump sets F026 (scene id) and
        // F110 (node), and rewinds the playthrough: R bits of the nodes
        // and E bits of the edges in every row AFTER the target row clear
        let node = -1;
        if (flowMarks) {
          const hit = (flowMarks.sceneIdNode || []).find((p) => p[0] === sceneId);
          if (hit) node = hit[1];
        }
        if (game && node >= 1) {
          const rows = (typeof S !== "undefined" && S.flowRows) ? (S.flowRows() || []) : [];
          let rowIdx = -1;
          for (let i = 0; i < rows.length; i++) {
            if ((rows[i][1] || []).some((r) => r[0] === node && r[3] >= 0)) { rowIdx = i; break; }
          }
          if (rowIdx >= 0) {
            for (let i = rows.length - 1; i > rowIdx; i--) {
              if ((rows[i][0] || 0) < 1) break;
              for (const r of (rows[i][1] || [])) {
                const nd = Math.abs(r[0] || 0);
                if (nd !== 0 && nd < 576) game.clearPlayBit("R", nd);
                const e = (r[2] || 0) - 564;
                if (e >= 0 && e < 704) game.clearPlayBit("E", e);
              }
            }
          }
        }
        flushLogPage();
        const preset = { F026: sceneId };
        if (node >= 1) preset.F110 = node;
        startScene(name, null, 0, !game, { presetVars: preset, flowReplay: true });
      },
      captureSave: () => captureSave(),
      loadSave: (rec) => loadSave(rec),
      refreshContinue: () => refreshContinue(),
      autosave: () => readAutosave(),
      logPages: () => (Array.isArray(progress.backlog) ? progress.backlog : []),
      logJump: async (page) => {
        if (!page) return;
        const hit = backHist.find((b) => b.scene === page.scene && b.zmPc === page.pc);
        if (hit && hit.snap && await restoreSnap(hit.snap)) return;
        // no snapshot (older session): replay to the line, like CONTINUE
        // without a snapshot — same lossy-vars caveat, the line is exact
        await startScene(page.scene, null, page.pc, false);
      },
      cgImageUrl: (name) => {
        const low = String(name).toLowerCase();
        const pack = game ? game.script : null;
        if (LANG !== "ja") { const u = i18nImage(pack, low); if (u) return mediaUrl(u); }
        if (pack && pack.images && pack.images[low]) return mediaUrl(pack.images[low]);
        return mediaUrl("assets/img/" + low + ".webp");
      },
      playTestVoice: (row) => {
        const name = progress.lastVoice[row];
        if (!name) return;
        const pack = game ? game.script : null;
        const url = mediaUrl((pack ? lookupPackMap(pack, "voices", name) : null) || ("assets/voice/" + String(name).toLowerCase() + ".ogg"));
        audio.playVoice(url, { stopAll: false, speakerRow: row });
      },
      playTestSe: () => {
        // knife conf_test_se (sub_29140): one of 14 test effects at
        // random, at the SE volume, stopping the previous test SE.
        // Channel 20 is outside the scene SE channels (0..19), so the
        // test never cuts scene audio (and scene SEs never cut it).
        // The old code played the current scene's first SE — dead from
        // the title, where game is null and there is no scene at all.
        const TEST_SES = ["MOON_SE02009", "MOON_SE02010", "MOON_SE02011", "MOON_SE02023", "MOON_SE02035", "MOON_SE02037", "MOON_SE02052", "MOON_SE02058", "MOON_SE02062", "MOON_SE02091", "MOON_SE10047", "MOON_SE02097", "MOON_SE02103", "MOON_SE09005"];
        const name = TEST_SES[Math.floor(Math.random() * TEST_SES.length)];
        audio.playSe(mediaUrl("assets/se/" + name + ".ogg"), { channel: 20 });
      },
      onLang: (lang) => applyLanguage(lang),
      getCustomInfo: () => (customName ? { name: customName } : null),
      importCustom: (file) => importCustomTexts(file),
      removeCustom: async () => { await removeCustomTexts(); if (config.lang === "custom") await applyLanguage("en"); },
      exportLang: (lang) => exportLangTexts(lang),
    });
    // deep link to a scene beat, in any of the forms that reach this page:
    // #/00_00/2682, #00_00/2682, ?00_00/2682, ?scene=00_00&pc=2682, or a
    // /00_00/2682 path when the server falls back to index.html
    const parseDeepLink = () => {
      const hash = (location.hash || "").replace(/^#/, "");
      let m = /^\/([\w-]+)\/(\d+)$/.exec(hash) || /^([\w-]+)\/(\d+)$/.exec(hash);
      if (m) return { scene: m[1], pc: +m[2] };
      const q = (location.search || "").replace(/^\?/, "");
      m = /^([\w-]+)\/(\d+)$/.exec(q);
      if (m) return { scene: m[1], pc: +m[2] };
      try {
        const sp = new URLSearchParams(location.search);
        if (sp.get("scene")) return { scene: sp.get("scene"), pc: +(sp.get("pc") || 0) };
      } catch (e) {}
      m = /\/([\w-]+)\/(\d+)\/?$/.exec(location.pathname || "");
      if (m) return { scene: m[1], pc: +m[2] };
      return null;
    };
    const dl = parseDeepLink();
    const startName = manifest.start || "START_SCRIPT";
    // knife title: NEW GAME plays system sound 6, the other entries 1;
    // hovering an entry moves the cursor (sound 0)
    const titleBtns = [["#btn-newgame", 6], ["#btn-continue", 1], ["#btn-load", 1], ["#btn-config", 1], ["#btn-gallery", 1]];
    for (const [sel, snd] of titleBtns) {
      const b = $(sel);
      if (!b) continue;
      b.addEventListener("mouseenter", () => { playSys(0); document.querySelectorAll(".title-btn.pad-focus").forEach((x) => x.classList.remove("pad-focus")); padTitleIdx = -1; });
      b.addEventListener("click", () => playSys(snd), true);
    }
    $("#btn-newgame").onclick = () => {
      // a new playthrough starts with an empty log (unlocks persist)
      progress.backlog = []; pageBuf = []; pageChoices = []; pendingChoice = null;
      saveProgressSoon();
      startScene(startName, null, 0, true);
    };
    $("#btn-continue").onclick = () => continueLoad();
    $("#btn-load").onclick = () => sysUI.openSaveLoad(false);
    $("#btn-config").onclick = () => sysUI.openConfig();
    $("#btn-gallery").onclick = () => sysUI.openGallery();
    // 0042: MENU toggles like the ✕ / right-click cancel: a second press
    // on an open screen steps one level back (from the pause menu that
    // closes it outright), so phones don't need the small ✕. The HUD
    // bar sits below #stage, so MENU stays tappable while a screen is
    // open. Mirrors the contextmenu handler above, dialog included.
    $("#hud-menu").onclick = () => {
      if (dialogActive) { dialogActive.cancel(); return; }
      if (sysUI.open) { sysUI.backOneLevel(); return; }
      if (game) { playSys(3); sysUI.openMenu(); }
    };
    // right-click = the original's pause menu: toggle it over the frozen
    // scene (tick already halts while a system screen is open). From a
    // deeper screen it steps back to the pause menu, like the
    // original's cancel button; on the title it does nothing.
    stageEl.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      // B / Back for the mouse (knife main.rs: right click = cancel()):
      // an open dialog answers No first, then one level back on an
      // open screen; a story movie skips; on the title it does nothing;
      // in game it opens the pause menu (sound 3)
      if (dialogActive) { dialogActive.cancel(); return; }
      if (sysUI.open) { sysUI.backOneLevel(); return; }
      if (!game) return;
      if (storyMoviePlaying && storySkip) { storySkip(); return; }
      playSys(3); sysUI.openMenu();
    });
    // dock station (0014): top bar, shown while the mouse is near the top
    // of the stage. All pointerdowns stop here: the stage advance listener
    // would otherwise fire through the buttons.
    const dockEl = $("#dock"), dockHint = $("#dock-hint"), dockMsg = $("#dock-msg");
    let dockMsgTimer = null;
    function dockFlash(msg) {
      dockMsg.textContent = msg;
      clearTimeout(dockMsgTimer);
      dockMsgTimer = setTimeout(() => { dockMsg.textContent = ""; }, 1600);
    }
    function syncDockStates() {
      $("#dock-auto").classList.toggle("on", autoOn);
      $("#dock-skip").classList.toggle("on", autoSkip);
      $("#dock-ff").classList.toggle("on", ffHeld);
      $("#dock-mute").textContent = audio.muted ? "🔇" : "🔊";
    }
    function showDock() { if (game && !sysOpen) { syncDockStates(); dockEl.classList.add("show"); } }
    function hideDock() { dockEl.classList.remove("show"); dockHint.classList.remove("show"); }
    dockEl.addEventListener("pointerdown", (e) => e.stopPropagation());
    stageEl.addEventListener("mousemove", (e) => {
      if (!game || sysOpen) { hideDock(); return; }
      const r = stageEl.getBoundingClientRect();
      if ((e.clientY - r.top) < 80 * r.height / 1080) showDock(); else hideDock();
    });
    stageEl.addEventListener("touchstart", (e) => {
      if (!game || sysOpen) { hideDock(); return; }
      if (dockEl.contains(e.target)) return;
      const r = stageEl.getBoundingClientRect();
      if ((e.touches[0].clientY - r.top) < 80 * r.height / 1080) showDock(); else hideDock();
    }, { passive: true });
    $("#dock-back").onclick = async () => {
      if (!game || sysOpen) return;
      if (backHist.length < 2) { dockFlash("NO HISTORY"); return; }
      backHist.pop(); // current line
      const t = backHist[backHist.length - 1];
      if (!t || !manifest.scenes[t.scene]) { dockFlash("NO HISTORY"); return; }
      // snapshot restore when we have one: exact stage/vars/audio, no
      // replay (replay picks choice 0, restarts motions, keeps later BGM)
      if (!(t.snap && await restoreSnap(t.snap))) await startScene(t.scene, null, t.zmPc !== undefined ? t.zmPc : t.pc, false);
      autoSkip = false; // never skip away from the line we went back to
    };
    $("#dock-auto").onclick = () => {
      if (!game || sysOpen || game.staffTask) return;
      autoOn = !autoOn; autoTimer = 0;
      $("#hud-auto").textContent = autoOn ? "AUTO" : "";
      syncDockStates();
    };
    $("#dock-skip").onclick = () => {
      if (!game || sysOpen || game.staffTask) return;
      if (autoSkip) { autoSkip = false; syncDockStates(); }
      else if (!config.skipConfirm) { autoSkip = true; syncDockStates(); }
      else showDialog("Skip read text?").then((ok) => { if (ok) autoSkip = true; syncDockStates(); });
    };
    const ffBtn = $("#dock-ff");
    ffBtn.addEventListener("pointerdown", () => { if (!game || sysOpen) return; ffHeld = true; syncDockStates(); });
    addEventListener("pointerup", () => { if (ffHeld) { ffHeld = false; syncDockStates(); } });
    ffBtn.addEventListener("pointerleave", () => { if (ffHeld) { ffHeld = false; syncDockStates(); } });
    ffBtn.addEventListener("mouseenter", () => dockHint.classList.add("show"));
    ffBtn.addEventListener("mouseleave", () => { if (!ffHeld) dockHint.classList.remove("show"); });
    // one quick-save slot (kp-qsave), shared by the dock buttons and the
    // pause menu: the line's snapshot (stage + vars + audio + page),
    // not just its pc, so a load restores BGM, loops, motions and
    // choice outcomes. Without a snapshot, fall back to the ZM index.
    function doQuickSave() {
      if (!game) return "nogame";
      const snap = (lastSnap && lastSnap.scene === game.sceneName) ? lastSnap : null;
      const zp = snap ? snap.zmPc : (lastZm && lastZm.scene === game.sceneName) ? lastZm.zmPc : game.pc;
      try { localStorage.setItem("kp-qsave", JSON.stringify({ scene: game.sceneName, pc: zp, snap: snap || undefined })); return "saved"; }
      catch (e) { return "failed"; }
    }
    async function doQuickLoad() {
      if (!game) return "nogame";
      let qs = null;
      try { qs = JSON.parse(localStorage.getItem("kp-qsave") || "null"); } catch (e) {}
      if (!qs || !qs.scene || !manifest.scenes[qs.scene]) return "nosave";
      if (!(qs.snap && await restoreSnap(qs.snap))) await startScene(qs.scene, null, qs.pc || 0, false);
      autoSkip = false;
      return "loaded";
    }
    $("#dock-qsave").onclick = () => {
      if (!game || sysOpen) return;
      dockFlash(doQuickSave() === "saved" ? "Q.SAVED" : "SAVE FAILED");
    };
    $("#dock-qload").onclick = async () => {
      if (!game || sysOpen) return;
      dockFlash(await doQuickLoad() === "loaded" ? "Q.LOADED" : "NO Q.SAVE");
    };
    $("#dock-mute").onclick = () => { audio.setMuted(!audio.muted); syncDockStates(); };
    addEventListener("keydown", (e) => {
      if (e.repeat) return;
      try { if (audio.ctx && audio.ctx.state === "suspended") audio.ctx.resume(); } catch (e) {}
      const k = config.keys;
      if (e.code === k.menu) {
        // menu key: an open dialog answers No first, then an open
        // screen answers with one-level cancel, a story movie skips
        // (knife: B / Plus), a closed game opens the pause menu (3)
        if (dialogActive) { dialogActive.cancel(); return; }
        if (sysUI.open) { sysUI.backOneLevel(); return; }
        if (storyMoviePlaying && storySkip) { storySkip(); return; }
        if (game) { playSys(3); sysUI.openMenu(); }
        return;
      }
      // a styled dialog is modal: only its own arrows / Enter answer,
      // ahead of the sys-screen nav branches (the gallery has nav items)
      if (dialogActive && choiceNav) {
        if (e.code === "ArrowUp") { e.preventDefault(); choiceNav.move(-1); return; }
        if (e.code === "ArrowDown") { e.preventDefault(); choiceNav.move(1); return; }
        if (e.code === "ArrowLeft") { e.preventDefault(); choiceNav.side(false); return; }
        if (e.code === "ArrowRight") { e.preventDefault(); choiceNav.side(true); return; }
        if (e.code === "Enter") { e.preventDefault(); choiceNav.pick(); return; }
        return;
      }
      // backlog (knife sub_28A90): up = older page, down = newer, left =
      // oldest, right = newest, Enter = quick jump, X = close
      if (sysOpen && sysUI.open === "log") {
        if (e.code === "ArrowUp") { e.preventDefault(); sysUI.logMove(1); return; }
        if (e.code === "ArrowDown") { e.preventDefault(); sysUI.logMove(-1); return; }
        if (e.code === "ArrowLeft") { e.preventDefault(); sysUI.logOldest(); return; }
        if (e.code === "ArrowRight") { e.preventDefault(); sysUI.logNewest(); return; }
        if (e.code === "Enter") { e.preventDefault(); sysUI.logJump(); return; }
        if (e.code === "KeyX") { e.preventDefault(); playSys(2); sysUI.close(); return; }
      }
      // save/load list: arrows move the cursor, Enter confirms, X deletes
      if (sysOpen && sysUI.open === "saveload") {
        if (e.code === "ArrowUp") { e.preventDefault(); sysUI.slMove(-1); return; }
        if (e.code === "ArrowDown") { e.preventDefault(); sysUI.slMove(1); return; }
        if (e.code === "Enter") { e.preventDefault(); sysUI.slActivateCursor(); return; }
        if (e.code === "KeyX") { e.preventDefault(); sysUI.slDeleteCursor(); return; }
      }
      // arrow-key navigation + Enter inside the flowchart chart
      if (sysOpen && sysUI.open === "flow") {
        if (e.code === "ArrowLeft") { e.preventDefault(); sysUI.flowMove(-1, 0); return; }
        if (e.code === "ArrowRight") { e.preventDefault(); sysUI.flowMove(1, 0); return; }
        if (e.code === "ArrowUp") { e.preventDefault(); sysUI.flowMove(0, -1); return; }
        if (e.code === "ArrowDown") { e.preventDefault(); sysUI.flowMove(0, 1); return; }
        if (e.code === "Enter") { e.preventDefault(); sysUI.flowActivate(); return; }
      }
      // arrow-key navigation + Enter inside the left-column menus
      if (sysOpen && sysUI.navActive()) {
        if (e.code === "ArrowUp") { e.preventDefault(); sysUI.navMove(-1); return; }
        if (e.code === "ArrowDown") { e.preventDefault(); sysUI.navMove(1); return; }
        if (e.code === "Enter") { e.preventDefault(); sysUI.navActivate(); return; }
      }
      // choice / dialog keyboard nav (knife choice_move / choice_side)
      if (choiceNav) {
        if (e.code === "ArrowUp") { e.preventDefault(); choiceNav.move(-1); return; }
        if (e.code === "ArrowDown") { e.preventDefault(); choiceNav.move(1); return; }
        if (choiceNav.kind === "dialog") {
          if (e.code === "ArrowLeft") { e.preventDefault(); choiceNav.side(false); return; }
          if (e.code === "ArrowRight") { e.preventDefault(); choiceNav.side(true); return; }
        }
        if (e.code === "Enter") { e.preventDefault(); choiceNav.pick(); return; }
      }
      if (sysOpen || !game) return;
      if (e.code === "KeyX") { e.preventDefault(); sysUI.openLog(); return; }
      if (e.code === k.auto) {
        e.preventDefault();
        if (game.staffTask) return;
        autoOn = !autoOn; autoTimer = 0;
        $("#hud-auto").textContent = autoOn ? "AUTO" : "";
        return;
      }
      if (e.code === k.skip) { if (!game.staffTask) skipHeld = true; return; }
      if (e.code === k.advance || e.code === "Enter") {
        e.preventDefault();
        userAdvance();
      }
    });
    addEventListener("keyup", (e) => { if (e.code === config.keys.skip) skipHeld = false; });
    // ---- controller (knife ui/pad.rs) ----
    function padTitleBtns() { return [...document.querySelectorAll(".title-btn")].filter((b) => b.offsetParent !== null); }
    function padTitleMove(d) {
      const btns = padTitleBtns();
      if (!btns.length) return;
      const n = btns.length;
      const old = padTitleIdx;
      padTitleIdx = padTitleIdx < 0 ? (d > 0 ? 0 : n - 1) : ((padTitleIdx + d + n) % n);
      btns.forEach((b, i) => b.classList.toggle("pad-focus", i === padTitleIdx));
      if (padTitleIdx !== old) playSys(0);
    }
    function padTitleActivate() {
      const btns = padTitleBtns();
      if (!btns.length) return;
      if (padTitleIdx < 0) padTitleIdx = 0;
      btns[padTitleIdx].click();
    }
    function panelFocus() {
      padPanelBtns.forEach((sel, i) => { const b = $(sel); if (b) b.classList.toggle("pad-focus", padPanelOpen && i === padPanelIdx); });
    }
    function panelOpen() {
      padPanelOpen = true;
      padPanelIdx = Math.max(0, Math.min(padPanelBtns.length - 1, padPanelLast));
      document.querySelector("#dock").classList.add("pad-open");
      panelFocus();
    }
    function panelClose() {
      if (!padPanelOpen) return;
      padPanelOpen = false;
      // a held fast-forward ends with the panel (knife: ZR is story-only)
      if (ffHeld) { ffHeld = false; syncDockStates(); }
      document.querySelector("#dock").classList.remove("pad-open");
      panelFocus();
    }
    function panelMove(d, repeat) {
      const n = padPanelBtns.length;
      let next = padPanelIdx + d;
      if (next < 0 || next >= n) {
        if (repeat) return;
        next = (next + n) % n;
      }
      if (next !== padPanelIdx) playSys(0);
      padPanelIdx = next; padPanelLast = next;
      panelFocus();
    }
    function panelActivate() {
      const b = $(padPanelBtns[padPanelIdx]);
      if (!b) return;
      if (padPanelIdx === 2) {
        // fast-forward is a hold button: A toggles the hold
        if (ffHeld) { ffHeld = false; syncDockStates(); }
        else b.dispatchEvent(new PointerEvent("pointerdown"));
        return;
      }
      b.click();
    }
    function onPadEvent(p, pressed, repeat) {
      // ZR release always ends fast-forward, wherever it happens
      if (p === "ZR" && !pressed) { ffHeld = false; syncDockStates(); return; }
      if (!pressed) return;
      // boot video: any button is the click that unmutes / finishes it
      if (bootVideoWrapEl.style.display !== "none") { bootVideoEl.dispatchEvent(new PointerEvent("pointerdown")); return; }
      // intro notice / caution: any button is the skip input
      if (introEl.style.display !== "none") { window.dispatchEvent(new PointerEvent("pointerdown")); return; }
      // PRESS ANY BUTTON title: any button presses it
      if (titleEl.classList.contains("press")) { titleEl.dispatchEvent(new PointerEvent("pointerdown")); return; }
      // dialogs (SELA / SELS / styled) answer before title and sys input
      if (choiceNav && choiceNav.kind === "dialog") {
        if (p === "Up" || p === "Down") choiceNav.move(p === "Down" ? 1 : -1);
        else if (p === "Left") choiceNav.side(false);
        else if (p === "Right") choiceNav.side(true);
        else if (p === "A") choiceNav.pick();
        else if (p === "B") choiceNav.cancel();
        return;
      }
      // title menu (only when no system screen sits above it: the gallery
      // and config open over the title, and their pads must win)
      if (titleEl.style.display !== "none" && !sysOpen) {
        if (p === "Up") padTitleMove(-1);
        else if (p === "Down") padTitleMove(1);
        else if (p === "A") padTitleActivate();
        return;
      }
      // CG viewer above the gallery grid
      if (sysUI.cgViewerEl) {
        if (p === "B") sysUI.backOneLevel();
        else if (p === "Minus") { playSys(0); sysUI.cgToggleFill(); }
        else if (p === "R3") { playSys(0); sysUI.cgViewReset(); }
        else if (p === "LLeft" || p === "Left") sysUI.cgViewPan(-24, 0);
        else if (p === "LRight" || p === "Right") sysUI.cgViewPan(24, 0);
        else if (p === "LUp") sysUI.cgViewPan(0, -24);
        else if (p === "LDown") sysUI.cgViewPan(0, 24);
        else if (p === "Up") sysUI.cgViewZoom(1.15);
        else if (p === "Down") sysUI.cgViewZoom(1 / 1.15);
        return;
      }
      // system screens
      if (sysUI.open) {
        const o = sysUI.open;
        if (p === "B") { sysUI.backOneLevel(); return; }
        if (p === "Y" && o === "menu") { sysUI.backOneLevel(); return; }
        if (p === "ZL" && (o === "menu" || o === "log")) { sysUI.backOneLevel(); return; }
        if (p === "X" && o === "saveload") { sysUI.slDeleteCursor(); return; }
        if (p === "X" && o === "log") { sysUI.backOneLevel(); return; }
        if (p === "ZR" && o === "log") { sysUI.logOldest(); return; }
        if (p === "L" || p === "R") {
          const d = p === "L" ? -1 : 1;
          if (o === "flow") sysUI.flowMove(d, 0);
          else if (o === "log") { if (d < 0) sysUI.logOldest(); else sysUI.logNewest(); }
          else if (o === "saveload") { if (d < 0) sysUI.slFirst(); else sysUI.slLast(); }
          else if (o === "config") {
            const tabs = [...document.querySelectorAll(".cfg-tabs button")];
            const cur = tabs.findIndex((t) => t.classList.contains("on"));
            if (tabs.length && cur >= 0) tabs[(cur + d + tabs.length) % tabs.length].click();
          }
          else if (o === "gallery") {
            if (sysUI.galSection === "music") { if (d < 0) sysUI.musicPrev(); else sysUI.musicNext(); }
            else sysUI.navMove(d);
          }
          return;
        }
        if (o === "log") {
          if (p === "Up") sysUI.logMove(1);
          else if (p === "Down") sysUI.logMove(-1);
          else if (p === "Left") sysUI.logOldest();
          else if (p === "Right") sysUI.logNewest();
          else if (p === "A") sysUI.logJump();
          return;
        }
        if (o === "saveload") {
          if (p === "Up" || p === "LUp") sysUI.slMove(-1);
          else if (p === "Down" || p === "LDown") sysUI.slMove(1);
          else if (p === "A") sysUI.slActivateCursor();
          return;
        }
        if (o === "flow") {
          if (p === "Up") sysUI.flowMove(0, -1);
          else if (p === "Down") sysUI.flowMove(0, 1);
          else if (p === "Left") sysUI.flowMove(-1, 0);
          else if (p === "Right") sysUI.flowMove(1, 0);
          else if (p === "LUp") sysUI.flowScrollBy(-120);
          else if (p === "LDown") sysUI.flowScrollBy(120);
          else if (p === "A") sysUI.flowActivate();
          return;
        }
        if (o === "gallery") {
          if (p === "Up" || p === "Down") {
            if (sysUI.galContentIdx >= 0) sysUI.galContentMove(p === "Down" ? 1 : -1, 0);
            else sysUI.navMove(p === "Down" ? 1 : -1);
          } else if (p === "Left" || p === "Right") {
            if (sysUI.galContentIdx >= 0) sysUI.galContentMove(0, p === "Right" ? 1 : -1);
          } else if (p === "A") {
            if (sysUI.galContentIdx >= 0) sysUI.galContentActivate();
            else if (sysUI.galContentEls().els.length) sysUI.galContentFocus(0);
            else sysUI.navActivate();
          }
          return;
        }
        // menu / config: the left nav column
        if (sysUI.navActive()) {
          if (p === "Up") sysUI.navMove(-1);
          else if (p === "Down") sysUI.navMove(1);
          else if (p === "A") sysUI.navActivate();
        }
        return;
      }
      // story movie: B / Plus skip, A advances (same as clicking it)
      if (storyMoviePlaying) {
        if ((p === "B" || p === "Plus" || p === "A") && storySkip) storySkip();
        return;
      }
      // page choice
      if (choiceNav && choiceNav.kind === "page") {
        if (p === "Up") choiceNav.move(-1);
        else if (p === "Down") choiceNav.move(1);
        else if (p === "A") choiceNav.pick();
        else if (p === "Y") { playSys(3); sysUI.openMenu(); }
        return;
      }
      // staff roll: only A advances, ZR fast-forwards (knife task lock)
      if (game && game.staffTask) {
        if (p === "ZR") { ffHeld = true; syncDockStates(); return; }
        if (p === "A") userAdvance();
        return;
      }
      // mode panel open
      if (padPanelOpen) {
        if (p === "Left") panelMove(-1, repeat);
        else if (p === "Right") panelMove(1, repeat);
        else if (p === "A") panelActivate();
        else if (p === "Down" || p === "B" || p === "Y") panelClose();
        return;
      }
      // story (knife pad_story)
      if (!game) return;
      if (p === "ZR") { ffHeld = true; syncDockStates(); return; }
      if (p === "A" || p === "Down") userAdvance();
      else if (p === "B") {
        if (autoSkip) { autoSkip = false; syncDockStates(); }
        else if (!textWin.visible) textWin.show();
        else textWin.hide();
      }
      else if (p === "Y") { autoSkip = false; syncDockStates(); textWin.show(); playSys(3); sysUI.openMenu(); }
      else if (p === "X") { if ((progress.backlog || []).length) { playSys(3); sysUI.openLog(); } }
      else if (p === "L") { const b = $("#dock-auto"); if (b) b.click(); }
      else if (p === "R") { if (textWin.visible) { const b = $("#dock-skip"); if (b) b.click(); } }
      else if (p === "Up") { if (textWin.visible) panelOpen(); }
      else if (p === "ZL") { const b = $("#dock-back"); if (b) b.click(); }
    }
    const padCtl = new KP.Pad();
    padCtl.start(onPadEvent);
    KP.__pad = padCtl; // test hook for the CDP harness
    // knife sub_B5650 boot_flag: the prologue (node 485) decides the boot.
    // Unreached -> the prologue scene (id 260) starts right away and its
    // end returns to a PRESS ANY BUTTON title; reached -> TM_CI + notice
    // -> the title menu. Captured at launch: playing the prologue sets
    // 485, but the press title after it still applies this launch.
    bootFlag = !(progress.nodesVisited || []).includes(485);
    for (const src of ["data/parts/parts_2_0.webp", "data/caution/caution_en.webp", "data/caution/caution1_en.webp"]) { const im = new Image(); im.src = mediaUrl(src); }
    if (dl && manifest.scenes[dl.scene]) startScene(dl.scene, null, dl.pc);
    else if (bootFlag) {
      const p = manifest.idmap && manifest.idmap[260];
      if (p && manifest.scenes[p]) startScene(p);
      else { await playBootVideo(); showTitle(); }
    } else { await playBootVideo(); await showNotice(); showTitle(); }
    // autosave shares the snapshot: CONTINUE restores the exact line
    // state (stage/vars/audio/page), not a replay approximation
    setInterval(() => { syncNodes(); saveProgressSoon(); writeAutosave(); }, 5000);
  }
  boot().catch((e) => {
    document.body.innerHTML = "<pre>boot failed: " + e.message + "</pre>";
  });
})();
