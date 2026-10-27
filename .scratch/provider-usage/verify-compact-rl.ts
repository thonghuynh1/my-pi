import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import usageFooter from "../../extensions/usage-footer.ts";
import { ProviderUsageMonitor } from "../../extensions/lib/provider-usage/monitor.ts";
import { UsageReadError } from "../../extensions/lib/provider-usage/readers.ts";

export default function verifyCompactRl(pi: ExtensionAPI) {
  usageFooter(pi, new ProviderUsageMonitor([{
    id: "claude-personal", name: "Claude Personal",
    read: async () => { throw new UsageReadError("Claude usage refresh rate limited"); },
  }]));
}
