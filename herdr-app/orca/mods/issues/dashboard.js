import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, shared, setShared } from "herdr";
import { dashboard, prKey, unseenFeedback, trackFeedback, dashboardHidden, toggleDashboardPR, dismissDashboardPR, feedbackTooltip, feedbackSummary } from "./attention.js";
import { prCIStatus } from "./details.js";
import { readCache, writeCache, age } from "./cache.js";

// The PR dashboard from the old right-hand github-prs panel, as a tab of this
// dialog: your open PRs plus review requests for you or your teams, across
// every repo. Attention state keeps the old panel's shared key, so dismissals,
// removals and seen feedback survive the move. Rows are disk-cached like the
// lists: a reopen paints the cache at once and fetches behind it; past FRESH
// the background fetch runs again (the host's sync timer drives that).

const ORANGE = "#db6d28";
const CACHE_KEY = "dashboard";
const FRESH = 60000;
const CI_GLYPH = { passed: "pass", failed: "fail", building: "pending", neutral: "pending", none: "pending", unknown: "pending" };

export function acknowledgeFeedback(viewer, repo, number, at) {
  if (!viewer || !at) return;
  const key = `${repo.toLowerCase()}#${number}`, name = `github-prs.attention.${viewer.toLowerCase()}`;
  const state = shared(name) ?? { seen: {}, dismissed: {} }, pending = { ...state.pending };
  if (pending[key]?.at <= at) delete pending[key];
  const seenAt = at > (state.seen?.[key] || "") ? at : state.seen[key];
  setShared(name, { ...state, pending, seen: { ...state.seen, [key]: seenAt } });
}

export class Dashboard {
  constructor(host) {
    this.host = host;
    this.rows = []; this.viewer = ""; this.loading = false; this.loaded = false;
    this.error = null; this.warning = ""; this.showHidden = false; this.request = 0; this.at = 0;
  }

  state() { return this.viewer ? shared(`github-prs.attention.${this.viewer.toLowerCase()}`) ?? { seen: {}, dismissed: {} } : { seen: {}, dismissed: {} }; }

  save(state) { if (this.viewer) setShared(`github-prs.attention.${this.viewer.toLowerCase()}`, state); }

  load(cx, force = false) {
    if (this.loading) return;
    if (!force && this.loaded && age({ at: this.at }) < FRESH) return;
    const request = ++this.request;
    this.loading = true; this.error = null;
    cx.spawn(async (cx) => {
      cx.notify();
      try {
        if (!this.loaded) {
          const kept = await readCache(CACHE_KEY);
          if (request !== this.request) return;
          if (kept?.rows) {
            this.viewer = kept.viewer || ""; this.rows = kept.rows; this.warning = kept.warning ?? "";
            this.at = kept.at ?? 0; this.loaded = true;
            if (this.at) this.updated = new Date(this.at).toLocaleTimeString();
            if (this.viewer) this.save(trackFeedback(this.rows, this.viewer, this.state()));
            cx.notify();
            if (!force && age(kept) < FRESH) return;
          }
        }
        const result = await dashboard(exec, () => request === this.request);
        if (!result || request !== this.request) return;
        this.viewer = result.viewer || "";
        if (this.viewer) this.save(trackFeedback(result.rows, this.viewer, this.state()));
        this.rows = result.rows; this.warning = result.warning; this.loaded = true;
        this.at = Date.now(); this.updated = new Date(this.at).toLocaleTimeString();
        writeCache(CACHE_KEY, { at: this.at, viewer: this.viewer, rows: this.rows, warning: this.warning });
      } catch (e) { if (request === this.request) this.error = String(e?.message ?? e); }
      finally { if (request === this.request) { this.loading = false; cx.notify(); } }
    });
  }

  dismiss(pr, cx) { this.save(dismissDashboardPR(pr, this.state())); cx.notify(); }

  remove(pr, cx) { this.save(toggleDashboardPR(pr, this.state())); cx.notify(); }

  open(pr) {
    const state = this.state(), feedback = unseenFeedback(pr, this.viewer, state.seen, state.pending);
    this.host.openIssue(pr, { repo: pr.repository.nameWithOwner, pr: true, on: null,
      feedback: feedback ? { viewer: this.viewer, at: feedback.at } : null });
  }

  // ---- drawing, in this dialog's table style ----

  card(t, cx) {
    const h = this.host, state = this.state();
    const active = this.rows.filter((pr) => !dashboardHidden(pr, state)), visible = this.showHidden ? this.rows : active;
    return v_flex().flex_1().min_h(0).rounded(12).border_1().border_color(t.border).bg(t.chrome).overflow_hidden()
      .child(h_flex().px(18).pt(14).gap(8).items_center()
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().text_size(14).font_semibold().child("Your review radar"))
          .child(div().text_size(12).text_color(t.muted).child(this.loading && !this.rows.length ? "Finding your PRs and review requests…"
            : `${active.length} PR${active.length === 1 ? "" : "s"} · your PRs and requests for you or your teams`)))
        .child(h.chip("dash-hidden", this.showHidden ? "Hide hidden" : "Show hidden", this.showHidden, t, (cx) => { this.showHidden = !this.showHidden; cx.notify(); }))
        .child(h.btn("dash-refresh", t, this.loading ? "…" : h.glyph("refresh", 16), (cx) => this.load(cx, true), { square: true })))
      .child(h_flex().px(18).py(8).gap(8).items_center().text_size(11).text_color(t.dim)
        .child(div().flex_1().child(this.viewer ? `Signed in as @${this.viewer}` : "Your PRs & GitHub review assignments"))
        .when(Boolean(this.updated), (e) => e.child(div().child(this.loading && this.rows.length ? `Checked ${this.updated} · refreshing…` : `Checked ${this.updated}`))))
      .when(Boolean(this.error), (e) => e.child(div().px(18).pb(8).text_size(12).text_color(t.ansi1).child(this.error)))
      .when(Boolean(this.warning), (e) => e.child(div().px(18).pb(8).text_size(12).text_color(ORANGE).child(this.warning)))
      .child(this.head(t))
      .child(v_flex().id("dash-rows").flex_1().min_h(0).overflow_y_scrollbar()
        .children(visible.map((pr) => this.row(pr, t, cx, state)))
        .when(!visible.length, (e) => e.child(div().py(40).text_center().text_size(12).text_color(t.dim)
          .child(this.loading ? "Loading…" : this.error ? "Nothing to show yet" : "A clear radar — no matching open PRs or review requests"))));
  }

  head(t) {
    const cell = (w, s) => h_flex().w(w).flex_none().items_center().child(div().text_size(11).font_semibold().text_color(t.dim).child(s));
    return h_flex().h(40).px(18).gap(12).items_center().border_b(1).border_color(t.border).bg(t.chrome)
      .child(cell(96, "ID")).child(div().flex_1().child(div().text_size(11).font_semibold().text_color(t.dim).child("TITLE / CONTEXT")))
      .child(cell(44, "CI")).child(cell(120, "STATUS")).child(cell(130, "UPDATED")).child(cell(210, div()));
  }

  row(pr, t, cx, state) {
    const h = this.host, login = pr.author?.login || "unknown", repo = pr.repository.nameWithOwner;
    const feedback = unseenFeedback(pr, this.viewer, state.seen, state.pending), summary = feedbackSummary(feedback);
    const ci = prCIStatus(pr), hidden = dashboardHidden(pr, state), removed = Boolean(state.unfollowed?.[prKey(pr)]);
    const status = pr.isDraft ? { label: "Draft", color: "#8b949e", glyph: "pull" } : { label: "Open", color: "#3fb950", glyph: "pull" };
    const cell = (w, child) => h_flex().w(w).flex_none().items_center().child(child);
    const stop = (e, cx) => { this.press = e; cx.stop_propagation(); };
    return h_flex().id(`dash-${repo}-${pr.number}`).min_h(72).px(18).py(10).gap(12).items_center().border_b(1).border_color(t.border)
      .bg(t.background).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click(() => this.open(pr))
      .child(cell(96, h_flex().h(26).px(8).gap(6).items_center().rounded(6).border_1().border_color(t.border).text_size(12).text_color(t.muted)
        .child(h.glyph("pull", 13, t.muted)).child(`#${pr.number}`)))
      .child(v_flex().flex_1().min_w(0).gap(4)
        .child(div().text_size(14).truncate().child(pr.title))
        .child(h_flex().gap(10).items_center().text_size(12).text_color(t.muted).overflow_hidden()
          .child(h.avatar(login, 22, t, cx))
          .child(div().flex_none().child(login.replace(/^app\//, "")))
          .child(div().flex_none().child(repo))
          .children((pr.assignments ?? []).map((label) => div().h(20).px(7).flex_none().flex().items_center().rounded(10)
            .bg(t.raised).text_size(11).text_color(label.startsWith("Team") ? "#a371f7" : t.muted).child(label))))
        .when(Boolean(feedback), (e) => e.child(h_flex().gap(6).items_center().text_size(12)
          .child(div().flex_none().tooltip(feedbackTooltip(feedback)).child(h.glyph("bell", 14, ORANGE)))
          .child(div().flex_none().font_semibold().text_color(ORANGE).child(summary.label))
          .child(div().flex_none().text_color(t.muted).child(summary.people))
          .when(Boolean(summary.comments), (s) => s.child(div().flex_none().text_color(t.muted).child(summary.comments))))))
      .child(cell(44, div().tooltip(`${ci.label} · latest commit · checked on Refresh`).child(h.glyph(CI_GLYPH[ci.state] ?? "pending", 16, t[ci.color] ?? t.muted))))
      .child(cell(120, h_flex().h(26).px(8).gap(5).items_center().rounded(13).border_1().border_color(status.color + "99").bg(status.color + "1a")
        .text_size(12).text_color(status.color).child(h.glyph(status.glyph, 12, status.color)).child(status.label)))
      .child(cell(130, div().text_size(12).text_color(t.muted).child(h.updated(pr.updatedAt))))
      .child(cell(210, h_flex().gap(6).items_center().justify_end()
        .when(hidden, (e) => e.child(div().h(20).px(7).flex().items_center().rounded(10).bg(ORANGE + "1a").text_size(11).text_color(ORANGE).child(removed ? "Removed" : "Dismissed")))
        .when(!hidden, (e) => e.child(h.btn(`dash-dismiss-${repo}-${pr.number}`, t, div().child("Dismiss"), (cx) => this.dismiss(pr, cx), { h: 30 })))
        .child(h.btn(`dash-remove-${repo}-${pr.number}`, t, div().child(hidden ? "Restore" : "Remove"), (cx) => this.remove(pr, cx), { h: 30 }))
        .child(div().id(`dash-external-${repo}-${pr.number}`).size(28).flex().items_center().justify_center().rounded(6).text_color(t.muted)
          .hover((s) => s.bg(t.raised).text_color(t.foreground)).on_mouse_down("left", stop)
          .on_click((_e, cx) => { cx.stop_propagation(); h.openExternal(pr.url); })
          .child(h.glyph("external", 14)))));
  }
}
