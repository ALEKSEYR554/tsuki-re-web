"use strict";
/* audio.js — knife-audio's volume curves, verbatim (sub_CA0 table flt_3355F0,
   BGM quadratic Bezier through 0.77, sub_FF4B8), over a WebAudio graph.
   BGM/SE/voice sources come from the dist asset pipeline (opus files); a
   missing file is silent, never fatal — the port must keep playing. */
var KP = globalThis.KP || (globalThis.KP = {});
(function () {
  const VOLUME_CURVE = [
    0.0, 0.001442, 0.002885, 0.004327, 0.005769, 0.007212, 0.008654, 0.010096, 0.011538, 0.016667, 0.021795,
    0.026923, 0.030769, 0.034615, 0.038462, 0.042308, 0.046154, 0.05, 0.055769, 0.061538, 0.069231, 0.076923,
    0.082692, 0.088462, 0.094231, 0.1, 0.105769, 0.111538, 0.119231, 0.126923, 0.132692, 0.138462, 0.15, 0.155769,
    0.161538, 0.176923, 0.182692, 0.188462, 0.2, 0.205769, 0.211538, 0.226923, 0.238462, 0.244231, 0.25, 0.261538,
    0.276923, 0.288462, 0.294231, 0.3, 0.311538, 0.326923, 0.338462, 0.35, 0.361538, 0.376923, 0.382692, 0.388462,
    0.4, 0.411538, 0.426923, 0.438462, 0.45, 0.461538, 0.476923, 0.488462, 0.5, 0.511538, 0.526923, 0.538462, 0.55,
    0.576923, 0.588462, 0.6, 0.611538, 0.625, 0.638462, 0.65, 0.661538, 0.676923, 0.688462, 0.711538, 0.725,
    0.738462, 0.75, 0.776923, 0.788462, 0.8, 0.811538, 0.826923, 0.85, 0.863462, 0.876923, 0.9, 0.913462, 0.926923,
    0.938462, 0.961538, 0.976923, 0.988462,
  ];
  function volumeCurve(v) {
    if (v < 0.0014423) return v;
    const x = v * 100, i = Math.trunc(x);
    if (i === 0) return 0;
    if (i >= 1 && i <= 98) return VOLUME_CURVE[i] + (x - i) * (VOLUME_CURVE[i + 1] - VOLUME_CURVE[i]);
    return 1;
  }
  const Curve = {
    linear: (v) => v,
    se: (v) => volumeCurve(v),
    bgm: (v) => {
      const b = (v > 0 && v < 1) ? v * v + 2 * v * (1 - v) * 0.77 : v;
      return volumeCurve(b);
    },
  };
  // Pan law (knife-audio): centre 1/sqrt(2), stereo streams 0.68, stereo waves full
  function panGains(pan) { // pan -1..1
    const a = (pan + 1) * Math.PI / 4;
    return [Math.cos(a), Math.sin(a)];
  }
  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.muted = false; // dock mute: applied to the master gain, live + future
      this.bgm = null; this.bgmGain = null; this.bgmUrl = null;
      this.bgmGen = 0; // BGM generation: every stopBgm invalidates a
      // playBgm still awaiting its load (title -> new game race).
      this.se = new Map();
      this.voices = [null, null];
      this.cfg = { bgm: 0.4, se: 0.4, voice: 1.0, voiceOn: true, charVoice: new Array(19).fill(1), charMute: 0, sys: 0.1, muteBgm: false, muteSe: false, muteSys: false };
      this.assetBase = "";
    }
    ensure() {
      if (this.ctx) return true;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 1;
        this.master.connect(this.ctx.destination);
        return true;
      } catch (e) { return false; }
    }
    setMuted(m) {
      this.muted = !!m;
      if (this.master) this.master.gain.value = this.muted ? 0 : 1;
      return this.muted;
    }
    async load(url) {
      if (!this.ensure()) return null;
      try {
        const r = await fetch(url);
        if (!r.ok) return null;
        const buf = await r.arrayBuffer();
        return await this.ctx.decodeAudioData(buf);
      } catch (e) { return null; }
    }
    // Gain ramps (knife-audio Ramp, linear in volume units): cancel any
    // scheduled ramp, anchor at the current value, ramp to the target.
    _ramp(param, target, secs) {
      try {
        const t = this.ctx.currentTime;
        param.cancelScheduledValues(t);
        param.setValueAtTime(param.value, t);
        param.linearRampToValueAtTime(target, t + Math.max(0.001, secs));
      } catch (e) {}
    }
    playBuffer(buf, { loop = false, gain = 1, pan = 0, curve = "linear", fadeIn = 0, loopStart = null, loopEnd = null, offset = 0 } = {}) {
      if (!buf || !this.ensure()) return null;
      const src = this.ctx.createBufferSource();
      src.buffer = buf; src.loop = loop;
      if (loop) {
        // BFSAR loop points (knife-audio loop_range), seconds. Clamped:
        // a loopEnd past the buffer end would throw on some engines.
        if (loopStart !== null) src.loopStart = Math.min(Math.max(0, loopStart), buf.duration);
        if (loopEnd !== null) src.loopEnd = Math.min(Math.max(src.loopStart, loopEnd), buf.duration);
      }
      const g = this.ctx.createGain();
      const t = this.ctx.currentTime;
      const target = Curve[curve](Math.max(0, Math.min(1, gain)));
      if (fadeIn > 0) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(target, t + fadeIn); }
      else g.gain.value = target;
      const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      if (p) { p.pan.value = pan; src.connect(g); g.connect(p); p.connect(this.master); }
      else { src.connect(g); g.connect(this.master); }
      src.start(0, Math.min(Math.max(0, offset || 0), Math.max(0, buf.duration - 0.001)));
      const node = { src, gain: g, stop: (fadeOut = 0) => {
        node._stopped = true;
        try {
          if (fadeOut > 0) { g.gain.linearRampToValueAtTime(0, this.ctx.currentTime + fadeOut); src.stop(this.ctx.currentTime + fadeOut + 0.05); }
          else src.stop();
        } catch (e) {}
      } };
      return node;
    }
    async playBgm(url, { volume = 1, fadeIn = 0, fadeOut = 0, offsetSamples = 0, loop = null, repeat = true, onEnded = null } = {}) {
      // load first: a missing file used to stop the current BGM and
      // leave silence (the title-72 case); now the old track keeps going.
      // Generation guard: a stopBgm issued while this load was in flight
      // (title BGM still decoding when NEW GAME is clicked) must cancel
      // the pending start, or the title track starts OVER the new game
      // and loops — the prologue's own MPLY only arrives at 00_00/3310.
      // Last call wins regardless of resolve order; the internal stop
      // must not bump the generation, or it would cancel a newer caller.
      // knife MPLY: a track already playing is left alone (no restart),
      // key 69 seeks to a sample, and with a fade-in the old track fades
      // out over key 11 (else key 1) while the new one rises over key 1.
      if (this.bgm && this.bgmUrl === url) return;
      const my = ++this.bgmGen;
      const buf = await this.load(url);
      if (!buf || my !== this.bgmGen) return;
      if (this.bgm && this.bgmUrl === url) return;
      this._stopBgm(fadeOut);
      let offset = offsetSamples ? Math.min(Math.max(0, offsetSamples) / buf.sampleRate, Math.max(0, buf.duration - 0.001)) : 0;
      if (loop && offset >= loop[1]) offset = loop[0];
      this.bgm = this.playBuffer(buf, { loop: repeat, gain: volume * this.cfg.bgm * (this.cfg.muteBgm ? 0 : 1), curve: "bgm", fadeIn, loopStart: loop ? loop[0] : null, loopEnd: loop ? loop[1] : null, offset });
      this.bgmUrl = url;
      this.bgmVol = volume; this.bgmLoop = loop; this.bgmOffset = offset; this.bgmBuf = buf;
      this.bgmStartedAt = this.ctx.currentTime;
      const node = this.bgm;
      node.src.onended = () => {
        if (!node._stopped && this.bgm === node) {
          this.bgm = null; this.bgmUrl = null;
          if (onEnded) onEnded();
        }
      };
    }
    stopBgm(fadeOut = 0) {
      this.bgmGen++;
      this._stopBgm(fadeOut);
    }
    _stopBgm(fadeOut = 0) {
      if (this.bgm) { this.bgm.stop(fadeOut); this.bgm = null; this.bgmUrl = null; }
      this.bgmStartedAt = 0; this.bgmOffset = 0; this.bgmLoop = null; this.bgmBuf = null;
    }
    // gallery player: current position (loop-aware), pause / resume
    bgmPlaying() { return !!this.bgm; }
    bgmPosition() {
      if (!this.bgm || !this.ctx) return 0;
      let pos = (this.ctx.currentTime - (this.bgmStartedAt || 0)) + (this.bgmOffset || 0);
      const loop = this.bgmLoop, dur = this.bgmBuf ? this.bgmBuf.duration : 0;
      if (loop && loop[1] > loop[0]) {
        if (pos >= loop[1]) pos = loop[0] + ((pos - loop[0]) % (loop[1] - loop[0]));
      } else if (dur > 0 && pos >= dur) pos = pos % dur;
      return Math.max(0, pos);
    }
    pauseBgm() {
      if (!this.bgm) return null;
      const info = { url: this.bgmUrl, vol: this.bgmVol ?? 1, loop: this.bgmLoop || null, pos: this.bgmPosition() };
      this.stopBgm(0);
      return info;
    }
    async resumeBgm(info) {
      if (!info || !info.url) return;
      const sr = this.ctx ? this.ctx.sampleRate : 48000;
      await this.playBgm(info.url, { volume: info.vol ?? 1, loop: info.loop || null, offsetSamples: Math.floor((info.pos || 0) * sr) });
    }
    setBgmLoop(repeat) { if (this.bgm && this.bgm.src) { try { this.bgm.src.loop = !!repeat; } catch (e) {} } }
    // knife MVOL: set_bgm_volume(v, key 1 ms) — a ramp, not a jump.
    setBgmVolume(vol01, rampSec = 0) {
      if (!this.bgm || !this.bgm.gain) return;
      this._ramp(this.bgm.gain.gain, Curve.bgm(vol01 * this.cfg.bgm), rampSec);
    }
    async playSe(url, { channel = 0, volume = 1, fadeIn = 0, looping = false, pan = 0, speakerRow = null, sys = false } = {}) {
      // same late-start race as BGM had: a stopSe during the load must
      // cancel the pending start, or a stopped SE restarts afterwards.
      if (!this.seTok) this.seTok = new Map();
      const my = (this.seTok.get(channel) || 0) + 1;
      this.seTok.set(channel, my);
      const old = this.se.get(channel);
      if (old) old.stop(0);
      const buf = await this.load(url);
      if (!buf || my !== this.seTok.get(channel)) return;
      let gain, curve;
      if (speakerRow !== null && speakerRow >= 0 && speakerRow < 19) {
        gain = this.cfg.charVoice[speakerRow] * (this.cfg.charMute >> speakerRow & 1 ? 0 : 1);
        curve = "linear";
      } else if (sys) { gain = this.cfg.sys * (this.cfg.muteSys ? 0 : 1); curve = "se"; }
      else { gain = this.cfg.se * (this.cfg.muteSe ? 0 : 1); curve = "se"; }
      const node = this.playBuffer(buf, { loop: looping, gain: volume * gain, curve, fadeIn, pan });
      // SEVL replaces the key-17 volume of a playing channel: keep the
      // pre-curve factor so setSeVolume can rebuild the target.
      if (node) { node._volBase = { curve, factor: gain }; this.se.set(channel, node); }
    }
    stopSe(channel, fadeOut = 0) {
      if (!this.seTok) this.seTok = new Map();
      if (channel < 0) {
        for (const k of new Set([...this.se.keys(), ...this.seTok.keys()])) this.seTok.set(k, (this.seTok.get(k) || 0) + 1);
        for (const n of this.se.values()) n.stop(fadeOut);
        this.se.clear();
        return;
      }
      this.seTok.set(channel, (this.seTok.get(channel) || 0) + 1);
      const n = this.se.get(channel);
      if (n) { n.stop(fadeOut); this.se.delete(channel); }
    }
    // knife SEVL (kind 3): ramp a playing channel's volume to key 17
    // over key 1 ms. No node (or no key 17) means nothing to do.
    setSeVolume(channel, vol01, fadeSec = 0) {
      const nodes = channel < 0 ? [...this.se.values()] : [this.se.get(channel)];
      for (const n of nodes) {
        if (!n || !n.gain) continue;
        const base = n._volBase || { curve: "se", factor: this.cfg.se * (this.cfg.muteSe ? 0 : 1) };
        this._ramp(n.gain.gain, Curve[base.curve](vol01 * base.factor), fadeSec);
      }
    }
    // knife sound.rs: two alternating voice players. A message-start voice
    // (stopAll) first stops BOTH players, then plays on the other one — so
    // a new line always cuts the previous voice. VPL2 (stopAll false)
    // leaves the last voice playing and overlaps it.
    async playVoice(url, { gain = 1, stopAll = true, speakerRow = null } = {}) {
      if (!this.cfg.voiceOn) return;
      if (!this.voices) { this.voices = [null, null]; this.curVoice = 0; }
      if (stopAll) this.stopVoice();
      const buf = await this.load(url);
      if (!buf) return;
      this.curVoice ^= 1;
      const slot = this.curVoice;
      if (this.voices[slot]) { try { this.voices[slot].stop(0); } catch (e) {} }
      let g = gain * this.cfg.voice;
      if (speakerRow !== null && speakerRow >= 0 && speakerRow < 19) {
        g *= this.cfg.charVoice[speakerRow] * (this.cfg.charMute >> speakerRow & 1 ? 0 : 1);
      }
      const node = this.playBuffer(buf, { gain: g, curve: "linear" });
      this.voices[slot] = node;
      // knife's auto mode waits for the voice to end (game.rs Wait::Click):
      // a finished source must clear its slot, or voicePlaying() would
      // stay true forever (stopped nodes are not otherwise observable).
      // playBuffer returns a {src, gain, stop} wrapper, NOT the source —
      // hanging onended on the wrapper silently never fires, so the
      // handler goes on the real AudioBufferSourceNode, via
      // addEventListener: boot's onVoice assigns node.src.onended for
      // its own flag, which would clobber an onended assignment here
      if (node && node.src) node.src.addEventListener("ended", () => { if (this.voices[slot] === node) this.voices[slot] = null; });
      return node;
    }
    // knife sound.rs voice_playing(): either alternating player busy
    voicePlaying() {
      return !!(this.voices && this.voices.some(Boolean));
    }
    stopVoice() {
      if (!this.voices) return;
      for (const n of this.voices) if (n) { try { n.stop(0); } catch (e) {} }
      this.voices = [null, null];
    }
  }
  KP.AudioEngine = AudioEngine; KP.Curve = Curve; KP.volumeCurve = volumeCurve; KP.panGains = panGains;
  if (typeof module !== "undefined") module.exports = KP;
})();
