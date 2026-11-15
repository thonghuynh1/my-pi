// Worktree hooks shared by project-settings and new-worktree (an identical copy lives in
// each; keep them in sync). Herdr's own herdr.yaml and HERDR_* variables; Orca's orca.yaml and ORCA_* names still work.

// The team's file in the repo: herdr.yaml, else Orca's orca.yaml (same format).
export const TEAM_FILES = ["herdr.yaml", "orca.yaml"];

// The team's setup script: { file, script } from the first of TEAM_FILES that has one, else null.
// read(path) resolves with the file's text or null (readTextFile with the machine bound).
export async function teamScript(read, root, name = "setup") {
  for (const file of TEAM_FILES) {
    const script = yamlScript(await read(`${root}/${file}`).catch(() => null), name);
    if (script) return { file, script };
  }
  return null;
}

// A script under a yaml file's `scripts:` (a | or > block, or a one-line value); null when absent.
export function yamlScript(text, name = "setup") {
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^scripts:\s*(#.*)?$/.test(l));
  if (start < 0) return null;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break; // the next top-level key
    const m = new RegExp(`^(\\s+)${name}:\\s*(.*)$`).exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length, rest = m[2].trim();
    if (rest && !/^[|>][+-]?\s*(#.*)?$/.test(rest)) return rest.replace(/^(['"])(.*)\1$/, "$2");
    const body = [];
    let inner = null;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (!line.trim()) { body.push(""); continue; }
      const at = line.match(/^\s*/)[0].length;
      if (at <= indent) break;
      inner ??= at;
      body.push(line.slice(inner));
    }
    return body.join("\n").trim() || null;
  }
  return null;
}

export const HOOK_VARS = [
  ["HERDR_ROOT_PATH", "The project's main checkout"],
  ["HERDR_WORKTREE_PATH", "The new worktree's folder"],
  ["HERDR_WORKSPACE_NAME", "The new worktree's folder name"],
];

// For `env`: Herdr's names, plus Orca's and Conductor's so scripts written for them run unchanged.
export function hookEnv(root, worktree) {
  const name = worktree.split("/").pop();
  return [`HERDR_ROOT_PATH=${root}`, `HERDR_WORKTREE_PATH=${worktree}`, `HERDR_WORKSPACE_NAME=${name}`,
    `ORCA_ROOT_PATH=${root}`, `ORCA_WORKTREE_PATH=${worktree}`, `ORCA_WORKSPACE_NAME=${name}`, `CONDUCTOR_ROOT_PATH=${root}`];
}
