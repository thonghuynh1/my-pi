import { appendFileSync } from "node:fs";
import { SharedUsageCache } from "../../lib/provider-usage/shared-cache.ts";
import type { UsageScope } from "../../lib/provider-usage/scope.ts";

export async function run(options: { root: string; counter: string; scope: UsageScope; now: number; fail?: boolean; gate?: boolean; abortAfterMs?: number }): Promise<void> {
  const queued: string[] = [];
  let waiter: ((command: string) => void) | undefined;
  const receive = (command: unknown) => {
    if (typeof command !== "string") return;
    if (waiter) { const resolve = waiter; waiter = undefined; resolve(command); }
    else queued.push(command);
  };
  const command = (): Promise<string> => queued.length ? Promise.resolve(queued.shift()!) : new Promise((resolve) => { waiter = resolve; });
  process.on("message", receive);
  const send = (value: Record<string, unknown>) => process.send?.(value);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  send({ type: "ready" });
  await command();
  if (options.abortAfterMs !== undefined) timer = setTimeout(() => controller.abort(), options.abortAfterMs);
  try {
    const result = await new SharedUsageCache({ root: options.root, now: () => options.now }).read({
      id: "copilot", name: "Fixture",
      scope: async () => { send({ type: "scope" }); return options.scope; },
      read: async (signal) => {
        appendFileSync(options.counter, "live\n");
        send({ type: "entered" });
        if (options.gate) await Promise.race([command(), new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("synthetic-secret-abort")), { once: true });
        })]);
        if (options.fail) throw new Error("synthetic-secret-token-account@example.test");
        return { kind: "credits", consumed: 42 };
      },
    }, controller.signal);
    send({ type: "result", result });
  } finally {
    if (timer) clearTimeout(timer);
    process.removeListener("message", receive);
    process.disconnect?.();
  }
}
