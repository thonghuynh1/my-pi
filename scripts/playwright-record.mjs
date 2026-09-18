#!/usr/bin/env node

/**
 * Record a short, headed Microsoft Edge session to WebM.
 *
 * This is intentionally separate from the Playwright MCP browser. MCP does
 * not expose video recording, so this helper launches its own Edge context
 * with Playwright's native recordVideo support.
 *
 * Usage:
 *   npm run playwright:record -- https://example.com --duration 30
 *   npm run playwright:record -- https://localhost:5050 --duration 0
 *
 * A duration of 0 records until Ctrl+C.
 */

import { chromium } from "playwright-core";
import { mkdir, rename } from "node:fs/promises";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);

function option(name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) return fallback;
  return value;
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npm run playwright:record -- <url> [options]

Options:
  --duration <seconds>    Stop automatically after this time. Default: 30.
                          Use 0 to record until Ctrl+C.
  --output-dir <path>     Video directory. Default: ./.playwright-mcp/videos
  --width <pixels>        Video width. Default: 1280
  --height <pixels>       Video height. Default: 720
`);
  process.exit(0);
}

const url = args.find((value) => !value.startsWith("--") && value !== option("duration") && value !== option("output-dir") && value !== option("width") && value !== option("height"));
if (!url) {
  console.error("Missing URL. Run with --help for usage.");
  process.exit(2);
}

const durationSeconds = Number(option("duration", "30"));
const width = Number(option("width", "1280"));
const height = Number(option("height", "720"));
const outputDir = resolve(option("output-dir", "./.playwright-mcp/videos"));

if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
  throw new Error("--duration must be a non-negative number of seconds");
}
if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
  throw new Error("--width and --height must be positive integers");
}

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  channel: "msedge",
  headless: false,
});
const context = await browser.newContext({
  viewport: { width, height },
  recordVideo: { dir: outputDir, size: { width, height } },
});
const page = await context.newPage();
const video = page.video();
if (!video) throw new Error("Playwright did not create a video recorder");

let finished = false;
let stopTimer;
let resolveFinished;
const finishedPromise = new Promise((resolvePromise) => {
  resolveFinished = resolvePromise;
});

async function finish(reason) {
  if (finished) return;
  finished = true;
  clearTimeout(stopTimer);

  // Video.path() becomes available after the context is closed.
  await context.close();
  const sourcePath = await video.path();
  await browser.close();

  const host = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, "_") || "page";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = join(outputDir, `${stamp}-${host}.webm`);
  await rename(sourcePath, outputPath);
  console.log(`Saved video (${reason}): ${outputPath}`);
  resolveFinished();
}

process.once("SIGINT", () => {
  void finish("Ctrl+C");
});
process.once("SIGTERM", () => {
  void finish("termination");
});

try {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  console.log(`Recording Edge: ${url}`);
  console.log(durationSeconds === 0
    ? "Recording until Ctrl+C..."
    : `Recording for ${durationSeconds}s...`);

  stopTimer = durationSeconds === 0
    ? undefined
    : setTimeout(() => void finish("duration elapsed"), durationSeconds * 1000);

  await finishedPromise;
} catch (error) {
  if (!finished) {
    await finish("error");
  }
  throw error;
}
