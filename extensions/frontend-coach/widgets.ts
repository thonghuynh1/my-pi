/**
 * widgets.ts — function-based widget map for MyOffice.
 *
 * Instead of hand-maintaining a .coach-widgets.json that drifts from the
 * server-side widget catalog, we *derive* the map on demand:
 *
 *   1. Parse  C:/GitRepos/MyOffice/Domain/Services/WidgetDataProvider.cs
 *      (one file, six IReadOnlyCollection<Widget> blocks). This is the
 *      authoritative catalog. ── primary source.
 *   2. Optional override layer: ./.frontend-coach/widgets.overrides.json
 *      ── lets you patch one entry without freezing everything.
 *   3. Vars (userId/clientId/companyId) come from the live Edge URL when
 *      reachable, then from .coach-env.local.json, then from process.env.
 *
 * Public API:
 *   - resolveWidget(query)           — pick the widget(s) matching a query
 *   - listWidgets(filter?)           — every known widget, optionally filtered
 *   - coachEnv()                     — current vars (live → file → env)
 *   - repoForFile(absPath)           — { name, path } of the repo a file lives in
 *   - resolveRecordingPlan(input)    — file/uid/scope → full RecordTestInput
 *                                       (url, waitFor, eval-ready, …)
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { ensureBrowser } from "./edge.ts";

// ──────────────────────────────────────────────────────────────────────────
// Configuration / defaults
// ──────────────────────────────────────────────────────────────────────────

const DEFAULT_MYOFFICE_PATH =
	process.env.COACH_MYOFFICE_PATH ?? "C:/GitRepos/MyOffice";
const DEFAULT_GITREPOS_ROOT =
	process.env.COACH_GITREPOS_ROOT ?? "C:/GitRepos";
const DEFAULT_SHELL_ORIGIN =
	process.env.COACH_SHELL_ORIGIN ?? "https://localhost:5050";

const CATALOG_FILE_REL = "Domain/Services/WidgetDataProvider.cs";
const OVERRIDES_FILE = "./.frontend-coach/widgets.overrides.json";
const ENV_FILE = "./.frontend-coach/env.local.json";

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export type Scope =
	| "user-aggregated"   // /user/:userId/:widgetuid  → SingleAggregatedContainer
	| "user-overview"     // /user/:userId/overview    → OverviewContainer (tile)
	| "company-single"    // /client/.../company/.../:widgetuid → Single
	| "company-special"   // /client/.../company/.../(companyinfo|flex|companyexpense)/:widgetuid → custom container
	| "modal";            // no own URL, opened via pubsub

export type ViewState = "single" | "grid" | "modal";

export interface WidgetEntry {
	uid: string;
	serviceName: string;       // matches one of C:/GitRepos/<name>
	scope: Scope;
	viewState: ViewState;
	rootId: string;
	titleKey?: string;
	sourceCollection: string;  // _rootWidgets, _defaultWidgets, …
	hasServiceConfigurationModal?: boolean;
}

export interface RepoInfo {
	name: string;              // "Documents", "Activities", …
	path: string;              // absolute on-disk path
}

export interface CoachVars {
	userId?: string;
	clientId?: string;
	companyId?: string;
}

export interface ResolvedWidget extends WidgetEntry {
	repo: RepoInfo;
	url: string | null;           // null for modal-only / unresolved
	mountSelector: string;        // best CSS selector to wait for
	readyExpression: string;      // JS expression: true when widget rendered
	vars: CoachVars;              // resolved vars used to build url
	source: "csharp" | "json";    // which tier produced the catalog entry
}

// ──────────────────────────────────────────────────────────────────────────
// 1. Parse WidgetDataProvider.cs
// ──────────────────────────────────────────────────────────────────────────

const COLLECTION_TO_SCOPE: Record<string, Scope> = {
	_rootWidgets:     "user-aggregated",
	_overviewWidgets: "user-overview",
	_defaultWidgets:  "company-single",
	_optionalWidgets: "company-single",
	_listWidgets:     "company-special",
	_modalWidgets:    "modal",
};

let cachedCatalog: { mtimeMs: number; entries: WidgetEntry[] } | null = null;

export function parseCsharpCatalog(myOfficePath = DEFAULT_MYOFFICE_PATH): WidgetEntry[] {
	const file = join(myOfficePath, CATALOG_FILE_REL);
	if (!existsSync(file)) {
		throw new Error(
			`Widget catalog source not found at ${file}. ` +
			`Set COACH_MYOFFICE_PATH or provide ${OVERRIDES_FILE}.`,
		);
	}
	const stat = (() => { try { return require("node:fs").statSync(file); } catch { return null; } })();
	if (cachedCatalog && stat && cachedCatalog.mtimeMs === stat.mtimeMs) {
		return cachedCatalog.entries;
	}

	const src = readFileSync(file, "utf8");
	const out: WidgetEntry[] = [];

	for (const [collectionName, scope] of Object.entries(COLLECTION_TO_SCOPE)) {
		// Find the collection literal:  _rootWidgets = [ … ];
		// `s` flag for multi-line; lazy so we stop at the first `];` that closes
		// the collection. The widget bodies use only `{ … }` so this is safe.
		const collRe = new RegExp(
			`${collectionName}\\s*=\\s*\\[(?<body>[\\s\\S]*?)\\];`,
			"m",
		);
		const cm = collRe.exec(src);
		if (!cm || !cm.groups) continue;

		const body = cm.groups.body;
		const widgetRe = /new\s+Widget\s*\{([\s\S]*?)\}/g;
		let wm: RegExpExecArray | null;
		while ((wm = widgetRe.exec(body))) {
			const fields = wm[1];
			const str = (k: string) => {
				const m = new RegExp(`\\b${k}\\s*=\\s*"([^"]+)"`).exec(fields);
				return m ? m[1] : undefined;
			};
			const bool = (k: string) => {
				const m = new RegExp(`\\b${k}\\s*=\\s*(true|false)`).exec(fields);
				return m ? m[1] === "true" : undefined;
			};

			const uid = str("Uid");
			const serviceName = str("ServiceName");
			if (!uid || !serviceName) continue;
			const viewState = (str("ViewState") as ViewState) ?? "single";
			const rootId = str("RootId") ?? "";

			out.push({
				uid,
				serviceName,
				scope,
				viewState,
				rootId,
				titleKey: str("TitleKey"),
				sourceCollection: collectionName,
				hasServiceConfigurationModal: bool("HasServiceConfigurationModal"),
			});
		}
	}

	if (stat) cachedCatalog = { mtimeMs: stat.mtimeMs, entries: out };
	return out;
}

// ──────────────────────────────────────────────────────────────────────────
// 2. JSON overrides
// ──────────────────────────────────────────────────────────────────────────

export interface OverrideEntry extends Partial<WidgetEntry> {
	uid: string;        // required for matching
	scope?: Scope;      // optional disambiguator
	// override-only fields
	urlOverride?: string;          // full path, with {userId} etc
	mountSelectorOverride?: string;
	readyExpressionOverride?: string;
}

interface OverrideFile {
	widgets?: OverrideEntry[];
	add?: WidgetEntry[];
}

function loadOverrides(): OverrideFile {
	if (!existsSync(OVERRIDES_FILE)) return {};
	try {
		return JSON.parse(readFileSync(OVERRIDES_FILE, "utf8")) as OverrideFile;
	} catch (err) {
		console.warn(`[frontend-coach] failed to read ${OVERRIDES_FILE}: ${(err as Error).message}`);
		return {};
	}
}

// ──────────────────────────────────────────────────────────────────────────
// 3. Vars: live URL → env file → process.env
// ──────────────────────────────────────────────────────────────────────────

const RE_USER_URL = /\/user\/([^/?#]+)/i;
const RE_COMPANY_URL = /\/client\/([^/?#]+)\/company\/([^/?#]+)/i;

function parseVarsFromUrl(url: string | undefined | null): CoachVars {
	if (!url) return {};
	const v: CoachVars = {};
	const u = RE_USER_URL.exec(url);
	if (u) v.userId = u[1];
	const c = RE_COMPANY_URL.exec(url);
	if (c) { v.clientId = c[1]; v.companyId = c[2]; }
	return v;
}

async function readVarsFromLiveTab(): Promise<CoachVars> {
	try {
		const browser = await ensureBrowser();
		const ctx = browser.contexts()[0];
		if (!ctx) return {};
		const page = ctx.pages()[0];
		if (!page) return {};
		return parseVarsFromUrl(page.url());
	} catch {
		return {};
	}
}

function readVarsFromFile(): CoachVars {
	if (!existsSync(ENV_FILE)) return {};
	try {
		const j = JSON.parse(readFileSync(ENV_FILE, "utf8"));
		return {
			userId:    typeof j.userId === "string" ? j.userId : undefined,
			clientId:  typeof j.clientId === "string" ? j.clientId : undefined,
			companyId: typeof j.companyId === "string" ? j.companyId : undefined,
		};
	} catch {
		return {};
	}
}

function readVarsFromEnv(): CoachVars {
	return {
		userId:    process.env.COACH_USER_ID,
		clientId:  process.env.COACH_CLIENT_ID,
		companyId: process.env.COACH_COMPANY_ID,
	};
}

/**
 * Merge vars from live tab + env file + process env, in that priority.
 * `clientId` defaults to `userId` if not given (matches MyOffice convention
 * where the logged-in user IS the client for their own data).
 */
export async function coachEnv(): Promise<CoachVars> {
	const live = await readVarsFromLiveTab();
	const file = readVarsFromFile();
	const env  = readVarsFromEnv();
	const merged: CoachVars = {
		userId:    live.userId    ?? file.userId    ?? env.userId,
		clientId:  live.clientId  ?? file.clientId  ?? env.clientId,
		companyId: live.companyId ?? file.companyId ?? env.companyId,
	};
	if (!merged.clientId && merged.userId) merged.clientId = merged.userId;
	return merged;
}

// ──────────────────────────────────────────────────────────────────────────
// 4. File → repo
// ──────────────────────────────────────────────────────────────────────────

export function repoForFile(absPath: string, gitReposRoot = DEFAULT_GITREPOS_ROOT): RepoInfo | null {
	if (!absPath) return null;
	const p = normalize(isAbsolute(absPath) ? absPath : resolve(absPath));
	const root = normalize(gitReposRoot);
	const rootWithSep = root.endsWith(sep) ? root : root + sep;
	if (!p.toLowerCase().startsWith(rootWithSep.toLowerCase())) return null;
	const tail = p.slice(rootWithSep.length);
	const firstSeg = tail.split(/[\\/]/, 1)[0];
	if (!firstSeg) return null;
	return { name: firstSeg, path: join(root, firstSeg) };
}

// ──────────────────────────────────────────────────────────────────────────
// 5. URL / selector synthesis
// ──────────────────────────────────────────────────────────────────────────

function buildUrl(entry: WidgetEntry, vars: CoachVars): string | null {
	const uidLower = entry.uid.toLowerCase();
	switch (entry.scope) {
		case "user-aggregated":
			if (!vars.userId) return null;
			return `/user/${vars.userId}/${uidLower}`;
		case "user-overview":
			if (!vars.userId) return null;
			return `/user/${vars.userId}/overview`;
		case "company-single":
			if (!vars.clientId || !vars.companyId) return null;
			return `/client/${vars.clientId}/company/${vars.companyId}/${uidLower}`;
		case "company-special":
			// Three sub-routes exist (companyinfo|flex|companyexpense). We make
			// a best guess from the serviceName; an override may correct it.
			if (!vars.clientId || !vars.companyId) return null;
			const segment =
				entry.serviceName === "Flex" ? "flex" :
				entry.serviceName === "CompanyExpense" ? "companyexpense" :
				"companyinfo";
			return `/client/${vars.clientId}/company/${vars.companyId}/${segment}/${entry.uid}`;
		case "modal":
			return null;
	}
}

function buildMountSelector(entry: WidgetEntry): string {
	if (!entry.rootId) return "#single_widget_root";
	switch (entry.scope) {
		case "user-aggregated":
		case "company-single":
			return `#single_widget_root #${entry.rootId}`;
		case "user-overview":
		case "company-special":
			return `#${entry.rootId}`;
		case "modal":
			return `[data-testid=widget_modal] #${entry.rootId}`;
	}
}

function buildReadyExpression(mountSelector: string): string {
	// Widget container always renders an empty div at #<rootId>; the remote
	// micro-frontend's render call adds children. So "children present" is
	// the most reliable "rendered" signal that doesn't need per-widget knowledge.
	return `!!document.querySelector(${JSON.stringify(mountSelector)})?.children.length`;
}

// ──────────────────────────────────────────────────────────────────────────
// 6. Resolution
// ──────────────────────────────────────────────────────────────────────────

export interface ResolveQuery {
	uid?: string;
	file?: string;
	scope?: Scope;
	serviceName?: string;
}

export interface ResolveOptions {
	myOfficePath?: string;
	gitReposRoot?: string;
	shellOrigin?: string;
	vars?: CoachVars;
}

export async function listWidgets(filter: ResolveQuery = {}, opts: ResolveOptions = {}): Promise<ResolvedWidget[]> {
	const myOffice = opts.myOfficePath ?? DEFAULT_MYOFFICE_PATH;
	const gitRoot  = opts.gitReposRoot ?? DEFAULT_GITREPOS_ROOT;

	const base = parseCsharpCatalog(myOffice).map<WidgetEntry & { _source: "csharp" }>((e) => ({ ...e, _source: "csharp" }));
	const ov = loadOverrides();

	// Merge overrides by (uid, scope?).
	const merged = base.map((e) => {
		const o = ov.widgets?.find((x) => x.uid.toLowerCase() === e.uid.toLowerCase() && (!x.scope || x.scope === e.scope));
		return o ? { ...e, ...o } : e;
	});
	if (ov.add) {
		for (const a of ov.add) merged.push({ ...a, _source: "csharp" } as any);
	}

	const vars = opts.vars ?? await coachEnv();
	const repoFromFile = filter.file ? repoForFile(filter.file, gitRoot) : null;

	const filtered = merged.filter((e) => {
		if (filter.uid && e.uid.toLowerCase() !== filter.uid.toLowerCase()) return false;
		if (filter.scope && e.scope !== filter.scope) return false;
		if (filter.serviceName && e.serviceName.toLowerCase() !== filter.serviceName.toLowerCase()) return false;
		if (repoFromFile && e.serviceName.toLowerCase() !== repoFromFile.name.toLowerCase()) return false;
		return true;
	});

	return filtered.map((e) => {
		const repo: RepoInfo = repoFromFile && repoFromFile.name.toLowerCase() === e.serviceName.toLowerCase()
			? repoFromFile
			: { name: e.serviceName, path: join(gitRoot, e.serviceName) };
		const ov2 = ov.widgets?.find((x) => x.uid.toLowerCase() === e.uid.toLowerCase() && (!x.scope || x.scope === e.scope));
		const url = ov2?.urlOverride ?? buildUrl(e, vars);
		const mountSelector = ov2?.mountSelectorOverride ?? buildMountSelector(e);
		const readyExpression = ov2?.readyExpressionOverride ?? buildReadyExpression(mountSelector);
		const { _source, ...rest } = e as any;
		return { ...(rest as WidgetEntry), repo, url, mountSelector, readyExpression, vars, source: _source ?? "csharp" } as ResolvedWidget;
	});
}

/**
 * resolveWidget — the main entry point. Returns:
 *   - exactly 1 result if the query is unambiguous,
 *   - multiple if the query matches several widgets (caller picks),
 *   - empty array if nothing matches.
 *
 * When `file` is given and matches multiple widgets in the same repo, we
 * rank by a tiny heuristic on filename so the most likely answer is first.
 */
export async function resolveWidget(query: ResolveQuery, opts: ResolveOptions = {}): Promise<ResolvedWidget[]> {
	let results = await listWidgets(query, opts);

	// File-based rerank: prefer widget whose uid (or rootId stem) matches
	// the changed file's path segments. Modal widgets sink to the bottom
	// unless their uid is explicit in the path.
	if (query.file && results.length > 1) {
		const fileLower = query.file.toLowerCase();
		const score = (w: ResolvedWidget): number => {
			let s = 0;
			if (fileLower.includes(w.uid.toLowerCase())) s += 100;
			if (w.rootId && fileLower.includes(w.rootId.split("_")[0])) s += 30;
			// Penalise modals unless their name is in the path.
			if (w.scope === "modal" && !fileLower.includes(w.uid.toLowerCase())) s -= 80;
			// Prefer the canonical "single" widget over its specialised siblings.
			if (w.uid.toLowerCase() === w.serviceName.toLowerCase()) s += 10;
			return s;
		};
		results = [...results].sort((a, b) => score(b) - score(a));
	}

	return results;
}

// ──────────────────────────────────────────────────────────────────────────
// 7. RecordingPlan — what browser_record_for_widget consumes
// ──────────────────────────────────────────────────────────────────────────

export interface RecordingPlan {
	widget: ResolvedWidget;
	absoluteUrl: string;
	autoSteps: Array<{
		action: "waitFor" | "eval";
		selector?: string;
		expression?: string;
		ms?: number;
	}>;
}

export interface PlanQuery extends ResolveQuery {
	shellOrigin?: string;
}

export async function resolveRecordingPlan(query: PlanQuery, opts: ResolveOptions = {}): Promise<{ plan: RecordingPlan | null; candidates: ResolvedWidget[]; reason?: string }> {
	const shellOrigin = query.shellOrigin ?? opts.shellOrigin ?? DEFAULT_SHELL_ORIGIN;
	const candidates = await resolveWidget(query, opts);

	if (candidates.length === 0) {
		return { plan: null, candidates: [], reason: "no widget matched the query" };
	}
	const w = candidates[0];

	if (!w.url) {
		return {
			plan: null,
			candidates,
			reason: w.scope === "modal"
				? `widget '${w.uid}' is a modal — no direct URL; open via host widget instead`
				: `widget '${w.uid}' resolved but vars are incomplete: need ${requiredVars(w.scope).join(", ")}`,
		};
	}

	const absoluteUrl = shellOrigin.replace(/\/$/, "") + w.url;
	const plan: RecordingPlan = {
		widget: w,
		absoluteUrl,
		autoSteps: [
			{ action: "waitFor", selector: w.mountSelector, ms: 8000 },
			{ action: "eval",    expression: w.readyExpression },
		],
	};
	return { plan, candidates };
}

function requiredVars(scope: Scope): (keyof CoachVars)[] {
	switch (scope) {
		case "user-aggregated":
		case "user-overview":
			return ["userId"];
		case "company-single":
		case "company-special":
			return ["clientId", "companyId"];
		default:
			return [];
	}
}

// ──────────────────────────────────────────────────────────────────────────
// 8. Diagnostics
// ──────────────────────────────────────────────────────────────────────────

export interface CatalogStats {
	myOfficePath: string;
	catalogFile: string;
	catalogFileExists: boolean;
	totalWidgets: number;
	byScope: Record<Scope, number>;
	overridesFile: string;
	overridesPresent: boolean;
	envFile: string;
	envPresent: boolean;
	vars: CoachVars;
}

export async function catalogStats(opts: ResolveOptions = {}): Promise<CatalogStats> {
	const myOffice = opts.myOfficePath ?? DEFAULT_MYOFFICE_PATH;
	const catalogFile = join(myOffice, CATALOG_FILE_REL);
	const vars = await coachEnv();
	let entries: WidgetEntry[] = [];
	try { entries = parseCsharpCatalog(myOffice); } catch { /* surfaced via exists flag */ }
	const byScope = entries.reduce((acc, e) => {
		acc[e.scope] = (acc[e.scope] ?? 0) + 1; return acc;
	}, {} as Record<Scope, number>);
	return {
		myOfficePath: myOffice,
		catalogFile,
		catalogFileExists: existsSync(catalogFile),
		totalWidgets: entries.length,
		byScope,
		overridesFile: resolve(OVERRIDES_FILE),
		overridesPresent: existsSync(OVERRIDES_FILE),
		envFile: resolve(ENV_FILE),
		envPresent: existsSync(ENV_FILE),
		vars,
	};
}
