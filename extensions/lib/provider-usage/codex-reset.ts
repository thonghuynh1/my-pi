import { randomUUID } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { accountId, codexRequest, responseJson } from "./codex-http.ts";

export type CodexProviderId = "codex" | `codex-${number}`;
export type CodexResetTarget = { readonly id: CodexProviderId; readonly name: string };
export type ResetCredit = { id: string; title: string; resetType: string; status: string; grantedAt?: string; expiresAt?: string; description?: string };
export type AccountBinding = { target: CodexResetTarget; accountId: string };
export type ResetAttempt = { account: AccountBinding; credit: ResetCredit; requestId: string };
export type ResetOutcome = { kind: "accepted"; outcome?: string } | { kind: "uncertain"; message: string } | { kind: "not-sent"; message: string };
export type ResetFlowState =
  | { kind: "hidden" }
  | { kind: "accounts"; targets: readonly [CodexResetTarget, ...CodexResetTarget[]]; index: number }
  | { kind: "loading"; target: CodexResetTarget }
  | { kind: "message"; text: string }
  | { kind: "credits"; account: AccountBinding; credits: readonly [ResetCredit, ...ResetCredit[]]; index: number }
  | { kind: "confirm"; account: AccountBinding; credit: ResetCredit }
  | { kind: "submitting"; attempt: ResetAttempt }
  | { kind: "done"; attempt: ResetAttempt; result: ResetOutcome };
export interface CodexResetFlow {
  state(): ResetFlowState;
  visible(): boolean;
  subscribe(cb: () => void): () => void;
  open(): void;
  handleInput(data: string): "handled" | "pass";
  renderLines(width: number): string[];
  hint(): string;
}
const BASE = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const clean = (v: string) => stripVTControlCharacters(v).replace(/[\x00-\x1f\x7f-\x9f]/g, "");
function text(v: unknown, required = false): string | undefined {
  if (v === undefined || v === null) { if (required) throw new Error("Codex reset inventory unavailable"); return undefined; }
  if (typeof v !== "string" || v.length > 1024) throw new Error("Codex reset inventory unavailable");
  const result = clean(v).trim();
  if (required && !result) throw new Error("Codex reset inventory unavailable");
  return result;
}
function credits(raw: unknown): ResetCredit[] {
  const list = object(raw).credits;
  if (!Array.isArray(list) || list.length > 100) throw new Error("Codex reset inventory unavailable");
  const ids = new Set<string>();
  return list.map((item) => {
    const v = object(item);
    if (typeof v.id !== "string" || !v.id.trim() || v.id.length > 1024 || clean(v.id) !== v.id || ids.has(v.id)) throw new Error("Codex reset inventory unavailable");
    ids.add(v.id);
    return { id: v.id, title: text(v.title, true)!, resetType: text(v.reset_type, true)!, status: text(v.status, true)!,
      grantedAt: text(v.granted_at), expiresAt: text(v.expires_at), description: text(v.description) };
  });
}
export function createCodexResetAccess(apiKey: () => Promise<string | undefined>, fetcher: typeof globalThis.fetch = globalThis.fetch) {
  return {
    async inventory(signal: AbortSignal): Promise<{ accountId: string; credits: readonly ResetCredit[] }> {
      try {
        const token = await apiKey();
        if (!token) throw new Error();
        const id = accountId(token);
        const request = codexRequest(token, id, signal);
        const response = await fetcher(BASE, request);
        return { accountId: id, credits: credits(await responseJson(response, request.signal!)) };
      } catch { throw new Error("Codex reset inventory unavailable; check Pi OAuth login"); }
    },
    async consume(attempt: ResetAttempt, signal: AbortSignal): Promise<ResetOutcome> {
      let token: string, id: string;
      try {
        const resolved = await apiKey();
        if (!resolved) throw new Error();
        token = resolved;
        id = accountId(token);
        if (id !== attempt.account.accountId) throw new Error();
      } catch { return { kind: "not-sent", message: "Reset not sent: Pi OAuth account unavailable or changed." }; }
      try {
        const request = codexRequest(token, id, signal);
        const response = await fetcher(`${BASE}/consume`, { ...request, method: "POST",
          headers: { ...request.headers, "Content-Type": "application/json" },
          body: JSON.stringify({ credit_id: attempt.credit.id, redeem_request_id: attempt.requestId }) });
        if (response.status !== 200 || response.redirected) throw new Error();
        try {
          const outcome = object(await responseJson(response, request.signal!)).outcome;
          return typeof outcome === "string" && outcome.length <= 1024 ? { kind: "accepted", outcome: clean(outcome) } : { kind: "accepted" };
        } catch { return { kind: "accepted" }; }
      } catch { return { kind: "uncertain", message: "The credit may or may not have been spent. Check codex /usage; press t to retry with the same request id." }; }
    },
  };
}
export function createCodexResetFlow(targets: readonly CodexResetTarget[], deps: {
  inventory: (target: CodexResetTarget, signal: AbortSignal) => Promise<{ account: AccountBinding; credits: readonly ResetCredit[] }>;
  consume: (attempt: ResetAttempt, signal: AbortSignal) => Promise<ResetOutcome>;
  afterReset: (target: CodexResetTarget) => Promise<void>;
  uuid?: () => string;
}): CodexResetFlow {
  let current: ResetFlowState = { kind: "hidden" }, loading: AbortController | undefined, refreshError = false;
  let previousCredits: Extract<ResetFlowState, { kind: "credits" }> | undefined;
  const listeners = new Set<() => void>();
  const set = (next: ResetFlowState) => { current = next; for (const listener of listeners) listener(); };
  const hide = () => { loading?.abort(); loading = undefined; set({ kind: "hidden" }); };
  const submit = (attempt: ResetAttempt) => {
    refreshError = false;
    set({ kind: "submitting", attempt });
    void (async () => {
      let result: ResetOutcome;
      try { result = await deps.consume(attempt, new AbortController().signal); }
      catch { result = { kind: "uncertain", message: "The credit may or may not have been spent. Check codex /usage; press t to retry with the same request id." }; }
      if (result.kind !== "not-sent") try { await deps.afterReset(attempt.account.target); } catch { refreshError = true; }
      set({ kind: "done", attempt, result });
    })();
  };
  return {
    state: () => current,
    visible: () => current.kind !== "hidden",
    subscribe(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    open() {
      if (current.kind !== "hidden") return;
      if (!targets.length) set({ kind: "message", text: "No Codex OAuth slots available." });
      else set({ kind: "accounts", targets: targets as [CodexResetTarget, ...CodexResetTarget[]], index: 0 });
    },
    handleInput(data) {
      const state = current;
      if (state.kind === "hidden") return "pass";
      if (state.kind === "submitting") return "handled";
      if (state.kind === "confirm") {
        if (matchesKey(data, "y")) submit({ account: state.account, credit: state.credit, requestId: (deps.uuid ?? randomUUID)() });
        else if (previousCredits) set(previousCredits);
        else hide();
        return "handled";
      }
      if (state.kind === "done") {
        if (matchesKey(data, "t") && state.result.kind === "uncertain") submit(state.attempt);
        else if (matchesKey(data, "return") || matchesKey(data, "escape")) hide();
        return "handled";
      }
      if (matchesKey(data, "escape")) { hide(); return "handled"; }
      if (state.kind === "accounts" || state.kind === "credits") {
        const items = state.kind === "accounts" ? state.targets : state.credits;
        if (matchesKey(data, "up")) set({ ...state, index: Math.max(0, state.index - 1) });
        else if (matchesKey(data, "down")) set({ ...state, index: Math.min(items.length - 1, state.index + 1) });
        else if (matchesKey(data, "return")) {
          if (state.kind === "credits") { previousCredits = state; set({ kind: "confirm", account: state.account, credit: state.credits[state.index] }); }
          else {
            const target = state.targets[state.index], controller = new AbortController();
            loading = controller;
            set({ kind: "loading", target });
            void deps.inventory(target, controller.signal).then(({ account, credits }) => {
              if (loading !== controller || controller.signal.aborted) return;
              loading = undefined;
              if (!credits.length) set({ kind: "message", text: "No reset credits available." });
              else set({ kind: "credits", account, credits: credits as [ResetCredit, ...ResetCredit[]], index: 0 });
            }, () => {
              if (loading !== controller || controller.signal.aborted) return;
              loading = undefined;
              set({ kind: "message", text: "Codex reset inventory unavailable; check Pi OAuth login." });
            });
          }
        }
      } else if (state.kind === "message" && matchesKey(data, "return")) hide();
      return "handled";
    },
    renderLines(width) {
      const state = current;
      let lines: string[] = [];
      if (state.kind === "accounts") lines = ["Choose a Codex account", ...state.targets.map((target, i) => `${i === state.index ? ">" : " "} ${target.name}`)];
      else if (state.kind === "loading") lines = [`Loading ${state.target.name} reset credits…`];
      else if (state.kind === "message") lines = [state.text];
      else if (state.kind === "credits") lines = [`Choose a reset for ${state.account.target.name}`, ...state.credits.map((credit, i) => `${i === state.index ? ">" : " "} ${credit.title} · ${credit.status}`)];
      else if (state.kind === "confirm") lines = [`${state.account.target.name} · account ****${clean(state.account.accountId).slice(-4)}`,
        `${state.credit.title} · ${state.credit.resetType}`, "This irreversibly spends exactly one reset credit. Confirm with y."];
      else if (state.kind === "submitting") lines = ["Submitting reset…"];
      else if (state.kind === "done") lines = [state.result.kind === "accepted" ? `Reset accepted${state.result.outcome ? `: ${state.result.outcome}` : ""}` : state.result.message,
        ...(refreshError ? ["Usage refresh failed; refresh manually."] : [])];
      return lines.map((line) => truncateToWidth(line, width));
    },
    hint() {
      return current.kind === "accounts" || current.kind === "credits" ? "↑/↓ select · Enter choose · Esc cancel"
        : current.kind === "confirm" ? "y confirm · any other key cancel"
        : current.kind === "done" ? `${current.result.kind === "uncertain" ? "t retry · " : ""}Enter/Esc close` : "Esc close";
    },
  };
}
