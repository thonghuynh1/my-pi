import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const waitCell = new Int32Array(new SharedArrayBuffer(4));
/** Bounded local I/O backoff, not agent/job polling. Never remove the old file. */
export function replaceFileWithRetry(source, destination, options = {}) {
  const rename = options.rename ?? renameSync;
  const platform = options.platform ?? process.platform;
  const pause = options.pause ?? ((ms) => Atomics.wait(waitCell, 0, 0, ms));
  const now = options.now ?? Date.now;
  const deadline = now() + (options.maxWaitMs ?? 1000);
  let delay = 5;
  for (;;) {
    try { rename(source, destination); return; }
    catch (error) {
      // Windows readers/virus scanners can briefly deny replace/delete sharing.
      // ENOSPC, invalid paths, and non-Windows failures are not retryable.
      if (platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(error.code) || now() >= deadline) throw error;
      pause(Math.min(delay, Math.max(0, deadline - now())));
      delay = Math.min(50, delay * 2);
    }
  }
}

export function writeAtomicJson(file, value) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = openSync(temporary, "wx", 0o600);
    writeFileSync(fd, JSON.stringify(value), "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    replaceFileWithRetry(temporary, file);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
