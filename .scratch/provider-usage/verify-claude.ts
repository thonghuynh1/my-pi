import { providerReaders } from "../../extensions/lib/provider-usage/readers.ts";
import { compactFooterRows, detailText } from "../../extensions/lib/provider-usage/model.ts";
import { readFileSync } from "node:fs"; import { homedir } from "node:os";
const before = JSON.parse(readFileSync(homedir() + "/.claude.json", "utf8")).cachedUsageUtilization.fetchedAtMs;
const r = providerReaders().find((x) => x.id === "claude")!;
const t = Date.now(); const value = await r.read(new AbortController().signal);
const after = JSON.parse(readFileSync(homedir() + "/.claude.json", "utf8")).cachedUsageUtilization.fetchedAtMs;
const state = { id: "claude" as const, name: "Claude", experimental: true, status: "available" as const, value };
console.log({ ms: Date.now() - t, refreshed: after > before });
console.log(compactFooterRows([state])); console.log(detailText([state]));

