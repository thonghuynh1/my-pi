// Keep insertion synchronous: clipboard write, explicit focus, native paste in order.
// Never use hc send: it submits Enter.
export function fullPath(root, relative) {
  if (!root || !relative) throw new Error("No file path is available.");
  const base = /^[A-Za-z]:[\\/]|^\\\\/.test(root) ? root.replace(/\\/g, "/") : root;
  const path = base.replace(/\/+$/, "") + "/" + relative;
  if (/[\x00-\x1f\x7f\u2028\u2029]/.test(path)) throw new Error("This path contains control characters and cannot be safely pasted.");
  return path;
}
export function captureTarget(focus, ps) {
  if (!focus?.terminal) return null;
  // A temporarily shown agent/composition terminal is not the underlying pane.
  if (focus.shown) return null;
  const pane = focus.pane ? ps.find(p => p.pane === focus.pane && p.terminal === focus.terminal) : null;
  if (focus.pane && !pane) return null;
  return { terminal: focus.terminal, pane: pane?.pane ?? null, space: focus.space, tab: focus.tab };
}
export function insertPath({ path, target }, api) {
  if (!target) throw new Error("Focus a terminal, then right-click the file again.");
  const f = api.focused();
  if (!f || f.space !== target.space || f.tab !== target.tab || f.terminal !== target.terminal || (f.pane ?? null) !== target.pane || f.shown ||
      (target.pane && !api.panes().some(p => p.pane === target.pane && p.terminal === target.terminal))) {
    throw new Error("The target terminal changed. Right-click the file again.");
  }
  if (/[\x00-\x1f\x7f\u2028\u2029]/.test(path) || !path) throw new Error("This path cannot be safely pasted.");
  api.copy(path);
  if (api.readClipboard() !== path) throw new Error("The clipboard changed. Nothing was pasted; try again.");
  api.close();
  api.run("pane.focus", target.pane ? { pane: target.pane } : { terminal: target.terminal });
  api.run("terminal.paste");
}
