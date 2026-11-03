import { View, div } from "gpui-kit";
import { palette, authorInitials, authorTone } from "./ui.js";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings } from "herdr";

function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const key = () => JSON.stringify(location());
// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const countLines = (text) => text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;

// Numbers each diff line once, so a frame only draws the rows on screen.
function diffRows(lines) {
  let old = 0, next = 0;
  return lines.map((line) => {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; return { kind: "@", text: line }; }
    const kind = line[0];
    if (kind === "-") return { kind, number: old++, text: line.slice(1) || " " };
    if (kind === "+") return { kind, number: next++, text: line.slice(1) || " " };
    if (kind === " ") { old++; return { kind, number: next++, text: line.slice(1) || " " }; }
    return { kind: "", text: line };
  });
}

export default class Changes extends View {
  init(_props, cx) {
    this.commitFiles = []; this.commitFile = null; this.commitFileRows = []; this.fileRequest = 0; this.commitFilesLoading = false; this.commitFilesError = "";
    this.historyLimit = 25; this.historyHasMore = false; this.historyLoading = false; this.historyError = ""; this.historyRequest = 0;
    this.files = []; this.rows = []; this.history = []; this.mode = "changes"; this.selectedCommit = null; this.diffWidth = 0; this.message = ""; this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Commit message" });
    this.input.on("change", (_e, cx) => {
      const hadMessage = Boolean(this.message.trim());
      this.message = this.input.value();
      if (hadMessage !== Boolean(this.message.trim())) cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.commit(cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root) this.refresh(cx);
        }
      } catch { this.watched = null; }
    });
  }

  refresh(cx) {
    if (this.loading || this.busy) return;
    const { cwd, on } = location(), context = key();
    if (context !== this.context) {
      this.context = context; this.root = null; this.files = []; this.history = [];
      this.historyLimit = 25; this.historyHasMore = false; this.historyLoading = false; this.historyError = ""; this.historyRequest++; this.selectedCommit = null; this.commitRequest = (this.commitRequest || 0) + 1; this.open = null;
      this.commitFiles = []; this.commitFile = null; this.commitFileRows = []; this.fileRequest++; this.commitFilesLoading = false; this.commitFilesError = "";
      this.setLines([]); this.message = ""; this.input.set_value(""); this.error = null; this.note = null; this.watched = null; this.closed = false; this.limited = false;
    }
    if (!cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        if (key() !== context) return;
        if (top.code !== 0) { this.root = null; this.files = []; this.setLines([]); this.open = null; this.error = "Not a git repository"; return; }
        const root = top.stdout.trim(), git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        const status = await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]);
        if (status.code !== 0) throw new Error(status.stderr);
        const head = await git(["rev-parse", "--verify", "HEAD"]);
        const stats = {};
        const results = head.code === 0 ? [await git(["diff", "HEAD", "--numstat", "-z", "--no-renames"])] : [await git(["diff", "--cached", "--numstat", "-z", "--no-renames"]), await git(["diff", "--numstat", "-z", "--no-renames"])];
        for (const result of results) {
          if (result.code !== 0) throw new Error(result.stderr);
          for (const entry of result.stdout.split("\0")) {
            const [a, d, ...parts] = entry.split("\t");
            if (!parts.length) continue;
            const path = parts.join("\t"), old = stats[path] ?? { add: 0, del: 0 };
            stats[path] = { add: old.add + (Number(a) || 0), del: old.del + (Number(d) || 0), binary: a === "-" };
          }
        }
        const files = [];
        const entries = status.stdout.split("\0").filter(Boolean);
        for (const entry of entries.slice(0, 1000)) {
          const xy = entry.slice(0, 2), path = entry.slice(3), fresh = xy === "??";
          const conflict = xy.includes("U") || xy === "AA" || xy === "DD";
          const s = conflict ? "U" : xy.includes("D") ? "D" : fresh || xy.includes("A") ? "A" : "M";
          const stat = stats[path] ?? { add: 0, del: 0 };
          files.push({ path, status: s, fresh, ...stat });
        }
        if (key() !== context) return;
        this.root = root; this.on = on; this.hasHead = head.code === 0; this.files = files; this.limited = entries.length > 1000; this.error = null;
        await this.loadHistory(cx);
        if (key() !== context) return;
        this.watch(root, cx);
        if (this.open && !files.some((f) => f.path === this.open)) { this.open = null; if (this.mode === "changes") this.setLines([]); }
        // The first file's diff shows until you pick another.
        if (!this.open && !this.closed && files.length) this.open = files[0].path;
        if (this.mode === "history" && !this.selectedCommit && this.history[0]) this.showCommit(this.history[0], cx);
        if (this.open && this.mode === "changes") {
          try { await this.load(this.open, context); }
          catch { if (key() === context) this.setLines(["Cannot preview this diff (too large or unreadable)"]); }
        }
      } catch (e) { if (key() === context) this.error = String(e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  async loadHistory(cx, more = false) {
    if (this.historyLoading || !this.root) return;
    const context = this.context, request = ++this.historyRequest;
    const limit = this.historyLimit + (more ? 25 : 0);
    this.historyLoading = true; this.historyError = ""; cx.notify();
    try {
      // One extra record tells us whether another page exists. Re-read the
      // prefix so commits added between pages cannot cause skips or duplicates.
      const result = await exec("git", [...READ, "log", "-n", String(limit + 1), "--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI"], { cwd: this.root, on: this.on });
      if (key() !== context || this.historyRequest !== request) return;
      if (result.code !== 0) {
        if (!this.hasHead) { this.history = []; this.historyHasMore = false; return; }
        throw new Error(result.stderr || "Cannot load history");
      }
      const commits = result.stdout.trim().split("\n").filter(Boolean).map(line => {
        const [hash, short, subject, author, date] = line.split("\x1f");
        return { hash, short, subject, author, date };
      });
      this.history = commits.slice(0, limit); this.historyHasMore = commits.length > limit; this.historyLimit = limit;
    } catch (e) { if (key() === context && this.historyRequest === request) this.historyError = String(e.message || e); }
    finally { if (key() === context && this.historyRequest === request) { this.historyLoading = false; cx.notify(); } }
  }

  async load(path, context) {
    const file = this.files.find((f) => f.path === path), root = this.root, on = this.on;
    if (!file) return;
    let lines;
    if (file.fresh || (!this.hasHead && file.status === "A")) {
      const text = await readTextFile(`${root}/${path}`, { on }).catch(() => null);
      if (text === null) lines = ["Cannot preview this file (binary, too large, or unreadable)"];
      else if (text.includes("\0")) lines = ["Binary file · no text diff"];
      else {
        file.add = countLines(text);
        lines = [`@@ -0,0 +1,${file.add} @@`, ...text.slice(0, 400000).replace(/\n$/, "").split("\n").slice(0, 1500).map(l => `+${l}`)];
      }
    } else {
      const r = await exec("git", [...READ, "diff", ...(this.hasHead ? ["HEAD"] : []), "--no-ext-diff", "--no-textconv", "--no-color", "--", path], { cwd: root, on });
      if (r.code !== 0) throw new Error(r.stderr);
      const all = r.stdout.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
      lines = first < 0 ? [file.binary ? "Binary file changed" : "No text diff available"] : all.slice(first);
    }
    if (key() === context && this.mode === "changes" && this.open === path) this.setLines(lines.slice(0, 1500).map(line => line.length > 4000 ? line.slice(0, 4000) + "… (line truncated)" : line));
  }

  setLines(lines) {
    this.rows = diffRows(lines);
    this.diffWidth = Math.max(300, ...lines.map(line => line.length * 7 + 50));
  }

  showCommit(commit, cx) {
    this.selectedCommit = commit.hash; this.note = null; this.commitFiles = []; this.commitFile = null;
    this.commitFileRows = []; this.fileRequest++; this.commitFilesLoading = true; this.commitFilesError = "";
    const request = this.commitRequest = (this.commitRequest || 0) + 1;
    const context = this.context, root = this.root, on = this.on;
    cx.spawn(async cx => {
      try {
        const result = await exec("git", [...READ, "show", "--format=", "--numstat", "-z", "--diff-merges=first-parent", "--no-ext-diff", "--no-textconv", "--no-renames", commit.hash], { cwd: root, on });
        if (result.code !== 0) throw new Error(result.stderr || "Git show failed");
        if (key() === context && this.mode === "history" && this.commitRequest === request && this.selectedCommit === commit.hash) {
          this.commitFiles = result.stdout.split("\0").filter(Boolean).map(entry => {
            const [add, del, ...path] = entry.split("\t");
            return { path: path.join("\t"), add: Number(add) || 0, del: Number(del) || 0, binary: add === "-" };
          }).filter(file => file.path);
          this.commitFilesLoading = false;
        }
      } catch (e) { if (key() === context && this.commitRequest === request) { this.commitFilesError = `Cannot load commit: ${e}`; this.commitFilesLoading = false; } }
      cx.notify();
    });
    cx.notify();
  }

  expandCommitFile(file, cx) {
    this.commitFile = this.commitFile === file.path ? null : file.path;
    const request = ++this.fileRequest, hash = this.selectedCommit, context = this.context;
    this.commitFileRows = []; this.commitFileNote = ""; this.commitFileLoading = Boolean(this.commitFile);
    if (!this.commitFile) { cx.notify(); return; }
    cx.spawn(async cx => {
      try {
        const result = await exec("git", [...READ, "--literal-pathspecs", "show", "--format=", "--diff-merges=first-parent", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", hash, "--", file.path], { cwd: this.root, on: this.on });
        if (result.code !== 0) throw new Error(result.stderr || "Cannot read file diff");
        if (key() !== context || this.selectedCommit !== hash || this.fileRequest !== request) return;
        const lines = result.stdout.replace(/\n$/, "").split("\n"), first = lines.findIndex(line => line.startsWith("@@"));
        const diff = first >= 0 ? lines.slice(first) : [file.binary ? "Binary file changed · no text preview" : "No text changes to preview"];
        this.commitFileRows = diffRows(diff.slice(0, 1500).map(line => line.length > 4000 ? line.slice(0, 4000) + "…" : line));
        if (diff.length > 1500) this.commitFileNote = "Preview limited to 1,500 lines.";
      } catch (e) { if (key() === context && this.fileRequest === request) this.commitFileNote = String(e.message || e); }
      finally { if (key() === context && this.fileRequest === request) { this.commitFileLoading = false; cx.notify(); } }
    });
    cx.notify();
  }

  historyFilesView(p, t, commit) {
    const totalAdd = this.commitFiles.reduce((n, f) => n + f.add, 0), totalDel = this.commitFiles.reduce((n, f) => n + f.del, 0);
    return v_flex().id("commit-file-disclosures").flex_1().min_h(0).overflow_y_scrollbar().px(12).pb(12).gap(8)
      .child(v_flex().flex_none().p(14).gap(8).rounded(14).bg(p.heroStart)
        .child(div().text_size(10).font_semibold().text_color(p.blue).child("A LITTLE PIECE OF HISTORY"))
        .child(div().text_size(15).font_semibold().child(commit?.subject || "Pick a commit"))
        .child(div().text_size(11).text_color(p.secondary).child(commit ? `${commit.author} · ${commit.short}` : "Explore the story, one file at a time."))
        .child(h_flex().flex_wrap().gap(6)
          .child(this.historyPill(`${this.commitFiles.length} files`, "purple", p))
          .child(this.historyPill(`+${totalAdd}`, "green", p))
          .child(this.historyPill(`−${totalDel}`, "red", p)))
        .child(div().text_size(10).text_color(p.secondary).child("Tap a file to peek inside · merge commits compare to their first parent")))
      .when(this.commitFilesLoading, el => el.child(div().p(12).text_color(p.secondary).child("Finding the changed files…")))
      .when(Boolean(this.commitFilesError), el => el.child(div().p(12).text_color(p.red).child(this.commitFilesError)))
      .when(!this.commitFilesLoading && !this.commitFilesError && !this.commitFiles.length, el => el.child(div().p(12).text_color(p.secondary).child("No file changes in this commit.")))
      .children(this.commitFiles.map(file => {
        const expanded = this.commitFile === file.path, parts = file.path.split("/"), name = parts.pop();
        const ext = name.includes(".") ? name.split(".").pop().slice(0, 4).toUpperCase() : "FILE";
        const tone = authorTone(ext);
        return v_flex().flex_none().min_w(0).rounded(12).border(1).border_color(expanded ? p.blue : p.stroke).bg(p.card).overflow_hidden()
          .child(h_flex().id(`history-file-${file.path}`).min_w(0).px(10).py(11).gap(8).items_center().cursor_pointer().hover(s => s.bg(p.hover))
            .on_click((_e, cx) => this.expandCommitFile(file, cx))
            .tooltip(file.path).accessibility_label(`${expanded ? "Collapse" : "Expand"} ${file.path}`)
            .child(div().w(10).flex_none().text_color(p.blue).child(expanded ? "⌄" : "›"))
            .child(div().w(32).h(32).flex_none().flex().items_center().justify_center().rounded(9).text_size(9).font_semibold().bg(p[`${tone}Wash`]).text_color(p[tone]).child(ext))
            .child(v_flex().flex_1().min_w(0).gap(3)
              .child(div().text_size(12).font_semibold().truncate().child(name))
              .when(parts.length > 0, el => el.child(div().text_size(10).text_color(p.secondary).truncate().child(parts.join("/")))))
            .child(div().flex_none().text_size(10).text_color(p.green).child(file.binary ? "Binary" : `+${file.add}`))
            .when(!file.binary, el => el.child(div().flex_none().text_size(10).text_color(p.red).child(`−${file.del}`))))
          .when(expanded, el => el
            .when(this.commitFileLoading, e => e.child(div().p(12).text_color(p.secondary).child("Loading file changes…")))
            .when(!this.commitFileLoading && this.commitFileRows.length > 0, e => e.child(
              div().h(Math.min(320, Math.max(60, this.commitFileRows.length * 20))).flex_none().relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(11)
                .child(div().id("history-file-diff-x").size_full().overflow_x_scrollbar()
                  .child(div().h_full().w_full().min_w(Math.max(280, ...this.commitFileRows.map(r => r.text.length * 7 + 50)))
                    .child(v_virtual_list("history-file-diff", this.commitFileRows.length, 20, i => String(i), range => this.commitFileRows.slice(range.start, range.end).map(row => this.diffRow(row, t))).size_full())))
                .child(Scrollbar.vertical("history-file-diff").viewport_from_layout().absolute().inset_0())))
            .when(Boolean(this.commitFileNote), e => e.child(div().p(10).text_size(11).text_color(p.secondary).child(this.commitFileNote))));
      }));
  }

  historyPill(label, tone, p) {
    return div().flex_none().px(8).py(4).rounded(12).text_size(10).font_semibold().bg(p[`${tone}Wash`]).text_color(p[tone]).child(label);
  }

  pick(path, cx) {
    this.open = this.open === path ? null : path; this.setLines([]); this.note = null;
    this.closed = !this.open;
    const context = this.context;
    if (this.open) cx.spawn(async (cx) => {
      try { await this.load(path, context); }
      catch (e) { if (key() === context && this.open === path) this.note = `Cannot preview this diff (too large or unreadable): ${e}`; }
      cx.notify();
    });
    cx.notify();
  }

  commit(cx) {
    if (!this.message.trim() || !this.root || this.busy || this.loading || this.context !== key()) return;
    const root = this.root, on = this.on, context = this.context, message = this.message.trim();
    this.busy = true; this.note = null;
    cx.spawn(async (cx) => {
      try {
        for (const args of [["add", "-A"], ["commit", "-m", message]]) {
          const r = await exec("git", args, { cwd: root, on });
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        }
        if (key() === context) { this.message = ""; this.input.set_value(""); }
      } catch (e) { if (key() === context) this.note = `Commit failed: ${e}`; }
      finally { this.busy = false; this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }

  diffRow({ kind, number, text }, t) {
    if (kind === "@") return div().w_full().px(12).h(20).flex_none().truncate().bg(t.raised).text_color(t.dim).child(text);
    return h_flex().w_full().h(20).flex_none().gap(10).when(kind === "+", (e) => e.bg(t.ansi2 + "18")).when(kind === "-", (e) => e.bg(t.ansi1 + "18"))
      .child(div().w(30).flex_none().text_right().text_color(t.dim).child(number === undefined ? "" : String(number)))
      .child(div().flex_1().min_w(0).truncate().child(text));
  }

  render(cx) {
    if (key() !== this.context) this.refresh(cx);
    const t = theme(), add = this.files.reduce((n, f) => n + f.add, 0), del = this.files.reduce((n, f) => n + f.del, 0);
    const p = palette(t), commit = this.history.find(c => c.hash === this.selectedCommit);
    const enabled = Boolean(this.message.trim() && this.root && !this.busy && !this.loading);
    return v_flex().id("changes").size_full().min_h(0).rounded(16).overflow_hidden().bg(p.canvas).border_1().border_color(p.stroke).text_color(p.text).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && this.typing) { this.typing = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      })
      .child(v_flex().flex_none().p(16).gap(14)
        .child(h_flex().items_center().gap(10)
          .child(div().size(34).flex_none().flex().items_center().justify_center().rounded(10).bg(p.blueWash).text_color(p.blue).text_size(18).child("⑂"))
          .child(v_flex().flex_1().min_w(0).gap(3)
            .child(div().text_size(17).font_semibold().child("Source Control"))
            .child(div().text_size(11).text_color(p.secondary).truncate().child(this.root ? this.root.split(/[\\/]/).pop() : "Your working copy")))
          .child(div().px(8).py(4).rounded(12).bg(p.inset).text_color(p.secondary).text_size(10).child(this.mode === "history" ? `${this.history.length}${this.historyHasMore ? "+" : ""} commits` : `${this.files.length} files`)))
        .child(h_flex().w_full().p(3).gap(3).rounded(10).bg(p.inset)
        .children([["changes", "Changes"], ["history", "Git History"]].map(([mode, label]) =>
          div().id(`source-mode-${mode}`).flex_1().flex().items_center().justify_center().py(7).rounded(8).text_size(12).font_semibold().cursor_pointer()
            .bg(this.mode === mode ? p.card : p.inset).text_color(this.mode === mode ? p.text : p.secondary)
            .hover(s => s.bg(this.mode === mode ? p.card : p.hover))
            .on_click((_e, cx) => {
              this.mode = mode; this.note = null; this.setLines([]);
              if (mode === "history") {
                const commit = this.history.find(c => c.hash === this.selectedCommit) || this.history[0];
                if (commit) this.showCommit(commit, cx);
              } else { this.refresh(cx); }
              cx.notify();
            }).child(label)))))
      .child(h_flex().flex_none().px(16).pb(8).items_center().gap(8)
        .child(div().flex_1().text_size(10).font_semibold().text_color(p.secondary).child(this.mode === "history" ? "RECENT COMMITS" : "WORKING CHANGES"))
        .when(this.mode === "changes", el => el.child(div().text_size(11).text_color(p.green).child(`+${add}`)).child(div().text_size(11).text_color(p.red).child(`−${del}`))))
      .child(v_flex().id("changes-list").flex_none().h(Math.min(this.mode === "history" ? 180 : 240, Math.max(60, (this.mode === "history" ? this.history.length * 62 : this.files.length * 36) + 16))).overflow_y_scrollbar().px(10).pb(10).gap(4)
        .when(this.mode === "history", el => el.children(this.history.map(commit =>
          h_flex().id(`commit-${commit.short}`).h(62).flex_none().px(10).gap(10).items_center().rounded(11).cursor_pointer()
            .bg(this.selectedCommit === commit.hash ? p.blueWash : p.card).hover(s => s.bg(this.selectedCommit === commit.hash ? p.blueWash : p.hover))
            .tooltip(`${commit.subject}\n${commit.author} · ${commit.hash}`)
            .on_click((_e, cx) => this.showCommit(commit, cx))
            .child(div().size(30).flex_none().flex().items_center().justify_center().rounded(15).bg(p[`${authorTone(commit.author)}Wash`]).text_color(p[authorTone(commit.author)]).text_size(10).font_semibold().child(authorInitials(commit.author)))
            .child(v_flex().flex_1().min_w(0).gap(5)
              .child(div().truncate().text_size(12).font_semibold().child(commit.subject))
              .child(h_flex().gap(6).items_center()
                .child(div().flex_1().min_w(0).truncate().text_size(10).text_color(p.secondary).child(`${commit.author} · ${new Date(commit.date).toLocaleDateString()}`))
                .child(div().flex_none().text_size(10).text_color(p.blue).child(commit.short))))))
        .when(!this.history.length, e => e.child(div().p(8).text_color(t.dim).child(this.historyLoading ? "Loading commit history…" : "No commits found")))
        .when(Boolean(this.historyError), e => e.child(div().p(8).text_size(11).text_color(p.red).child(this.historyError)))
        .when(this.historyHasMore, e => e.child(div().id("history-load-more").flex_none().py(10).rounded(10).bg(p.inset).text_color(p.blue).text_size(12).text_center()
          .disabled(this.historyLoading).hover(s => s.bg(p.hover))
          .on_click((_e, cx) => { if (!this.historyLoading) cx.spawn(async cx => { await this.loadHistory(cx, true); }); })
          .child(this.historyLoading ? "Loading commits…" : "Load 25 more commits"))))
        .when(this.mode === "changes", el => el.children(this.files.map((f) => {
        const parts = f.path.split("/"), name = parts.pop();
        return h_flex().id(`change-${f.path}`).h(36).flex_none().px(10).gap(8).items_center().rounded(9).cursor_pointer().bg(this.open === f.path ? p.blueWash : p.card).hover((s) => s.bg(p.hover)).on_click((_e, cx) => this.pick(f.path, cx))
          .child(div().w(14).text_size(11).text_color(f.status === "A" ? t.ansi2 : f.status === "D" ? t.ansi1 : f.status === "U" ? t.ansi1 : t.blocked).child(f.status))
          .child(h_flex().flex_1().min_w(0).child(div().text_color(t.dim).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().max_w(260).min_w(0).truncate().child(name)))
          .when(f.add > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${f.add}`))).when(f.del > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${f.del}`)));
      })).when(!this.files.length, (e) => e.child(div().p(8).text_color(t.dim).child(this.error || (this.loading ? "Loading changes…" : this.root ? "No uncommitted changes" : "No folder"))))))
      .when(this.limited, el => el.child(div().px(12).py(4).text_size(11).text_color(t.dim).child("Showing the first 1,000 changed files")))
      .when(this.mode === "history", el => el.child(this.historyFilesView(p, t, commit)))
      .when(this.mode === "changes", el => el.child(v_flex().flex_none().mx(12).mt(4).px(12).py(10).gap(4).rounded(10).bg(p.card)
        .child(div().text_size(12).font_semibold().truncate().child(this.mode === "history" ? commit?.subject || "Commit preview" : this.open?.split("/").pop() || "Diff preview"))
        .child(div().text_size(10).text_color(p.secondary).truncate().child(this.mode === "history" ? commit ? `${commit.short} · ${commit.author}` : "Select a commit to explore its changes" : this.open || "Select a file to inspect its changes"))))
      .when(this.mode === "changes", el => el.child(div().flex_1().min_h(0).relative().mt(8).bg(p.card).font_family(settings().font_family ?? "JetBrains Mono").text_size(11)
        .child(div().id("changes-diff-x").size_full().overflow_x_scrollbar()
          .child(div().w_full().min_w(this.diffWidth).h_full().child(v_virtual_list("changes-diff", this.rows.length, 20, (i) => String(i),
            (range) => this.rows.slice(range.start, range.end).map((row) => this.diffRow(row, t))).size_full())))
        .child(Scrollbar.vertical("changes-diff").viewport_from_layout().absolute().inset_0())
        .when(this.mode === "changes" && !this.open && this.files.length > 0, (e) => e.child(div().absolute().top(6).px(12).text_color(t.dim).child("Select a file to view its changes")))))
      .when(Boolean(this.note), (e) => e.child(div().px(10).pb(8).text_size(11).text_color(t.ansi1).child(this.note)))
      .when(this.mode === "changes", el => el.child(h_flex().flex_none().p(12).gap(8).border_t(1).border_color(p.stroke)
        .child(div().id("commit-message").flex_1().min_w(0).h(32).px(10).flex().items_center().rounded(8).border_1().border_color(this.typing ? t.accent : t.border).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
        .child(div().id("commit").h(32).px(14).flex().items_center().rounded(8).bg(enabled ? p.action : p.inset).text_color(enabled ? p.white : p.muted).text_size(12).when(enabled, (e) => e.cursor_pointer()).on_click((_e, cx) => this.commit(cx)).child(this.busy ? "Committing…" : "Commit"))));
  }
}
