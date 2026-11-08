import assert from "node:assert/strict";
import { test } from "node:test";
import { AccountsModal, actionForKey, buildAccountView, pickClaudeModel, slotName, type AccountRow, type CodexRow } from "../account.ts";
import type { ClaudeProfile } from "../lib/claude-profiles.ts";

const profile = (index: number, configDir: string): ClaudeProfile =>
  ({ id: `claude-${index}`, index, name: `Claude ${index}`, configDir, provider: index === 1 ? "claude-bridge" : `claude-bridge-${index}`, useApiKey: index === 1 });
const claude = [
  { profile: profile(1, "/c1"), ready: true },
  { profile: profile(2, "/c2"), ready: true },
  { profile: profile(3, "/c3"), ready: false },
];

test("view lists Codex slots and Claude accounts, each with an add row", () => {
  const view = buildAccountView({
    slots: [{ provider: "openai-codex" }, { provider: "codex-2", label: "Personal" }],
    identities: new Map([["openai-codex", { key: "a|a@x", email: "a@x" }], ["codex-2", undefined]]),
    main: { provider: "openai-codex", model: "gpt-6" },
    sub: { provider: "codex-2", model: "gpt-6" },
    claude,
  });
  assert.deepEqual(view.rows.map((r) => r.kind), ["codex", "codex", "codex-add", "claude", "claude", "claude", "claude-add"]);
  assert.deepEqual((view.rows[0] as CodexRow).roles, ["main"]);
  assert.deepEqual((view.rows[1] as CodexRow).roles, ["sub"]);
  assert.ok(view.rows.every((r) => r.kind !== "claude" || !r.main));
  assert.deepEqual(view.duplicates, []);
});

test("the Claude account whose provider runs main is tagged main", () => {
  const view = buildAccountView({
    slots: [{ provider: "openai-codex" }],
    identities: new Map(),
    main: { provider: "claude-bridge-2", model: "claude-sonnet-5" },
    claude,
  });
  const mains = view.rows.filter((r): r is Extract<AccountRow, { kind: "claude" }> => r.kind === "claude" && r.main);
  assert.deepEqual(mains.map((r) => r.profile.id), ["claude-2"]);
});

test("slot names prefer label, then email, then provider", () => {
  assert.equal(slotName({ provider: "codex-2", label: "Personal" }, { key: "k", email: "e@x" }), "Personal");
  assert.equal(slotName({ provider: "codex-2" }, { key: "k", email: "e@x" }), "e@x");
  assert.equal(slotName({ provider: "codex-2" }, undefined), "codex-2");
  assert.equal(slotName({ provider: "openai-codex" }, undefined), "Codex");
});

test("keys map to actions per row kind", () => {
  const loggedIn: CodexRow = { kind: "codex", slot: { provider: "codex-2" }, identity: { key: "k" }, roles: [] };
  const loggedOut: CodexRow = { ...loggedIn, identity: undefined };
  const builtin: CodexRow = { ...loggedIn, slot: { provider: "openai-codex" } };
  assert.deepEqual(actionForKey(loggedIn, "enter"), { kind: "main", provider: "codex-2" });
  assert.deepEqual(actionForKey(loggedIn, "s"), { kind: "sub", provider: "codex-2" });
  assert.deepEqual(actionForKey(loggedOut, "m"), { kind: "login", provider: "codex-2" });
  assert.deepEqual(actionForKey(loggedIn, "x"), { kind: "remove", provider: "codex-2" });
  assert.equal(actionForKey(builtin, "x"), undefined);
  assert.deepEqual(actionForKey(builtin, "r"), { kind: "rename", provider: "openai-codex" });
  assert.deepEqual(actionForKey({ kind: "codex-add" }, "enter"), { kind: "add" });
  assert.deepEqual(actionForKey(loggedIn, "a"), { kind: "add" });

  const ready: AccountRow = { kind: "claude", profile: profile(2, "/c2"), ready: true, main: false };
  const notReady: AccountRow = { ...ready, ready: false };
  assert.deepEqual(actionForKey(ready, "enter"), { kind: "claude-main", id: "claude-2" });
  assert.deepEqual(actionForKey(ready, "m"), { kind: "claude-main", id: "claude-2" });
  assert.deepEqual(actionForKey(notReady, "enter"), { kind: "claude-login", id: "claude-2" });
  assert.deepEqual(actionForKey(ready, "l"), { kind: "claude-login", id: "claude-2" });
  assert.deepEqual(actionForKey(ready, "x"), { kind: "claude-remove", id: "claude-2" });
  assert.equal(actionForKey({ ...ready, profile: profile(1, "/c1") }, "x"), undefined);
  assert.equal(actionForKey(ready, "s"), undefined);
  assert.equal(actionForKey(ready, "r"), undefined);
  assert.deepEqual(actionForKey(ready, "a"), { kind: "claude-add" });
  assert.deepEqual(actionForKey({ kind: "claude-add" }, "enter"), { kind: "claude-add" });
});

test("Claude main keeps the current bridge model, then the last one, then a Sonnet", () => {
  const models = [{ id: "claude-opus-5" }, { id: "claude-sonnet-5" }, { id: "claude-haiku-5" }];
  assert.equal(pickClaudeModel(models, "claude-haiku-5", "claude-opus-5"), "claude-haiku-5");
  assert.equal(pickClaudeModel(models, undefined, "claude-opus-5"), "claude-opus-5");
  assert.equal(pickClaudeModel(models, "gone", "also-gone"), "claude-sonnet-5");
  assert.equal(pickClaudeModel([{ id: "x" }], undefined, undefined), "x");
  assert.equal(pickClaudeModel([], undefined, undefined), undefined);
});

test("modal renders roles, rows, duplicate warning, and returns actions", () => {
  const theme = { fg: (_c: string, s: string) => s, bold: (s: string) => s } as never;
  const view = buildAccountView({
    slots: [{ provider: "openai-codex" }, { provider: "codex-2", label: "Personal" }],
    identities: new Map([["openai-codex", { key: "same", email: "a@x", plan: "team" }], ["codex-2", { key: "same", email: "a@x" }]]),
    main: { provider: "openai-codex", model: "gpt-6" },
    mainDefault: { provider: "codex-2", model: "gpt-6" },
    sub: { provider: "codex-2", model: "gpt-6", thinking: "high" },
    claude,
  });
  let action: unknown;
  const modal = new AccountsModal(theme, view, (a) => { action = a; }, () => {}, () => {}, 0);
  const text = modal.render(120).join("\n");
  for (const needle of ["Accounts", "Main session", "openai-codex/gpt-6", "new sessions: codex-2/gpt-6", "codex-2/gpt-6:high",
    "[main]", "[subagents]", "Personal", "+ Add Codex account", "CLAUDE ACCOUNTS", "Claude 1", "claude-bridge-2", "Claude 3", "not logged in · press l",
    "+ Add Claude account", "same ChatGPT login"]) {
    assert.ok(text.includes(needle), `missing ${needle}`);
  }
  assert.ok(!text.includes("Claude Work") && !text.includes("Personal)"));
  modal.handleInput("\x1b[B");
  modal.handleInput("s");
  assert.deepEqual(action, { kind: "sub", provider: "codex-2" });
});
