import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextView } from "gpui-base";
import { URL } from "url";
import { exec, theme, shared, setShared, focused, spaces, panes, run } from "herdr";
import { gh, repositories, pullRequests } from "./data.js";
import { dashboard, prKey, unseenFeedback, trackFeedback, dashboardHidden, toggleDashboardPR, dismissDashboardPR, feedbackTooltip, feedbackSummary } from "./attention.js";
import { ciStatus, prCIStatus, reviewers } from "./details.js";
import { mergeChain, mergeStatus, syncStatus, compactBranch, chainSync, chainOrigin } from "./merge.js";

import { palette, statusTone, authorInitials, authorTone } from "./ui.js";

export default class GitHubPRs extends View {
  init(_props, cx) {
    const saved = shared("github-prs.filters") ?? {};
    this.mine = saved.mine !== false;
    this.view = ["dashboard", "mine", "all"].includes(saved.view) ? saved.view : "dashboard";
    this.viewer = ""; this.showDismissed = false;
    this.repo = saved.repo || "";
    this.repos = []; this.rows = []; this.limit = 100;
    this.request = 0; this.detailRequest = 0; this.repoLookup = 0;
    this.repoQuery = ""; this.prQuery = ""; this.showRepos = false;
    this.repoInput = InputState.new({ placeholder: "Find repository (owner/name)…" });
    this.repoInput.on("change", (_e, cx) => { this.repoQuery = this.repoInput.value(); cx.notify(); });
    this.prInput = InputState.new({ placeholder: "Filter loaded PRs by title, author, number…" });
    this.prInput.on("change", (_e, cx) => { this.prQuery = this.prInput.value(); cx.notify(); });
    if (this.view === "dashboard") this.load(cx);
    else this.loadRepos(cx);
  }

  save() { setShared("github-prs.filters", { mine: this.mine, view: this.view, repo: this.repo }); }

  attentionState() { return this.viewer ? shared(`github-prs.attention.${this.viewer.toLowerCase()}`) ?? { seen: {}, dismissed: {} } : { seen: {}, dismissed: {} }; }

  saveAttention(state) { if (this.viewer) setShared(`github-prs.attention.${this.viewer.toLowerCase()}`, state); }

  acknowledge(pr, event) {
    if (!event) return;
    const state = this.attentionState(), key = prKey(pr), pending = { ...state.pending };
    if (pending[key]?.at <= event.at) delete pending[key];
    const seenAt = event.at > (state.seen?.[key] || "") ? event.at : state.seen[key];
    this.saveAttention({ ...state, pending, seen: { ...state.seen, [key]: seenAt } });
  }

  dismissPR(pr, cx) {
    this.saveAttention(dismissDashboardPR(pr, this.attentionState())); cx.notify();
  }

  removePR(pr, cx) {
    this.saveAttention(toggleDashboardPR(pr, this.attentionState())); cx.notify();
  }

  loadRepos(cx) {
    if (this.loadingRepos) return;
    this.loadingRepos = true; this.repoError = "";
    cx.spawn(async cx => {
      try {
        this.repos = await repositories(exec); this.reposLoaded = true;
        if (this.view !== "dashboard") this.load(cx);
      } catch (e) { this.repoError = String(e.message || e); }
      finally { this.loadingRepos = false; cx.notify(); }
    });
    cx.notify();
  }

  load(cx) {
    if (this.view !== "dashboard" && !this.reposLoaded) {
      this.request++; this.detailRequest++; this.selected = null; this.rows = []; this.loading = false;
      this.loadRepos(cx); return;
    }
    const request = ++this.request;
    const names = this.repo ? [this.repo] : this.repos.map(r => r.name);
    const isDashboard = this.view === "dashboard", mine = this.view === "mine", limit = this.limit;
    this.mine = mine;
    this.loading = true; this.error = ""; this.rows = []; this.limited = false;
    this.selected = null; this.detail = null; this.detailRequest++;
    this.chain = null; this.mergeLoading = false;
    cx.spawn(async cx => {
      try {
        const result = isDashboard ? await dashboard(exec, () => request === this.request)
          : await pullRequests(exec, names, mine, limit, () => request === this.request);
        if (request !== this.request) return;
        if (!result) return;
        this.viewer = result.viewer || "";
        if (this.viewer) this.saveAttention(trackFeedback(result.rows, this.viewer, this.attentionState()));
        this.rows = result.rows; this.limited = Boolean(result.limited); this.error = result.warning;
        this.updated = new Date().toLocaleTimeString();
      } catch (e) { if (request === this.request) this.error = String(e.message || e); }
      finally { if (request === this.request) { this.loading = false; cx.notify(); } }
    });
    cx.notify();
  }

  selectRepo(name, cx) {
    this.repoLookup++; this.repoError = "";
    this.repo = name; this.showRepos = false; this.limit = 100;
    this.save(); this.load(cx);
  }

  selectPR(pr, cx) {
    const request = ++this.detailRequest;
    this.openedFeedback = unseenFeedback(pr, this.viewer, this.attentionState().seen, this.attentionState().pending);
    this.selected = pr; this.detail = null; this.detailError = ""; this.detailLoading = true;
    this.chain = null; this.mergeLoading = true; this.actionMessage = "";
    cx.spawn(async cx => {
      try {
        const detail = await gh(exec, ["pr", "view", String(pr.number), "--repo", pr.repository.nameWithOwner,
          "--json", "body,baseRefName,headRefName,reviewDecision,mergeable,additions,deletions,changedFiles,statusCheckRollup,reviews,reviewRequests"]);
        if (request === this.detailRequest) { this.detail = detail; this.acknowledge(pr, this.openedFeedback); }
      } catch (e) { if (request === this.detailRequest) this.detailError = String(e.message || e); }
      finally { if (request === this.detailRequest) { this.detailLoading = false; cx.notify(); } }
    });
    cx.spawn(async cx => {
      try {
        const chain = await mergeChain(exec, pr, () => request === this.detailRequest, 8, snapshot => {
          if (request === this.detailRequest) { this.chain = snapshot; cx.notify(); }
        });
        if (request === this.detailRequest) {
          this.chain = chain;
          if (chain?.steps[0]) this.selected = { ...pr, ...chain.steps[0] };
        }
      } catch (e) {
        if (request === this.detailRequest) this.chain = { steps: [], alternatives: [], warnings: [String(e.message || e)], end: "unavailable" };
      } finally { if (request === this.detailRequest) { this.mergeLoading = false; cx.notify(); } }
    });
    cx.notify();
  }

  openPR(pr, cx) {
    this.actionMessage = "";
    cx.spawn(async cx => {
      try {
        const r = await exec("gh", ["pr", "view", String(pr.number), "--repo", pr.repository.nameWithOwner, "--web"]);
        if (r.code !== 0) throw new Error(r.stderr || "Could not open browser");
      } catch (e) { this.actionMessage = String(e.message || e); }
      cx.notify();
    });
  }

  // Review in a new terminal: no checkout, merge, or remote mutation.
  reviewPR(pr) {
    const argv = ["gh", "pr", "view", String(pr.number), "--repo", pr.repository.nameWithOwner, "--comments"];
    const space = spaces().find(s => s.active);
    if (space?.machine) run("space.new", { machine: "", name: `GitHub PR #${pr.number}`, argv });
    else run("tab.new", { name: `PR #${pr.number}`, argv });
  }

  folderContext() {
    const f = focused(), space = spaces().find(s => s.active);
    const pane = panes().find(p => p.pane === f?.pane);
    return { cwd: pane?.cwd || f?.cwd || space?.folder,
      remote: Boolean(space?.machine || f?.terminal?.includes("/")) };
  }

  useCurrentRepo(cx) {
    const context = this.folderContext(), { cwd, remote } = context;
    const lookup = ++this.repoLookup;
    const current = () => lookup === this.repoLookup && JSON.stringify(context) === JSON.stringify(this.folderContext());
    if (!cwd) { this.repoError = "No terminal folder selected."; cx.notify(); return; }
    if (remote) {
      this.repoError = "Current folder is remote. Select its GitHub repository from the list instead.";
      cx.notify(); return;
    }
    cx.spawn(async cx => {
      try {
        const r = await exec("gh", ["repo", "view", "--json", "nameWithOwner"], { cwd });
        if (r.code !== 0) throw new Error(r.stderr || "Current folder is not a GitHub repository");
        const name = JSON.parse(r.stdout).nameWithOwner;
        if (current()) this.selectRepo(name, cx);
      } catch (e) { if (current()) this.repoError = String(e.message || e); }
      cx.notify();
    });
  }

  colors() { return palette(theme()); }

  icon(name, size = 16, color = this.colors().blue) {
    return svg(`mods/github-prs/${name}.svg`).size(size).flex_none().text_color(color);
  }

  badge(label, tone = "blue") {
    const p = this.colors();
    return div().flex_none().whitespace_nowrap().px(7).py(3).rounded(20).text_size(11)
      .bg(p[`${tone}Wash`] || p.inset).text_color(p[tone] || p.secondary).child(label);
  }

  avatar(login, size = 28) {
    const p = this.colors(), tone = authorTone(login);
    return h_flex().size(size).flex_none().items_center().justify_center().rounded(size / 2)
      .bg(p[`${tone}Wash`]).text_color(p[tone]).text_size(10).font_semibold()
      .child(authorInitials(login));
  }

  surface() {
    const p = this.colors();
    return v_flex().min_w(0).flex_none().p(12).gap(10).rounded(14).border(1).border_color(p.stroke).bg(p.card);
  }

  sectionHeading(icon, title, tone = "blue", trailing = "") {
    const p = this.colors();
    return h_flex().items_center().gap(8)
      .child(h_flex().size(25).flex_none().items_center().justify_center().rounded(7).bg(p[`${tone}Wash`])
        .child(this.icon(icon, 14, p[tone])))
      .child(div().flex_1().text_size(13).font_semibold().child(title))
      .when(Boolean(trailing), el => el.child(this.badge(trailing, tone)));
  }

  button(id, label, action, active = false) {
    const p = this.colors();
    return div().id(id).px(10).py(7).rounded(9).text_size(12).flex_none().whitespace_nowrap()
      .bg(active ? p.action : p.inset).text_color(active ? p.white : p.blue)
      .hover(s => s.bg(active ? p.actionHover : p.hover)).on_click(action).child(label);
  }

  notice(text, tone = "orange") {
    const p = this.colors();
    return div().px(10).py(8).rounded(10).text_size(12).flex_none()
      .bg(p[`${tone}Wash`]).text_color(p[tone]).child(text);
  }

  input(state) {
    const p = this.colors();
    return h_flex().h(36).flex_none().min_w(0).items_center().gap(7).px(10).rounded(10).bg(p.inset)
      .child(this.icon("search", 14, p.muted))
      .child(Input.new(state).flex_1().min_w(0).h(34).text_size(12).text_color(p.text));
  }

  repoPicker() {
    const p = this.colors(), q = this.repoQuery.toLowerCase();
    const visible = this.repos.filter(r => r.name.toLowerCase().includes(q));
    return v_flex().gap(10).min_h(0).flex_1()
      .child(this.input(this.repoInput))
      .child(h_flex().gap(6)
        .child(this.button("all-repos", "All repositories", (_e, cx) => this.selectRepo("", cx), !this.repo))
        .child(this.button("reload-repos", "Reload list", (_e, cx) => this.loadRepos(cx))))
      .child(div().text_size(11).text_color(p.secondary).child(`${visible.length} of ${this.repos.length} accessible repositories`))
      .child(v_flex().id("repo-list").flex_1().min_h(0).overflow_y_scrollbar().gap(5).children(
        visible.map(r => h_flex().id(`repo-${r.name}`).items_center().gap(8).px(10).py(10).rounded(10)
          .bg(this.repo === r.name ? p.blueWash : p.card).hover(s => s.bg(p.hover))
          .on_click((_e, cx) => this.selectRepo(r.name, cx))
          .child(this.icon("folder", 16, r.private ? p.purple : p.blue))
          .child(div().flex_1().min_w(0).text_size(12).text_color(p.text).child(r.name))
          .when(this.repo === r.name, el => el.child(this.icon("check", 14, p.blue)))
          .when(r.private && this.repo !== r.name, el => el.child(this.badge("Private", "secondary"))))))
      .when(!visible.length && !this.loadingRepos, el => el.child(this.emptyState("No repositories found", "Try a different owner or repository name.")));
  }

  mergeView() {
    const p = this.colors(), chain = this.chain;
    const steps = [...(chain?.steps ?? [])].reverse(), top = steps[0], origin = chainOrigin(chain);
    const labels = [origin.reference, top?.base.name, ...steps.map(pr => pr.head.name)].filter(Boolean).map(compactBranch);
    const label = name => labels.filter(l => l === compactBranch(name)).length > 1 ? name : compactBranch(name);
    const rootTone = origin.status ? statusTone(origin.status.color) : "purple";
    return this.surface().gap(7)
      .child(this.sectionHeading("branch", "Merge chain", "purple", this.mergeLoading ? "Checking…" : ""))
      .tooltip(this.mergeLoading ? "Loading merge chain…" : "Each status is relative to the branch immediately to its left. < links a PR to its target; ≈ compares with the default when no upstream PR exists. Need-merge means missing commits, not a required merge order. Squash/rebase merges can affect counts. Hover a branch for details.")
      .when(!chain && this.mergeLoading, el => el.child(div().text_size(12).text_color(p.secondary).child("Finding branch targets…")))
      .when(Boolean(top), el => el.child(
        h_flex().id("merge-chain-line").w_full().min_w(0).flex_none().items_center().flex_wrap().gap(6)
          .when(Boolean(origin.reference), el => el
            .child(this.badge(label(origin.reference), "purple"))
            .child(div().flex_none().text_color(p.secondary).tooltip("Comparison only — no PR connects these branches").child("≈")))
          .child(div().flex_none().whitespace_nowrap().px(8).py(5).rounded(8).text_size(12)
            .bg(p[`${rootTone}Wash`] || p.inset).text_color(p[rootTone])
            .tooltip(`${top?.base.name}${top?.baseDrift ? ` · ${top.baseDrift.behind_by} commits behind ${chain.defaultBranch}` : ""}${origin.reference ? `\nCompared with ${origin.reference}; no upstream PR was found. This is not a known PR target.` : ""}`)
            .child(`${label(top?.base.name)}${origin.status ? ` (${origin.status.label})` : ""}`))
          .children(steps.map(pr => {
            const status = chainSync(pr, this.mergeLoading), sync = syncStatus(pr.comparison, pr.base.name), tone = statusTone(status.color);
            const selected = pr.number === this.selected.number && pr.repository.nameWithOwner === this.selected.repository.nameWithOwner;
            const detail = [`${pr.head.name} → ${pr.base.name}`, `#${pr.number} · ${pr.title}`, sync.label,
              pr.comparison ? `${pr.comparison.ahead_by} commits ahead · ${pr.comparison.behind_by} behind target` : pr.comparisonError,
              mergeStatus(pr).label, pr.isDraft ? "Draft" : "",
              pr.headDrift ? `Branch vs ${chain.defaultBranch}: ${pr.headDrift.behind_by} behind` : pr.headDriftError,
              pr.baseDrift ? `Base vs ${chain.defaultBranch}: ${pr.baseDrift.behind_by} behind` : pr.baseDriftError].filter(Boolean).join("\n");
            return h_flex().id(`merge-${pr.repository.nameWithOwner}-${pr.number}`).flex_none().items_center().gap(6)
              .child(div().flex_none().text_color(p.secondary).child("<"))
              .child(div().id(`merge-open-${pr.number}`).flex_none().whitespace_nowrap().text_size(12).rounded(8).px(8).py(5)
                .border(1).border_color(selected ? p.blue : p[`${tone}Wash`] || p.inset)
                .bg(p[`${tone}Wash`] || p.inset).text_color(p[tone]).hover(s => s.bg(p.hover))
                .tooltip(detail).accessibility_label(`${pr.head.name}: ${status.label}. PR ${pr.number}`)
                .on_click((_e, cx) => { if (!selected) this.selectPR(pr, cx); })
                .child(`${label(pr.head.name)} (${status.label})`));
          }))))
      .when(chain?.end === "missing", el => el.child(div().text_size(11).text_color(p.secondary)
        .child(origin.reference
          ? `≈ Compared with ${origin.reference} · no upstream PR for ${compactBranch(top?.base.name)}`
          : `No upstream PR found for ${compactBranch(top?.base.name)}.`)))
      .children((chain?.warnings ?? []).map((warning, i) => this.notice(warning).id(`merge-warning-${i}`)))
      .children((chain?.alternatives ?? []).map(pr => this.button(`merge-alternative-${pr.number}`, `Inspect #${pr.number} → ${compactBranch(pr.base.name)}`, (_e, cx) => this.selectPR(pr, cx))));
  }

  detailView() {
    const p = this.colors(), pr = this.selected, d = this.detail;
    const ci = ciStatus(d?.statusCheckRollup), people = reviewers(d ?? {}).filter(person => person.state === "APPROVED");
    const login = pr.author?.login || "unknown";
    const state = pr.merged ? "Merged" : pr.state === "closed" ? "Closed" : pr.isDraft ? "Draft" : "Open";
    return v_flex().min_h(0).flex_1().gap(10)
      .child(h_flex().items_center().gap(7)
        .child(h_flex().id("back").items_center().gap(3).px(8).py(7).rounded(9).bg(p.inset).text_color(p.blue)
          .hover(s => s.bg(p.hover)).on_click((_e, cx) => { this.selected = null; this.detailRequest++; cx.notify(); })
          .child(this.icon("back", 14, p.blue)).child(div().text_size(12).child("All requests")))
        .child(div().flex_1())
        .child(this.button("open-pr", "GitHub ↗", (_e, cx) => this.openPR(pr, cx), true)))
      .child(v_flex().id("pr-detail").flex_1().min_h(0).min_w(0).overflow_y_scrollbar().gap(12)
        .child(v_flex().min_w(0).flex_none().rounded(16).border(1).border_color(p.stroke).p(14).gap(11)
          .bg(p.heroStart)
          .child(h_flex().items_center().gap(6)
            .child(this.badge(`#${pr.number}`, "blue"))
            .child(this.badge(state, state === "Draft" ? "orange" : state === "Closed" ? "red" : state === "Merged" ? "purple" : "green")))
          .child(div().text_size(17).font_semibold().child(pr.title))
          .child(div().text_size(11).text_color(p.secondary).child(pr.repository.nameWithOwner))
          .child(h_flex().items_center().gap(8)
            .child(this.avatar(login))
            .child(div().flex_1().min_w(0).text_size(12).text_color(p.secondary).child(`@${login}`)))
          .when(Boolean(d), el => el.child(h_flex().items_center().flex_wrap().gap(5)
            .child(this.badge(ci.label, statusTone(ci.color)))
            .child(this.badge(people.length ? `✓ ${people.length} approved` : "No approvals", people.length ? "green" : "secondary")))))
        .when(Boolean(this.openedFeedback), el => el.child(this.notice(feedbackTooltip(this.openedFeedback), this.openedFeedback?.tone)))
        .when(this.detailLoading, el => el.child(div().text_size(12).text_color(p.secondary).child("Loading description and approvals…")))
        .when(Boolean(this.detailError), el => el.child(this.notice(this.detailError, "red")))
        .child(this.mergeView())
        .when(Boolean(d), el => el
          .child(this.surface()
            .child(this.sectionHeading("comment", "Description", "blue"))
            .child(h_flex().items_center().flex_wrap().gap(6)
              .child(this.badge(`${d?.changedFiles} files`, "secondary"))
              .child(this.badge(`+${d?.additions}`, "green"))
              .child(this.badge(`−${d?.deletions}`, "red")))
            .child(TextView.markdown(`pr-description-${pr.repository.nameWithOwner}-${pr.number}`, d?.body || "No description.")
              .selectable(true).scrollable(false)
              .on_link_click((link, cx) => {
                try {
                  const base = link.startsWith("#") ? pr.url : `https://github.com/${pr.repository.nameWithOwner}/blob/${encodeURIComponent(d?.headRefName || "HEAD")}/`;
                  const url = new URL(link, base);
                  if (url.protocol === "https:" || url.protocol === "http:") cx.open_url(url.href);
                } catch { /* Invalid links are inert. */ }
              })))
          .child(this.surface()
            .child(this.sectionHeading("check", "Approvals", "green", String(people.length)))
            .when(Boolean(d?.reviewDecision), el => el.child(div().text_size(11).text_color(p.secondary)
              .child(`GitHub decision · ${d.reviewDecision.replaceAll("_", " ").toLowerCase()}`)))
            .children(people.map(person => h_flex().id(`reviewer-${person.key}`).items_center().gap(8).py(4)
              .child(this.avatar(person.name.replace(/^@/, "")))
              .child(div().flex_1().min_w(0).text_size(12).child(person.name))
              .child(this.badge("✓ Approved", "green"))))
            .when(!people.length, el => el.child(div().text_size(12).text_color(p.secondary).child("No approvals yet.")))))
        .child(h_flex().id("review-terminal").items_center().justify_center().gap(7).px(10).py(10).rounded(10)
          .bg(p.blueWash).text_color(p.blue).hover(s => s.bg(p.hover)).on_click(() => this.reviewPR(pr))
          .child(this.icon("comment", 15, p.blue)).child(div().text_size(12).font_semibold().child("View comments in new tab")))
        .child(div().px(3).text_size(10).text_color(p.secondary).child("Read-only here. Comment, approve and merge on GitHub.")));
  }

  emptyState(title, message) {
    const p = this.colors();
    return v_flex().items_center().p(20).gap(10).rounded(14).bg(p.card).flex_none()
      .child(h_flex().size(44).items_center().justify_center().rounded(14).bg(p.blueWash).child(this.icon("pr", 23, p.blue)))
      .child(div().text_size(14).font_semibold().child(title))
      .child(div().text_size(12).text_color(p.secondary).child(message));
  }

  prCard(pr, inDashboard = false) {
    const p = this.colors(), login = pr.author?.login || "unknown", tone = pr.isDraft ? "orange" : "green";
    const state = this.attentionState(), feedback = unseenFeedback(pr, this.viewer, state.seen, state.pending);
    const preview = feedbackTooltip(feedback), summary = feedbackSummary(feedback), ci = prCIStatus(pr), ciTone = statusTone(ci.color);
    const dismissed = dashboardHidden(pr, state), removed = Boolean(state.unfollowed?.[prKey(pr)]);
    return h_flex().id(`pr-${pr.repository.nameWithOwner}-${pr.number}`).min_w(0).flex_none().rounded(13).border(1).border_color(p.stroke)
      .bg(p.card).shadow_sm().hover(s => s.bg(p.hover).border_color(p.blue)).on_click((_e, cx) => this.selectPR(pr, cx))
      .child(div().w(3).flex_none().my(14).rounded(3).bg(p[tone]))
      .child(v_flex().flex_1().min_w(0).p(12).gap(9)
        .child(h_flex().items_center().gap(6)
          .child(this.badge(`#${pr.number}`, "blue"))
          .child(this.badge(pr.isDraft ? "○ Draft" : "↗ Open", tone))
          .child(div().flex_1())
          .child(div().id(`ci-${prKey(pr)}`).size(28).flex_none().flex().items_center().justify_center().rounded(7)
            .bg(p[`${ciTone}Wash`] || p.inset)
            .tooltip(`${ci.label} · latest commit · checked on Refresh`).accessibility_label(ci.label)
            .child(this.icon(ci.icon, 15, p[ciTone])))
          .when(Boolean(feedback), el => el.child(
            div().id(`feedback-${prKey(pr)}`).size(28).flex_none().flex().items_center().justify_center().rounded(7)
              .bg(p.orangeWash).hover(s => s.bg(p.orangeWash)).tooltip(preview)
              .accessibility_label(`Unseen feedback: ${preview}`)
              .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
              .on_click((_e, cx) => { cx.stop_propagation(); })
              .child(this.icon("bell", 15, p.orange))))
          .child(div().id(`external-${prKey(pr)}`).size(28).flex_none().flex().items_center().justify_center().rounded(7)
            .hover(s => s.bg(p.blueWash)).tooltip(`Open PR on GitHub\n${pr.url}`)
            .accessibility_label(`Open PR #${pr.number} on GitHub`)
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => { cx.stop_propagation(); this.openPR(pr, cx); })
            .child(this.icon("external", 14, p.blue))))
        .child(div().text_size(14).font_semibold().child(pr.title))
        .child(div().text_size(11).text_color(p.secondary).child(pr.repository.nameWithOwner))
        .when(Boolean(feedback), el => el.child(h_flex().flex_wrap().gap(5)
          .child(this.badge(summary.label, feedback?.tone)).child(div().text_size(10).text_color(p.secondary).child(summary.people))
          .when(Boolean(summary.comments), row => row.child(div().text_size(10).text_color(p.secondary).child(summary.comments)))))
        .when(inDashboard, el => el.child(h_flex().flex_wrap().gap(5).children((pr.assignments ?? []).map(label => this.badge(label, label.startsWith("Team") ? "purple" : "blue")))))
        .when(inDashboard, el => el.child(h_flex().justify_end().items_center().gap(8)
          .when(dismissed, row => row.child(this.badge(removed ? "Removed" : "Dismissed", "orange")))
          .when(!dismissed, row => row.child(
            div().id(`dismiss-${prKey(pr)}`).px(8).py(5).rounded(6).text_size(11).text_color(p.secondary)
              .hover(s => s.bg(p.hover)).tooltip("Dismiss this update · the PR returns when it updates")
              .accessibility_label("Dismiss current PR update")
              .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
              .on_click((_e, cx) => { cx.stop_propagation(); this.dismissPR(pr, cx); }).child("Dismiss")))
          .child(div().id(`remove-${prKey(pr)}`).px(8).py(5).rounded(6).text_size(11).text_color(p.blue)
            .hover(s => s.bg(p.hover))
            .tooltip(dismissed ? "Restore to dashboard" : "Stop tracking on this dashboard until restored · does not unsubscribe on GitHub")
            .accessibility_label(dismissed ? "Restore PR to dashboard" : "Remove PR from dashboard")
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => { cx.stop_propagation(); this.removePR(pr, cx); }).child(dismissed ? "Restore" : "Remove"))))
        .child(h_flex().items_center().gap(7)
          .child(this.avatar(login, 24))
          .child(div().flex_1().min_w(0).text_size(11).text_color(p.secondary).child(`@${login}`))));
  }

  dashboardView(rows) {
    const p = this.colors(), state = this.attentionState();
    const dismissed = pr => dashboardHidden(pr, state);
    const active = rows.filter(pr => !dismissed(pr)), visible = this.showDismissed ? rows : active;
    return v_flex().flex_1().min_h(0).min_w(0).gap(10)
      .child(v_flex().flex_none().p(14).gap(7).rounded(14).bg(p.heroStart)
        .child(h_flex().items_center().gap(8).child(this.icon("bell", 20, p.blue)).child(div().text_size(16).font_semibold().child("Your review radar")))
        .child(div().text_size(12).text_color(p.secondary).child(this.loading ? "Finding requests for you and your teams…" : `${active.length} PR${active.length === 1 ? "" : "s"} waiting for you or your teams`))
        .child(div().text_size(10).text_color(p.secondary).child("Hover a bell to see who approved, requested changes or commented. Dismiss hides this update; Remove stops tracking until restored.")))
      .child(h_flex().items_center().gap(6)
        .child(div().flex_1().text_size(11).text_color(p.secondary).child(this.viewer ? `Signed in as @${this.viewer}` : "GitHub review assignments"))
        .child(this.button("toggle-dismissed", this.showDismissed ? "Hide hidden" : "Show hidden", (_e, cx) => { this.showDismissed = !this.showDismissed; cx.notify(); })))
      .child(v_flex().id("dashboard-list").flex_1().min_h(0).min_w(0).overflow_y_scrollbar().gap(9)
        .children(visible.map(pr => this.prCard(pr, true)))
        .when(!this.loading && !visible.length, el => el.child(this.emptyState(this.error ? "Nothing to show yet" : "A clear radar", this.error ? "Some assignments could not be loaded. Check the warning above." : "No matching review requests. Refresh to check for new ones."))))
      .when(Boolean(this.updated) && !this.loading, el => el.child(div().text_size(10).text_color(p.secondary).child(`Checked ${this.updated} · manual refresh`)));
  }

  listView(rows) {
    const p = this.colors();
    return v_flex().flex_1().min_h(0).min_w(0).gap(10)
      .child(this.input(this.prInput))
      .child(div().text_size(10).text_color(p.secondary).child("Bells show unseen feedback. Hover to see who approved, requested changes or commented. Refresh to check for updates."))
      .child(h_flex().items_center().gap(5).px(2)
        .child(div().flex_1().text_size(12).font_semibold().child(this.loading ? "Finding your next review…" : `${rows.length} pull request${rows.length === 1 ? "" : "s"}`))
        .child(this.badge("Open", "green")))
      .child(v_flex().id("pr-list").flex_1().min_h(0).min_w(0).overflow_y_scrollbar().gap(9).children(rows.map(pr => this.prCard(pr)))
        .when(this.loading && !rows.length, el => el.child(this.emptyState("A little GitHub catch-up", "Fetching open pull requests…")))
        .when(!this.loading && !rows.length && !this.error && !this.repoError, el => el.child(this.emptyState("All caught up", "No open pull requests match these filters.")))
        .when(this.limited && this.limit < 1000, el => el.child(this.button("more-prs", `Load older PRs · ${this.limit}/repo`, (_e, cx) => {
          this.limit = Math.min(1000, this.limit + 100); this.load(cx);
        })))
        .when(this.limited && this.limit >= 1000, el => el.child(this.notice("Up to 1,000 open PRs per repository. Open GitHub for older requests."))))
      .when(Boolean(this.updated) && !this.loading, el => el.child(div().px(2).text_size(10).text_color(p.secondary).child(`Updated ${this.updated}`)));
  }

  render() {
    const p = this.colors(), q = this.prQuery.toLowerCase();
    const refreshing = this.selected ? this.detailLoading || this.mergeLoading : this.loading || this.loadingRepos;
    const rows = this.view === "dashboard" ? this.rows : this.rows.filter(pr => `${pr.title} ${pr.number} ${pr.repository.nameWithOwner} ${pr.author?.login || ""}`.toLowerCase().includes(q));
    return v_flex().id("github-prs").size_full().min_w(0).min_h(0).rounded(16).border(1).border_color(p.stroke)
      .bg(p.canvas).text_color(p.text).text_size(13).p(14).gap(12)
      .child(h_flex().items_center().gap(10).flex_none()
        .child(h_flex().size(38).flex_none().items_center().justify_center().rounded(11)
          .bg("#006bdf").child(this.icon("pr", 21, p.white)))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().text_size(18).font_semibold().child("Pull Requests"))
          .child(div().text_size(11).text_color(p.secondary).child("Your GitHub, at a glance")))
        .child(h_flex().id("refresh-prs").size(32).flex_none().items_center().justify_center().rounded(10).bg(p.inset)
          .disabled(Boolean(refreshing)).text_color(refreshing ? p.muted : p.blue).hover(s => s.bg(p.hover))
          .tooltip(refreshing ? "Refreshing…" : "Refresh pull requests").accessibility_label(refreshing ? "Refreshing pull requests" : "Refresh pull requests")
          .on_click((_e, cx) => {
            if (refreshing) return;
            if (this.selected) this.selectPR(this.selected, cx);
            else this.view === "dashboard" || this.repos.length ? this.load(cx) : this.loadRepos(cx);
          }).child(this.icon("refresh", 16, refreshing ? p.muted : p.blue))))
      .child(h_flex().flex_none().p(3).gap(3).rounded(11).bg(p.inset)
        .children([["dashboard", "dashboard-prs", "Dashboard"], ["mine", "my-prs", "My PRs"], ["all", "all-prs", "All PRs"]].map(([view, id, label]) =>
          h_flex().id(id).flex_1().items_center().justify_center().py(7).rounded(8)
            .bg(this.view === view ? p.card : p.inset).text_color(this.view === view ? p.blue : p.secondary)
            .hover(s => s.bg(p.hover)).on_click((_e, cx) => { if (this.view !== view) { this.view = view; this.showRepos = false; this.mine = view === "mine"; this.save(); this.load(cx); } })
            .child(div().text_size(12).font_semibold().child(label)))))
      .when(this.view !== "dashboard", el => el.child(h_flex().items_center().gap(6).flex_none()
        .child(h_flex().id("choose-repo").flex_1().min_w(0).items_center().gap(8).p(10).rounded(11).bg(p.card).border(1).border_color(p.stroke)
          .hover(s => s.bg(p.hover)).on_click((_e, cx) => { this.showRepos = !this.showRepos; if (this.showRepos && !this.reposLoaded) this.loadRepos(cx); cx.notify(); })
          .child(this.icon("folder", 17, p.blue))
          .child(div().flex_1().min_w(0).text_size(12).child(this.repo || (this.reposLoaded ? `All repositories · ${this.repos.length}` : "All repositories")))
          .child(this.icon("chevron", 12, p.secondary)))
        .child(h_flex().id("current-repo").size(33).flex_none().items_center().justify_center().rounded(9).bg(p.blueWash)
          .tooltip("Use current terminal folder").accessibility_label("Use current folder")
          .hover(s => s.bg(p.hover)).on_click((_e, cx) => this.useCurrentRepo(cx)).child(this.icon("branch", 16, p.blue)))))
      .when(this.view !== "dashboard" && this.loadingRepos, el => el.child(div().text_size(11).text_color(p.secondary).child("Syncing your repositories…")))
      .when(this.view !== "dashboard" && Boolean(this.repoError), el => el.child(this.notice(this.repoError, "red")))
      .when(Boolean(this.error), el => el.child(this.notice(this.error)))
      .when(Boolean(this.actionMessage), el => el.child(this.notice(this.actionMessage, "red")))
      .child(this.showRepos && this.view !== "dashboard" ? this.repoPicker() : this.selected ? this.detailView() : this.view === "dashboard" ? this.dashboardView(rows) : this.listView(rows))
      .child(h_flex().items_center().gap(5).flex_none().px(2)
        .child(div().text_size(10).text_color(p.secondary).child("Local gh · Manual refresh · Dismissals & seen state are local")));
  }
}
