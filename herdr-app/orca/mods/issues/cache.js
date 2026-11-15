// Disk cache for GitHub answers, under data/issues/cache/, shared by every popup copy
// and kept across restarts, so reopening something doesn't spend rate limit again.
import * as fs from "fs/promises";
import { appHome, exec } from "herdr";

const dir = () => `${appHome()}/data/issues/cache`;
const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 2166136261).toString(16);
const file = (key) => `${dir()}/${key.replace(/[^\w.-]+/g, "_").slice(0, 120)}-${hash(key)}.json`;

export async function readCache(key) {
  try { return JSON.parse(await fs.readFile(file(key), "utf8")); } catch { return null; }
}

export async function writeCache(key, value) {
  try { await fs.mkdir(dir(), { recursive: true }); await fs.writeFile(file(key), JSON.stringify(value)); } catch {}
}

export const age = (entry) => (entry?.at ? Date.now() - entry.at : Infinity);

// Has anything in the repo changed since `etag`? GitHub's newest-updated issue (PRs count)
// asked conditionally: a 304 answer doesn't count against the rate limit.
// Returns { changed, etag }; changed is true when unsure.
export async function repoChanged(repo, on, etag) {
  const args = ["api", "-i", `repos/${repo}/issues?state=all&sort=updated&direction=desc&per_page=1`];
  if (etag) args.splice(2, 0, "-H", `If-None-Match: ${etag}`);
  const r = await exec("gh", args, { on }).catch(() => null);
  const out = r?.stdout ?? "";
  if (/^HTTP\/[\d.]+ 304/m.test(out)) return { changed: false, etag };
  const tag = /^etag:\s*(.+?)\s*$/im.exec(out)?.[1] ?? null;
  return { changed: true, etag: tag };
}
