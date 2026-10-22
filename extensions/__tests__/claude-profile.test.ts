import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  applyStoredProfileDirs,
  buildPickerItems,
  claudeProfiles,
  currentClaudeProfileId,
  expandHome,
  isProfileReady,
  loadStoredProfileDirs,
  parsePickerValue,
  saveStoredProfileDirs,
  switchClaudeProfile,
} from "../lib/claude-profiles.ts";

const tmp = () => mkdtempSync(path.join(tmpdir(), "claude-prof-"));

test("profiles default to ~/.claude for work and ~/.claude-personal for personal", () => {
  const profiles = claudeProfiles({}, "/home/u", {});
  assert.equal(profiles.work.configDir, path.join("/home/u", ".claude"));
  assert.equal(profiles.personal.configDir, path.join("/home/u", ".claude-personal"));
});

test("precedence is env over stored file over default", () => {
  const stored = { workDir: "/stored/work", personalDir: "/stored/personal" };
  assert.equal(claudeProfiles({}, "/home/u", stored).work.configDir, "/stored/work");
  assert.equal(
    claudeProfiles({ CLAUDE_PROFILE_PERSONAL_DIR: "/env/personal" }, "/home/u", stored).personal.configDir,
    "/env/personal",
  );
  const explicit = claudeProfiles(
    { CLAUDE_PROFILE_WORK_DIR: "/w", CLAUDE_PROFILE_PERSONAL_DIR: "  " },
    "/home/u",
    stored,
  );
  assert.equal(explicit.work.configDir, "/w");
  assert.equal(explicit.personal.configDir, "/stored/personal");
});

test("stored dirs round-trip; invalid files read as empty", () => {
  const file = path.join(tmp(), "claude-profiles.json");
  saveStoredProfileDirs({ workDir: "/w", personalDir: "/p" }, file);
  assert.deepEqual(loadStoredProfileDirs(file), { workDir: "/w", personalDir: "/p" });
  assert.deepEqual(loadStoredProfileDirs(path.join(tmp(), "missing.json")), {});
  const broken = path.join(tmp(), "broken.json");
  writeFileSync(broken, "{nope", "utf8");
  assert.deepEqual(loadStoredProfileDirs(broken), {});
  const shapeless = path.join(tmp(), "shapeless.json");
  writeFileSync(shapeless, JSON.stringify({ workDir: 42, personalDir: "  " }), "utf8");
  assert.deepEqual(loadStoredProfileDirs(shapeless), {});
});

test("stored dirs fill only unset env vars", () => {
  const env: NodeJS.ProcessEnv = { CLAUDE_PROFILE_WORK_DIR: "/env/work" };
  applyStoredProfileDirs(env, { workDir: "/stored/work", personalDir: "/stored/personal" });
  assert.equal(env.CLAUDE_PROFILE_WORK_DIR, "/env/work");
  assert.equal(env.CLAUDE_PROFILE_PERSONAL_DIR, "/stored/personal");
});

test("explicit stored config keeps resolution hermetic", () => {
  assert.equal(currentClaudeProfileId({}, "/home/u", {}), "work");
  assert.equal(
    currentClaudeProfileId({ CLAUDE_CONFIG_DIR: path.join("/home/u", ".claude-personal") }, "/home/u", {}),
    "personal",
  );
});

test("switching to personal sets its dir and stashes the API key; work restores it", () => {
  const env: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: "work-key" };
  const personal = switchClaudeProfile("personal", env, "/home/u", {});
  assert.equal(personal.id, "personal");
  assert.equal(env.CLAUDE_CONFIG_DIR, path.join("/home/u", ".claude-personal"));
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  const work = switchClaudeProfile("work", env, "/home/u", {});
  assert.equal(work.id, "work");
  assert.equal(env.CLAUDE_CONFIG_DIR, path.join("/home/u", ".claude"));
  assert.equal(env.ANTHROPIC_API_KEY, "work-key");
});

test("expandHome handles ~ prefixes and plain paths", () => {
  assert.equal(expandHome("~", "/home/u"), path.join("/home/u"));
  assert.equal(expandHome("~/cfg", "/home/u"), path.join("/home/u", "cfg"));
  assert.equal(expandHome("  /abs/dir  ", "/home/u"), "/abs/dir");
});

test("readiness reflects a login, never secret contents", () => {
  const base = tmp();
  assert.equal(isProfileReady(path.join(base, "missing")), false);
  const creds = path.join(base, "creds");
  mkdirSync(creds, { recursive: true });
  writeFileSync(path.join(creds, ".credentials.json"), JSON.stringify({ token: "secret" }), "utf8");
  assert.equal(isProfileReady(creds), true);
  const email = path.join(base, "email");
  mkdirSync(email, { recursive: true });
  writeFileSync(
    path.join(email, ".claude.json"),
    JSON.stringify({ emailAddress: "me@example.com", oauthAccount: { accessToken: "secret" } }),
    "utf8",
  );
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

test("picker shows ready profiles and setup entries for the rest", () => {
  const profiles = claudeProfiles({}, "/home/u", {});
  const items = buildPickerItems(profiles, { work: true, personal: false }, "work");
  assert.deepEqual(items.map((item) => item.value), ["work", "setup:personal"]);
  assert.equal(items[0]?.label, "Claude Work (current)");
  assert.equal(items[0]?.description, profiles.work.configDir);
  assert.equal(items[1]?.label, "+ Set up Claude Personal...");
  assert.deepEqual(parsePickerValue("work"), { kind: "pick", id: "work" });
  assert.deepEqual(parsePickerValue("setup:personal"), { kind: "setup", id: "personal" });
  assert.equal(parsePickerValue("setup:other"), undefined);
  assert.equal(parsePickerValue(""), undefined);
});
