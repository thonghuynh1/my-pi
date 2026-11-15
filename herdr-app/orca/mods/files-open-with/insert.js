// Insert a file's path into a terminal, and remember which terminal a
// right-click meant. Same approach as the workspace-files mod in the GitHub
// Workspace layout: clipboard write, verify, focus, native paste — never
// `hc send`, which would submit Enter.

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
