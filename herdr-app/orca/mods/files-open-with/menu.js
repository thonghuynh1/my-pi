// The right-click popup. Opened by panel.js with
// props { role: "menu", path (absolute), dir, on, items (indexes into ITEMS), overlay }.
// ↑/↓ move, Enter runs, Esc closes.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, theme, exec, notify, focused, panes, run, window } from "herdr";
import { ITEMS, argvOf } from "./items.js";
import { insertPath } from "./insert.js";

// A plain class: main.js (the View) owns it and forwards init and render.
export default class Menu {
  init(_props, cx) {
    this.at = 0;
    this.confirm = false; // Delete asks once more before anything is removed
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  // Built-ins first (Insert into the terminal the right-click came from,
  // Copy path), then the macOS Open With apps.
  list() {
    const p = props(), out = [];
    if (this.confirm) return [
      { builtin: "confirm-delete", label: `Delete ${p?.path?.split("/").pop() ?? ""}`, icon: "trash", danger: true },
      { builtin: "cancel", label: "Cancel", icon: "files" },
    ];
    if (p?.terminal) out.push({ builtin: "insert", label: "Insert path into terminal", icon: "file-text" });
    out.push({ builtin: "copy", label: "Copy path", icon: "files" });
    if (p?.path && p.path !== p.root) out.push({ builtin: "delete", label: "Move to Recycle Bin", icon: "trash", danger: true });
    return [...out, ...(p?.items ?? []).map(i => ITEMS[i]).filter(Boolean)];
  }

  choose(i, cx) {
    const p = props(), it = this.list()[i];
    if (!it) return;
    if (it.builtin === "copy") { cx.write_to_clipboard(p.path); closeOverlay(p.overlay); return; }
    if (it.builtin === "delete") { this.confirm = true; this.at = 1; cx.notify(); return; }
    if (it.builtin === "cancel") { this.confirm = false; this.at = 0; cx.notify(); return; }
    if (it.builtin === "confirm-delete") { this.trash(p); closeOverlay(p.overlay); return; }
    if (it.builtin === "insert") {
      try {
        insertPath({ path: p.path, target: p.terminal }, {
          focused, panes, run,
          close: () => closeOverlay(p.overlay),
          copy: text => cx.write_to_clipboard(text),
          readClipboard: () => cx.read_from_clipboard(),
        });
      } catch (e) { notify({ title: "Insert path", body: String(e.message ?? e), level: "error" }); }
      return;
    }
    closeOverlay(p.overlay);
    const [cmd, ...args] = argvOf(it, p.path);
    // Not awaited by the menu: Quick Look runs until its window is closed.
    exec(cmd, args).then(
      r => { if (r.code !== 0 && cmd !== "qlmanage") notify({ title: it.label, body: r.stderr.trim() || `Exited with ${r.code}`, level: "error" }); },
      e => notify({ title: it.label, body: String(e), level: "error" }),
    );
  }

  // To the Recycle Bin / Trash, never a permanent delete. The panel's
  // folder watch refreshes the list on its own.
  trash(p) {
    const platform = window()?.platform, name = p.path.split("/").pop() || p.path;
    const done = r => notify(r.code === 0
      ? { title: "Moved to Recycle Bin", body: name }
      : { title: "Couldn't delete", body: (r.stderr || `Exited with ${r.code}`).trim(), level: "error" });
    const fail = e => notify({ title: "Couldn't delete", body: String(e), level: "error" });
    if (platform === "windows") {
      const lit = p.path.replaceAll("'", "''");
      const script = `Add-Type -AssemblyName Microsoft.VisualBasic; if (Test-Path -LiteralPath '${lit}' -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('${lit}', 'OnlyErrorDialogs', 'SendToRecycleBin') } else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${lit}', 'OnlyErrorDialogs', 'SendToRecycleBin') }`;
      exec("powershell", ["-NoProfile", "-Command", script]).then(done, fail);
    } else if (platform === "macos") exec("osascript", ["-e", `tell application "Finder" to delete POSIX file ${JSON.stringify(p.path)}`]).then(done, fail);
    else exec("gio", ["trash", p.path]).then(done, fail);
  }

  render(cx) {
    const t = theme(), p = props(), list = this.list();
    return v_flex()
      .id("files-open-with-menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (!list.length) return;
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at, cx);
        else if (e.key === "escape") closeOverlay(p.overlay);
        else return;
        cx.notify();
      })
      .child(div().h(26).px(8).pt(4).text_size(11).text_color(t.dim).truncate().child(p?.path?.split("/").pop() || p?.path || ""))
      .children(list.map((it, i) =>
        h_flex()
          .id(`fow-${i}`)
          .h(31)
          .px(8)
          .gap(9)
          .rounded(7)
          .items_center()
          .cursor_pointer()
          .text_color(it.danger ? t.ansi1 : t.foreground)
          .when(i === this.at, el => el.bg(t.selected))
          .hover(s => s.bg(t.hover))
          .on_click((_e, cx) => this.choose(i, cx))
          .child(svg(`mods/files-open-with/menu-${it.icon}.svg`).size(14).flex_none().text_color(t.muted))
          .child(div().flex_1().truncate().child(it.label))));
  }
}
