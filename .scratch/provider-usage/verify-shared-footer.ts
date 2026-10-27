import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import usageFooter from "../../extensions/usage-footer.ts";
import { ProviderUsageMonitor } from "../../extensions/lib/provider-usage/monitor.ts";
import { SharedUsageCache } from "../../extensions/lib/provider-usage/shared-cache.ts";
import type { ProviderReader } from "../../extensions/lib/provider-usage/readers.ts";
import type { UsageMetric, ProviderId } from "../../extensions/lib/provider-usage/model.ts";

const root = "C:/Users/920287/AppData/Local/Temp/pi-usage-ui-600312db16ca4426b8e59c4df0c9dfff";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const fixtures: [ProviderId, string, UsageMetric][] = [
  ["codex", "Codex", { kind: "quota", groups: [{ id: "codex", name: "Codex", shortName: "Codex", windows: [{ id: "5h", label: "5h", usedPercent: 12 }, { id: "week", label: "week", usedPercent: 34 }] }] }],
  ["antigravity", "Antigravity", { kind: "quota", groups: [{ id: "gemini", name: "Gemini Models", shortName: "AG Gemini", windows: [{ id: "5h", label: "5h", usedPercent: 5 }, { id: "week", label: "week", usedPercent: 10 }] }] }],
  ["copilot", "GitHub Copilot", { kind: "credits", consumed: 10000 }],
  ["cursor", "Cursor", { kind: "quota", groups: [{ id: "cursor", name: "Cursor included plan", shortName: "Cursor", windows: [{ id: "month", label: "month", usedPercent: 25 }] }] }],
  ["claude-work", "Claude Work", { kind: "spend", windows: [], spend: { used: 123, limit: 500, currency: "USD" } }],
  ["claude-personal", "Claude Personal", { kind: "spend", windows: [{ id: "5h", label: "5h", usedPercent: 84 }, { id: "week", label: "week", usedPercent: 74 }] }],
];
export default function verifySharedFooter(pi: ExtensionAPI) {
  const readers: ProviderReader[] = fixtures.map(([id, name, value]) => ({
    id, name,
    scope: async () => ({ key: hash(id), generation: hash("fixture-login"), identity: "known" as const }),
    read: async () => { appendFileSync(path.join(root, "fetches.txt"), id + "\n"); return value; },
  }));
  usageFooter(pi, new ProviderUsageMonitor(readers, undefined, new SharedUsageCache({ root })));
}
