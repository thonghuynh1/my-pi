import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { readJson, writeAtomicJson } from "../lib/durable-jobs.ts";

const worker = fileURLToPath(new URL("../lib/background-job-worker.mjs", import.meta.url));
const host = fileURLToPath(new URL("./fixtures/durable-background-host.mjs", import.meta.url));
async function runNode(args: string[]): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const fd = args[0] === worker ? openSync(join(args[1], "supervisor.log"), "a", 0o600) : undefined;
    const child = spawn(process.execPath, args, { stdio: fd === undefined ? "ignore" : ["ignore", fd, fd], windowsHide: true });
    if (fd !== undefined) closeSync(fd);
    child.on("error", reject);
    child.on("close", resolve);
  });
}

test("supervisor survives actual host-process exit and refuses duplicate execution", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-worker-crash-"));
  const token = randomUUID();
  let passed = false;
  writeAtomicJson(join(directory, "request.json"), {
    id: "bg-1", token, cwd: directory, startedAt: Date.now(), timeoutSeconds: 30,
    command: `node -e "setTimeout(() => console.log('one-execution-marker'), 500)"`,
  });
  try {
    assert.equal(await runNode([host, worker, directory]), 3);
    const deadline = Date.now() + 10_000;
    let state: any;
    while (Date.now() < deadline) {
      state = readJson(join(directory, "state.json"));
      if (state && state.status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(state?.status, "completed", JSON.stringify(state) + "\n" + readFileSync(join(directory, "supervisor.log"), "utf8"));
    assert.equal(state.token, token);
    assert.equal(state.exitCode, 0);
    assert.equal(await runNode([worker, directory]), 1, "duplicate supervisor is rejected");
    const output = readFileSync(join(directory, "output.log"), "utf8");
    assert.equal(output.split(/\r?\n/).filter((line) => line === "one-execution-marker").length, 1);
    passed = true;
  } finally {
    if (passed) rmSync(directory, { recursive: true, force: true });
    else console.error("Supervisor failure evidence:", directory);
  }
});

test("natural exit wins over a late kill while descendant stdio is draining", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-worker-exit-race-"));
  let passed = false;
  const token = randomUUID();
  writeAtomicJson(join(directory, "request.json"), {
    id: "bg-1", token, cwd: directory, startedAt: Date.now(), timeoutSeconds: 30,
    command: `node -e "require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},2500)'],{stdio:'inherit'}).unref();console.log('root-exited');process.exit(0)"`,
  });
  try {
    let exitCode: number | null | undefined;
    const completion = runNode([worker, directory]).then((code) => { exitCode = code; return code; });
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (readJson<any>(join(directory, "state.json"))?.commandExited) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const exited = readJson<any>(join(directory, "state.json"));
    assert.equal(exited?.commandExited, true, JSON.stringify({ exited, supervisorExitCode: exitCode }) + "\n" + readFileSync(join(directory, "supervisor.log"), "utf8"));
    writeAtomicJson(join(directory, "controls", "late-kill.json"), { token, action: "kill" });
    assert.equal(await completion, 0);
    const state = readJson<any>(join(directory, "state.json"));
    assert.equal(state?.status, "completed", "late kill cannot replace natural exit");
    assert.equal(state?.exitCode, 0);
    passed = true;
  } finally {
    if (passed) rmSync(directory, { recursive: true, force: true });
    else console.error("Supervisor failure evidence:", directory);
  }
});
