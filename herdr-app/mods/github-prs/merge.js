import { gh } from "./data.js";

// Read-only snapshots. A branch target is a relationship, not an enforced merge order.
export function mergePR(raw, repository) {
  return {
    number: raw.number, title: raw.title, url: raw.html_url,
    repository: { nameWithOwner: raw.base?.repo?.full_name || repository },
    author: { login: raw.user?.login }, isDraft: Boolean(raw.draft),
    state: raw.state, merged: Boolean(raw.merged), mergeable: raw.mergeable,
    mergeableState: raw.mergeable_state || "unknown",
    head: { name: raw.head?.ref, sha: raw.head?.sha, repository: raw.head?.repo?.full_name },
    base: { name: raw.base?.ref, sha: raw.base?.sha, repository: raw.base?.repo?.full_name || repository },
  };
}

export function mergeStatus(pr) {
  if (pr.merged) return { label: "✓ Already merged", color: "ansi2" };
  if (pr.state === "closed") return { label: "— Closed without merging", color: "muted" };
  if (pr.mergeable === false || pr.mergeableState === "dirty") return { label: "✕ Merge conflicts — resolve first", color: "blocked" };
  if (pr.isDraft) return { label: "○ Draft — not ready to merge", color: "muted" };
  if (pr.mergeableState === "behind") return { label: "! Branch update required by GitHub", color: "working" };
  if (pr.mergeableState === "blocked") return { label: "! Blocked by GitHub merge rules", color: "working" };
  if (pr.mergeableState === "unstable") return { label: "! Checks not all passing", color: "working" };
  if (pr.mergeableState === "clean") return { label: "✓ GitHub reports mergeable", color: "ansi2" };
  if (pr.mergeable === true) return { label: "✓ No merge conflicts", color: "ansi2" };
  return { label: "◌ Merge status not calculated — refresh later", color: "muted" };
}

export function syncStatus(comparison, base) {
  if (!comparison || !Number.isInteger(comparison.behind_by) || !Number.isInteger(comparison.ahead_by))
    return { label: `Sync with ${base} unavailable`, color: "muted" };
  return comparison.behind_by > 0
    ? { label: `! ${comparison.behind_by} commits behind ${base} · update available`, color: "working" }
    : { label: `✓ Up to date with ${base}`, color: "ansi2" };
}

export function compactBranch(name = "unknown") {
  // Keep the work-item identity; full branch names remain available on hover.
  return name.match(/^(feature\/\d+)(?:[-/].*)?$/i)?.[1] || name;
}

export function chainOrigin(chain) {
  const top = chain?.steps?.[chain.steps.length - 1];
  const reference = top?.base?.name && chain?.end === "missing" && chain.defaultBranch && top.base.name !== chain.defaultBranch
    ? chain.defaultBranch : "";
  return { reference, status: reference ? chainSync({ comparison: top?.baseDrift }) : null };
}

export function chainSync(pr, loading = false) {
  if (pr.merged) return { label: "merged", color: "ansi2" };
  if (pr.state === "closed") return { label: "closed", color: "muted" };
  if (pr.mergeable === false || pr.mergeableState === "dirty") return { label: "conflicts", color: "blocked" };
  if (!pr.comparison || !Number.isInteger(pr.comparison.behind_by))
    return { label: loading && !pr.comparisonError ? "checking…" : "unknown", color: "muted" };
  return pr.comparison.behind_by > 0
    ? { label: "need-merge", color: "working" }
    : { label: "up to date", color: "ansi2" };
}

const fatal = error => /rate limit|authentication|bad credentials|HTTP 401/i.test(String(error.message || error));
const sameRepo = (a, b) => a?.toLowerCase() === b?.toLowerCase();
const repoPath = repo => repo.split("/").map(encodeURIComponent).join("/");

// Follow exact same-repository head branches, regardless of the list's author/repo
// filters. Stop explicitly at ambiguity, cycles or depth limits instead of guessing.
export async function mergeChain(exec, selected, current = () => true, maxDepth = 8, progress = () => {}) {
  const result = { steps: [], defaultBranch: "", warnings: [], alternatives: [], end: "", checkedAt: "" };
  const cancelled = new Error("Obsolete merge-chain request");
  const call = async args => {
    if (!current()) throw cancelled;
    const value = await gh(exec, args);
    if (!current()) throw cancelled;
    return value;
  };
  const comparisons = new Map(), visited = new Set();
  const compare = async (repo, base, head) => {
    if (!base || !head) throw new Error("Branch commit is unavailable (it may have been deleted)");
    const key = `${repo}:${base}:${head}`;
    if (!comparisons.has(key)) {
      const value = await call(["api", `repos/${repoPath(repo)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?per_page=1`,
        "--jq", "{ahead_by,behind_by,status}"]);
      if (!Number.isInteger(value?.ahead_by) || !Number.isInteger(value?.behind_by)) throw new Error("GitHub returned no commit comparison");
      comparisons.set(key, value);
    }
    return comparisons.get(key);
  };
  try {
    const repository = selected.repository.nameWithOwner, path = repoPath(repository);
    let pr = mergePR(await call(["api", `repos/${path}/pulls/${selected.number}`]), repository);
    result.steps.push(pr);
    progress(result);
    const metadata = await call(["api", `repos/${path}`, "--jq", "{default_branch}"]);
    if (!metadata?.default_branch) throw new Error("Repository default branch is unavailable");
    result.defaultBranch = metadata.default_branch;
    let defaultSHA;
    try {
      const commit = await call(["api", `repos/${path}/commits/${encodeURIComponent(result.defaultBranch)}`, "--jq", "{sha}"]);
      defaultSHA = commit?.sha;
    } catch (e) {
      if (e === cancelled || fatal(e)) throw e;
      result.warnings.push(`Default-branch comparison unavailable: ${e.message || e}`);
    }
    for (let depth = 0; depth < maxDepth; depth++) {
      visited.add(`${pr.repository.nameWithOwner.toLowerCase()}#${pr.number}`);
      try { pr.comparison = await compare(pr.base.repository, pr.base.sha, pr.head.sha); }
      catch (e) {
        if (e === cancelled || fatal(e)) throw e;
        pr.comparisonError = String(e.message || e);
      }
      if (pr.base.name !== result.defaultBranch && defaultSHA) {
        try { pr.headDrift = await compare(pr.base.repository, defaultSHA, pr.head.sha); }
        catch (e) {
          if (e === cancelled || fatal(e)) throw e;
          pr.headDriftError = String(e.message || e);
        }
        try { pr.baseDrift = await compare(pr.base.repository, defaultSHA, pr.base.sha); }
        catch (e) {
          if (e === cancelled || fatal(e)) throw e;
          pr.baseDriftError = String(e.message || e);
        }
      }
      progress(result);
      if (pr.base.name === result.defaultBranch) { result.end = "default"; break; }
      if (!pr.base.name) throw new Error("PR target branch is unavailable");
      const owner = pr.base.repository.split("/")[0];
      const candidates = await call(["api", `repos/${repoPath(pr.base.repository)}/pulls?state=open&head=${encodeURIComponent(`${owner}:${pr.base.name}`)}&per_page=100`]);
      if (!Array.isArray(candidates)) throw new Error("GitHub returned no base-branch PR list");
      const parents = candidates.filter(p => p.head?.ref === pr.base.name && sameRepo(p.head?.repo?.full_name, pr.base.repository));
      if (candidates.length >= 100) {
        result.end = "limit"; result.warnings.push("Base-branch PR lookup reached 100 results; the chain may be incomplete."); break;
      }
      if (!parents.length) { result.end = "missing"; break; }
      if (parents.length > 1) {
        result.end = "ambiguous"; result.alternatives = parents.map(p => mergePR(p, pr.base.repository));
        result.warnings.push(`Multiple open PRs for ${pr.base.name}; inspect a target below. No parent was guessed.`); break;
      }
      const parent = parents[0], parentRepo = pr.base.repository;
      if (visited.has(`${parentRepo.toLowerCase()}#${parent.number}`)) {
        result.end = "cycle"; result.warnings.push("Circular branch targets detected; cannot follow the chain further."); break;
      }
      if (depth + 1 >= maxDepth) {
        result.end = "limit"; result.warnings.push(`Showing up to ${maxDepth} PRs; more ancestors exist.`); break;
      }
      pr = mergePR(await call(["api", `repos/${repoPath(parentRepo)}/pulls/${parent.number}`]), parentRepo);
      result.steps.push(pr);
      progress(result);
    }
    result.checkedAt = new Date().toLocaleTimeString();
  } catch (e) {
    if (e === cancelled || !current()) return null;
    result.end = "unavailable";
    result.warnings.push(String(e.message || e));
  }
  return result;
}
