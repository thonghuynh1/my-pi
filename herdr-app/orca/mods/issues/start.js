// Start (or open) a worktree for an issue or PR. Used by the issues table and the viewer:
// an open space for it is selected, otherwise the Create worktree dialog (new-worktree) opens
// with it picked, so the branch and space name can be checked before creating.
import { spaces, run, openOverlay, closeOverlay } from "herdr";

export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");

// The space already working on it: a PR's head branch, or a branch named for the issue
// (issue-12-…, dev/feat/12, feat/12-…).
export function spaceFor(item, pr) {
  const issue = new RegExp(`(?:^|/)(?:issue-)?${item.number}(?:$|-)`);
  return spaces().find((s) => s.branch && (pr ? s.branch === item.headRefName : issue.test(s.branch)));
}

// folder: a checkout of the repo on `machine`, so the dialog knows the project.
export async function startWorkspace({ machine = null, folder, item, pr, overlay }) {
  const existing = spaceFor(item, pr);
  if (overlay) closeOverlay(overlay);
  if (existing) return run("space.select", { id: existing.id });
  openOverlay({ mod: "new-worktree", kind: "dialog", width: 560, height: 780, props: {
    folder, machine, mode: pr ? "pr" : "issue",
    pick: { kind: pr ? "pr" : "issue", number: item.number, title: item.title, head: item.headRefName },
  } });
}
