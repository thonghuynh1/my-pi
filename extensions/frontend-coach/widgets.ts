/**
 * widgets.ts — function-based widget map for the MyOffice / MyBusiness shells.
 *
 * Both apps are micro-frontend shells that mount widgets from sibling repos,
 * and both declare their catalog in `Domain/Services/WidgetDataProvider.cs`.
 * The two files use *different* C# shapes and the two shells use *different*
 * URL schemes, so this module is app-aware:
 *
 *   MyOffice   (https://localhost:5050)
 *     catalog : IReadOnlyCollection<Widget> [ new Widget { Uid = "…" } ]
 *     routes  : /user/:userId/:uid , /client/:clientId/company/:companyId/:uid
 *   MyBusiness (https://localhost:5000)
 *     catalog : Dictionary<string,Widget> / List<Widget>
 *               new Widget(serviceName: "…", uid: "…", rootId: "…")
 *     routes  : /app/client/:userId/company/:companyId[/single/:uid]
 *
 * Instead of hand-maintaining a JSON map that drifts from the server-side
 * catalog, we *derive* the map on demand:
 *
 *   1. Parse  <repo>/Domain/Services/WidgetDataProvider.cs  — primary source.
 *   2. Optional override layer: ./.frontend-coach/widgets.overrides.json
 *   3. Vars (userId/clientId/companyId) come from the live Edge URL when
 *      reachable, then from .frontend-coach/env.local.json, then from process.env.
 *
 * The active app is auto-detected from the live Edge tab origin (5050 → MyOffice,
 * 5000 → MyBusiness), or forced via the `app` option / `COACH_APP` env var.
 *
 * Public API:
 *   - resolveWidget(query)           — pick the widget(s) matching a query
 *   - listWidgets(filter?)           — every known widget, optionally filtered
 *   - coachEnv()                     — current vars (live → file → env)
 *   - detectApp()                    — which shell is active
 *   - repoForFile(absPath)           — { name, path } of the repo a file lives in
 *   - resolveRecordingPlan(input)    — file/uid/scope → full RecordTestInput
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, resolve, sep } from "node:path";
import { ensureBrowser } from "./edge.ts";

// ──────────────────────────────────────────────────────────────────────────
// Configuration / defaults
// ──────────────────────────────────────────────────────────────────────────

export type AppKind = "myoffice" | "mybusiness";

interface AppConfig {
	kind: AppKind;
	repoPath: string;
	origin: string;
}

const stripSlash = (s: string) => s.replace(/\/$/, "");

const APPS: Record<AppKind, AppConfig> = {
	myoffice: {
		kind: "myoffice",
		repoPath: process.env.COACH_MYOFFICE_PATH ?? "C:/GitRepos/MyOffice",
		origin: stripSlash(
			process.env.COACH_MYOFFICE_ORIGIN ?? process.env.COACH_SHELL_ORIGIN ?? "https://localhost:5050",
		),
	},
	mybusiness: {
		kind: "mybusiness",
		repoPath: process.env.COACH_MYBUSINESS_PATH ?? "C:/GitRepos/MyBusiness",
		origin: stripSlash(
			process.env.COACH_MYBUSINESS_ORIGIN ?? "https://localhost:5000",
		),
	},
};

const DEFAULT_GITREPOS_ROOT = process.env.COACH_GITREPOS_ROOT ?? "C:/GitRepos";

const CATALOG_FILE_REL = "Domain/Services/WidgetDataProvider.cs";
const OVERRIDES_FILE = "./.frontend-coach/widgets.overrides.json";
const ENV_FILE = "./.frontend-coach/env.local.json";

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export type Scope =
	// MyOffice scopes
	| "user-aggregated"   // /user/:userId/:widgetuid  → SingleAggregatedContainer
	| "user-overview"     // /user/:userId/overview    → OverviewContainer (tile)
	| "company-single"    // /client/.../company/.../:widgetuid → Single
	| "company-special"   // /client/.../company/.../(companyinfo|flex|companyexpense)/:widgetuid
	| "modal"             // no own URL, opened via pubsub
	// MyBusiness scopes
	| "mb-grid"           // dashboard grid widget (GridWidget)
	| "mb-single"         // /app/client/:userId/company/:companyId/single/:uid
	| "mb-pane"           // dashboard side pane (PaneWidget)
	| "mb-modal"          // modal portal, no own URL
	| "mb-component";     // embedded component (e.g. UserMenu), no own URL

export type ViewState = "single" | "grid" | "modal" | "pane" | "component";

export interface WidgetEntry {
	uid: string;
	serviceName: string;       // matches one of C:/GitRepos/<name>
	app: AppKind;
	scope: Scope;
	viewState: ViewState;
	rootId: string;
	titleKey?: string;
	sourceCollection: string;  // _rootWidgets, ListWidgetData, …
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
	origin: string;               // shell origin used to build absolute url
	source: "csharp" | "json";    // which tier produced the catalog entry
}

// ──────────────────────────────────────────────────────────────────────────
// 1. Parse WidgetDataProvider.cs (per-app shapes)
// ──────────────────────────────────────────────────────────────────────────

// MyOffice: collection literal name → scope
const MO_COLLECTION_TO_SCOPE: Record<string, Scope> = {
	_rootWidgets:     "user-aggregated",
	_overviewWidgets: "user-overview",
	_defaultWidgets:  "company-single",
	_optionalWidgets: "company-single",
	_listWidgets:     "company-special",
	_modalWidgets:    "modal",
};

// MyBusiness: collection name → scope + viewState
const MB_COLLECTION_TO_SCOPE: Record<string, { scope: Scope; viewState: ViewState; kind: "dict" | "list" }> = {
	ListWidgetData:   { scope: "mb-grid",      viewState: "grid",      kind: "dict" },
	SingleWidgetData: { scope: "mb-single",    viewState: "single",    kind: "dict" },
	PaneWidgets:      { scope: "mb-pane",      viewState: "pane",      kind: "list" },
	ModalWidgets:     { scope: "mb-modal",     viewState: "modal",     kind: "list" },
	ComponentWidgets: { scope: "mb-component", viewState: "component", kind: "list" },
};

const catalogCache = new Map<string, { mtimeMs: number; entries: WidgetEntry[] }>();

function readCatalogFile(app: AppKind, repoPath: string): { file: string; src: string } {
	const file = join(repoPath, CATALOG_FILE_REL);
	if (!existsSync(file)) {
		const envHint = app === "mybusiness" ? "COACH_MYBUSINESS_PATH" : "COACH_MYOFFICE_PATH";
		throw new Error(
			`Widget catalog source not found at ${file}. ` +
			`Set ${envHint} or provide ${OVERRIDES_FILE}.`,
		);
	}
	return { file, src: readFileSync(file, "utf8") };
}

function withCache(file: string, compute: () => WidgetEntry[]): WidgetEntry[] {
	let stat: ReturnType<typeof statSync> | null = null;
	try { stat = statSync(file); } catch { /* ignore */ }
	const cached = catalogCache.get(file);
	if (cached && stat && cached.mtimeMs === stat.mtimeMs) return cached.entries;
	const entries = compute();
	if (stat) catalogCache.set(file, { mtimeMs: stat.mtimeMs, entries });
	return entries;
}

/** Parse MyOffice's `_rootWidgets = [ new Widget { Uid = "…" } ]` shape. */
export function parseMyOfficeCatalog(repoPath = APPS.myoffice.repoPath): WidgetEntry[] {
	const { file, src } = readCatalogFile("myoffice", repoPath);
	return withCache(file, () => {
		const out: WidgetEntry[] = [];
		for (const [collectionName, scope] of Object.entries(MO_COLLECTION_TO_SCOPE)) {
			const collRe = new RegExp(`${collectionName}\\s*=\\s*\\[(?<body>[\\s\\S]*?)\\];`, "m");
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
				out.push({
					uid,
					serviceName,
					app: "myoffice",
					scope,
					viewState: (str("ViewState") as ViewState) ?? "single",
					rootId: str("RootId") ?? "",
					titleKey: str("TitleKey"),
					sourceCollection: collectionName,
					hasServiceConfigurationModal: bool("HasServiceConfigurationModal"),
				});
			}
		}
		return out;
	});
}

/** Parse MyBusiness's `Dictionary/List<Widget>` shape with `new Widget(uid: …)`. */
export function parseMyBusinessCatalog(repoPath = APPS.mybusiness.repoPath): WidgetEntry[] {
	const { file, src } = readCatalogFile("mybusiness", repoPath);
	return withCache(file, () => {
		const out: WidgetEntry[] = [];
		for (const [collectionName, meta] of Object.entries(MB_COLLECTION_TO_SCOPE)) {
			// Dictionary:  Name = new() { … };     List:  Name = [ … ];
			const collRe = meta.kind === "dict"
				? new RegExp(`${collectionName}\\s*=\\s*new\\(\\)\\s*\\{([\\s\\S]*?)\\};`, "m")
				: new RegExp(`${collectionName}\\s*=\\s*\\[([\\s\\S]*?)\\];`, "m");
			const cm = collRe.exec(src);
			if (!cm) continue;
			const body = cm[1];
			// Constructor args are named & contain no nested parens, so a lazy
			// match up to the first ')' captures exactly one widget's args.
			const widgetRe = /new\s+Widget\s*\(([\s\S]*?)\)/g;
			let wm: RegExpExecArray | null;
			while ((wm = widgetRe.exec(body))) {
				const args = wm[1];
				const arg = (k: string) => {
					const m = new RegExp(`\\b${k}\\s*:\\s*"([^"]+)"`).exec(args);
					return m ? m[1] : undefined;
				};
				const uid = arg("uid");
				const serviceName = arg("serviceName");
				if (!uid || !serviceName) continue;
				out.push({
					uid,
					serviceName,
					app: "mybusiness",
					scope: meta.scope,
					viewState: meta.viewState,
					rootId: arg("rootId") ?? "",
					titleKey: arg("titleKey"),
					sourceCollection: collectionName,
				});
			}
		}
		return out;
	});
}

/** Back-compat alias: the original export name parsed MyOffice. */
export const parseCsharpCatalog = parseMyOfficeCatalog;

export function parseCatalog(app: AppKind, repoPath?: string): WidgetEntry[] {
	return app === "mybusiness"
		? parseMyBusinessCatalog(repoPath ?? APPS.mybusiness.repoPath)
		: parseMyOfficeCatalog(repoPath ?? APPS.myoffice.repoPath);
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
// 3. Vars + app detection: live URL → env file → process.env
// ──────────────────────────────────────────────────────────────────────────

const RE_MB_URL = /\/app\/client\/([^/?#]+)\/company\/([^/?#]+)/i;
const RE_USER_URL = /\/user\/([^/?#]+)/i;
const RE_COMPANY_URL = /\/client\/([^/?#]+)\/company\/([^/?#]+)/i;

function parseVarsFromUrl(url: string | undefined | null): CoachVars {
	if (!url) return {};
	const v: CoachVars = {};
	// MyBusiness: /app/client/{userId}/company/{companyId} — the "client"
	// segment holds the userId in this shell.
	const mb = RE_MB_URL.exec(url);
	if (mb) { v.userId = mb[1]; v.companyId = mb[2]; return v; }
	const u = RE_USER_URL.exec(url);
	if (u) v.userId = u[1];
	const c = RE_COMPANY_URL.exec(url);
	if (c) { v.clientId = c[1]; v.companyId = c[2]; }
	return v;
}

async function readLiveTabUrl(): Promise<string | null> {
	try {
		const browser = await ensureBrowser();
		const ctx = browser.contexts()[0];
		if (!ctx) return null;
		const page = ctx.pages()[0];
		if (!page) return null;
		return page.url();
	} catch {
		return null;
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
 * `clientId` defaults to `userId` if not given (matches the self-service
 * convention where the logged-in user IS the client for their own data).
 */
export async function coachEnv(): Promise<CoachVars> {
	const live = parseVarsFromUrl(await readLiveTabUrl());
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

/**
 * Decide which shell to target. Priority:
 *   explicit `app` → `shellOrigin` match → live Edge tab origin/path →
 *   COACH_APP env → "myoffice".
 */
export async function detectApp(opts: { app?: AppKind; shellOrigin?: string } = {}): Promise<AppKind> {
	if (opts.app) return opts.app;
	if (opts.shellOrigin) {
		const o = stripSlash(opts.shellOrigin);
		for (const a of Object.values(APPS)) if (o.startsWith(a.origin)) return a.kind;
	}
	const url = await readLiveTabUrl();
	if (url) {
		for (const a of Object.values(APPS)) if (url.startsWith(a.origin)) return a.kind;
		if (RE_MB_URL.test(url)) return "mybusiness";
		if (RE_USER_URL.test(url) || RE_COMPANY_URL.test(url)) return "myoffice";
	}
	const env = (process.env.COACH_APP ?? "").trim().toLowerCase();
	if (env === "mybusiness") return "mybusiness";
	if (env === "myoffice") return "myoffice";
	return "myoffice";
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
// 5. URL / selector synthesis (per-app)
// ──────────────────────────────────────────────────────────────────────────

function buildUrlMyOffice(entry: WidgetEntry, vars: CoachVars): string | null {
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
		case "company-special": {
			if (!vars.clientId || !vars.companyId) return null;
			const segment =
				entry.serviceName === "Flex" ? "flex" :
				entry.serviceName === "CompanyExpense" ? "companyexpense" :
				"companyinfo";
			return `/client/${vars.clientId}/company/${vars.companyId}/${segment}/${entry.uid}`;
		}
		default:
			return null;
	}
}

function buildUrlMyBusiness(entry: WidgetEntry, vars: CoachVars): string | null {
	if (!vars.userId || !vars.companyId) return null;
	const base = `/app/client/${vars.userId}/company/${vars.companyId}`;
	switch (entry.scope) {
		case "mb-single":
			// :widget is matched case-insensitively against uid; real links lowercase it.
			return `${base}/single/${entry.uid.toLowerCase()}`;
		case "mb-grid":
		case "mb-pane":
			// Grid + pane widgets render on the dashboard root, no dedicated URL.
			return base;
		case "mb-modal":
		case "mb-component":
			return null;
		default:
			return null;
	}
}

function buildUrl(app: AppKind, entry: WidgetEntry, vars: CoachVars): string | null {
	return app === "mybusiness" ? buildUrlMyBusiness(entry, vars) : buildUrlMyOffice(entry, vars);
}

function buildMountSelectorMyOffice(entry: WidgetEntry): string {
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
		default:
			return `#${entry.rootId}`;
	}
}

function buildMountSelectorMyBusiness(entry: WidgetEntry): string {
	switch (entry.scope) {
		case "mb-single":
			// Single view overrides the DOM id to a shared wrapper (customRootId).
			return "#single_widget_root";
		case "mb-pane":
			// MyPublisher pane uses a custom id; others mount on their own rootId.
			return entry.rootId === "inspiration_root_pane" ? "#pane_widget_root" : `#${entry.rootId}`;
		case "mb-grid":
		case "mb-modal":
		case "mb-component":
			return entry.rootId ? `#${entry.rootId}` : "#MyBusiness";
		default:
			return entry.rootId ? `#${entry.rootId}` : "#MyBusiness";
	}
}

function buildMountSelector(app: AppKind, entry: WidgetEntry): string {
	return app === "mybusiness" ? buildMountSelectorMyBusiness(entry) : buildMountSelectorMyOffice(entry);
}

function buildReadyExpression(mountSelector: string): string {
	// Widget containers render an empty div; the remote micro-frontend's render
	// call adds children. "children present" is the most reliable "rendered"
	// signal that doesn't need per-widget knowledge.
	return `!!document.querySelector(${JSON.stringify(mountSelector)})?.children.length`;
}

function requiredVars(scope: Scope): (keyof CoachVars)[] {
	switch (scope) {
		case "user-aggregated":
		case "user-overview":
			return ["userId"];
		case "company-single":
		case "company-special":
			return ["clientId", "companyId"];
		case "mb-single":
		case "mb-grid":
		case "mb-pane":
			return ["userId", "companyId"];
		default:
			return [];
	}
}

const NO_URL_SCOPES = new Set<Scope>(["modal", "mb-modal", "mb-component"]);

// ──────────────────────────────────────────────────────────────────────────
// 6. Resolution
// ──────────────────────────────────────────────────────────────────────────

export interface ResolveQuery {
	uid?: string;
	file?: string;
	scope?: Scope;
	serviceName?: string;
	app?: AppKind;
}

export interface ResolveOptions {
	app?: AppKind;
	repoPath?: string;
	/** @deprecated use repoPath; kept for back-compat. */
	myOfficePath?: string;
	gitReposRoot?: string;
	shellOrigin?: string;
	vars?: CoachVars;
}

export async function listWidgets(filter: ResolveQuery = {}, opts: ResolveOptions = {}): Promise<ResolvedWidget[]> {
	const app = filter.app ?? opts.app ?? await detectApp({ shellOrigin: opts.shellOrigin });
	const repoPath = opts.repoPath ?? opts.myOfficePath ?? APPS[app].repoPath;
	const gitRoot  = opts.gitReposRoot ?? DEFAULT_GITREPOS_ROOT;
	const origin   = opts.shellOrigin ? stripSlash(opts.shellOrigin) : APPS[app].origin;

	const base = parseCatalog(app, repoPath).map<WidgetEntry & { _source: "csharp" }>((e) => ({ ...e, _source: "csharp" }));
	const ov = loadOverrides();

	// Merge overrides by (uid, scope?).
	const merged = base.map((e) => {
		const o = ov.widgets?.find((x) => x.uid.toLowerCase() === e.uid.toLowerCase() && (!x.scope || x.scope === e.scope));
		return o ? { ...e, ...o } : e;
	});
	if (ov.add) {
		for (const a of ov.add) merged.push({ ...a, app, _source: "csharp" } as any);
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
		const url = ov2?.urlOverride ?? buildUrl(app, e, vars);
		const mountSelector = ov2?.mountSelectorOverride ?? buildMountSelector(app, e);
		const readyExpression = ov2?.readyExpressionOverride ?? buildReadyExpression(mountSelector);
		const { _source, ...rest } = e as any;
		return { ...(rest as WidgetEntry), repo, url, mountSelector, readyExpression, vars, origin, source: _source ?? "csharp" } as ResolvedWidget;
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

	if (query.file && results.length > 1) {
		const fileLower = query.file.toLowerCase();
		const score = (w: ResolvedWidget): number => {
			let s = 0;
			if (fileLower.includes(w.uid.toLowerCase())) s += 100;
			if (w.rootId && fileLower.includes(w.rootId.split("_")[0])) s += 30;
			// Sink URL-less widgets (modals/components) unless explicitly named.
			if (NO_URL_SCOPES.has(w.scope) && !fileLower.includes(w.uid.toLowerCase())) s -= 80;
			if (!w.url) s -= 40;
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
	const app = query.app ?? opts.app ?? await detectApp({ shellOrigin: query.shellOrigin ?? opts.shellOrigin });
	const shellOrigin = query.shellOrigin ?? opts.shellOrigin ?? APPS[app].origin;
	const candidates = await resolveWidget(query, { ...opts, app, shellOrigin });

	if (candidates.length === 0) {
		return { plan: null, candidates: [], reason: "no widget matched the query" };
	}
	const w = candidates[0];

	if (!w.url) {
		return {
			plan: null,
			candidates,
			reason: NO_URL_SCOPES.has(w.scope)
				? `widget '${w.uid}' [${w.scope}] has no direct URL — open it via its host dashboard/widget instead`
				: `widget '${w.uid}' resolved but vars are incomplete: need ${requiredVars(w.scope).join(", ")}`,
		};
	}

	const absoluteUrl = stripSlash(shellOrigin) + w.url;
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

// ──────────────────────────────────────────────────────────────────────────
// 8. Diagnostics
// ──────────────────────────────────────────────────────────────────────────

export interface CatalogStats {
	app: AppKind;
	repoPath: string;
	origin: string;
	catalogFile: string;
	catalogFileExists: boolean;
	totalWidgets: number;
	byScope: Record<string, number>;
	overridesFile: string;
	overridesPresent: boolean;
	envFile: string;
	envPresent: boolean;
	vars: CoachVars;
}

export async function catalogStats(opts: ResolveOptions = {}): Promise<CatalogStats> {
	const app = opts.app ?? await detectApp({ shellOrigin: opts.shellOrigin });
	const repoPath = opts.repoPath ?? opts.myOfficePath ?? APPS[app].repoPath;
	const origin = opts.shellOrigin ? stripSlash(opts.shellOrigin) : APPS[app].origin;
	const catalogFile = join(repoPath, CATALOG_FILE_REL);
	const vars = await coachEnv();
	let entries: WidgetEntry[] = [];
	try { entries = parseCatalog(app, repoPath); } catch { /* surfaced via exists flag */ }
	const byScope = entries.reduce((acc, e) => {
		acc[e.scope] = (acc[e.scope] ?? 0) + 1; return acc;
	}, {} as Record<string, number>);
	return {
		app,
		repoPath,
		origin,
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
