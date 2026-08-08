import { existsSync } from "fs";

const DEFAULT_AIKNOW_PATH =
  "C:/Hackathon/aiKnow/aiKnow/integrations/pi/aiknow/index.ts";

const AIKNOW_PATH = process.env.AIKNOW_PATH ?? DEFAULT_AIKNOW_PATH;

export const piExtension = { id: "aiknow" };

type SearchResult = Record<string, unknown> & {
  content: unknown[];
};

type SearchTool = Record<string, unknown> & {
  name: string;
  execute: (...args: unknown[]) => Promise<unknown>;
};

type PiApi = Record<string, unknown> & {
  registerTool: (tool: unknown) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSearchTool(value: unknown): value is SearchTool {
  return isRecord(value) && value.name === "aiknow_search" && typeof value.execute === "function";
}

function isPiApi(value: unknown): value is PiApi {
  return isRecord(value) && typeof value.registerTool === "function";
}

function isSearchResult(value: unknown): value is SearchResult {
  return isRecord(value) && Array.isArray(value.content);
}

function queryFromToolArgs(args: unknown[]): string {
  const params = args[1];
  return isRecord(params) && typeof params.query === "string" ? params.query : "";
}

export function formatEscalationNudge(query: string, resultCount: number): string | null {
  if (resultCount === 0) {
    return `[aiknow] No indexed results for "${query}". Try grep, or the symbol may be in an unindexed file.`;
  }
  if (resultCount <= 2) {
    return `[aiknow] Only ${resultCount} result(s) for "${query}". Try broadening your search or using grep for unindexed files.`;
  }
  return null;
}

function appendEscalationNudge(result: unknown, query: string): unknown {
  if (!isSearchResult(result) || !isRecord(result.details) || !Array.isArray(result.details.entryPoints)) {
    return result;
  }

  const nudge = formatEscalationNudge(query, result.details.entryPoints.length);
  return nudge === null
    ? result
    : { ...result, content: [...result.content, { type: "text", text: `\n\n${nudge}` }] };
}

function wrapSearchTool(tool: unknown): unknown {
  if (!isSearchTool(tool)) return tool;

  return {
    ...tool,
    execute: async (...args: unknown[]) => appendEscalationNudge(await tool.execute(...args), queryFromToolArgs(args)),
  };
}

function withEscalationNudge(pi: unknown): unknown {
  if (!isPiApi(pi)) return pi;

  return new Proxy(pi, {
    get(target, property) {
      if (property === "registerTool") {
        return (tool: unknown) => pi.registerTool(wrapSearchTool(tool));
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export default async function (pi: unknown) {
  if (!existsSync(AIKNOW_PATH)) {
    return;
  }
  const mod = await import(AIKNOW_PATH);
  if (typeof mod.default === "function") {
    await mod.default(withEscalationNudge(pi));
  }
}
