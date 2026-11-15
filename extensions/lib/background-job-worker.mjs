/** Dependency-free supervisor. Owns command lifecycle after the Pi host exits. */
import { spawn } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { writeAtomicJson } from "./durable-file.mjs";

const directory = process.argv[2];
const request = JSON.parse(readFileSync(join(directory, "request.json"), "utf8"));
const resultFile = join(directory, "state.json");
const logFile = join(directory, "output.log");
const controls = join(directory, "controls");
mkdirSync(controls, { recursive: true, mode: 0o700 });
// Exclusive admission: a duplicate supervisor may never launch the command twice.
try { closeSync(openSync(join(directory, "started.lock"), "wx", 0o600)); }
catch { process.exit(1); }
// Progress writes are superseded by the next one, so a blocked rename must never kill the
// supervisor. The terminal write in finish is the only copy of the outcome, so it passes a
// longer retry budget. A lock outlasting that budget still loses the write and the host
// reports interrupted, which is the truthful outcome then.
function commit(value, options) {
  try { writeAtomicJson(resultFile, value, options); }
  catch (error) { console.error(`[supervisor] state write failed: ${error.message}`); }
}
let outputWriteFailed = false;
function appendLog(data) {
  try { appendFileSync(logFile, data, { mode: 0o600 }); }
  catch (error) {
    if (!outputWriteFailed) {
      outputWriteFailed = true;
      console.error(`[supervisor] output write failed: ${error.message}`);
    }
  }
}

const state = { token: request.token, status: "running", startedAt: request.startedAt, supervisorPid: process.pid, heartbeatAt: Date.now() };
commit(state);
appendLog(`[${request.id}] ${request.command}\nCwd: ${request.cwd}\n\n`);
let child;
let terminal = false;
let childExited = false;
let requestedStatus;
let terminationPromise;
let terminationError;
let timer;
let controlTimer;
let heartbeatTimer;
let drainTimer;
// Descendants that outlive the command (build servers, detached apps) inherit its stdio and can
// hold the pipes open indefinitely; the command's exit, not their lifetime, ends the job.
const DRAIN_GRACE_MS = 2000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function killTree() {
  if (!child?.pid || childExited) return;
  if (process.platform === "win32") {
    // taskkill fails whenever any short-lived descendant vanishes mid-walk, even though the rest of
    // the tree dies, so the shell's exit is the proof of termination, not taskkill's exit code.
    let lastCode;
    for (let attempt = 0; attempt < 3 && !childExited; attempt++) {
      lastCode = await new Promise((resolve, reject) => {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        killer.once("error", reject);
        killer.once("close", resolve);
      });
      for (let waited = 0; waited < 5000 && !childExited; waited += 100) await sleep(100);
    }
    if (!childExited) throw new Error(`taskkill exited ${lastCode}; process-tree termination could not be confirmed`);
  } else {
    try { process.kill(-child.pid, "SIGKILL"); }
    catch { if (!child.kill("SIGKILL")) throw new Error("Process-tree termination could not be confirmed"); }
  }
}
function releaseOutput() {
  if (terminal || !child) return;
  console.error("[supervisor] output still held by a descendant after the command exited; closing pipes");
  child.stdout.destroy();
  child.stderr.destroy();
}
function requestTermination(status) {
  if (childExited) { releaseOutput(); return; }
  if (terminal || requestedStatus) return;
  requestedStatus = status;
  console.error(`[supervisor] termination requested: ${status}, pid=${child?.pid}`);
  terminationPromise = killTree().catch((error) => {
    terminationError = error.message;
    state.error = terminationError;
    commit(state);
  });
}
async function finish(code, error) {
  if (terminal) return;
  terminal = true;
  clearTimeout(timer);
  clearTimeout(drainTimer);
  clearInterval(controlTimer);
  clearInterval(heartbeatTimer);
  // On Windows the shell closing is not proof that taskkill finished the tree.
  console.error(`[supervisor] command closed: code=${code}, error=${error ?? "none"}`);
  await terminationPromise;
  state.status = terminationError ? "interrupted" : requestedStatus ?? (error || code !== 0 ? "failed" : "completed");
  state.exitCode = code;
  state.endedAt = Date.now();
  if (error || terminationError) state.error = String(error ?? terminationError);
  commit(state, { maxWaitMs: 10_000 });
}
try {
  child = process.platform === "win32"
    ? spawn(request.command, { cwd: request.cwd, env: { ...process.env, PI_BACKGROUND_JOB: request.id }, shell: true, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] })
    : spawn(existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh", ["-c", request.command], { cwd: request.cwd, env: { ...process.env, PI_BACKGROUND_JOB: request.id }, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  state.pid = child.pid;
  commit(state);
  heartbeatTimer = setInterval(() => { state.heartbeatAt = Date.now(); commit(state); }, 2000);
  child.stdout.on("data", appendLog);
  child.stderr.on("data", appendLog);
  child.stdin.on("error", (error) => appendLog(`\n[stdin error: ${error.message}]\n`));
  child.on("error", (error) => { void finish(null, error.message); });
  child.on("exit", () => {
    childExited = true;
    console.error("[supervisor] command exited; draining output");
    state.commandExited = true;
    clearTimeout(timer);
    commit(state);
    drainTimer = setTimeout(releaseOutput, DRAIN_GRACE_MS);
  });
  // close, not exit: drain stdout/stderr before committing the terminal outcome.
  child.on("close", (code) => { void finish(code); });
  let controlPollFailed = false;
  const reportedControlFailures = new Set();
  const logControlFailure = (name, error) => {
    if (reportedControlFailures.has(name)) return;
    reportedControlFailures.add(name);
    console.error(`[supervisor] control file failed: ${name}: ${error.message}`);
  };
  controlTimer = setInterval(() => {
    let names;
    try {
      names = readdirSync(controls).filter((name) => name.endsWith(".json")).sort();
      controlPollFailed = false;
    } catch (error) {
      if (!controlPollFailed) {
        controlPollFailed = true;
        console.error(`[supervisor] control file failed: ${error.message}`);
      }
      return;
    }
    for (const name of names) {
      const file = join(controls, name);
      let control;
      try { control = JSON.parse(readFileSync(file, "utf8")); }
      catch (error) {
        logControlFailure(name, error);
        try { unlinkSync(file); reportedControlFailures.delete(name); } catch { /* A later poll retries removal. */ }
        continue;
      }
      try { unlinkSync(file); reportedControlFailures.delete(name); }
      catch (error) {
        logControlFailure(name, error);
        continue;
      }
      try {
        if (control.token !== request.token) continue;
        if (control.action === "kill") requestTermination("killed");
        if (control.action === "input" && !terminal && !childExited && !requestedStatus && child.stdin.writable) child.stdin.write(control.input + "\n");
      } catch (error) {
        console.error(`[supervisor] control action failed: ${error.message}`);
      }
    }
  }, 100);
  if (request.timeoutSeconds > 0) {
    const remaining = Math.max(1, request.startedAt + request.timeoutSeconds * 1000 - Date.now());
    timer = setTimeout(() => requestTermination("timed_out"), remaining);
  }
} catch (error) {
  console.error("[supervisor] startup failure", error);
  requestTermination("killed");
  void finish(null, error.message);
}
