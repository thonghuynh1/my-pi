#!/usr/bin/env node

/**
 * MCP adapter for the standalone Edge video recorder.
 *
 * This exposes a bounded `record_video` tool to MCP clients. It launches a
 * separate headed Microsoft Edge context; it cannot record the browser
 * context owned by the official Playwright MCP server.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const recorderScript = resolve(fileURLToPath(new URL("./playwright-record.mjs", import.meta.url)));

function runRecorder(input) {
  return new Promise((resolveResult) => {
    const args = [
      recorderScript,
      input.url,
      "--duration",
      String(input.duration),
      "--width",
      String(input.width),
      "--height",
      String(input.height),
    ];
    if (input.outputDir) args.push("--output-dir", input.outputDir);

    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => resolveResult({ code: 1, stdout, stderr: `${stderr}${error.message}` }));
    child.on("close", (code, signal) => {
      resolveResult({
        code: code ?? 1,
        signal,
        stdout,
        stderr,
      });
    });
  });
}

const server = new McpServer({
  name: "playwright-recorder",
  version: "1.0.0",
});

server.registerTool(
  "record_video",
  {
    title: "Record Edge video",
    description:
      "Launch a separate headed Microsoft Edge session, navigate to the URL, and save a WebM video. " +
      "This does not record the browser session owned by the official Playwright MCP server.",
    inputSchema: {
      url: z.string().url().describe("URL to open in Microsoft Edge."),
      duration: z.number().int().min(1).max(3600).default(30)
        .describe("Recording duration in seconds. Maximum 3600."),
      outputDir: z.string().optional()
        .describe("Optional video directory, relative to the current workspace or an absolute path."),
      width: z.number().int().min(1).max(7680).default(1280)
        .describe("Video width in pixels."),
      height: z.number().int().min(1).max(4320).default(720)
        .describe("Video height in pixels."),
    },
  },
  async (input) => {
    const result = await runRecorder(input);
    if (result.code !== 0) {
      const diagnostics = [
        `Video recording failed${result.signal ? ` (${result.signal})` : ""}.`,
        result.stderr.trim(),
        result.stdout.trim(),
      ].filter(Boolean).join("\n");
      return {
        content: [{ type: "text", text: diagnostics }],
        isError: true,
      };
    }

    const savedLine = result.stdout.split(/\r?\n/).find((line) => line.startsWith("Saved video"));
    const outputPath = savedLine?.replace(/^Saved video \([^)]*\):\s*/, "") ?? result.stdout.trim();
    return {
      content: [{
        type: "text",
        text: `Saved Edge video: ${outputPath}`,
      }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
