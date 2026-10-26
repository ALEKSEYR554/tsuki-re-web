"use strict";
/* text.js — the message window. Timing follows knife text.rs: the typing head
   advances 16.667 ms / text-speed per frame and holds 2 frames at a message
   start; earlier page messages dim to 100/255 over 1.2x text speed; the
   window fades in fully in 128 ms. All of it is driven by wall-clock dt so
   a slow frame rate cannot slow the text down. Rendering is a DOM textbox
   for now (GAP:
   knife draws glyphs itself with its own line breaking; the EN UAX#14 tables
   from the exe are not ported yet — the browser's line breaker stands in). */
var KP = globalThis.KP || (globalThis.KP = {});
(function () {
  function formatLine(raw) {
    let t = String(raw || "").replace(/^@g/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    t = t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    t = t.replace(/&lt;([^&<>|]+)\|([^&<>]+)&gt;/g, "<ruby>$1<rt>$2</rt></ruby>");
    t = t.replace(/@i/g, "<i>").replace(/@r/g, "</i>").replace(/@b/g, "<b>");
    t = t.replace(/@[a-zA-Z]\d?/g, "");
    t = t.replace(/#/g, "<br>");
    return t.replace(/\n/g, "<br>");
  }
  // knife page geometry (EN, canvas 1920x1080): text from x 96, first line
  // box top 55 units * 1080/448 = 133px, pitch 77px (53 + 24), bottom limit
  // 1000px. The box is TOP-anchored: lines stack downward from a fixed top,
  // never upward from the bottom edge. JP/ZC/ZT share the Japanese layout
  // (knife msg_layout): left 88*3 = 264, right 264, top 65 units = 157px,
  // glyph 60*0.76 = 45.6px, pitch 50*45.6/40 + 24 = 81px.
  const BOTTOM_LIMIT = 1000;
  const READ_ALPHA = 100 / 255;
  class TextWindow {
    constructor(el, opts) {
      this.el = el;
      this.speed = (opts && opts.speed) || 9; // ms per char-ish (CONFIG text speed)
      this.mediaUrl = (opts && opts.mediaUrl) || ((p) => p);
      this.lines = [];   // {html, fade 0..1}
      this.current = null; // {full, shown, count, hold}
      this.visible = false;
      this.alpha = 0;
      this.fadeIn = true;  // CONFIG: text appears with a fade (typing); off = instantly
      this.fadeOut = true; // CONFIG: the page fades out on clear (else vanishes)
      this.fadeOutMs = 0;  // >0 while a page-out fade is running
      this.onDone = null;
      this.onShow = null; // called with the formatted html of each shown line
      this.onOverflow = null; // called when the page restarts on overflow
      this.pageTop = 133; this.pitch = 77; // EN layout; setLayout switches JP/ZC/ZT
      // knife sub_38EC0 click icon (DISP_PARTS strips, 105 frames of 39x39):
      // set by boot each frame; fades in while the message waits for a click
      this.showIcon = false;
      this.iconPage = false;  // true = page-break icon (stripes), false = line-break (circle)
      this.iconTicks = 0;
      this.iconFade = 0;
      this.onRender = null;   // called with the computed textbox opacity (drives the window panel)
    }
    // knife msg_layout(): the Japanese layout for ja/zc/zt, the tuned EN
    // numbers otherwise. CJK glyphs fall back to system fonts (no CJK
    // font ships with the port); the panel texture stays the EN one.
    setLayout(lang) {
      const jp = lang === "ja" || lang === "zc" || lang === "zt";
      this.pageTop = jp ? 157 : 133;
      this.pitch = jp ? 81 : 77;
      const box = document.querySelector("#textbox");
      if (box) {
        box.style.left = jp ? "264px" : "96px";
        box.style.right = jp ? "264px" : "105px";
        box.style.top = jp ? "157px" : "133px";
        box.style.fontSize = jp ? "45.6px" : "41px";
        box.style.lineHeight = jp ? "81px" : "77px";
        // RU (0039): TsukiEN has zero Cyrillic glyphs, so the textbox
        // falls back per-glyph to a system sans (Arial on Windows).
        // RU uses the EN layout; only the font stack changes.
        // Custom translations (0040) get the same treatment: their
        // script is unknown, and the sans fallback covers Cyrillic.
        box.classList.toggle("lang-ru", lang === "ru");
        box.classList.toggle("lang-custom", lang === "custom");
      }
    }
    visualLines(html) {
      return (html.match(/<br>/g) || []).length + 1;
    }
    pageLineCount() {
      let n = 0;
      for (const l of this.lines) n += this.visualLines(l.html);
      if (this.current) n += this.visualLines(this.current.full);
      return n;
    }
    showMessage(raw, extraLines) {
      const html = formatLine(raw);
      // a pending page-out fade is cut short by the incoming message
      if (this.fadeOutMs > 0) { this.lines = []; this.current = null; this.fadeOutMs = 0; }
      // knife show_message: a message whose layout would pass BOTTOM_LIMIT
      // restarts the page at the top instead of overflowing it.
      const extra = extraLines || 0;
      if (this.lines.length > 0 && this.pageTop + (this.pageLineCount() + extra + this.visualLines(html)) * this.pitch > BOTTOM_LIMIT) {
        this.clearPage();
        if (this.onOverflow) this.onOverflow();
      }
      for (let i = 0; i < extra; i++) this.lines.push({ html: "", fade: 1 });
      this.current = { full: html, shown: "", count: 0, holdMs: 2 * KP.FRAME_MS, charAcc: 0 };
      if (this.onShow) this.onShow(html);
      // knife show_message: only visible = true. page.alpha is a persistent
      // fade state (step ramps it toward 1 at dt/128) and must NOT reset
      // here — resetting it made the window, and the panel following it,
      // blink out and back on every single message (flash on each click)
      this.visible = true;
      if (!this.fadeIn) this.finish();
      this.render();
    }
    isTypingDone() {
      if (!this.current) return true;
      return this.current.count >= this.current.full.replace(/<[^>]+>/g, "").length;
    }
    // one tick of dtMs wall-clock milliseconds: window fade-in, typing
    // head, and the read fade of earlier messages (to 100/255 over
    // text speed * 1.2 frames, knife game.rs text step: fade +=
    // 1 / (text_ms * 1.2) per frame). Everything here is time-based, not
    // frame-based: at 10 fps a per-frame typer would crawl 6x slower,
    // which is exactly the "text barely shows" lag report.
    step(dtMs) {
      const dt = dtMs || KP.FRAME_MS;
      // a page-out fade runs its course, then the page actually clears
      if (this.fadeOutMs > 0) {
        this.fadeOutMs -= dt;
        if (this.fadeOutMs <= 0) { this.lines = []; this.current = null; this.fadeOutMs = 0; }
        this.render();
        return;
      }
      // click icon: fades in by 0.1/frame (dt * 0.006) while the message
      // waits for a click, 30 fps animation (one frame per 2 ticks)
      if (this.showIcon && this.current && this.isTypingDone()) {
        this.iconFade = Math.min(1, this.iconFade + dt * 0.006);
        this.iconTicks = (this.iconTicks + Math.min(dt * 0.06, 2)) % 210;
      } else this.iconFade = 0;
      const fadeStep = dt / (this.speed * 1.2 * KP.FRAME_MS); // fade_frames = text_ms * 1.2
      for (const l of this.lines) if (l.fade < 1) l.fade = Math.min(1, l.fade + fadeStep);
      if (!this.current) { this.render(); return; }
      if (this.current.holdMs > 0) { this.current.holdMs -= dt; this.render(); return; }
      this.alpha = Math.min(1, this.alpha + dt / 128);
      this.current.charAcc = (this.current.charAcc || 0) + dt / Math.max(1, this.speed);
      const stepChars = Math.floor(this.current.charAcc);
      this.current.charAcc -= stepChars;
      this.current.count += stepChars;
      const plainLen = this.current.full.replace(/<[^>]+>/g, "").length;
      if (this.current.count >= plainLen) {
        this.current.shown = this.current.full;
        this.render();
        return;
      }
      let count = 0, out = "", i = 0;
      const html = this.current.full;
      while (i < html.length && count < this.current.count) {
        if (html[i] === "<") { const j = html.indexOf(">", i); out += html.slice(i, j + 1); i = j + 1; }
        else { out += html[i]; i++; count++; }
      }
      this.current.shown = out;
      this.render();
    }
    finish() {
      if (!this.current) return;
      this.current.shown = this.current.full;
      this.current.count = 1e9;
      this.render();
    }
    commitLine() {
      if (!this.current) return;
      this.lines.push({ html: this.current.full, fade: 0 });
      this.current = null;
      this.render();
    }
    clearPage() {
      if (this.fadeOut && (this.lines.length > 0 || this.current)) {
        this.fadeOutMs = 200;
        this.render();
        return;
      }
      this.lines = [];
      this.current = null;
      this.fadeOutMs = 0;
      this.render();
    }
    hide() { this.visible = false; this.alpha = 0; this.render(); }
    show() { this.visible = true; this.alpha = 1; this.render(); }
    render() {
      if (!this.el) return;
      const parts = this.lines.map((l) => `<div style="opacity:${(1 - l.fade * (1 - READ_ALPHA)).toFixed(3)}">${l.html}</div>`);
      if (this.current) {
        let cur = `<div>${this.current.shown}`;
        if (this.showIcon && this.isTypingDone() && this.iconFade > 0) {
          // 39px frame shown at 42px: strip 4095px -> 4410px wide
          const frame = Math.floor(this.iconTicks / 2) % 105;
          const strip = this.mediaUrl(this.iconPage ? "data/disp_pageBreak_a.webp" : "data/disp_lineBreak_a.webp");
          const a = (this.iconPage ? 0.5 : 1) * this.iconFade;
          // every script line ends with \r\n, so shown ends with a trailing
          // <br> — without stripping it the icon drops onto its own line
          // instead of sitting after the last glyph on the same line
          cur = cur.replace(/(<br>)+$/, "");
          cur += `<span class="clickicon" style="background-image:url(${strip});background-size:4410px 42px;background-position:-${frame * 42}px 0;opacity:${a.toFixed(3)}"></span>`;
        }
        cur += "</div>";
        parts.push(cur);
      }
      this.el.innerHTML = parts.join("");
      let o = this.visible ? this.alpha : 0;
      if (this.fadeOutMs > 0) o *= this.fadeOutMs / 200;
      this.el.style.opacity = o;
      if (this.onRender) this.onRender(o);
    }
  }
  KP.TextWindow = TextWindow; KP.formatLine = formatLine;
  if (typeof module !== "undefined") module.exports = KP;
})();
