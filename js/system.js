"use strict";
/* system.js — knife's system screens for the web port, web-native DOM edition:
   CONFIG (system / sound / controls tabs, knife's full option set from ui.rs
   conf_layout + conf_slider + the radio/toggle meanings), the flowchart
   (flow_table.rs rows, RDST/RDED completion from the VM's node sets) and
   the CG gallery (gallery_table.rs groups + knife gallery.rs unlock rules:
   group_allowed by RDST node, entry seen by image/alias, RDED 557 unlocks
   all). Labels are plain text: knife's own labels are baked UI textures
   (CONF_PARTS / SYSMES sheets) that dist does not carry, so the port uses
   English labels with the same meanings. The music gallery is not ported
   (the request named the CG gallery); save/load screens are not ported
   either (the port autosaves + CONTINUE already covers them). */
var KP = globalThis.KP || (globalThis.KP = {});
(function () {
  // ---------- config ----------
  function defaultConfig() {
    return {
      lang: "en",
      // knife's defaults, as in the original's Config: 35 ms unseen,
      // 15 ms seen (sliders offer the full 0..250 range).
      textMs: [35, 15],
      autoPageMs: 3000, autoClickMs: 2200,
      pageAtOnce: [false, false],
      skipConfirm: false, autoSkipRead: false, skipUnread: false,
      textFadeIn: true, textFadeOut: true,
      bgm: 40, se: 40, sysSe: 10,
      muteBgm: false, muteSe: false, muteSys: false,
      voiceOn: true, voiceStop: true,
      charVoice: new Array(19).fill(50),
      charMute: new Array(19).fill(false),
      keys: { advance: "Space", auto: "KeyA", skip: "ControlLeft", menu: "Escape" },
    };
  }
  function loadConfig() {
    try {
      const raw = JSON.parse(localStorage.getItem("kp-config") || "null");
      if (!raw || typeof raw !== "object") return defaultConfig();
      const d = defaultConfig();
      for (const k of Object.keys(d)) {
        if (raw[k] === undefined) continue;
        if (Array.isArray(d[k])) { if (Array.isArray(raw[k]) && raw[k].length === d[k].length) d[k] = raw[k].slice(); }
        else if (typeof d[k] === "object") { if (raw[k] && typeof raw[k] === "object") Object.assign(d[k], raw[k]); }
        else d[k] = raw[k];
      }
      return d;
    } catch (e) { return defaultConfig(); }
  }
  function saveConfig(cfg) {
    try { localStorage.setItem("kp-config", JSON.stringify(cfg)); } catch (e) {}
  }
  function applyAudio(cfg, audio) {
    if (!audio) return;
    audio.cfg.bgm = cfg.bgm / 100;
    audio.cfg.se = cfg.se / 100;
    audio.cfg.sys = cfg.sysSe / 100;
    audio.cfg.voiceOn = !!cfg.voiceOn;
    audio.cfg.muteBgm = !!cfg.muteBgm;
    audio.cfg.muteSe = !!cfg.muteSe;
    audio.cfg.muteSys = !!cfg.muteSys;
    for (let i = 0; i < 19; i++) audio.cfg.charVoice[i] = (cfg.charVoice[i] || 0) / 100;
    let m = 0;
    for (let i = 0; i < 19; i++) if (cfg.charMute[i]) m |= 1 << i;
    audio.cfg.charMute = m;
  }

  // ---------- progress ----------
  function defaultProgress() {
    return { seenLines: [], seenImages: [], nodesVisited: [], nodesDone: [], lastVoice: {}, voiceRowsShown: [], backlog: [],
      heardBgms: [], movieFlags: 0, edges: [], routeEdges: [] };
  }
  function loadProgress() {
    try {
      const raw = JSON.parse(localStorage.getItem("kp-progress") || "null");
      if (!raw || typeof raw !== "object") return defaultProgress();
      const d = defaultProgress();
      for (const k of Object.keys(d)) if (raw[k] !== undefined) d[k] = raw[k];
      return d;
    } catch (e) { return defaultProgress(); }
  }
  function saveProgress(p) {
    try { localStorage.setItem("kp-progress", JSON.stringify(p)); } catch (e) {}
  }

  // ---------- manual save slots (IndexedDB; knife: 140 slots, 0..99 in
  // the list, 100..138 auto, 139 quick — the port keeps manual 0..99
  // here, the autosave in kp-save, the quick save in kp-qsave) ----------
  const SAVE_DB = "kp-saves", SAVE_STORE = "slots";
  let saveDbPromise = null;
  function openSaveDb() {
    if (saveDbPromise) return saveDbPromise;
    saveDbPromise = new Promise((res, rej) => {
      try {
        const req = indexedDB.open(SAVE_DB, 1);
        req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(SAVE_STORE)) req.result.createObjectStore(SAVE_STORE, { keyPath: "id" }); };
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      } catch (e) { rej(e); }
    });
    return saveDbPromise;
  }
  function idbRun(mode, fn) {
    return openSaveDb().then((db) => new Promise((res, rej) => {
      let out;
      const tx = db.transaction(SAVE_STORE, mode);
      tx.oncomplete = () => res(out);
      tx.onerror = () => rej(tx.error);
      try { const r = fn(tx.objectStore(SAVE_STORE)); if (r && r.onsuccess !== undefined) r.onsuccess = () => { out = r.result; }; else out = r; }
      catch (e) { rej(e); }
    }));
  }
  function listSlots() { return idbRun("readonly", (s) => s.getAll()).then((a) => (a || []).sort((x, y) => x.id - y.id)); }
  function putSlot(slot) { return idbRun("readwrite", (s) => s.put(slot)); }
  function deleteSlot(id) { return idbRun("readwrite", (s) => s.delete(id)); }
  function clearSlots() { return idbRun("readwrite", (s) => s.clear()); }
  function readJson(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; } }
  // one-file export: progress (unlocks, backlog, nodes) + quick + auto +
  // manual slots. Config is settings, not saves, and stays out.
  function buildExport() {
    return listSlots().then((slots) => ({
      app: "knife-port-saves", version: 1, exportedAt: new Date().toISOString(),
      progress: readJson("kp-progress"), qsave: readJson("kp-qsave"), autosave: readJson("kp-save"), slots,
    }));
  }
  function applyImport(data) {
    if (!data || data.app !== "knife-port-saves" || data.version !== 1) throw new Error("not a knife-port save file");
    const counts = { progress: false, qsave: false, autosave: false, slots: 0 };
    if (data.progress) { localStorage.setItem("kp-progress", JSON.stringify(data.progress)); counts.progress = true; }
    if (data.qsave !== undefined) { localStorage.setItem("kp-qsave", JSON.stringify(data.qsave)); counts.qsave = true; }
    if (data.autosave !== undefined) { localStorage.setItem("kp-save", JSON.stringify(data.autosave)); counts.autosave = true; }
    if (!Array.isArray(data.slots)) return Promise.resolve(counts);
    return clearSlots().then(async () => {
      for (const s of data.slots) await putSlot(s);
      counts.slots = data.slots.length;
      return counts;
    });
  }

  // ---------- voice maps (knife game.rs VOICE_SPEAKERS / SPEAKER_ROW_BIT) ----------
  let VOICE = null; // {speakers, rowBits, rowWords} from data/voice_rows.json
  function setVoiceData(d) { VOICE = d; }
  function voiceSpeaker(name) {
    if (!VOICE || !name) return 0;
    const p = String(name).slice(0, 3).toUpperCase();
    for (const [prefix, speaker] of VOICE.speakers) if (prefix === p) return speaker;
    return 0;
  }
  function voiceRow(name) {
    if (!VOICE) return 18;
    const bit = VOICE.rowBits[voiceSpeaker(name)] || 0;
    let r = 0;
    while ((1 << r) < bit && r < 31) r++;
    return r >= 19 ? 18 : r;
  }
  function rowPrefixes(row) {
    if (!VOICE) return [];
    const out = [];
    for (const [prefix, speaker] of VOICE.speakers) {
      const bit = VOICE.rowBits[speaker] || 0;
      let r = 0;
      while ((1 << r) < bit && r < 31) r++;
      if (r === row) out.push(prefix);
    }
    return out;
  }
  // knife ui.rs refresh_voice_rows: row shown when its progress word has bit 4.
  function rowShown(progress, row) {
    return !!(progress.voiceRowsShown && progress.voiceRowsShown[row]);
  }
  function noteVoice(progress, name) {
    if (!name) return;
    const row = voiceRow(name);
    progress.lastVoice[row] = name;
    if (!progress.voiceRowsShown) progress.voiceRowsShown = [];
    progress.voiceRowsShown[row] = true;
  }

  // ---------- gallery logic (knife gallery.rs, verbatim rules) ----------
  let GALLERY = null; // {groups, overseas, aliases, origins, strips}
  function setGalleryData(d) { GALLERY = d; }
  function galleryGroups() {
    if (!GALLERY) return [];
    const groups = GALLERY.groups.slice();
    for (const [gi, entries] of Object.entries(GALLERY.overseas || {})) {
      if (groups[+gi]) groups[+gi] = { cond: groups[+gi].cond, entries };
    }
    return groups;
  }
  function groupAllowed(cond, node) {
    const n = { 1: 2, 2: 3, 3: 4, 4: 5, 5: 383, 6: 208, 7: 7, 8: 8, 9: 9, 10: 226, 11: 10, 12: 11, 13: 12, 14: 13, 16: 14, 17: 297, 18: 300, 19: 309 }[cond];
    if (cond === 15) return node(275) || node(276);
    if (n === undefined) return true;
    return node(n);
  }
  function imageSeen(seenLower, name) {
    const low = String(name).toLowerCase();
    if (seenLower.has(low)) return true;
    const aliases = (GALLERY && GALLERY.aliases) || {};
    // alias keys are uppercase IMG names; match case-insensitively
    let al = null;
    for (const k of Object.keys(aliases)) if (k.toLowerCase() === low) { al = aliases[k]; break; }
    if (!al) return false;
    return al.some((a) => {
      const la = a.toLowerCase();
      if (seenLower.has(la)) return true;
      if (a.length >= 6 && !a.startsWith("IMG")) {
        for (const c of ["a", "l", "m", "s"]) {
          const v = la.slice(0, 4) + c + la.slice(5);
          if (seenLower.has(v)) return true;
        }
      }
      return false;
    });
  }
  // unlocked entry indices per group (knife gallery.rs unlocked)
  function galleryUnlocked(progress, nodesDone) {
    const seenLower = new Set((progress.seenImages || []).map((s) => String(s).toLowerCase()));
    const node = (n) => (progress.nodesVisited || []).includes(n);
    const all = (nodesDone || []).includes(557);
    return galleryGroups().map((g) => {
      if (!groupAllowed(g.cond, node)) return [];
      return g.entries.map((e, i) => i).filter((i) => all || imageSeen(seenLower, g.entries[i].name));
    });
  }
  function galleryEntryRect(name) {
    const o = (GALLERY && GALLERY.origins) || {};
    for (const k of Object.keys(o)) if (k.toLowerCase() === String(name).toLowerCase()) return o[k];
    return [0, 0];
  }
  function isStrip(name) {
    return !!((GALLERY && GALLERY.strips) || []).find((s) => s.toLowerCase() === String(name).toLowerCase());
  }
  // language band of a strip image: bands stack vertically in ja/en/zc/zt order
  function stripBand(lang) { return { ja: 0, en: 1, zc: 2, zt: 3 }[lang] ?? 1; }

  // ---------- flowchart logic ----------
  let FLOW = null; // {rows}
  // ---------- music / movie / ending galleries (knife gallery.rs) ----------
  let MUSIC = null, ENDINGS = null, MOVIES = null;
  function setMusicData(d) { MUSIC = d; }
  function musicRows() { return Array.isArray(MUSIC) ? MUSIC : []; }
  // knife music_unlocked: heard bgm, or a heard alt, or the movie-flag /
  // title-node specials (80 <- movie 5 viewed, 124 <- movie 6 viewed,
  // 82 <- node 560, 126 <- node 562). game.nodes = RDST = nodesVisited.
  function musicUnlocked(progress) {
    const heard = new Set(progress.heardBgms || []);
    const nodes = new Set(progress.nodesVisited || []);
    const mf = progress.movieFlags || 0;
    return musicRows().map((r) =>
      heard.has(r.bgm) || (r.alts || []).some((a) => a > 0 && heard.has(a)) ||
      (r.bgm === 80 && (mf & 1) !== 0) || (r.bgm === 124 && (mf & 2) !== 0) ||
      (r.bgm === 82 && nodes.has(560)) || (r.bgm === 126 && nodes.has(562)));
  }
  function setEndingsData(d) { ENDINGS = d; }
  // overseas rows 0..23 via EN_ENDING_DONE (RDED = nodesDone, either
  // node); row 24 (QA_25) iff all 24 reached. Rows carry [node, scene,
  // confirm SYSMES]; the QA record is endings[24].
  function endingRows() {
    if (!ENDINGS || !Array.isArray(ENDINGS.endings)) return [];
    return ENDINGS.endings.slice(0, 24);
  }
  function endingQa() { return (ENDINGS && Array.isArray(ENDINGS.endings)) ? ENDINGS.endings[24] : null; }
  function endingOk(progress, i) {
    if (!ENDINGS || !Array.isArray(ENDINGS.enDone)) return false;
    if (i === 24) return ENDINGS.enDone.every((_, j) => endingOk(progress, j));
    const pair = ENDINGS.enDone[i];
    if (!pair) return false;
    const done = new Set(progress.nodesDone || []);
    return done.has(pair[0]) || (pair[1] >= 0 && done.has(pair[1]));
  }
  function setMoviesData(d) { MOVIES = d; }
  function movieRows() { return Array.isArray(MOVIES) ? MOVIES : []; }
  // knife movie_list: the prologue always, each opening once its
  // in-game viewing flag is set (movie 5 -> bit 0, movie 6 -> bit 1).
  function movieUnlocked(progress) {
    const mf = progress.movieFlags || 0;
    return movieRows().map((m) => m.flag === null || m.flag === undefined || (mf & (1 << m.flag)) !== 0);
  }
  function setFlowData(d) { FLOW = d; }
  function flowRows() { return FLOW ? FLOW.rows : null; }
  let SYSMES = null; // {ja,en,zc,zt: [strings]} (w_allui SYSMES_TEXT_ML)
  function setSysmesData(d) { SYSMES = d; }
  function sysmesText(i, lang) {
    if (i === undefined || i === null || i < 0) return "";
    const arr = SYSMES ? (SYSMES[lang] || SYSMES.en) : null;
    return (arr && arr[i] !== undefined) ? arr[i] : "";
  }
  let FLOW_EXTRA = null; // {lines, titles_en} (knife flow_table.rs)
  function setFlowExtraData(d) { FLOW_EXTRA = d; }
  let FLOW_THUMBS = null; // [stem] by preview index (w_allpaccg GALLERY_FC_TH)
  function setFlowThumbsData(d) { FLOW_THUMBS = d; }
  function flowThumbStem(preview) {
    if (!FLOW_THUMBS || preview === undefined || preview === null || preview < 0) return null;
    return FLOW_THUMBS[preview] || null;
  }
  function flowNodes() {
    if (!FLOW) return [];
    const out = [];
    FLOW.rows.forEach(([phase, recs], rowIdx) => {
      for (const r of recs) out.push({ phase, rowIdx, node: r[0], conn: r[1], edge: r[2], sceneId: r[3], title: r[4], thumb: r[5], preview: r[6], name: r[7], desc: r[8] });
    });
    return out;
  }
  function nodeEntry(n) {
    if (!FLOW) return null;
    for (let i = 0; i < FLOW.rows.length; i++) {
      const recs = FLOW.rows[i][1];
      for (const r of recs) if (r[0] === n && r[3] >= 0) return { row: i, sceneId: r[3] };
    }
    return null;
  }

  KP.System = {
    defaultConfig, loadConfig, saveConfig, applyAudio,
    defaultProgress, loadProgress, saveProgress,
    listSlots, putSlot, deleteSlot, clearSlots, buildExport, applyImport,
    setVoiceData, voiceSpeaker, voiceRow, rowPrefixes, rowShown, noteVoice,
    setGalleryData, galleryGroups, groupAllowed, imageSeen, galleryUnlocked, galleryEntryRect, isStrip, stripBand,
    setMusicData, musicRows, musicUnlocked, setEndingsData, endingRows, endingQa, endingOk,
    setMoviesData, movieRows, movieUnlocked,
    setFlowData, flowRows, flowNodes, nodeEntry,
    setSysmesData, sysmesText, setFlowExtraData, flowExtra: () => FLOW_EXTRA,
    setFlowThumbsData, flowThumbStem,
  };
})();
