// A file in its own tab, opened by panel.js with props { role: "viewer", file (absolute), on }.
// Markdown renders formatted (Source toggles to text); other files show as code.
// Orca bundle fit: local files are editable (upstream was read-only). Saving
// is compare-and-swap via writeTextFile(path, text, expected): if the file
// changed on disk underneath unsaved edits, the save refuses instead of
// overwriting, and the draft survives in localStorage across a reload.
// Remote, binary and truncated files stay read-only.
import { div } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView } from "gpui-base";
import { props, readTextFile, writeTextFile, watchFolder, theme, settings, focused, spaces } from "herdr";
import { openFile } from "./tabs.js";
import { syntaxColors, languageFor } from "./syntax.js";

const LIMIT = 400000;
const isMarkdown = path => /\.(md|markdown|mdx)$/i.test(path ?? "");
const dirname = path => path.slice(0, path.lastIndexOf("/")) || "/";

// A relative or absolute link, resolved against the current file's folder.
function resolve(file, href) {
  let p;
  try { p = decodeURIComponent(href.split("#")[0]); } catch { return null; }
  if (!p) return null;
  const parts = [];
  for (const s of (p.startsWith("/") ? p : `${dirname(file)}/${p}`).split("/")) {
    if (!s || s === ".") continue;
    if (s === "..") parts.pop(); else parts.push(s);
  }
  return "/" + parts.join("/");
}

// A plain class: main.js (the View) owns it and forwards init, render and close.
export default class Viewer {
  init(_props, cx) {
    const p = props() ?? {};
    this.on = p.on ?? null;
    this.file = p.file; this.source = false;
    this.dirty = false; this.saving = false; this.notice = null; this.saveError = null;
    if (!this.file) { this.error = "No file to show"; return; }
    this.load(cx);
    this.watch(cx);
  }

  draftKey() { return `fow-draft:${this.file}`; }

  // Editable only where a save can be safe: this machine, whole file loaded.
  editable() { return !this.on && !this.truncated && Boolean(this.code); }

  load(cx) {
    const file = this.file;
    cx.spawn(async cx => {
      try {
        const raw = await readTextFile(file, { on: this.on });
        if (this.closed || this.file !== file) return;
        if (raw === null) { this.error = "This file is no longer available"; return; }
        if (raw.includes("\0")) { this.error = "Binary file · no text preview"; return; }
        this.truncated = raw.length > LIMIT;
        const text = this.truncated ? raw.slice(0, LIMIT) + "\n… (file truncated)" : raw;
        // Unsaved edits win over a reload; flag the conflict instead.
        if (this.code && this.dirty) {
          if (text !== this.text) this.notice = "Changed on disk — your unsaved edits are kept. Save will refuse; copy them before reloading.";
          return;
        }
        if (this.code && text === this.text) return;
        const syntax = await syntaxColors();
        if (this.closed || this.file !== file) return;
        this.code?.release();
        this.text = text; this.error = null;
        this.code = EditorState.new({ language: languageFor(file), readonly: Boolean(this.on) || this.truncated, value: text,
          font_family: settings().font_family, font_size: 12,
          syntax });
        this.code.on("change", (_e, cx) => this.changed(cx));
        // A draft from an earlier session (crash, reload) comes back dirty.
        if (!this.on && !this.truncated) {
          try {
            const draft = localStorage.getItem(this.draftKey());
            if (typeof draft === "string" && draft !== text) {
              this.code.set_value(draft);
              this.dirty = true;
              this.notice = "Recovered unsaved draft";
            }
          } catch { /* Draft recovery is best-effort. */ }
        }
      } catch { if (this.file === file) this.error = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { if (!this.closed) cx.notify(); }
    });
  }

  changed(cx) {
    const value = this.code?.value();
    if (value == null) return;
    this.dirty = value !== this.text;
    this.saveError = null;
    if (this.dirty) this.notice = null;
    try {
      if (this.dirty) localStorage.setItem(this.draftKey(), value);
      else localStorage.removeItem(this.draftKey());
    } catch { /* Best-effort. */ }
    cx.notify();
  }

  save(cx) {
    if (!this.editable() || this.saving || !this.dirty || !this.code) return;
    const file = this.file, value = this.code.value(), expected = this.text;
    this.saving = true; this.saveError = null; cx.notify();
    cx.spawn(async cx => {
      try {
        await writeTextFile(file, value, expected);
        this.text = value;
        this.dirty = this.code?.value() !== value;
        this.notice = "Saved";
        try { if (!this.dirty) localStorage.removeItem(this.draftKey()); } catch { /* Best-effort. */ }
      } catch (e) {
        this.saveError = `Not saved: ${e?.message ?? e}. Your draft is kept — if the file changed externally, copy your edits before reloading.`;
      } finally {
        this.saving = false;
        if (!this.closed) cx.notify();
      }
    });
  }

  // Local files reload when saved elsewhere; watchFolder only works on this machine.
  watch(cx) {
    if (this.on) return;
    const dir = dirname(this.file);
    if (this.watching === dir) return;
    this.watching = dir;
    cx.spawn(async cx => {
      try {
        while (!this.closed && this.watching === dir) {
          const changed = await watchFolder(dir);
          if (this.closed || this.watching !== dir) return;
          if (changed.some(c => c.endsWith(this.file) || this.file.startsWith(c + "/"))) this.load(cx);
        }
      } catch { if (this.watching === dir) this.watching = null; }
    });
  }

  // Linked files open in their own tab, like clicks in the Files panel.
  followLink(url, cx) {
    if (/^(https?|mailto):/i.test(url)) return cx.open_url(url);
    const next = resolve(this.file, url);
    if (!next || next === this.file) return;
    const space = focused()?.space ?? spaces().find(s => s.active)?.id;
    openFile({ file: next, on: this.on, space }, cx);
  }

  body(t) {
    if (!this.code) return div().p(16).text_color(t.dim).child(this.error || "Loading file…");
    if (!isMarkdown(this.file) || this.source) return Editor.new(this.code).flex_1().min_h(0);
    return v_flex().id(`fow-md-${this.file}`).flex_1().min_h(0).overflow_y_scrollbar().px(24).py(16)
      .child(TextView.markdown(`fow-md-view-${this.file}`, this.code.value()).selectable(true).scrollable(false).w_full()
        .text_size(14).text_color(t.foreground).on_link_click((url, cx) => this.followLink(url, cx)));
  }

  button(id, label, t, action) {
    return div().id(id).flex_none().px(8).h(24).flex().items_center().rounded(6).text_size(12).text_color(t.muted)
      .cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => action(cx)).child(label);
  }

  render(_cx) {
    const t = theme();
    return v_flex().id("fow-viewer").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .on_key_down((e, cx) => {
        if (e.keystroke === "ctrl-s" || e.keystroke === "cmd-s") { cx.stop_propagation(); this.save(cx); }
      })
      .child(h_flex().h(36).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(this.file ?? ""))
        .when(this.dirty, el => el.child(div().flex_none().text_color(t.blocked).tooltip("Unsaved · Ctrl+S to save").child("●")))
        .when(this.saving, el => el.child(div().flex_none().text_size(12).text_color(t.dim).child("Saving…")))
        .when(!this.saving && Boolean(this.saveError), el => el.child(div().flex_none().max_w(420).truncate().text_size(12).text_color(t.ansi1).tooltip(this.saveError).child("Not saved")))
        .when(!this.saving && !this.saveError && Boolean(this.notice), el => el.child(div().flex_none().max_w(420).truncate().text_size(12).text_color(t.dim).tooltip(this.notice).child(this.notice === "Saved" ? "Saved" : "Notice")))
        .when(Boolean(this.code) && !this.editable(), el => el.child(div().flex_none().text_size(12).text_color(t.dim).child(this.on ? "Remote · read-only" : "Read-only")))
        .when(this.editable() && this.dirty, el => el.child(this.button("fow-save", "Save", t, cx => this.save(cx))))
        .when(isMarkdown(this.file) && Boolean(this.code), el => el.child(this.button("fow-mode", this.source ? "Preview" : "Source", t,
          cx => { this.source = !this.source; cx.notify(); }))))
      .child(this.body(t));
  }

  close() {
    this.closed = true;
    this.code?.release(); this.code = null;
  }
}
