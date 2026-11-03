import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, terminals, exec, run, theme, props, openOverlay, closeOverlay, pickFolder, window } from "herdr";
import { normalize, inside, projectKey, basename, parseWorktrees, parseStatus, locations, spacesFor, removalBlock } from "./data.js";

const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false"];
async function git(cwd, args, machine) {
  const r = await exec("git", [...READ, ...args], { cwd, on: machine ?? undefined });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || "Git failed").trim());
  return r.stdout;
}
async function inspect(project) {
  const text = await git(project.cwd, ["worktree", "list", "--porcelain", "-z"], project.machine);
  const rows = parseWorktrees(text);
  for (const row of rows) {
    if (row.bare || row.prunable) continue;
    try {
      row.status = parseStatus(await git(row.path, ["status", "--porcelain=v2", "--branch", "--untracked-files=normal"], project.machine));
      // Distinguish upstream divergence from local commits not on any remote ref.
      const local = await git(row.path, ["rev-list", "--count", "HEAD", "--not", "--remotes"], project.machine);
      row.unpublished = Number(local.trim());
    } catch (e) { row.error = String(e.message ?? e); }
  }
  return rows;
}
const button = (id, text, action, t) => div().id(id).px(6).py(3).rounded(4).flex_none()
  .text_size(11).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
  .on_click((_e, cx) => { cx.stop_propagation(); action(cx); }).child(text);

// Stable theme-derived color: projects keep their personality after reordering.
const projectTone = (key, t) => {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return [t.ansi6, t.ansi5, t.ansi3, t.ansi4, t.ansi2][hash % 5] || t.accent;
};
const badge = (label, color, t) => h_flex().flex_none().items_center().gap(4)
  .px(5).py(1).rounded(5).bg(t.raised).text_size(10).text_color(color).child(label);

export default class Projects extends View {
  init(_props, cx) {
    this.error = ""; this.projects = []; this.found = {}; this.retry = {}; this.rows = {}; this.errors = {};
    this.busy = false;
    this.collapsed = new Set();
    try { this.collapsed = new Set(JSON.parse(localStorage.getItem("projects.collapsed") || "[]")); } catch {}
    this.menu = props()?.spaceMenu;
    if (this.menu) return;
    this.dialog = props()?.remove;
    if (this.dialog) {
      this.handle = cx.focus_handle(); this.handle.focus();
      this.checkRemoval(cx);
      return;
    }
    try { this.projects = JSON.parse(localStorage.getItem("projects") || "[]"); } catch {}
    this.discover(cx, true);
    // Live spaces are cheap to compare; Git only runs for new locations or on refresh.
    cx.timer.every(2000, cx => { if (window().active) this.discover(cx); });
    cx.timer.every(15000, cx => { if (window().active) this.discover(cx, true); });
  }

  save() { localStorage.setItem("projects", JSON.stringify(this.projects)); }
  toggleProject(key, cx) {
    if (this.collapsed.has(key)) this.collapsed.delete(key);
    else this.collapsed.add(key);
    localStorage.setItem("projects.collapsed", JSON.stringify([...this.collapsed]));
    cx.notify();
  }
  async add(folder, machine) {
    const common = normalize((await git(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"], machine)).trim());
    const key = projectKey(machine, common);
    if (!this.projects.some(p => p.key === key)) {
      // Keep the common directory as the discovery cwd: it survives linked-checkout removal.
      this.projects.push({ key, cwd: common, machine: machine ?? null,
        name: basename(common.endsWith("/.git") ? common.slice(0, -5) : common) });
      this.save();
    }
    return key;
  }
  discover(cx, force = false) {
    if (this.busy) return;
    const sp = spaces(), ps = panes(), now = Date.now();
    const places = sp.flatMap(s => locations(s, ps).map(folder => ({ folder, machine: s.machine ?? null })));
    const newPlaces = places.filter(p => {
      const key = projectKey(p.machine, p.folder);
      return !this.found[key] && now >= (this.retry[key] || 0);
    });
    if (!force && !newPlaces.length) return;
    this.busy = true;
    cx.spawn(async cx => {
      try {
        for (const p of newPlaces) {
          const key = projectKey(p.machine, p.folder);
          try { this.found[key] = await this.add(p.folder, p.machine); }
          catch { this.retry[key] = Date.now() + 60000; }
        }
        for (const p of this.projects) {
          try { this.rows[p.key] = await inspect(p); delete this.errors[p.key]; }
          catch (e) { this.errors[p.key] = String(e.message ?? e); }
        }
      } finally { this.busy = false; cx.notify(); }
    });
  }
  pick(cx) {
    cx.spawn(async cx => {
      try {
        const folder = await pickFolder({ prompt: "Add project" });
        if (!folder) return;
        await this.add(folder, null); this.error = "";
        this.discover(cx, true);
      } catch (e) { this.error = String(e.message ?? e); }
      cx.notify();
    });
  }
  open(project, row) {
    const match = spacesFor(row, this.rows[project.key] || [], spaces(), panes(), project.machine);
    if (match.length) run("space.select", { id: match.find(s => s.active)?.id || match[0].id });
    else run("space.new", { folder: row.path, machine: project.machine ?? "" });
  }
  isOpen(project, row, rows) {
    if (spaces().some(s => (s.machine ?? null) === (project.machine ?? null) && locations(s, panes()).some(path => inside(path, row.path)))) return true;
    // Conservative deletion guard: also includes core terminals not displayed as spaces.
    return terminals().some(t => (t.machine ?? null) === (project.machine ?? null) && inside(t.cwd, row.path)) ||
      panes().some(p => spaces().some(s => (s.machine ?? null) === (project.machine ?? null) && (s.tabs || []).some(tab => tab.id === p.tab)) && inside(p.cwd, row.path));
  }
  checkRemoval(cx, remove = false) {
    if (this.busy) return;
    this.busy = true; this.error = "";
    cx.spawn(async cx => {
      try {
        const { project, path } = this.dialog;
        const rows = await inspect(project);
        const row = rows.find(r => r.path === path);
        const blocked = removalBlock(row, row && this.isOpen(project, row, rows));
        this.target = row; this.blocked = blocked;
        if (remove && !blocked) {
          // No force, no branch deletion, no space closing. Git checks dirty/locked again.
          await git(project.cwd, ["worktree", "remove", "--", row.path], project.machine);
          closeOverlay(props().overlay);
        }
      } catch (e) { this.error = String(e.message ?? e); this.blocked = "Could not verify or remove the worktree."; }
      finally { this.busy = false; cx.notify(); }
    });
  }
  renderDialog(t) {
    const row = this.target;
    return v_flex().size_full().p(16).gap(12).bg(t.popover).text_size(13).text_color(t.foreground)
      .track_focus(this.handle)
      .child(div().font_semibold().child(`Remove ${row?.branch || "worktree"}?`))
      .child(div().child(this.dialog.path))
      .child(div().text_color(t.muted).child("Deletes this checkout directory only. The branch is kept. No force removal."))
      .child(div().text_color(t.blocked).child("Clean does not mean safe to delete. Remote information is local and may be stale; nothing is fetched."))
      .when(Boolean(row), el => el.child(div().text_color(t.muted).child(
        `${row?.unpublished ?? "Unknown"} commit(s) not on local remote-tracking refs. ${row?.status?.upstream ? `Upstream: ${row.status.upstream}; ahead ${row.status.ahead ?? "?"}, behind ${row.status.behind ?? "?"}.` : "No upstream / detached: review the branch first."}`)))
      .when(Boolean(this.blocked || this.error), el => el.child(div().text_color(t.blocked).child(this.error || this.blocked)))
      .child(h_flex().gap(8).justify_end()
        .child(button("cancel", "Cancel", () => closeOverlay(props().overlay), t))
        .when(!this.busy && !this.blocked && Boolean(row), el => el.child(button("remove", "Remove checkout", cx => this.checkRemoval(cx, true), t)))
        .when(this.busy, el => el.child(div().child("Checking…"))));
  }
  renderMenu(t) {
    const { project, path, space } = this.menu;
    const act = fn => { closeOverlay(props().overlay); fn(); };
    return v_flex().p(8).gap(4).bg(t.popover)
      .when(Boolean(space), el => el
        .child(button("rename-space", "Rename space…", () => act(() => run("space.rename", { id: space })), t))
        .child(button("close-space", "Close space…", () => act(() => run("space.close", { id: space })), t)))
      .child(button("remove-checkout", "Remove worktree…", () => act(() => openOverlay({ mod: "project-spaces", kind: "dialog", width: 530, height: 320, props: { remove: { project, path } } })), t));
  }
  render() {
    const t = theme();
    if (this.menu) return this.renderMenu(t);
    if (this.dialog) return this.renderDialog(t);
    const sp = spaces(), ps = panes(), matched = new Set();
    const projectViews = this.projects.map(project => {
      const rows = this.rows[project.key] || [];
      const collapsed = this.collapsed.has(project.key);
      const tint = projectTone(project.key, t);
      const stale = Boolean(this.errors[project.key]);
      const cards = rows.map((row, i) => {
        const open = spacesFor(row, rows, sp, ps, project.machine);
        open.forEach(s => matched.add(s.id));
        const active = open.some(s => s.active);
        const status = ["blocked", "done", "working", "idle"].find(k => open.some(s => s.status === k));
        const flags = row.bare ? "Bare repository" : row.prunable ? "Missing / prunable" : row.error ? "Status unavailable" : !row.status ? "Unknown" : row.status.dirty ? "Modified" : "Clean";
        const counts = row.status?.upstream
          ? [row.status.ahead ? `↑${row.status.ahead}` : "", row.status.behind ? `↓${row.status.behind}` : ""].filter(Boolean).join(" ")
          : "";
        const available = !row.bare && !row.prunable && !stale;
        const warning = row.error || row.prunable || !row.status || row.bare;
        const health = warning ? t.blocked : row.status.dirty ? t.ansi3 : t.ansi2;
        return v_flex().id(`checkout-${project.key}-${i}`).flex_none().px(8).py(5).gap(3).rounded(8)
          .border(1).border_color(active ? tint : t.border).bg(active ? t.selected : t.surface)
          .tooltip([row.path, row.error, row.status?.upstream ? `Upstream: ${row.status.upstream} · ↑${row.status.ahead ?? "?"} ↓${row.status.behind ?? "?"}` : "No upstream", row.locked ? "Locked" : ""].filter(Boolean).join("\n"))
          .when(!active, el => el.hover(s => s.bg(t.hover).border_color(tint)))
          .on_click(() => { if (available) this.open(project, row); })
          .on_mouse_down("right", (_e, cx) => {
            cx.stop_propagation();
            openOverlay({ mod: "project-spaces", kind: "popup", width: 220, props: { spaceMenu: { project, path: row.path, space: open.find(s => s.active)?.id || open[0]?.id } } });
          })
          .child(h_flex().gap(6).items_center()
            .child(svg(`mods/project-spaces/${row.main ? "home" : "branch"}.svg`).size(13).flex_none().text_color(tint))
            .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).text_size(12).font_semibold()
              .child(row.branch || (row.bare ? "bare" : `detached ${(row.head || "").slice(0, 7)}`)))
            .when(active, el => el.child(badge("Here", tint, t)))
            .when(Boolean(status && status !== "idle"), el => el.child(badge(status === "working" ? "Working" : status === "done" ? "Done" : "Needs you", t[status] || t.dim, t))))
          .child(h_flex().gap(5).items_center()
            .child(div().size(5).rounded(3).flex_none().bg(health))
            .child(div().text_size(10.5).text_color(t.muted).child(flags))
            .when(Boolean(row.locked), el => el.child(badge("Locked", t.ansi3, t)))
            .when(Boolean(counts), el => el.child(div().text_size(10).text_color(tint).child(counts)))
            .child(div().flex_1())
            .child(div().text_size(10).text_color(open.length ? tint : t.dim).child(open.length ? "● Open" : "○ Closed")))
          .children(open.length > 1 ? open.map(s => button(`space-${s.id}`, `${s.active ? "● " : ""}${s.name}`, () => run("space.select", { id: s.id }), t)) : []);
      });
      return v_flex().flex_none().gap(4).pb(10)
        .child(h_flex().id(`project-toggle-${project.key}`).items_center().gap(7).px(3).py(5).rounded(7)
          .hover(s => s.bg(t.hover)).on_click((_e, cx) => this.toggleProject(project.key, cx))
          .child(div().size(24).flex_none().rounded(8).bg(t.raised).flex().items_center().justify_center()
            .text_size(11).font_bold().text_color(tint).child([...project.name][0]?.toUpperCase() || "P"))
          .child(div().flex_1().min_w(0).truncate().text_size(12).font_semibold().text_color(t.foreground).tooltip(project.cwd)
            .child(`${project.name}${project.machine ? ` · ${project.machine}` : ""}`))
          .child(badge(String(rows.length), tint, t))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(collapsed ? "▸" : "▾"))
          .child(button(`new-${project.key}`, "+", () => openOverlay({ mod: "worktree", kind: "dialog", width: 500, height: 300, props: { folder: rows.find(r => !r.bare && !r.prunable)?.path || project.cwd, machine: project.machine, action: "new" } }), t)))
        .when(stale, el => el.child(div().text_size(11).text_color(t.blocked).child(`Refresh failed (old data): ${this.errors[project.key]}`)))
        .when(!collapsed && !rows.length && !stale, el => el.child(div().text_size(11).text_color(t.dim).child("Loading worktrees…")))
        .children(collapsed ? [] : cards);
    });
    return v_flex().size_full().min_h(0).bg(t.chrome).text_color(t.foreground)
      .child(h_flex().h(38).px(12).items_center().gap(6)
        .child(svg("mods/project-spaces/spark.svg").size(14).flex_none().text_color(t.ansi3))
        .child(div().flex_1().text_size(12).font_semibold().child("Your projects"))
        .child(button("refresh", this.busy ? "…" : "↻", cx => this.discover(cx, true), t))
        .child(button("add-project", "+", cx => this.pick(cx), t)))
      .child(v_flex().flex_1().min_h(0).px(8).overflow_y_scrollbar().mode("always")
        .when(Boolean(this.error), el => el.child(div().text_size(11).text_color(t.blocked).child(this.error)))
        .children(projectViews)
        .children(sp.filter(s => !matched.has(s.id)).map(s => button(`other-${s.id}`, `${s.active ? "● " : ""}${s.name}${s.machine ? ` · ${s.machine}` : ""}`, () => run("space.select", { id: s.id }), t))))
      .child(h_flex().px(8).py(4).gap(4)
        .child(button("new-space", "+ Space", () => run("space.new"), t))
        .child(button("machines", "Machines", () => openOverlay({ mod: "spaces", kind: "dialog", width: 340, height: 500 }), t)));
  }
}
