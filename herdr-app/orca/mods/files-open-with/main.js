// Files Open With: Herdr's Files panel with a right-click menu that opens the
// clicked file or folder in your own apps. One mod, three roles:
//   no role          the Files panel (panel.js), put in a layout block
//   role: "menu"     the right-click popup (menu.js), opened by the panel
//   role: "viewer"   a file in its own tab (viewer.js), opened by the panel
// The menu's items are in items.js.

import { View } from "gpui-kit";
import { props } from "herdr";
import Panel from "./panel.js";
import Menu from "./menu.js";
import Viewer from "./viewer.js";

const ROLES = { menu: Menu, viewer: Viewer };

export default class FilesOpenWith extends View {
  init(p, cx) {
    this.part = new (ROLES[props()?.role] ?? Panel)();
    this.part.init(p, cx);
  }

  render(cx) {
    return this.part.render(cx);
  }

  async close(cx) {
    this.part.close?.(cx);
  }
}
