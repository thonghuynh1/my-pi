// Pure detail presentation helpers. No credentials, shell commands or UI effects.
export function ciStatus(checks = []) {
  if (!checks.length) return { state: "none", label: "— No CI", color: "muted" };
  const failure = ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"];
  if (checks.some(c => failure.includes(c.conclusion || c.state))) return { state: "failed", label: "✕ CI failed", color: "blocked" };
  if (checks.some(c => c.status ? c.status !== "COMPLETED" : ["PENDING", "EXPECTED"].includes(c.state)))
    return { state: "building", label: "◌ CI building", color: "working" };
  if (checks.every(c => ["NEUTRAL", "SKIPPED"].includes(c.conclusion || c.state)))
    return { state: "neutral", label: "— CI skipped", color: "muted" };
  return { state: "passed", label: "✓ CI passed", color: "ansi2" };
}

export function reviewers(detail = {}) {
  const people = new Map();
  const reviews = [...(detail.reviews ?? [])].sort((a, b) => (a.submittedAt || "").localeCompare(b.submittedAt || ""));
  for (const review of reviews) {
    const login = review.author?.login;
    if (!login || review.state === "PENDING") continue;
    const key = `user:${login.toLowerCase()}`, old = people.get(key);
    // A follow-up comment doesn't revoke an approval or a changes-requested review.
    if (review.state === "COMMENTED" && old && ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(old.state)) continue;
    people.set(key, { key, name: `@${login}`, state: review.state, team: false });
  }
  for (const request of detail.reviewRequests ?? []) {
    const team = request.__typename === "Team" || Boolean(request.slug && !request.login);
    const name = team ? request.name || request.slug : request.login;
    if (!name) continue;
    const key = `${team ? "team" : "user"}:${(team ? request.slug || name : name).toLowerCase()}`;
    // Re-requested reviews are awaiting a fresh decision, not a current approval.
    people.set(key, { key, name: team ? `Team · ${name}` : `@${name}`, state: "REQUESTED", team });
  }
  return [...people.values()].sort((a, b) => Number(b.state === "APPROVED") - Number(a.state === "APPROVED") || a.name.localeCompare(b.name));
}

export function reviewStatus(state) {
  return ({
    APPROVED: { label: "✓ Approved", color: "ansi2" },
    CHANGES_REQUESTED: { label: "! Changes requested", color: "blocked" },
    DISMISSED: { label: "— Dismissed", color: "muted" },
    COMMENTED: { label: "Commented", color: "muted" },
    REQUESTED: { label: "○ Awaiting review", color: "muted" },
  })[state] || { label: "○ Awaiting review", color: "muted" };
}
