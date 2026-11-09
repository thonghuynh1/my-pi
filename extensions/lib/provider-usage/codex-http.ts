const RESPONSE_LIMIT = 65_536;
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function accountId(token: string): string {
  if (token.length > 32_768 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error("Invalid Codex OAuth token");
  const claims: unknown = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  const id = record(record(claims)["https://api.openai.com/auth"]).chatgpt_account_id;
  if (typeof id !== "string" || !id.trim()) throw new Error("Codex OAuth account unavailable");
  return id;
}
export async function responseJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.status !== 200 || response.redirected || !response.body
    || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) throw new Error("Codex usage response unavailable");
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > RESPONSE_LIMIT) throw new Error("Codex usage response exceeded safety limit");
      chunks.push(value);
    }
    signal.throwIfAborted();
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)));
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function codexRequest(token: string, account: string, signal: AbortSignal): RequestInit {
  return { headers: { Authorization: `Bearer ${token}`, "ChatGPT-Account-Id": account, originator: "pi" },
    redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) };
}
