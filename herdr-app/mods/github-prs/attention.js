import { gh, activityFields, ciFields } from "./data.js";

// Bounded summaries, not full comment histories. No notification writes or
// organization-wide PR crawl; only GitHub's explicit review assignments.
export const prFields = `number title url updatedAt isDraft author { login } repository { nameWithOwner } ${ciFields} ${activityFields}`;
export const prKey = pr => `${pr.repository.nameWithOwner.toLowerCase()}#${pr.number}`;

export const dashboardHidden = (pr, state = {}) =>
  Boolean(state.unfollowed?.[prKey(pr)] || state.dismissed?.[prKey(pr)] === pr.updatedAt);

export function dismissDashboardPR(pr, state = {}) {
  return { ...state, dismissed: { ...state.dismissed, [prKey(pr)]: pr.updatedAt } };
}

export function toggleDashboardPR(pr, state = {}) {
  const key = prKey(pr), unfollowed = { ...state.unfollowed }, dismissed = { ...state.dismissed };
  if (dashboardHidden(pr, state)) { delete unfollowed[key]; delete dismissed[key]; }
  else unfollowed[key] = true;
  return { ...state, unfollowed, dismissed };
}

const isComment = event => ["New comment", "Review comment"].includes(event.label);
const eventKey = event => event.id || `${event.label}:${event.who.toLowerCase()}:${event.at}`;

function feedbackEvents(pr, viewer) {
  if (!viewer) return [];
  const other = author => author?.login && author.login.toLowerCase() !== viewer.toLowerCase();
  const events = [];
  for (const comment of pr.comments?.nodes ?? []) if (other(comment.author) && comment.updatedAt)
    events.push({ id: comment.id, at: comment.updatedAt, label: "New comment", who: comment.author.login, tone: "blue" });
  for (const review of pr.reviews?.nodes ?? []) {
    if (other(review.author) && review.submittedAt && review.state !== "PENDING") events.push({
      id: review.id, at: review.submittedAt, who: review.author.login,
      label: review.state === "APPROVED" ? "Approved" : review.state === "CHANGES_REQUESTED" ? "Changes requested" : "New review",
      tone: review.state === "APPROVED" ? "green" : review.state === "CHANGES_REQUESTED" ? "orange" : "purple",
    });
    for (const comment of review.comments?.nodes ?? []) if (other(comment.author) && comment.updatedAt)
      events.push({ id: comment.id, at: comment.updatedAt, label: "Review comment", who: comment.author.login, tone: "blue" });
  }
  return events.sort((a, b) => b.at.localeCompare(a.at));
}

export function latestFeedback(pr, viewer) {
  return feedbackEvents(pr, viewer)[0] || null;
}

export function unseenFeedback(pr, viewer, seen = {}, pending = {}) {
  if (!viewer) return null;
  const loaded = feedbackEvents(pr, viewer), saved = pending[prKey(pr)], events = new Map();
  let legacyLimited = false;
  // Migrate old single-event pending state; never retain old comment previews.
  for (const raw of [...(saved?.events || (saved ? [saved] : [])), ...loaded]) {
    const { at, label, who, tone } = raw;
    if (!who || !at || at <= (seen[prKey(pr)] || "")) continue;
    const match = !raw.id && loaded.find(e => e.label === label && e.who.toLowerCase() === who.toLowerCase() && e.at === at);
    // Without an old ID an edited comment cannot be distinguished from a new
    // comment by the same person. Coalesce conservatively, never invent a second.
    const newer = !raw.id && !match && loaded.find(e => e.label === label && e.who.toLowerCase() === who.toLowerCase() && e.at > at);
    if (newer) legacyLimited = true;
    const id = raw.id || match?.id || newer?.id;
    const event = { id, at, label, who, tone }, key = eventKey(event), old = events.get(key);
    if (!old || at >= old.at) events.set(key, event);
  }
  const unseen = [...events.values()].sort((a, b) => b.at.localeCompare(a.at));
  if (!unseen.length) return null;
  const limited = Boolean(legacyLimited || saved?.limited || unseen.length > 200 || pr.comments?.pageInfo?.hasPreviousPage
    || pr.reviews?.pageInfo?.hasPreviousPage || pr.reviews?.nodes?.some(r => r.comments?.pageInfo?.hasPreviousPage));
  return { ...unseen[0], events: unseen.slice(0, 200), limited };
}

export function feedbackSummary(event) {
  if (!event) return { label: "", people: "", comments: "" };
  const comments = (event.events || [event]).filter(isComment);
  const names = [...new Map(comments.map(e => [e.who.toLowerCase(), e.who])).values()];
  const people = names.slice(0, 3).map(name => `@${name}`).join(", ") + (names.length > 3 ? ` +${names.length - 3} others` : "");
  const count = comments.length;
  const label = count ? `${count}${event.limited ? "+" : ""} new comment${count === 1 && !event.limited ? "" : "s"}` : "";
  return {
    label: isComment(event) ? label : event.label,
    people: isComment(event) ? people : `@${event.who}`,
    comments: !isComment(event) && count ? `${people} · ${label}` : "",
  };
}

export function feedbackTooltip(event) {
  if (!event) return "";
  const summary = feedbackSummary(event);
  return [`${summary.people} · ${summary.label}`, summary.comments].filter(Boolean).join("\n");
}

// Keep observed unseen feedback even if the author replies or later summaries
// roll it out of their bounded window. Only an explicit detail read clears it.
export function trackFeedback(rows, viewer, state = {}) {
  const pending = { ...state.pending };
  for (const pr of rows) {
    if (!viewer) continue;
    const event = unseenFeedback(pr, viewer, state.seen, pending);
    if (event) pending[prKey(pr)] = event;
  }
  return { ...state, pending };
}

export async function dashboard(exec, current = () => true) {
  const warnings = [], teams = [];
  try {
    // Cap membership discovery and searches; report limits instead of silently
    // claiming all teams are covered. A missing read:org permission is explicit.
    const result = await gh(exec, ["api", "user/teams?per_page=21"]);
    if (!Array.isArray(result)) throw new Error("GitHub returned no team list");
    teams.push(...result.slice(0, 20).map(t => `${t.organization.login}/${t.slug}`));
    if (result.length > 20) warnings.push("Showing assignments for the first 20 teams only.");
  } catch (e) { warnings.push(`Team assignments unavailable (check GitHub read:org access): ${e.message || e}`); }
  if (!current()) return null;
  const searches = [{ query: "is:pr is:open review-requested:@me", label: "Your review requested" },
    ...teams.map(team => ({ query: `is:pr is:open team-review-requested:${team}`, label: `Team · ${team}` }))];
  const rows = new Map(); let viewer = "", limited = false;
  for (let start = 0; start < searches.length && current(); start += 6) {
    const batch = searches.slice(start, start + 6);
    try {
      const query = `query { viewer { login } ${batch.map((s, i) => `s${i}: search(type:ISSUE,first:25,query:${JSON.stringify(`${s.query} sort:updated-desc`)}) {
        pageInfo { hasNextPage } nodes { ... on PullRequest { ${prFields} } }
      }`).join(" ")} }`;
      const response = await gh(exec, ["api", "graphql", "-f", `query=${query}`], true);
      if (!current()) return null;
      if (!response.data?.viewer) throw new Error("GitHub returned no viewer");
      viewer = response.data.viewer.login;
      for (const error of response.errors ?? []) warnings.push(error.message);
      batch.forEach((s, i) => {
        const connection = response.data[`s${i}`];
        if (!connection) { warnings.push(`${s.label}: search unavailable`); return; }
        limited ||= Boolean(connection.pageInfo?.hasNextPage);
        for (const pr of connection.nodes ?? []) {
          if (!pr?.repository || !pr.number) continue;
          const key = prKey(pr), old = rows.get(key);
          rows.set(key, { ...pr, assignments: [...new Set([...(old?.assignments ?? []), s.label])] });
        }
      });
    } catch (e) { warnings.push(String(e.message || e)); }
  }
  if (!current()) return null;
  if (!viewer) throw new Error(warnings.join("; ") || "Dashboard unavailable");
  if (limited) warnings.push("Showing the 25 most recently updated PRs per review assignment. More may exist on GitHub.");
  return { viewer, rows: [...rows.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), warning: [...new Set(warnings)].join("\n") };
}
