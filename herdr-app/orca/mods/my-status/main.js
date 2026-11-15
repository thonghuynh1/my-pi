import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, theme, run, window, keys, props, exec } from "herdr";

const PR_EVERY = 60 * 1000; // ms, re-check the focused branch's PR
const PR_FIELDS = "number,title,state,isDraft,url,closingIssuesReferences";

export default class WorkspaceStatus extends View {
  init(_props, cx) {
    this.prs = {};    // "machine|cwd|branch" → PR json, or null when there is none
    this.busy = {};
    this.key = null;
    if (props()?.part === "machine") return;
    cx.timer.every(PR_EVERY, (cx) => this.fetchPr(this.target(), cx));
  }

  // The focused terminal's folder and branch, on its space's machine.
  target() {
    const pane = panes().find((p) => p.focused);
    const space = spaces().find((s) => s.active);
    if (!pane?.cwd || !pane.branch) return null;
    return { cwd: pane.cwd, branch: pane.branch, on: space?.machine ?? null, key: `${space?.machine ?? ""}|${pane.cwd}|${pane.branch}` };
  }

  fetchPr(tg, cx) {
    if (!tg || this.busy[tg.key]) return;
    this.busy[tg.key] = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("gh", ["pr", "view", tg.branch, "--json", PR_FIELDS], { cwd: tg.cwd, on: tg.on });
        // Non-zero is "no PR for this branch" (or not a GitHub repo): show nothing.
        this.prs[tg.key] = r.code === 0 ? JSON.parse(r.stdout) : null;
      } catch {
        // gh missing or offline: keep the last answer
      }
      this.busy[tg.key] = false;
      cx.notify();
    });
  }

  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  prIcons(pr, t) {
    if (!pr) return [];
    const merged = pr.state === "MERGED";
    const color = merged ? t.ansi5 : pr.state === "CLOSED" ? t.ansi1 : pr.isDraft ? t.dim : t.ansi2;
    const status = merged ? "merged" : pr.state === "CLOSED" ? "closed" : pr.isDraft ? "draft" : "open";
    const issues = pr.closingIssuesReferences ?? [];
    const icon = (id, name, c, tip, url) => div().id(id).cursor_pointer().tooltip(tip)
      .on_click(() => exec("open", [url]))
      .child(svg(`mods/my-status/icons/${name}.svg`).size(14).text_color(c));
    return [
      issues.length > 0 && icon("issue", "issue", t.muted, `Linked: ${issues.map((i) => `#${i.number}`).join(", ")}`, issues[0].url),
      icon("pr", "pr", color, `#${pr.number} ${pr.title} (${status})`, pr.url),
    ].filter(Boolean);
  }

  render(cx) {
    const t = theme();
    const space = spaces().find(s => s.active);
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    // part "machine": the machine only (right end); "commands": branch, PR and palette hint
    const part = props()?.part;
    let pr = null;
    if (part !== "machine") {
      const tg = this.target();
      if (tg && tg.key !== this.key) this.fetchPr(tg, cx);
      this.key = tg?.key ?? null;
      pr = tg ? this.prs[tg.key] : null;
    }
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .when(part !== "commands", el => el.child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer")))
      .when(part !== "machine", el => el
        .child(div().flex_1())
        .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
        .child(h_flex().gap(10).items_center().children(this.prIcons(pr, t)))
        .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t))));
  }
}
