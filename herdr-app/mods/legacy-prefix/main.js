// Personal Ctrl+B prefix menu, matching the old Herdr terminal defaults.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, theme, props, closeOverlay, focused, panes, openOverlay } from "herdr";

export const BINDINGS = [
  ["c", "New tab", "tab.new"],
  ["n", "Next tab", "tab.next"],
  ["p", "Previous tab", "tab.prev"],
  ["T", "Rename tab", "tab.rename"],
  ["X", "Close tab", "tab.close"],
  ["v", "Split right", "pane.split", { direction: "right" }],
  ["-", "Split down", "pane.split", { direction: "down" }],
  ["h", "Focus left", "pane.go", { direction: "left" }],
  ["j", "Focus down", "pane.go", { direction: "down" }],
  ["k", "Focus up", "pane.go", { direction: "up" }],
  ["l", "Focus right", "pane.go", { direction: "right" }],
  ["x", "Close pane immediately", "close-pane"],
  ["z", "Zoom pane", "pane.zoom"],
  ["b", "Toggle sidebar", "layout.toggle", { id: "sidebar" }],
  ["s", "Settings", "app.settings"],
  ["w", "Workspace picker", "mod.open", { name: "picker" }],
  ["g", "Go to tab / workspace", "mod.open", { name: "picker" }],
  ["N", "New workspace", "space.new"],
  ["W", "Rename workspace", "space.rename"],
  ["D", "Close workspace", "space.close"],
];

export default class LegacyPrefix extends View {
  init(_props, cx) {
    this.target = focused();
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.message = "Press a key below; Shift gives uppercase. Esc cancels.";
  }

  finish(command, args) {
    if (command === "close-pane") {
      if (!this.target?.pane) return;
      closeOverlay(props().overlay);
      if (this.target.terminal) run("terminal.kill", { terminal: this.target.terminal });
      else run("pane.close", { pane: this.target.pane });
      return;
    }
    closeOverlay(props().overlay);
    run(command, args);
  }

  key(e, cx) {
    cx.stop_propagation();
    if (e.is_held) return;
    const m = e.modifiers;
    if (e.key === "escape") return closeOverlay(props().overlay);
    if (m.control || m.alt || m.platform) return;
    const raw = e.key_char || e.key;
    const key = m.shift && /^[a-z]$/i.test(raw) ? raw.toUpperCase() : raw;
    if (key === "?" || (m.shift && e.key === "/")) {
      this.message = "This is the Ctrl+B help. Choose a command below, or Esc to cancel.";
    } else if (/^[1-9]$/.test(key)) {
      return this.finish("tab.select", { index: Number(key) });
    } else if (e.key === "tab") {
      const f = focused();
      const list = panes().filter(p => p.tab === f?.tab);
      const at = list.findIndex(p => p.pane === f?.pane);
      if (list.length) {
        const next = list[(at + (m.shift ? list.length - 1 : 1)) % list.length];
        return this.finish("pane.focus", { pane: next.pane });
      }
      return closeOverlay(props().overlay);
    } else if (key === "G") {
      const space = focused()?.space;
      closeOverlay(props().overlay);
      return openOverlay({ mod: "worktree", kind: "dialog", props: { space, action: "new" } });
    } else {
      const binding = BINDINGS.find(b => b[0] === key);
      if (binding) return this.finish(binding[2], binding[3]);
      this.message = "No equivalent for this key in Herdr App. Choose below, or Esc to cancel.";
    }
    cx.notify();
  }

  render() {
    const t = theme();
    return v_flex().id("legacy-prefix").track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full().p(16).gap(8).bg(t.popover).text_color(t.foreground).text_size(13)
      .child(div().font_semibold().text_size(16).child("Ctrl+B · Herdr terminal shortcuts"))
      .child(div().text_color(t.muted).child(this.message))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().gap(2).children(
        BINDINGS.map(([key, label, command, args]) =>
          h_flex().id(`binding-${key}`).gap(14).p(4).rounded(4)
            .hover(s => s.bg(t.hover)).on_click(() => this.finish(command, args))
            .child(div().w(36).text_color(t.accent).child(key)).child(div().child(label)))))
      .child(div().text_color(t.muted).child("1–9: select tab · Tab / Shift+Tab: cycle panes · G: new worktree · ?: help"))
      .child(div().text_color(t.dim).child("Not ported: resize mode, pane rename, scrollback editor, detach, reload, notification target."));
  }
}
