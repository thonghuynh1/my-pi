import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, utimesSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { usageScope, type ScopeDependencies } from "../lib/provider-usage/scope.ts";
import { providerReaders } from "../lib/provider-usage/readers.ts";
import type { ProviderId } from "../lib/provider-usage/model.ts";

function fixture(env: NodeJS.ProcessEnv = {}, platform: NodeJS.Platform = "linux", home = "/fixture-home") {
  const files = new Map<string, Buffer>();
  const reads: string[] = [];
  const deps: ScopeDependencies = { env, platform, home, readFile: (file) => { reads.push(file); return files.get(file); } };
  return { files, reads, deps, env };
}
const ids: ProviderId[] = ["codex", "antigravity", "copilot", "cursor", "claude-work", "claude-personal"];

test("all six scopes are deterministic opaque hashes and never contain credential or directory values", async () => {
  const f = fixture({ GH_TOKEN: "synthetic-secret-gh", CLAUDE_CODE_OAUTH_TOKEN: "synthetic-secret-claude" });
  const scopes = await Promise.all(ids.map((id) => usageScope(id, id.startsWith("claude-") ? `/profiles/${id}` : undefined, f.deps)()));
  for (const [index, scope] of scopes.entries()) {
    assert.match(scope.key, /^[a-f0-9]{64}$/);
    assert.match(scope.generation, /^[a-f0-9]{64}$/);
    assert.deepEqual(scope, await usageScope(ids[index], ids[index].startsWith("claude-") ? `/profiles/${ids[index]}` : undefined, f.deps)());
  }
  assert.equal(new Set(scopes.map((scope) => scope.key)).size, 6);
  assert(!JSON.stringify(scopes).includes("synthetic-secret"));
  assert(!JSON.stringify(scopes).includes("profiles"));
});

test("same-size, same-time credential replacement changes generation while keeping stable unknown-account lock namespace", async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), "provider-scope-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const auth = path.join(home, ".credentials.json");
  writeFileSync(auth, "synthetic-login-one", { mode: 0o600 });
  const before = statSync(auth);
  const resolve = usageScope("claude-work", home, { env: {}, home });
  const first = await resolve();
  writeFileSync(auth, "synthetic-login-two");
  utimesSync(auth, before.atime, before.mtime);
  const second = await resolve();
  assert.equal(second.key, first.key);
  assert.notEqual(second.generation, first.generation);
  rmSync(auth);
  const missing = await resolve();
  assert.equal(missing.key, first.key);
  assert.notEqual(missing.generation, second.generation);
});

test("Claude uses fixed actual profile dirs and identity only, not mutable .claude.json usage", async () => {
  const f = fixture({ CLAUDE_CONFIG_DIR: "/unrelated-current-profile", ANTHROPIC_API_KEY: "cleared-by-reader" });
  const work = usageScope("claude-work", "/fixed-work", f.deps);
  f.files.set("/fixed-work/.credentials.json", Buffer.from("synthetic-credentials"));
  f.files.set("/fixed-work/.claude.json", Buffer.from(JSON.stringify({ oauthAccount: { accountUuid: "synthetic-account", organizationUuid: "org" }, cachedUsage: 1 })));
  const first = await work();
  f.files.set("/fixed-work/.claude.json", Buffer.from(JSON.stringify({ oauthAccount: { accountUuid: "synthetic-account", organizationUuid: "org" }, cachedUsage: 999, randomSession: "mutable" })));
  assert.deepEqual(await work(), first);
  f.env.CLAUDE_CONFIG_DIR = "/another-active-profile";
  f.env.ANTHROPIC_API_KEY = "different-but-cleared";
  assert.deepEqual(await work(), first);
  f.files.set("/fixed-work/.claude.json", Buffer.from(JSON.stringify({ oauthAccount: { accountUuid: "replacement-account", organizationUuid: "org" } })));
  assert.notDeepEqual(await work(), first);
  assert(!f.reads.some((file) => file.startsWith("/unrelated-current-profile")));
  assert.notEqual((await usageScope("claude-personal", "/fixed-work", f.deps)()).key, first.key);
});

test("auth override VALUES, not presence, distinguish namespaces across every provider", async () => {
  for (const [id, variable] of [["codex", "OPENAI_API_KEY"], ["copilot", "GH_TOKEN"], ["cursor", "AGENT_CLI_CREDENTIAL_STORE"], ["antigravity", "AGY_LLM_GATEWAY_HEADERS"], ["claude-work", "CLAUDE_CODE_OAUTH_TOKEN"], ["claude-personal", "ANTHROPIC_AUTH_TOKEN"]] as const) {
    const f = fixture({ [variable]: "synthetic-value-A" });
    const resolve = usageScope(id, "/fixed-profile", f.deps);
    const first = await resolve();
    f.env[variable] = "synthetic-value-B";
    const second = await resolve();
    assert.notEqual(second.key, first.key, id);
    assert.notEqual(second.generation, first.generation, id);
  }
});

test("Codex hashes selected home auth/config and identity-file overrides", async () => {
  const f = fixture({ CODEX_HOME: "/codex-selected", CODEX_IDENTITY_FILE: "/identity-selected" });
  const resolve = usageScope("codex", undefined, f.deps);
  const first = await resolve();
  assert.deepEqual(f.reads, ["/codex-selected/auth.json", "/codex-selected/config.toml", "/identity-selected"]);
  f.files.set("/codex-selected/config.toml", Buffer.from("model_provider = 'synthetic-provider'"));
  const configChanged = await resolve();
  assert.equal(configChanged.key, first.key);
  assert.notEqual(configChanged.generation, first.generation);
  f.files.set("/identity-selected", Buffer.from("synthetic-identity"));
  assert.notEqual((await resolve()).generation, configChanged.generation);
});

test("Cursor exact platform auth paths stay separate from config-root override; active teams are distinct", async () => {
  for (const [platform, env, home, auth, config] of [
    ["win32", { APPDATA: "C:\\Roaming", CURSOR_CONFIG_DIR: "C:\\Custom" }, "C:\\Home", "C:\\Roaming\\Cursor\\auth.json", "C:\\Custom\\cli-config.json"],
    ["darwin", { XDG_CONFIG_HOME: "/xdg", CURSOR_CONFIG_DIR: "/custom" }, "/home", "/home/.cursor/auth.json", "/custom/cli-config.json"],
    ["linux", { XDG_CONFIG_HOME: "/xdg" }, "/home", "/xdg/cursor/auth.json", "/xdg/cursor/cli-config.json"],
    ["linux", {}, "/home", "/home/.config/cursor/auth.json", "/home/.cursor/cli-config.json"],
  ] as const) {
    const f = fixture({ ...env }, platform, home);
    const resolve = usageScope("cursor", undefined, f.deps);
    f.files.set(config, Buffer.from(JSON.stringify({ authInfo: { activeTeamId: 1 } })));
    const first = await resolve();
    assert.deepEqual(new Set(f.reads), new Set([auth, config]));
    f.files.set(config, Buffer.from(JSON.stringify({ authInfo: { activeTeamId: 2 } })));
    const second = await resolve();
    assert.notEqual(second.key, first.key);
    assert.notEqual(second.generation, first.generation);
  }
});

test("GitHub config root precedence and host selectors use independent namespaces", async () => {
  for (const [platform, env, home, expected] of [
    ["linux", { GH_CONFIG_DIR: "/gh", XDG_CONFIG_HOME: "/xdg" }, "/home", "/gh"],
    ["linux", { XDG_CONFIG_HOME: "/xdg" }, "/home", "/xdg/gh"],
    ["win32", { APPDATA: "C:/Roaming" }, "C:/Home", "C:/Roaming/GitHub CLI"],
    ["linux", {}, "/home", "/home/.config/gh"],
  ] as const) {
    const f = fixture({ ...env }, platform, home);
    const resolve = usageScope("copilot", undefined, f.deps);
    const first = await resolve();
    const paths = platform === "win32" ? path.win32 : path.posix;
    assert.deepEqual(f.reads, [paths.join(expected, "hosts.yml"), paths.join(expected, "config.yml")]);
    f.env.GH_HOST = "enterprise.synthetic.test";
    assert.notEqual((await resolve()).key, first.key);
  }
});

test("Antigravity fingerprints observed native fallback files and all selectors without treating AGY_ACCOUNT as subscription identity", async () => {
  const f = fixture();
  const resolve = usageScope("antigravity", undefined, f.deps);
  const first = await resolve();
  assert.deepEqual(f.reads, ["/fixture-home/.gemini/jetski-standalone-oauth-token", "/fixture-home/.gemini/antigravity-cli/settings.json", "/fixture-home/.gemini/antigravity-cli/jetski_state.pbtxt"]);
  f.files.set("/fixture-home/.gemini/jetski-standalone-oauth-token", Buffer.from("synthetic-native-oauth"));
  const replacement = await resolve();
  assert.equal(replacement.key, first.key);
  assert.notEqual(replacement.generation, first.generation);
  for (const selector of ["AGY_ADC_AUTH", "GEMINI_API_KEY", "AGY_LLM_GATEWAY_API_KEY", "AGY_LLM_GATEWAY_HEADERS", "AGY_LLM_GATEWAY_URL", "ANTIGRAVITY_GEMINI_DIR", "ANTIGRAVITY_CONFIG_REL_DIR", "ANTIGRAVITY_APP_DATA_DIR", "AGY_ACCOUNT"]) {
    const before = await resolve();
    f.env[selector] = "synthetic-selector";
    assert.notEqual((await resolve()).key, before.key, selector);
  }
});

test("production registry attaches all six scope resolvers with fixed Claude profiles", async () => {
  const f = fixture({ CLAUDE_CONFIG_DIR: "/active-not-used" });
  const profiles = {
    work: { id: "work" as const, name: "Work", shortName: "W", configDir: "/fixed/work" },
    personal: { id: "personal" as const, name: "Personal", shortName: "P", configDir: "/fixed/personal" },
  };
  const noTransport = async (): Promise<never> => { throw new Error("must not invoke transports"); };
  const registry = providerReaders(noTransport, noTransport, noTransport, profiles, f.deps);
  assert.equal(registry.length, 6);
  for (const entry of registry) {
    assert.equal(typeof entry.scope, "function");
    const dir = entry.id === "claude-work" ? profiles.work.configDir : entry.id === "claude-personal" ? profiles.personal.configDir : undefined;
    assert.deepEqual(await entry.scope!(), await usageScope(entry.id, dir, f.deps)());
  }
  assert(f.reads.includes("/fixed/work/.credentials.json"));
  assert(f.reads.includes("/fixed/personal/.credentials.json"));
  assert(!f.reads.some((file) => file.startsWith("/active-not-used")));
});


test("verified Codex access-token and federation overrides hash values, including identity-token file contents", async () => {
  for (const variable of ["CODEX_ACCESS_TOKEN", "OPENAI_FEDERATION_RULE_ID", "OPENAI_IDENTITY_TOKEN_FILE", "OPENAI_WORKLOAD_IDENTITY_CONTEXT"]) {
    const f = fixture({ [variable]: "synthetic-one" });
    const resolve = usageScope("codex", undefined, f.deps);
    const first = await resolve();
    f.env[variable] = "synthetic-two";
    const changed = await resolve();
    assert.notEqual(changed.key, first.key, variable);
    assert.notEqual(changed.generation, first.generation, variable);
  }
  const f = fixture({ OPENAI_IDENTITY_TOKEN_FILE: "/verified-identity-token" });
  const resolve = usageScope("codex", undefined, f.deps);
  const missing = await resolve();
  assert.equal(missing.identity, "opaque");
  f.files.set("/verified-identity-token", Buffer.from("synthetic-token-one"));
  const first = await resolve();
  assert.equal(first.identity, "known");
  f.files.set("/verified-identity-token", Buffer.from("synthetic-token-two"));
  const changed = await resolve();
  assert.equal(changed.key, first.key);
  assert.notEqual(changed.generation, first.generation);
});

test("confidence requires observable credentials or an account marker, not configuration or API URLs", async () => {
  const f = fixture({ OPENAI_BASE_URL: "https://synthetic.invalid", ANTHROPIC_BASE_URL: "https://synthetic.invalid", GH_HOST: "synthetic.invalid", AGY_ACCOUNT: "plugin-only" });
  f.files.set("/fixture-home/.codex/config.toml", Buffer.from("config-only"));
  f.files.set("/fixture-home/.config/gh/config.yml", Buffer.from("config-only"));
  f.files.set("/fixture-home/.cursor/cli-config.json", Buffer.from(JSON.stringify({ authInfo: { activeTeamId: 7 } })));
  f.files.set("/fixture-home/.gemini/antigravity-cli/settings.json", Buffer.from("config-only"));
  f.files.set("/fixture-home/.gemini/antigravity-cli/jetski_state.pbtxt", Buffer.from("state-only"));
  for (const id of ids) assert.equal((await usageScope(id, "/profile", f.deps)()).identity, "opaque", id);
  for (const [id, file] of [
    ["codex", "/fixture-home/.codex/auth.json"], ["copilot", "/fixture-home/.config/gh/hosts.yml"],
    ["cursor", "/fixture-home/.config/cursor/auth.json"], ["antigravity", "/fixture-home/.gemini/jetski-standalone-oauth-token"],
    ["claude-work", "/profile/.credentials.json"], ["claude-personal", "/profile/.credentials.json"],
  ] as const) {
    f.files.set(file, Buffer.from("synthetic-credential-context"));
    assert.equal((await usageScope(id, "/profile", f.deps)()).identity, "known", id);
    f.files.delete(file);
  }
  f.files.set("/profile/.claude.json", Buffer.from(JSON.stringify({ oauthAccount: { accountUuid: "synthetic-account" } })));
  assert.equal((await usageScope("claude-work", "/profile", f.deps)()).identity, "known");
  for (const [id, variable] of [["codex", "CODEX_ACCESS_TOKEN"], ["copilot", "GH_TOKEN"], ["antigravity", "GEMINI_API_KEY"], ["claude-personal", "CLAUDE_CODE_OAUTH_TOKEN"]] as const) {
    f.env[variable] = "synthetic-token";
    assert.equal((await usageScope(id, "/other-profile", f.deps)()).identity, "known", id);
  }
});

test("observed Antigravity state path does not invalidate account generation on mutable state-content updates", async () => {
  const f = fixture();
  const state = "/fixture-home/.gemini/antigravity-cli/jetski_state.pbtxt";
  f.files.set(state, Buffer.from("mutable-state-one"));
  const resolve = usageScope("antigravity", undefined, f.deps);
  const before = await resolve();
  f.files.set(state, Buffer.from("mutable-state-two"));
  assert.deepEqual(await resolve(), before);
  assert(f.reads.includes(state));
  assert(!f.reads.includes("/fixture-home/.gemini/jetski_state.pbtxt"));
});
