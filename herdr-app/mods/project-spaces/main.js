import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, terminals, exec, hc, run, theme, props, openOverlay, closeOverlay, pickFolder, window, shared, setShared, notify } from "herdr";
import { normalize, inside, projectKey, basename, parseWorktrees, parseStatus, locations, spacesFor, projectSpaceIndex, removalBlock, resumablePanes, resumeCommand, resumeName } from "./data.js";

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

// Attention means a human should look now: an agent finished unseen or is
// waiting on input. Working is one step quieter (spinner, no border) so the
// attention signal keeps its meaning. Only idle stays silent.
const ATTENTION = ["blocked", "done"];
const isAttention = status => ATTENTION.includes(status);
const attentionOf = list => ATTENTION.find(k => list.some(s => s.status === k));
// Tinted fill + colored border + pulsing dot: readable in peripheral vision,
// where the old 10px colored-text badge on `raised` was not.
const attentionPill = (status, t, label) => h_flex().flex_none().items_center().gap(5)
  .px(7).py(2).rounded(6).bg((t[status] || t.accent) + "30").border(1).border_color(t[status] || t.accent)
  .text_size(10.5).font_bold().text_color(t[status] || t.accent)
  .child(div().size(7).rounded(4).flex_none().bg(t[status] || t.accent).loop("opacity", { from: 1, to: 0.25, period: 1300 }))
  .child(label ?? (status === "blocked" ? "Needs you" : "Done"));
// Working: same spinner the shipped agents/tabs mods use, tinted fill, no
// border. Rotation reads as "in progress"; the pulsing dot stays "look now".
// Resume: an accent pill-button. Clicking types the agent's resume line into
// the recovered shell pane; it never fires on its own.
const resumeButton = (id, entry, t, resume) => h_flex().id(id).flex_none().items_center().gap(5)
  .px(7).py(2).rounded(6).bg((t.accent || t.ansi4) + "2b").border(1).border_color(t.accent || t.ansi4)
  .text_size(10.5).font_semibold().text_color(t.accent || t.ansi4)
  .hover(s => s.bg(t.hover))
  .on_click((_e, cx) => { cx.stop_propagation(); resume(entry, cx); })
  .child(`↩ Resume ${resumeName(entry.app)}`);
const workingPill = (t, label) => h_flex().flex_none().items_center().gap(5)
  .px(7).py(2).rounded(6).bg((t.working || t.accent) + "2b")
  .text_size(10.5).font_semibold().text_color(t.working || t.accent)
  .child(svg("mods/workspace-chrome/spinner.svg").size(11).flex_none().text_color(t.working || t.accent).spin(900))
  .child(label ?? "Working");

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
          try {
            const generation = this.removalGeneration || 0;
            const rows = await inspect(p);
            // An overlapping removal invalidates this snapshot.
            if (generation === (this.removalGeneration || 0)) this.rows[p.key] = rows;
            else this.refreshAgain = true;
            delete this.errors[p.key];
          }
          catch (e) { this.errors[p.key] = String(e.message ?? e); }
        }
      } finally {
        this.busy = false;
        if (this.refreshAgain) { this.refreshAgain = false; this.discover(cx, true); }
        cx.notify();
      }
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
  resume(entry, cx) {
    const line = resumeCommand(entry.app, entry.session);
    if (!line) return;
    cx.spawn(async cx => {
      try { await hc(["send", entry.terminal, line]); }
      catch (e) { notify({ title: "Couldn't resume session", body: String(e.message ?? e), level: "error" }); }
      cx.notify();
    });
  }
  resumeAll(entries, cx) {
    for (const entry of entries) this.resume(entry, cx);
  }
  open(project, row) {
    if (this.isRemoving(project, row.path)) return;
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
  isRemoving(project, path) {
    const matches = job => job && job.project.key === project.key && job.path === path;
    return Boolean(matches(this.removing) || (shared("projects.removals") || []).some(matches));
  }
  confirmRemoval() {
    if (this.busy || this.blocked || !this.target || this.submitted) return;
    this.submitted = true;
    const queue = shared("projects.removals") || [];
    if (!queue.some(job => job.project.key === this.dialog.project.key && job.path === this.dialog.path)) {
      setShared("projects.removals", [...queue, this.dialog]);
    }
    closeOverlay(props().overlay);
  }
  processRemovals(cx) {
    if (this.removing) return;
    const queue = shared("projects.removals") || [];
    if (!queue.length) return;
    const job = queue[0];
    this.removing = job;
    this.removalGeneration = (this.removalGeneration || 0) + 1;
    // Claim once before starting: never replay an uncertain deletion after restart.
    setShared("projects.removals", queue.slice(1));
    cx.spawn(async cx => {
      try {
        const rows = await inspect(job.project);
        const row = rows.find(r => r.path === job.path);
        const blocked = removalBlock(row, row && this.isOpen(job.project, row, rows));
        if (blocked) throw new Error(blocked);
        // Exact registration only. Two force flags also handle locked checkouts.
        await git(job.project.cwd, ["worktree", "remove", "--force", "--force", "--", row.path], job.project.machine);
        // Drop the stale card before unlocking it, even if a refresh is already running.
        this.rows[job.project.key] = (this.rows[job.project.key] || []).filter(row => row.path !== job.path);
        notify({ title: "Worktree removed", body: job.path, level: "success" });
      } catch (e) {
        notify({ title: "Couldn't remove worktree", body: `${job.path}\n${String(e.message ?? e)}`, level: "error", timeout: 12000 });
      } finally {
        this.removalGeneration++;
        this.removing = null;
        if (this.busy) this.refreshAgain = true;
        else this.discover(cx, true);
        cx.notify();
      }
    });
  }
  checkRemoval(cx) {
    if (this.busy) return;
    this.busy = true; this.error = ""; cx.notify();
    cx.spawn(async cx => {
      try {
        const { project, path } = this.dialog;
        const rows = await inspect(project);
        const row = rows.find(r => r.path === path);
        const blocked = removalBlock(row, row && this.isOpen(project, row, rows));
        this.target = row; this.blocked = blocked;
      } catch (e) { this.error = String(e.message ?? e); this.blocked = "Could not verify or remove the worktree."; }
      finally { this.busy = false; cx.notify(); }
    });
  }
  renderDialog(t) {
    const row = this.target;
    return v_flex().size_full().p(20).gap(14).bg(t.popover).text_size(13).text_color(t.foreground)
      .track_focus(this.handle)
      .child(div().text_size(18).font_semibold().child("Remove worktree?"))
      .child(v_flex().p(12).gap(5).rounded(8).bg(t.surface).border(1).border_color(t.border)
        .child(div().font_semibold().child(row?.branch || basename(this.dialog.path)))
        .child(div().text_size(11).text_color(t.muted).child(this.dialog.path)))
      .child(div().text_color(t.muted).child("Free up this checkout's space. Your branch will be kept."))
      .child(v_flex().p(12).gap(5).rounded(8).bg(t.surface)
        .child(div().font_semibold().text_color(t.blocked).child("Local files will be permanently deleted"))
        .child(div().text_color(t.muted).child("Includes uncommitted changes, untracked and ignored files. Locked worktrees are removed too. This cannot be undone.")))
      .child(v_flex().flex_1().min_h(0).gap(8).overflow_y_scrollbar()
        .when(this.busy, el => el.child(h_flex().gap(8).items_center().text_color(t.muted)
          .child(div().text_color(t.accent).frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90))
          .child("Checking worktree…")))
        .when(!this.busy && Boolean(row), el => el.child(div().text_size(12).text_color(t.muted).child(
          `${row?.unpublished ?? "Unknown"} commit(s) not on local remote-tracking refs. Remote information may be stale; nothing is fetched.`)))
        .when(!this.busy && Boolean(row && !row.branch), el => el.child(div().text_color(t.blocked).child("Detached HEAD: commits may become unreachable.")))
        .when(Boolean(row?.error), el => el.child(div().text_color(t.blocked).child(`Status unavailable: ${row.error}`)))
        .when(Boolean(this.blocked || this.error), el => el.child(div().text_color(t.blocked).child(this.error || this.blocked))))
      .child(h_flex().gap(8).items_center().justify_end()
        .child(button("cancel", "Cancel", () => closeOverlay(props().overlay), t))
        .when(!this.busy && !this.blocked && Boolean(row), el => el.child(
          div().id("remove").px(12).py(8).rounded(6).bg(t.blocked).text_color(t.background).font_semibold()
            .on_click(() => this.confirmRemoval()).child("Remove worktree"))));
  }
  renderMenu(t) {
    const { project, path, space } = this.menu;
    const act = fn => { closeOverlay(props().overlay); fn(); };
    return v_flex().p(8).gap(4).bg(t.popover)
      .when(Boolean(space), el => el
        .child(button("rename-space", "Rename space…", () => act(() => run("space.rename", { id: space })), t))
        .child(button("close-space", "Close space…", () => act(() => run("space.close", { id: space })), t)))
      .child(button("remove-checkout", "Remove worktree…", () => act(() => openOverlay({ mod: "project-spaces", kind: "dialog", width: 540, height: 460, props: { remove: { project, path } } })), t));
  }
  workTree(space, ps, t, grouped = false) {
    const tabs = space.tabs || [];
    if (!tabs.length) return v_flex().flex_none();
    // One line per tab. Pane detail lives in the tooltip only. No hover
    // state here. A notify on hover rebuilds the list mid-scroll and the
    // scrollbar fights the pointer.
    const buildTabRows = () => tabs.map(tab => {
      const panesInTab = ps.filter(p => p.tab === tab.id);
      const label = tab.named ? tab.name : `Tab ${tab.index}`;
      const program = p => p.program?.name || p.mod || "pane";
      const summary = panesInTab.length
        ? program(panesInTab[0]) + (panesInTab.length > 1 ? ` +${panesInTab.length - 1}` : "")
        : "";
      const tip = panesInTab.length
        ? panesInTab.map(p => `${program(p)}${p.title && p.title !== program(p) ? ` · ${p.title}` : ""}${p.status ? ` · ${p.status}` : ""}`).join("\n")
        : "No panes";
      return h_flex().id(`wt-tab-${space.id}-${tab.id}`).flex_none().items_center().gap(4).px(5).py(1).rounded(4)
        .when(tab.active, el => el.bg(t.raised))
        .hover(s => s.bg(t.hover))
        .tooltip(tip)
        .on_click((_e, cx) => { cx.stop_propagation(); run("space.select", { id: space.id }); run("tab.select", { id: tab.id }); })
        .child(tab.status === "working"
          ? svg("mods/workspace-chrome/spinner.svg").size(10).flex_none().text_color(t.working || t.accent).spin(900)
          : div().size(6).rounded(3).flex_none().bg(isAttention(tab.status) ? (t[tab.status] || t.accent) : t.dim))
        .child(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(tab.active ? t.foreground : t.muted)
          .when(tab.active, el => el.font_semibold())
          .child(label))
        .when(Boolean(summary), el => el.child(div().flex_none().max_w(90).truncate().text_size(10).text_color(t.dim).child(summary)))
        .when(Boolean(tab.settled), el => el.child(div().flex_none().text_size(9.5).text_color(t.dim).child("settled")));
    });
    if (!grouped) return v_flex().flex_none().pt(1).children(buildTabRows());
    // Several spaces share one checkout card. Name the space before its
    // tabs, or a tab row reads as belonging to the space you are in. Only
    // the active space lists tabs. The rest fold to one switch line.
    const paneCount = tabs.reduce((n, tab) => n + (tab.panes || 0), 0);
    const head = h_flex().id(`wt-space-${space.id}`).flex_none().items_center().gap(4).px(5).py(1).rounded(4)
      .when(space.active, el => el.bg(t.raised))
      .hover(s => s.bg(t.hover))
      .tooltip(`${tabs.length} tab${tabs.length === 1 ? "" : "s"} · ${paneCount} pane${paneCount === 1 ? "" : "s"}${space.status ? ` · ${space.status}` : ""}`)
      .on_click((_e, cx) => { cx.stop_propagation(); run("space.select", { id: space.id }); })
      .child(space.status === "working"
        ? svg("mods/workspace-chrome/spinner.svg").size(10).flex_none().text_color(t.working || t.accent).spin(900)
        : div().size(6).rounded(3).flex_none().bg(isAttention(space.status) ? (t[space.status] || t.accent) : space.active ? (t.accent || t.ansi4) : t.dim))
      .child(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(space.active ? t.foreground : t.muted)
        .when(space.active, el => el.font_semibold())
        .child(space.name))
      .child(div().flex_none().text_size(9.5).text_color(t.dim)
        .child(space.active ? `${tabs.length} tab${tabs.length === 1 ? "" : "s"}` : `${tabs.length} tab${tabs.length === 1 ? "" : "s"} · ${paneCount} pane${paneCount === 1 ? "" : "s"} ▸`));
    if (!space.active) return v_flex().flex_none().pt(1).child(head);
    return v_flex().flex_none().pt(1).child(head)
      .child(v_flex().flex_none().pl(10).children(buildTabRows()));
  }
  render(cx) {
    const t = theme();
    if (this.menu) return this.renderMenu(t);
    if (this.dialog) return this.renderDialog(t);
    this.processRemovals(cx);
    const sp = spaces(), ps = panes(), matched = new Set();
    // Recovered shells with a recorded session (the post-reboot shape).
    const resumable = resumablePanes(ps, terminals());
    const spaceByTab = new Map(sp.flatMap(s => (s.tabs || []).map(tab => [tab.id, s.id])));
    const resumableBySpace = new Map();
    for (const entry of resumable) {
      const spaceId = spaceByTab.get(entry.tab);
      if (!spaceId) continue;
      if (!resumableBySpace.has(spaceId)) resumableBySpace.set(spaceId, []);
      resumableBySpace.get(spaceId).push(entry);
    }
    const projectViews = this.projects.map(project => {
      const rows = this.rows[project.key] || [];
      const collapsed = this.collapsed.has(project.key);
      const tint = projectTone(project.key, t);
      const stale = Boolean(this.errors[project.key]);
      const byCheckout = projectSpaceIndex(rows, sp, ps, project.machine);
      for (const open of byCheckout.values()) for (const space of open) matched.add(space.id);
      // Project-level rollup, deduped by space: a collapsed project must still
      // announce a finished or waiting agent in its header.
      const openSpaces = [...new Map([...byCheckout.values()].flat().map(s => [s.id, s])).values()];
      const projStatus = attentionOf(openSpaces);
      const projCount = openSpaces.filter(s => isAttention(s.status)).length;
      const projWorking = openSpaces.filter(s => s.status === "working").length;
      // Collapsed groups still own their spaces, but build no hidden card trees.
      const cards = collapsed ? [] : rows.map((row, i) => {
        const deleting = this.isRemoving(project, row.path);
        const open = byCheckout.get(row) || [];
        const active = open.some(s => s.active);
        const status = ["blocked", "done", "working", "idle"].find(k => open.some(s => s.status === k));
        const needs = isAttention(status);
        const busy = status === "working";
        const flags = row.bare ? "Bare repository" : row.prunable ? "Missing / prunable" : row.error ? "Status unavailable" : !row.status ? "Unknown" : row.status.dirty ? "Modified" : "Clean";
        const counts = row.status?.upstream
          ? [row.status.ahead ? `↑${row.status.ahead}` : "", row.status.behind ? `↓${row.status.behind}` : ""].filter(Boolean).join(" ")
          : "";
        const available = !deleting && !row.bare && !row.prunable && !stale;
        const warning = row.error || row.prunable || !row.status || row.bare;
        const health = warning ? t.blocked : row.status.dirty ? t.ansi3 : t.ansi2;
        return v_flex().id(`checkout-${project.key}-${i}`).flex_none().px(8).py(5).gap(3).rounded(8)
          .border(needs ? 1.5 : 1).border_color(needs ? t[status] : active ? tint : busy ? (t.working || t.accent) + "99" : t.border)
          .bg(needs ? (t[status] || t.accent) + "1f" : busy && !active ? (t.working || t.accent) + "14" : active ? t.selected : t.surface)
          .tooltip([row.path, row.error, row.status?.upstream ? `Upstream: ${row.status.upstream} · ↑${row.status.ahead ?? "?"} ↓${row.status.behind ?? "?"}` : "No upstream", row.locked ? "Locked" : ""].filter(Boolean).join("\n"))
          .when(!active && !deleting, el => el.hover(s => s.bg(t.hover).border_color(tint)))
          .on_click(() => { if (available) this.open(project, row); })
          .on_mouse_down("right", (_e, cx) => {
            cx.stop_propagation();
            if (this.isRemoving(project, row.path)) return;
            openOverlay({ mod: "project-spaces", kind: "popup", width: 220, props: { spaceMenu: { project, path: row.path, space: open.find(s => s.active)?.id || open[0]?.id } } });
          })
          .child(h_flex().gap(6).items_center()
            .child(svg(`mods/project-spaces/${row.main ? "home" : "branch"}.svg`).size(13).flex_none().text_color(tint))
            .child(div().flex_1().min_w(0).truncate().text_color(deleting ? t.dim : t.foreground).text_size(12).font_semibold()
              .child(row.branch || (row.bare ? "bare" : `detached ${(row.head || "").slice(0, 7)}`)))
            .when(active && !needs && !busy, el => el.child(badge("Here", tint, t)))
            .when(needs, el => el.child(attentionPill(status, t)))
            .when(busy, el => el.child(workingPill(t))))
          .child(h_flex().gap(5).items_center()
            .child(div().size(5).rounded(3).flex_none().bg(health))
            .child(div().text_size(10.5).text_color(t.muted).child(deleting ? "Deleting…" : flags))
            .when(deleting, el => el.child(div().text_color(t.accent).frames(["⠋", "⠙", "⠹", "⠸"], 90)))
            .when(Boolean(row.locked), el => el.child(badge("Locked", t.ansi3, t)))
            .when(Boolean(counts), el => el.child(div().text_size(10).text_color(tint).child(counts)))
            .child(div().flex_1())
            .when(!deleting, el => el.child(div().text_size(10).text_color(open.length ? tint : t.dim).child(open.length ? "● Open" : "○ Closed"))))
          .children(!deleting ? open.flatMap(s => (resumableBySpace.get(s.id) || []).map((entry, j) =>
            h_flex().items_center().gap(6).pt(2)
              .child(resumeButton(`resume-${entry.terminal}-${j}`, entry, t, (e, cx) => this.resume(e, cx)))
              .child(div().flex_1().min_w(0).truncate().text_size(10).text_color(t.dim).child("session recorded")))) : [])
          .children(!deleting ? open.map(s => this.workTree(s, ps, t, open.length > 1)) : []);
      });
      return v_flex().flex_none().gap(4).pb(10)
        .child(h_flex().id(`project-toggle-${project.key}`).items_center().gap(7).px(6).py(5).rounded(7)
          .bg(projStatus ? (t[projStatus] || t.accent) + "24" : t.raised)
          .hover(s => s.bg(t.hover)).on_click((_e, cx) => this.toggleProject(project.key, cx))
          .child(div().size(24).flex_none().rounded(8).bg(t.surface).flex().items_center().justify_center()
            .text_size(11).font_bold().text_color(tint).child([...project.name][0]?.toUpperCase() || "P"))
          .child(div().flex_1().min_w(0).truncate().text_size(12).font_semibold().text_color(t.foreground).tooltip(project.cwd)
            .child(`${project.name}${project.machine ? ` · ${project.machine}` : ""}`))
          .when(Boolean(projStatus), el => el.child(attentionPill(projStatus, t,
            projCount > 1 ? (projStatus === "blocked" ? `${projCount} need you` : `${projCount} done`) : undefined)))
          .when(!projStatus && projWorking > 0, el => el.child(workingPill(t, projWorking > 1 ? `${projWorking} working` : "Working")))
          .child(badge(String(rows.length), tint, t))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(collapsed ? "▸" : "▾"))
          .child(button(`new-${project.key}`, "+", () => openOverlay({ mod: "worktree", kind: "dialog", width: 500, height: 300, props: { folder: rows.find(r => !r.bare && !r.prunable)?.path || project.cwd, machine: project.machine, action: "new" } }), t)))
        .when(stale, el => el.child(div().text_size(11).text_color(t.blocked).child(`Refresh failed (old data): ${this.errors[project.key]}`)))
        .when(!collapsed && !rows.length && !stale, el => el.child(div().text_size(11).text_color(t.dim).child("Loading worktrees…")))
        .children(collapsed ? [] : cards);
    });
    const otherSpaces = sp.filter(s => !matched.has(s.id));
    // Sidebar-wide totals in the fixed header: news is visible without scrolling.
    const waiting = sp.filter(s => s.status === "blocked").length;
    const finished = sp.filter(s => s.status === "done").length;
    const running = sp.filter(s => s.status === "working").length;
    return v_flex().size_full().min_h(0).bg(t.chrome).text_color(t.foreground)
      .child(h_flex().h(38).px(12).items_center().gap(6)
        .child(svg("mods/project-spaces/spark.svg").size(14).flex_none().text_color(t.ansi3))
        .child(div().flex_1().min_w(0).truncate().text_size(12).font_semibold().child("Your projects"))
        .when(waiting > 0, el => el.child(attentionPill("blocked", t, waiting === 1 ? "1 needs you" : `${waiting} need you`)))
        .when(finished > 0, el => el.child(attentionPill("done", t, `${finished} done`)))
        .when(running > 0, el => el.child(workingPill(t, `${running} working`)))
        .when(resumable.length > 0, el => el.child(
          h_flex().id("resume-all").flex_none().items_center().px(7).py(2).rounded(6)
            .bg((t.accent || t.ansi4) + "2b").border(1).border_color(t.accent || t.ansi4)
            .text_size(10.5).font_semibold().text_color(t.accent || t.ansi4)
            .hover(s => s.bg(t.hover))
            .on_click((_e, cx) => { cx.stop_propagation(); this.resumeAll(resumable, cx); })
            .child(`↩ Resume ${resumable.length}`)))
        .child(button("refresh", this.busy ? "…" : "↻", cx => this.discover(cx, true), t))
        .child(button("add-project", "+", cx => this.pick(cx), t)))
      .when(Boolean(this.removing), el => el.child(h_flex().px(12).py(8).gap(6).items_center().text_size(11).text_color(t.muted)
        .child(div().text_color(t.accent).frames(["⠋", "⠙", "⠹", "⠸"], 90))
        .child(div().truncate().child(`Removing ${basename(this.removing.path)}…`))))
      .child(v_flex().flex_1().min_h(0).px(8).overflow_y_scrollbar().mode("always")
        .when(Boolean(this.error), el => el.child(div().text_size(11).text_color(t.blocked).child(this.error)))
        .children(projectViews)
        .when(Boolean(otherSpaces.length), el => el.child(v_flex().pt(8).gap(5)
          .child(div().px(4).text_size(10).font_bold().text_color(t.muted).child("OTHER SPACES"))
          .children(otherSpaces.map(s => v_flex().flex_none().gap(1)
            .child(h_flex().id(`other-${s.id}`).items_center().gap(6).px(6).py(3).rounded(6)
            .bg(isAttention(s.status) ? (t[s.status] || t.accent) + "1f" : t.surface)
            .border(isAttention(s.status) ? 1 : 0).border_color(t[s.status] || t.border)
            .hover(el => el.bg(t.hover))
            .on_click(() => run("space.select", { id: s.id }))
            .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(s.active ? t.foreground : t.muted)
              .child(`${s.active ? "● " : ""}${s.name}${s.machine ? ` · ${s.machine}` : ""}`))
            .when(isAttention(s.status), el => el.child(attentionPill(s.status, t)))
            .when(s.status === "working", el => el.child(workingPill(t)))
            .children((resumableBySpace.get(s.id) || []).map((entry, j) => resumeButton(`resume-other-${entry.terminal}-${j}`, entry, t, (e, cx) => this.resume(e, cx)))))
            .child(this.workTree(s, ps, t)))))))
      .child(h_flex().px(8).py(4).gap(4)
        .child(button("new-space", "+ Space", () => run("space.new"), t))
        .child(button("machines", "Machines", () => openOverlay({ mod: "spaces", kind: "dialog", width: 340, height: 500 }), t)));
  }
}
