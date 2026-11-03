// Pure helpers shared by the native mod and Node tests.
export const normalize = path => {
  const raw = path ?? "";
  // Backslash is a legal Unix filename character, not always a separator.
  const p = /^[A-Za-z]:[\\/]|^\\\\/.test(raw) ? raw.replace(/\\/g, "/") : raw;
  return p === "/" ? p : p.replace(/\/+$/, "");
};
export const pathKey = path => {
  const p = normalize(path);
  return /^[A-Za-z]:\//.test(p) || p.startsWith("//") ? p.toLowerCase() : p;
};
export const inside = (path, root) => {
  const p = pathKey(path), r = pathKey(root);
  return !!r && (p === r || p.startsWith(r + "/"));
};
export const projectKey = (machine, common) => JSON.stringify([machine ?? null, pathKey(common)]);
export const basename = path => normalize(path).split("/").pop() || path;
export function parseWorktrees(text) {
  const out = [];
  let row;
  // --porcelain -z: fields and records are NUL separated; paths are never quoted.
  for (const field of text.split("\0")) {
    if (field.startsWith("worktree ")) {
      row = { path: field.slice(9), branch: null, main: out.length === 0 };
      out.push(row);
    } else if (row) {
      if (field.startsWith("branch ")) row.branch = field.slice(7).replace(/^refs\/heads\//, "");
      else if (field.startsWith("HEAD ")) row.head = field.slice(5);
      else if (field === "bare") row.bare = true;
      else if (field === "locked" || field.startsWith("locked ")) row.locked = field.slice(7) || true;
      else if (field === "prunable" || field.startsWith("prunable ")) row.prunable = field.slice(9) || true;
    }
  }
  return out;
}
export function parseStatus(text) {
  const result = { dirty: false, ahead: null, behind: null, upstream: null };
  for (const line of text.split("\n")) {
    if (line.startsWith("# branch.upstream ")) result.upstream = line.slice(18);
    else if (line.startsWith("# branch.ab ")) {
      const match = /^# branch.ab \+(\d+) -(\d+)$/.exec(line);
      if (match) { result.ahead = Number(match[1]); result.behind = Number(match[2]); }
    } else if (line && !line.startsWith("# ")) result.dirty = true;
  }
  return result;
}
export function place(space, ps) {
  const tabs = new Set((space.tabs ?? []).map(tab => tab.id));
  return ps.find(p => tabs.has(p.tab) && p.cwd)?.cwd || space.folder;
}
export function checkoutFor(path, rows) {
  return rows.filter(row => !row.bare && inside(path, row.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
}
export function locations(space, ps) {
  const tabs = new Set((space.tabs ?? []).map(tab => tab.id));
  return [...new Set([space.folder, ...ps.filter(p => tabs.has(p.tab)).map(p => p.cwd)].filter(Boolean))];
}
export function spacesFor(row, rows, sp, ps, machine) {
  return sp.filter(s => (s.machine ?? null) === (machine ?? null) &&
    locations(s, ps).some(path => checkoutFor(path, rows) === row));
}
export function removalBlock(row, open) {
  if (!row) return "Worktree is no longer registered. Refresh the list.";
  if (row.main || row.bare) return "The main checkout cannot be removed here.";
  if (!row.branch) return "Detached HEAD: create or check out a branch before removing it here.";
  if (row.locked) return "This worktree is locked.";
  if (row.prunable) return "This checkout is missing or prunable. Repair it with Git.";
  if (open) return "Close its Herdr spaces and terminals before removing it.";
  if (row.error || !row.status) return "Could not verify the worktree status.";
  if (row.status.dirty) return "Uncommitted changes: commit or stash them first.";
  return null;
}
