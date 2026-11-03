// All commands use argv, never shell interpolation. Authentication stays in gh.
export async function gh(exec, args, allowPartial = false) {
  const r = await exec("gh", args);
  if (r.code !== 0 && allowPartial) {
    try { const response = JSON.parse(r.stdout); if (response.data?.viewer) return response; } catch {}
  }
  if (r.code !== 0) {
    const message = (r.stderr || r.stdout || "GitHub CLI failed").trim();
    if (/rate limit/i.test(message)) throw new Error("GitHub rate limit reached. Please try Refresh later.");
    throw new Error(message.slice(0, 1200));
  }
  return JSON.parse(r.stdout || "null");
}

export async function repositories(exec) {
  const result = [];
  for (let page = 1; ; page++) {
    const batch = await gh(exec, ["api", `user/repos?per_page=100&page=${page}&sort=full_name&affiliation=owner,collaborator,organization_member`]);
    result.push(...batch.map(r => ({ name: r.full_name, private: r.private })));
    if (batch.length < 100) break;
  }
  return [...new Map(result.map(r => [r.name.toLowerCase(), r])).values()]
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const activityFields = `comments(last:5) { nodes { updatedAt author { login } } }
  reviews(last:5) { nodes { submittedAt state author { login } comments(last:1) { nodes { updatedAt author { login } } } } }`;

export function queryFor(entries) {
  return `query { viewer { login } ${entries.map((e, i) => {
    const [owner, name] = e.name.split("/");
    return `r${i}: repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}) {
      pullRequests(first:100,states:OPEN,orderBy:{field:UPDATED_AT,direction:DESC}${e.cursor ? `,after:${JSON.stringify(e.cursor)}` : ""}) {
        nodes { number title url updatedAt isDraft author { login } repository { nameWithOwner } ${activityFields} }
        pageInfo { hasNextPage endCursor }
      }
    }`;
  }).join(" ")} }`;
}

// GraphQL batches avoid the much tighter GitHub search quota. Paginate each
// repository independently; filtering by the authenticated viewer happens locally.
export async function pullRequests(exec, names, mine, limit, current = () => true) {
  const groups = [];
  for (let i = 0; i < names.length; i += 6) groups.push(names.slice(i, i + 6));
  let cursor = 0, limited = false, stopped = false, viewerLogin = "";
  const all = [], failures = [];
  await Promise.all(Array.from({ length: Math.min(2, groups.length) }, async () => {
    while (cursor < groups.length && current() && !stopped) {
      const names = groups[cursor++];
      let pending = names.map(name => ({ name, cursor: null, count: 0 }));
      try {
        while (pending.length && current() && !stopped) {
          const response = await gh(exec, ["api", "graphql", "-f", `query=${queryFor(pending)}`], true);
          if (!current()) return;
          if (!response.data?.viewer) throw new Error(response.errors?.map(e => e.message).join("; ") || "GitHub response has no viewer");
          const data = response.data, viewer = data.viewer.login.toLowerCase(), next = [];
          viewerLogin = data.viewer.login;
          for (const error of response.errors ?? []) {
            failures.push(String(error.message).slice(0, 400));
            if (/rate limit|authentication|bad credentials|HTTP 401/i.test(error.message)) stopped = true;
          }
          pending.forEach((entry, i) => {
            const connection = data[`r${i}`]?.pullRequests;
            if (!connection) { failures.push(`${entry.name}: repository is unavailable`); return; }
            const rows = connection.nodes ?? [];
            all.push(...rows.filter(p => !mine || p.author?.login?.toLowerCase() === viewer));
            entry.count += rows.length;
            if (connection.pageInfo.hasNextPage) {
              if (entry.count >= limit) limited = true;
              else next.push({ ...entry, cursor: connection.pageInfo.endCursor });
            }
          });
          pending = next;
        }
      } catch (e) {
        if (current()) {
          failures.push(`${names.join(", ")}: ${e.message || e}`);
          if (/rate limit|authentication|bad credentials|HTTP 401/i.test(e.message || e)) stopped = true;
        }
      }
    }
  }));
  const rows = [...new Map(all.map(p => [p.url, p])).values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (failures.length && !rows.length) throw new Error(failures[0]);
  return { rows, limited, viewer: viewerLogin, warning: failures.length ? `Partial results: ${failures.length} repository requests failed. ${failures[0]}` : "" };
}

export function checkSummary(checks) {
  if (!checks?.length) return "No checks";
  const failed = checks.filter(c => ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(c.conclusion || c.state)).length;
  const pending = checks.filter(c => c.__typename === "CheckRun" ? c.status !== "COMPLETED" : ["PENDING", "EXPECTED"].includes(c.state)).length;
  return failed ? `${failed} failing · ${checks.length} checks` : pending ? `${pending} pending · ${checks.length} checks` : `${checks.length} checks complete`;
}
