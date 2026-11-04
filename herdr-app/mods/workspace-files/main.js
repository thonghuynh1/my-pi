// A lazy file browser with a small local editor and bounded remote/large previews.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, writeTextFile, watchFolder, theme, settings, window, props, openOverlay, closeOverlay, run } from "herdr";

import { fullPath, captureTarget, insertPath } from "./insert.js";
import { FileDocument, EDIT_LIMIT } from "./editor.js";

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const PER_FOLDER = 500, TOTAL = 5000;

async function directory(path, on) {
  if (!on && window()?.platform === "windows") {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Reparse points keep directory attributes even when dangling; check their target.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replaceAll("'", "''") + "'"]);
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  }
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  const r = await exec("sh", ["-c", script, "files", path], { on });
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export default class Files extends View {
  init(_props, cx) {
    this.menu = props()?.fileMenu;
    if (this.menu) return;
    this.saved = new Map(); this.documents = new Map();
    this.handle = cx.focus_handle(); this.fileRequest = 0;
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return !this.closed && this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.show(null); this.watched = null; this.error = null; this.limited = false;
      this.loading = false;
      if (saved?.file) this.show(saved.file, cx);
    }
    // The tree is hidden while editing. Defer directory/Git scans until Back.
    if (!cwd || this.loading || this.file) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context) || this.file) return;
          await this.loadFolder(path, context);
        }
        if (!this.current(context) || this.file) return;
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        if (!this.current(context) || this.file) return;
        const marks = {};
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${top.stdout.trim()}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  flushDraft() {
    if (!this.draftTask) return;
    this.draftTask.cancel(); this.draftTask = null;
    this.document?.persist();
    return true;
  }

  trimEditors() {
    const cached = [...this.documents.entries()].filter(([, doc]) => doc.code);
    for (const [key, doc] of cached.slice(0, Math.max(0, cached.length - 8))) {
      if (doc === this.document) continue;
      doc.code.release(); doc.code = null;
      if (!doc.dirty && !doc.saving) this.documents.delete(key);
    }
  }

  async close() {
    this.flushDraft(); this.closed = true; this.fileRequest++;
    this.code = null; this.document = null;
    for (const doc of this.documents?.values() ?? []) { doc.code?.release(); doc.code = null; }
    // Herdr storage writes in the background. Await durability within its close grace period.
    try { await localStorage.flush(); } catch (e) { console.error("Draft flush failed", e); }
  }

  show(path, cx) {
    if (this.closed) return;
    this.flushDraft();
    this.code = null; this.document = null; this.file = path; this.fileError = null; this.discardConfirm = false;
    const request = ++this.fileRequest;
    if (!path || !cx) return;
    const context = this.context, root = this.root, on = this.on;
    cx.spawn(async cx => {
      try {
        const absolute = fullPath(root, path), documentKey = JSON.stringify([on, absolute]);
        const previous = this.documents.get(documentKey);
        // A retained draft opens immediately; Save still checks its original disk snapshot.
        const text = previous && (previous.dirty || previous.saving) ? previous.expected
          : await readTextFile(`${root}/${path}`, { on }).catch(() => null);
        if (request !== this.fileRequest || !this.current(context)) return;
        const t = theme(), ext = path.includes(".") ? path.split(".").pop() : "txt";
        const document = previous && (previous.dirty || previous.saving || text === previous.expected) ? previous
          : new FileDocument(absolute, text, { on, storage: localStorage, write: writeTextFile });
        if (document.unavailable) { this.fileError = document.readonly; return; }
        if (previous && previous !== document) previous.code?.release();
        this.documents.delete(documentKey); this.documents.set(documentKey, document); this.document = document;
        if (document.code) { this.code = document.code; return; }
        this.code = EditorState.new({ language: LANG[ext] ?? ext, readonly: Boolean(document.readonly),
          value: document.readonly && document.value.length > EDIT_LIMIT ? document.value.slice(0, EDIT_LIMIT) + "\n… (file truncated)" : document.value,
          font_family: settings().font_family, font_size: 12,
          syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
        const code = this.code;
        document.code = code; this.trimEditors();
        code.on("change", (_e, cx) => {
          if (this.document !== document || this.code !== code) return;
          const dirty = document.dirty, confirming = this.discardConfirm;
          document.update(code.value(), false);
          this.discardConfirm = false;
          if (dirty !== document.dirty) {
            // Paint the unsaved dot immediately, but don't redraw the entire window per key.
            if (!this.flushDraft()) document.persist();
            cx.notify();
          } else if (!this.draftTask) {
            // One bounded backup per typing burst; sustained typing still flushes every 300ms.
            this.draftTask = cx.timer.after(300, cx => {
              this.draftTask = null;
              const error = document.backupError;
              document.persist();
              if (error !== document.backupError) cx.notify();
            });
          }
          if (confirming && dirty === document.dirty) cx.notify();
        });
        code.on("blur", (_e, cx) => {
          if (this.document !== document || this.code !== code) return;
          const error = document.backupError;
          this.flushDraft();
          if (error !== document.backupError) cx.notify();
        });
      } catch { if (request === this.fileRequest && this.current(context)) this.fileError = "Cannot open this file (binary, too large, or unreadable)"; }
      finally { cx.notify(); }
    });
  }

  save(cx) {
    this.flushDraft();
    const document = this.document;
    if (!document || document.readonly || document.saving || !document.dirty) return;
    cx.spawn(async cx => {
      await document.save();
      if (this.document === document && !document.error) this.refresh(cx);
      cx.notify();
    });
    cx.notify();
  }

  reload(cx) {
    const doc = this.document;
    if (!doc || doc.saving) return;
    if (doc.dirty && !this.discardConfirm) { this.discardConfirm = true; cx.notify(); return; }
    try {
      localStorage.removeItem(doc.key);
      this.draftTask?.cancel(); this.draftTask = null;
      doc.code?.release(); doc.code = null;
      this.documents.delete(JSON.stringify([this.on, doc.path]));
      this.show(this.file, cx);
    } catch { doc.error = "Cannot clear the draft backup. Copy your edits before leaving."; }
    cx.notify();
  }

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : this.show(path, cx))
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.fileMenu(path, cx); })
        .child(entry.dir ? svg(`mods/workspace-files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/workspace-files/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  fileMenu(path, cx) {
    try {
      if (!this.current(this.context)) throw new Error("The folder or terminal changed. Wait for Files to refresh and try again.");
      const absolute = fullPath(this.root, path);
      openOverlay({ mod: "workspace-files", kind: "popup", width: 280,
        props: { fileMenu: { path: absolute, target: captureTarget(focused(), panes()) } } });
    } catch (e) { this.error = String(e.message ?? e); cx.notify(); }
  }

  renderMenu(t) {
    const item = (id, label, action) => div().id(id).px(10).py(8).rounded(6).text_size(12)
      .hover(s => s.bg(t.hover)).on_click((_e, cx) => { cx.stop_propagation(); action(cx); }).child(label);
    return v_flex().p(6).gap(3).bg(t.popover).text_color(t.foreground)
      .child(div().px(10).py(4).text_size(10.5).text_color(t.dim).truncate().tooltip(this.menu.path).child(this.menu.path))
      .when(Boolean(this.menu.target), el => el.child(item("insert-path", "Insert path into terminal", cx => {
        try {
          insertPath(this.menu, { focused, panes, run,
            close: () => closeOverlay(props().overlay), copy: text => cx.write_to_clipboard(text),
            readClipboard: () => cx.read_from_clipboard() });
        } catch (e) { this.menuError = String(e.message ?? e); cx.notify(); }
      })))
      .when(!this.menu.target, el => el.child(div().px(10).py(5).text_size(11).text_color(t.dim).child("Focus a terminal to insert a path.")))
      .child(item("copy-path", "Copy path", cx => { cx.write_to_clipboard(this.menu.path); closeOverlay(props().overlay); }))
      .when(Boolean(this.menuError), el => el.child(div().px(10).py(5).text_size(11).text_color(t.blocked).child(this.menuError)));
  }

  render(cx) {
    const t = theme();
    if (this.menu) return this.renderMenu(t);
    if (key() !== this.context?.key) this.refresh(cx);
    const doc = this.document;
    const warning = this.discardConfirm ? "Discard unsaved edits? Click ↻ again to reload."
      : doc?.error || doc?.backupError || doc?.recoveryError || doc?.readonly;
    return v_flex().id("files").track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (this.file && (e.keystroke === "ctrl-s" || e.keystroke === "cmd-s")) { cx.stop_propagation(); this.save(cx); }
      })
      .size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(34).flex_none().px(10).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().id("files-back").flex_none().cursor_pointer().text_color(this.file ? t.muted : t.foreground)
          .tooltip(this.file ? "Back to files" : "Files")
          .on_click((_e, cx) => { if (!this.file) return; this.show(null); this.refresh(cx); cx.notify(); })
          .child(this.file ? "← Files" : "Files"))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).tooltip(this.file ?? this.root ?? "")
          .child((this.file ?? this.root ?? "").split(/[\\/]/).pop()))
        .when(Boolean(doc?.dirty), el => el.child(div().text_color(t.blocked).tooltip("Unsaved · Ctrl+S / Cmd+S to save").child("●")))
        .when(Boolean(doc), el => el.child(div().id("file-reload").px(5).py(4).rounded(4).text_color(this.discardConfirm ? t.blocked : t.muted).cursor_pointer()
          .tooltip(this.discardConfirm ? "Discard edits and reload" : "Reload from disk")
          .hover(s => s.bg(t.hover)).on_click((_e, cx) => this.reload(cx)).child("↻")))
        .when(Boolean(doc && !doc.readonly && (doc.dirty || doc.saving)), el => el.child(div().id("file-save").px(8).py(4).rounded(4)
          .bg(t.surface).text_color(t.foreground).cursor_pointer().hover(s => s.bg(t.hover))
          .tooltip("Save · Ctrl+S / Cmd+S").on_click((_e, cx) => this.save(cx)).child(doc.saving ? "Saving…" : "Save")))
        .when(Boolean(this.file), el => el.child(div().id("preview-file-menu").px(5).py(4).rounded(4).text_color(t.muted)
          .hover(s => s.bg(t.hover)).on_click((_e, cx) => this.fileMenu(this.file, cx)).child("⋯"))))
      .when(Boolean(warning), el => el.child(div().id("file-warning").px(10).py(5).text_size(11).text_color(this.discardConfirm || doc?.error || doc?.backupError || doc?.recoveryError ? t.blocked : t.dim).child(warning)))
      .when(!this.file, el => el.child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.rows("", 0, [], t))
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))))
      .when(Boolean(this.file), el => el.child(this.code ? Editor.new(this.code).flex_1().min_h(0) : div().p(12).text_color(t.dim).child(this.fileError || "Loading file…")));
  }
}
