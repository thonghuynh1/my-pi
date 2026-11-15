import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, openSync, closeSync, existsSync, writeFileSync } from "node:fs";
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

async function waitForState(directory: string, done: (state: any) => boolean, timeoutMs: number): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  let state: any;
  while (Date.now() < deadline) {
    state = readJson<any>(join(directory, "state.json"));
    if (state && done(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return state;
}

test("an exited command finishes even while a detached descendant keeps its stdio open", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-worker-held-stdio-"));
  let passed = false;
  writeAtomicJson(join(directory, "request.json"), {
    id: "bg-1", token: randomUUID(), cwd: directory, startedAt: Date.now(), timeoutSeconds: 0,
    command: `node -e "require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},20000)'],{cwd:require('node:os').tmpdir(),stdio:'inherit',detached:true}).unref();console.log('root-exited');process.exit(3)"`,
  });
  try {
    const completion = runNode([worker, directory]);
    const state = await waitForState(directory, (value) => value.status !== "running", 10_000);
    assert.equal(state?.status, "failed", JSON.stringify(state) + "\n" + readFileSync(join(directory, "supervisor.log"), "utf8"));
    assert.equal(state.exitCode, 3);
    assert.match(readFileSync(join(directory, "output.log"), "utf8"), /root-exited/);
    assert.equal(await completion, 0);
    passed = true;
  } finally {
    if (passed) rmSync(directory, { recursive: true, force: true });
    else console.error("Supervisor failure evidence:", directory);
  }
});

function holdWithoutDeleteShare(file: string, readyFile: string, seconds: number) {
  return spawn("powershell.exe", ["-NoProfile", "-Command",
    `$f=[System.IO.File]::Open($env:LOCKFILE,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::Read); [System.IO.File]::WriteAllText($env:LOCKREADY,'1'); Start-Sleep -Seconds ${seconds}; $f.Close()`],
  { env: { ...process.env, LOCKFILE: file, LOCKREADY: readyFile }, stdio: "ignore", windowsHide: true });
}

test("supervisor survives a state.json lock that outlasts the rename retry and still records completion", { skip: process.platform !== "win32" }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-worker-locked-state-"));
  let passed = false;
  writeAtomicJson(join(directory, "request.json"), {
    id: "bg-1", token: randomUUID(), cwd: directory, startedAt: Date.now(), timeoutSeconds: 60,
    command: `node -e "const fs=require('fs');const t=setInterval(()=>{if(fs.existsSync('go')){clearInterval(t);console.log('go-done')}},50)"`,
  });
  let holder: ReturnType<typeof spawn> | undefined;
  try {
    let exitCode: number | null | undefined;
    const completion = runNode([worker, directory]).then((code) => { exitCode = code; return code; });
    const running = await waitForState(directory, (value) => Boolean(value.pid), 10_000);
    assert.ok(running?.pid, "supervisor wrote running state" + "\n" + readFileSync(join(directory, "supervisor.log"), "utf8"));
    const readyFile = join(directory, "lock-ready");
    holder = holdWithoutDeleteShare(join(directory, "state.json"), readyFile, 9);
    const readyDeadline = Date.now() + 10_000;
    while (!existsSync(readyFile) && Date.now() < readyDeadline) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(existsSync(readyFile), "lock holder opened state.json without delete sharing");
    await new Promise((resolve) => setTimeout(resolve, 4500));
    assert.equal(exitCode, undefined, "supervisor stayed alive across heartbeats with a blocked state write");
    writeFileSync(join(directory, "go"), "1");
    const state = await waitForState(directory, (value) => value.status !== "running", 20_000);
    assert.equal(state?.status, "completed", JSON.stringify(state) + "\n" + readFileSync(join(directory, "supervisor.log"), "utf8"));
    assert.equal(state.exitCode, 0);
    assert.equal(await completion, 0);
    assert.match(readFileSync(join(directory, "supervisor.log"), "utf8"), /state write failed/);
    assert.match(readFileSync(join(directory, "output.log"), "utf8"), /go-done/);
    passed = true;
  } finally {
    holder?.kill();
    if (passed) rmSync(directory, { recursive: true, force: true });
    else console.error("Supervisor failure evidence:", directory);
  }
});

test("supervisor survives an unwritable output log and a malformed control file", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-worker-bad-io-"));
  let passed = false;
  const token = randomUUID();
  mkdirSync(join(directory, "output.log"));
  writeAtomicJson(join(directory, "request.json"), {
    id: "bg-1", token, cwd: directory, startedAt: Date.now(), timeoutSeconds: 30,
    command: `node -e "setTimeout(() => {}, 30000)"`,
  });
  try {
    let exitCode: number | null | undefined;
    const completion = runNode([worker, directory]).then((code) => { exitCode = code; return code; });
    const running = await waitForState(directory, (value) => Boolean(value.pid), 3000);
    assert.ok(running?.pid, "supervisor started despite the unwritable output log\n" + readFileSync(join(directory, "supervisor.log"), "utf8"));
    writeFileSync(join(directory, "controls", "00-bad.json"), "{broken");
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(exitCode, undefined, "supervisor stayed alive after the malformed control file");
    writeAtomicJson(join(directory, "controls", "kill.json"), { token, action: "kill" });
    const state = await waitForState(directory, (value) => value.status !== "running", 20_000);
    assert.equal(state?.status, "killed", JSON.stringify(state) + "\n" + readFileSync(join(directory, "supervisor.log"), "utf8"));
    assert.equal(await completion, 0);
    const supervisorLog = readFileSync(join(directory, "supervisor.log"), "utf8");
    assert.match(supervisorLog, /output write failed/);
    assert.match(supervisorLog, /control file failed/);
    passed = true;
  } finally {
    if (passed) rmSync(directory, { recursive: true, force: true });
    else console.error("Supervisor failure evidence:", directory);
  }
});

test("a kill that ends the tree is confirmed even when taskkill reports a vanished child", { skip: process.platform !== "win32" }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-worker-churn-kill-"));
  let passed = false;
  const token = randomUUID();
  writeAtomicJson(join(directory, "request.json"), {
    id: "bg-1", token, cwd: directory, startedAt: Date.now(), timeoutSeconds: 0,
    command: `node -e "const {execFileSync}=require('node:child_process');for(;;)execFileSync('cmd',['/d','/c','exit 0'])"`,
  });
  try {
    const completion = runNode([worker, directory]);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    writeAtomicJson(join(directory, "controls", "kill.json"), { token, action: "kill" });
    const state = await waitForState(directory, (value) => value.status !== "running", 20_000);
    assert.equal(state?.status, "killed", JSON.stringify(state) + "\n" + readFileSync(join(directory, "supervisor.log"), "utf8"));
    assert.equal(state.error, undefined);
    assert.equal(await completion, 0);
    passed = true;
  } finally {
    if (passed) rmSync(directory, { recursive: true, force: true });
    else console.error("Supervisor failure evidence:", directory);
  }
});
