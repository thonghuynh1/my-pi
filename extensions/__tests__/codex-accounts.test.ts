import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  defaultCodexPaths,
  duplicateSlots,
  formatModelRef,
  identityFromAccessToken,
  loadCodexSlots,
  nextSlotId,
  parseModelRef,
  readMainDefault,
  readSubagentDefault,
  removeSlotLogin,
  retargetRole,
  saveCodexSlots,
  slotIdentity,
  storedCodexModels,
  withAuthLock,
  writeMainDefault,
  writeSubagentDefault,
} from "../lib/codex-accounts.ts";

function jwt(payload: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none" })}.${part(payload)}.sig`;
}

const access = (email: string, accountId: string) => jwt({
  "https://api.openai.com/profile": { email },
  "https://api.openai.com/auth": { chatgpt_account_id: accountId, chatgpt_plan_type: "plus" },
});

const tmp = () => defaultCodexPaths(mkdtempSync(path.join(tmpdir(), "codex-slots-")));
const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));

test("slots always start with the built-in provider and ignore junk", () => {
  const paths = tmp();
  assert.deepEqual(loadCodexSlots(paths.configFile), [{ provider: "openai-codex" }]);
  writeFileSync(paths.configFile, JSON.stringify({ slots: [
    { provider: "openai-codex", label: "Work" }, { provider: "codex-2", label: " Personal " },
    { provider: "codex-2" }, { provider: "anthropic" }, { provider: "codex-x" }, 7,
  ] }));
  assert.deepEqual(loadCodexSlots(paths.configFile), [
    { provider: "openai-codex", label: "Work" }, { provider: "codex-2", label: "Personal" },
  ]);
  saveCodexSlots(paths.configFile, [{ provider: "openai-codex" }, { provider: "codex-3" }]);
  assert.deepEqual(json(paths.configFile), { slots: [{ provider: "openai-codex" }, { provider: "codex-3" }] });
  assert.equal(nextSlotId(loadCodexSlots(paths.configFile)), "codex-2");
});

test("identity comes from token claims; duplicates are detected", () => {
  assert.deepEqual(identityFromAccessToken(access("a@x.com", "acct-a")), { key: "acct-a|a@x.com", email: "a@x.com", plan: "plus" });
  assert.equal(identityFromAccessToken("garbage").key, "?|?");
  const paths = tmp();
  writeFileSync(paths.authFile, JSON.stringify({
    "openai-codex": { type: "oauth", access: access("a@x.com", "acct-a"), refresh: "r", expires: 1 },
    "codex-2": { type: "oauth", access: access("a@x.com", "acct-a"), refresh: "r2", expires: 1 },
    "codex-3": { type: "api_key", key: "k" },
  }));
  assert.equal(slotIdentity(paths.authFile, "codex-3"), undefined);
  const ids = new Map(["openai-codex", "codex-2", "codex-3"].map((p) => [p, slotIdentity(paths.authFile, p)]));
  assert.deepEqual(duplicateSlots(ids), [["openai-codex", "codex-2"]]);
});

test("removing a slot login only touches that entry and refuses the built-in", async () => {
  const paths = tmp();
  writeFileSync(paths.authFile, JSON.stringify({ "openai-codex": { type: "oauth" }, "codex-2": { type: "oauth" }, other: { type: "api_key" } }));
  await removeSlotLogin(paths.authFile, "codex-2");
  assert.deepEqual(Object.keys(json(paths.authFile)), ["openai-codex", "other"]);
  await assert.rejects(removeSlotLogin(paths.authFile, "openai-codex"), /\/logout/);
  assert.equal(existsSync(`${paths.authFile}.lock`), false);
});

test("auth lock waits for a held lock to be released", async () => {
  const paths = tmp();
  const lockDir = `${paths.authFile}.lock`;
  mkdirSync(lockDir);
  setTimeout(() => rmdirSync(lockDir), 150);
  assert.equal(await withAuthLock(paths.authFile, () => 42), 42);
  assert.equal(existsSync(lockDir), false);
});

test("model refs parse provider, model, and thinking level", () => {
  assert.deepEqual(parseModelRef("codex-2/gpt-6.1-sol:high"), { provider: "codex-2", model: "gpt-6.1-sol", thinking: "high" });
  assert.deepEqual(parseModelRef("openai-codex/gpt-6"), { provider: "openai-codex", model: "gpt-6" });
  assert.equal(parseModelRef("inherit"), undefined);
  assert.equal(parseModelRef("bare-model"), undefined);
  assert.equal(formatModelRef({ provider: "p", model: "m", thinking: "low" }), "p/m:low");
});

test("retargeting keeps Codex model and level, else borrows the other role's Codex model", () => {
  const slots = [{ provider: "openai-codex" }, { provider: "codex-2" }];
  const mainRef = { provider: "openai-codex", model: "gpt-6.1-sol" };
  assert.deepEqual(retargetRole({ provider: "openai-codex", model: "gpt-6", thinking: "high" }, mainRef, "codex-2", slots, "first"),
    { provider: "codex-2", model: "gpt-6", thinking: "high" });
  assert.deepEqual(retargetRole({ provider: "meta", model: "muse", thinking: "xhigh" }, mainRef, "codex-2", slots, "first"),
    { provider: "codex-2", model: "gpt-6.1-sol", thinking: "xhigh" });
  assert.deepEqual(retargetRole(undefined, { provider: "anthropic", model: "x" }, "codex-2", slots, "first"), { provider: "codex-2", model: "first" });
  assert.equal(retargetRole(undefined, undefined, "codex-2", slots, undefined), undefined);
});

test("role writers merge into existing settings and subagent config", () => {
  const paths = tmp();
  writeFileSync(paths.settingsFile, JSON.stringify({ theme: "dark", defaultProvider: "openai-codex", defaultModel: "gpt-6" }));
  writeMainDefault(paths.settingsFile, { provider: "codex-2", model: "gpt-6.1-sol", thinking: "high" });
  assert.deepEqual(json(paths.settingsFile), { theme: "dark", defaultProvider: "codex-2", defaultModel: "gpt-6.1-sol" });
  assert.deepEqual(readMainDefault(paths.settingsFile), { provider: "codex-2", model: "gpt-6.1-sol" });

  mkdirSync(path.dirname(paths.subagentModelsFile), { recursive: true });
  writeFileSync(paths.subagentModelsFile, JSON.stringify({ agents: { a: "inherit" }, subagents: { default: "meta/muse:xhigh", other: 1 } }));
  assert.deepEqual(readSubagentDefault(paths.subagentModelsFile), { provider: "meta", model: "muse", thinking: "xhigh" });
  writeSubagentDefault(paths.subagentModelsFile, { provider: "codex-2", model: "gpt-6", thinking: "xhigh" });
  assert.deepEqual(json(paths.subagentModelsFile), { agents: { a: "inherit" }, subagents: { default: "codex-2/gpt-6:xhigh", other: 1 } });
});

test("stored Codex models come from the models-store snapshot", () => {
  const paths = tmp();
  assert.deepEqual(storedCodexModels(paths.agentDir), []);
  writeFileSync(path.join(paths.agentDir, "models-store.json"), JSON.stringify({ "openai-codex": { models: [{ id: "gpt-6" }, { nope: 1 }] } }));
  assert.deepEqual(storedCodexModels(paths.agentDir), [{ id: "gpt-6" }]);
});
