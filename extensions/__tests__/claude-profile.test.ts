import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  addClaudeProfile,
  applyBridgeProfile,
  claudeProfiles,
  expandHome,
  isClaudeBridgeProvider,
  isProfileReady,
  legacyClaudeConfig,
  loadClaudeConfig,
  removeClaudeProfile,
  saveClaudeConfig,
  suggestedProfileDir,
  switchClaudeProfile,
  withClaudeProfileEnv,
} from "../lib/claude-profiles.ts";

const tmp = () => mkdtempSync(path.join(tmpdir(), "claude-prof-"));
const home = "/home/u";

function loggedIn(dir: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, ".credentials.json"), "{}", "utf8");
  return dir;
}

test("without a saved list, Claude 1 is ~/.claude with the API key and Claude 2 is ~/.claude-personal", () => {
  const config = loadClaudeConfig(path.join(tmp(), "missing.json"), home);
  assert.deepEqual(config, legacyClaudeConfig(home));
  const profiles = claudeProfiles({}, config);
  assert.deepEqual(profiles.map((p) => [p.id, p.name, p.configDir, p.provider, p.useApiKey]), [
    ["claude-1", "Claude 1", path.join(home, ".claude"), "claude-bridge", true],
    ["claude-2", "Claude 2", path.join(home, ".claude-personal"), "claude-bridge-2", false],
  ]);
});

test("the old {workDir, personalDir} file migrates to numbered profiles", () => {
  const file = path.join(tmp(), "claude-profiles.json");
  writeFileSync(file, JSON.stringify({ workDir: "/w", personalDir: "/p" }), "utf8");
  assert.deepEqual(loadClaudeConfig(file, home), {
    profiles: [{ dir: "/w", provider: "claude-bridge", apiKey: true }, { dir: "/p", provider: "claude-bridge-2" }],
  });
});

test("saved profiles round-trip; junk, duplicates and bad provider ids are dropped or reassigned", () => {
  const file = path.join(tmp(), "claude-profiles.json");
  const saved = { profiles: [{ dir: "/a", provider: "claude-bridge", apiKey: true }, { dir: "/c", provider: "claude-bridge-3" }], lastModel: "claude-sonnet-5" };
  saveClaudeConfig(saved, file);
  assert.deepEqual(loadClaudeConfig(file, home), saved);
  writeFileSync(file, JSON.stringify({ profiles: [{ dir: "/a" }, { dir: "/a" }, { dir: " " }, 7, { dir: "/b", apiKey: "yes", provider: "openai" }, { dir: "/c", provider: "claude-bridge-2" }] }), "utf8");
  assert.deepEqual(loadClaudeConfig(file, home), {
    profiles: [{ dir: "/a", provider: "claude-bridge" }, { dir: "/b", provider: "claude-bridge-3" }, { dir: "/c", provider: "claude-bridge-2" }],
  });
  writeFileSync(file, "{nope", "utf8");
  assert.deepEqual(loadClaudeConfig(file, home), legacyClaudeConfig(home));
});

test("env vars override numbered dirs; legacy WORK/PERSONAL names map to 1 and 2", () => {
  const config = { profiles: [{ dir: "/a" }, { dir: "/b" }, { dir: "/c" }] };
  const dirs = (env: NodeJS.ProcessEnv) => claudeProfiles(env, config).map((p) => p.configDir);
  assert.deepEqual(dirs({ CLAUDE_PROFILE_WORK_DIR: "/w", CLAUDE_PROFILE_PERSONAL_DIR: "/p" }), ["/w", "/p", "/c"]);
  assert.deepEqual(dirs({ CLAUDE_PROFILE_1_DIR: "/one", CLAUDE_PROFILE_WORK_DIR: "/w", CLAUDE_PROFILE_3_DIR: "/three" }), ["/one", "/b", "/three"]);
});

test("claude-bridge provider ids are recognized", () => {
  assert.ok(isClaudeBridgeProvider("claude-bridge") && isClaudeBridgeProvider("claude-bridge-12"));
  assert.ok(!isClaudeBridgeProvider("claude-code-cli") && !isClaudeBridgeProvider(undefined) && !isClaudeBridgeProvider("claude-bridge-x"));
});

test("switching hides the API key from non-key profiles and restores it for key profiles", () => {
  const [one, two, three] = claudeProfiles({}, { profiles: [{ dir: "/a", apiKey: true }, { dir: "/b" }, { dir: "/c" }] });
  const env: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: "work-key" };
  switchClaudeProfile(two, env);
  assert.equal(env.CLAUDE_CONFIG_DIR, "/b");
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  switchClaudeProfile(three, env);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  switchClaudeProfile(one, env);
  assert.equal(env.CLAUDE_CONFIG_DIR, "/a");
  assert.equal(env.ANTHROPIC_API_KEY, "work-key");
});

test("withClaudeProfileEnv scopes dir and key to one call; the bridge profile pins process env", () => {
  const [one, two] = claudeProfiles({}, { profiles: [{ dir: "/a", provider: "claude-bridge", apiKey: true }, { dir: "/b", provider: "claude-bridge-2" }] });
  const env: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: "work-key" };
  const seen = withClaudeProfileEnv(two, () => [env.CLAUDE_CONFIG_DIR, env.ANTHROPIC_API_KEY], env);
  assert.deepEqual(seen, ["/b", undefined]);
  assert.equal(env.CLAUDE_CONFIG_DIR, undefined);
  assert.equal(env.ANTHROPIC_API_KEY, "work-key");
  assert.throws(() => withClaudeProfileEnv(two, () => { throw new Error("boom"); }, env), /boom/);
  assert.equal(env.ANTHROPIC_API_KEY, "work-key");

  assert.equal(applyBridgeProfile(env, { profiles: [{ dir: "/b", provider: "claude-bridge-2" }, { dir: "/a", provider: "claude-bridge", apiKey: true }] })?.configDir, "/a");
  assert.equal(env.CLAUDE_CONFIG_DIR, "/a");
  assert.equal(one.provider, "claude-bridge");
});

test("adding suggests the next free ~/.claude-N with its own provider; removing renumbers but keeps provider ids", () => {
  const config = legacyClaudeConfig(home);
  const dir = suggestedProfileDir(config, home);
  assert.equal(dir, path.join(home, ".claude-3"));
  const added = addClaudeProfile(config, dir);
  assert.deepEqual([claudeProfiles({}, added)[2]?.name, claudeProfiles({}, added)[2]?.provider], ["Claude 3", "claude-bridge-3"]);
  assert.throws(() => addClaudeProfile(added, dir), /already/);
  const removed = removeClaudeProfile(added, path.join(home, ".claude-personal"));
  assert.deepEqual(claudeProfiles({}, removed).map((p) => [p.name, p.configDir, p.provider]), [
    ["Claude 1", path.join(home, ".claude"), "claude-bridge"],
    ["Claude 2", dir, "claude-bridge-3"],
  ]);
  assert.equal(addClaudeProfile(removed, "/new").profiles[2]?.provider, "claude-bridge-4");
});

test("expandHome handles ~ prefixes and plain paths", () => {
  assert.equal(expandHome("~", home), path.join(home));
  assert.equal(expandHome("~/cfg", home), path.join(home, "cfg"));
  assert.equal(expandHome("  /abs/dir  ", home), "/abs/dir");
});

test("readiness reflects a login, never secret contents", () => {
  const base = tmp();
  assert.equal(isProfileReady(path.join(base, "missing")), false);
  assert.equal(isProfileReady(loggedIn(path.join(base, "creds"))), true);
  const email = path.join(base, "email");
  mkdirSync(email, { recursive: true });
  writeFileSync(path.join(email, ".claude.json"), JSON.stringify({ emailAddress: "me@example.com" }), "utf8");
  assert.equal(isProfileReady(email), true);
  const empty = path.join(base, "empty");
  mkdirSync(empty, { recursive: true });
  writeFileSync(path.join(empty, ".claude.json"), "{}", "utf8");
  assert.equal(isProfileReady(empty), false);
  const garbage = path.join(base, "garbage");
  mkdirSync(garbage, { recursive: true });
  writeFileSync(path.join(garbage, ".claude.json"), "{oops", "utf8");
  assert.equal(isProfileReady(garbage), false);
});
