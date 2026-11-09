import assert from "node:assert/strict";
import { test } from "node:test";
import { createCodexResetAccess, createCodexResetFlow, type CodexResetTarget, type ResetCredit, type ResetOutcome } from "../lib/provider-usage/codex-reset.ts";

const token = (account: string) => `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: account } })).toString("base64url")}.signature`;
const target: CodexResetTarget = { id: "codex-2", name: "Codex 2" };
const rawCredit = { id: "secret-credit", title: "Weekly reset", reset_type: "weekly", status: "available", granted_at: "now", expires_at: "later", description: "test" };
const credit: ResetCredit = { id: rawCredit.id, title: rawCredit.title, resetType: rawCredit.reset_type, status: rawCredit.status };
const attempt = { account: { target, accountId: "secret-account" }, credit, requestId: "request-1" };
const signal = () => new AbortController().signal;
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

test("inventory uses selected OAuth and parses bounded sanitized fields", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  let body: unknown = { credits: [{ ...rawCredit, title: "\u001b[31mReset\u001b[0m\nnow", extra: "ignored" }] };
  const access = createCodexResetAccess(async () => token("secret-account"), async (url, init) => {
    calls.push({ url: String(url), init: init! }); return Response.json(body);
  });
  const inventory = await access.inventory(signal());
  assert.equal(inventory.accountId, "secret-account");
  assert.equal(inventory.credits[0].title, "Resetnow");
  assert(!JSON.stringify(inventory.credits).includes("ignored"));
  assert.equal(calls[0].url, "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits");
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get("authorization"), `Bearer ${token("secret-account")}`);
  assert.equal(headers.get("chatgpt-account-id"), "secret-account");
  assert.equal(headers.get("originator"), "pi");
  assert.equal(calls[0].init.redirect, "error");
  assert(calls[0].init.signal instanceof AbortSignal);
  for (const bad of [{}, { credits: null }, { credits: [{ ...rawCredit, id: "" }] },
    { credits: [rawCredit, rawCredit] }, { credits: [{ ...rawCredit, title: "x".repeat(1025) }] }]) {
    body = bad;
    await assert.rejects(access.inventory(signal()), (e: Error) => !/secret/.test(e.message));
  }
  body = { credits: [] };
  assert.deepEqual((await access.inventory(signal())).credits, []);
});

test("consume posts exact idempotent fields; all 200 bodies accepted", async () => {
  let body: Response = Response.json({ outcome: "reset" });
  const requests: { url: string; init: RequestInit }[] = [];
  const access = createCodexResetAccess(async () => token("secret-account"), async (url, init) => {
    requests.push({ url: String(url), init: init! }); return body;
  });
  for (const outcome of ["reset", "nothingToReset", "noCredit", "alreadyRedeemed"]) {
    body = Response.json({ outcome });
    assert.deepEqual(await access.consume(attempt, signal()), { kind: "accepted", outcome });
  }
  for (const make of [() => Response.json({}), () => new Response("broken", { headers: { "content-type": "application/json" } }),
    () => new Response(""), () => new Response("hi", { headers: { "content-type": "text/plain" } }),
    () => new Response("x".repeat(65537), { headers: { "content-type": "application/json" } })]) {
    body = make(); assert.deepEqual(await access.consume(attempt, signal()), { kind: "accepted" });
  }
  for (const request of requests) {
    assert.equal(request.url, "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume");
    assert.equal(request.init.method, "POST");
    assert.deepEqual(JSON.parse(String(request.init.body)), { credit_id: "secret-credit", redeem_request_id: "request-1" });
    assert.equal(new Headers(request.init.headers).get("chatgpt-account-id"), "secret-account");
    assert.equal(new Headers(request.init.headers).get("originator"), "pi");
    assert.equal(request.init.redirect, "error");
  }
});

test("preflight is not-sent, network and HTTP failures are uncertain and private", async () => {
  let auth: string | undefined = undefined, calls = 0, mode = "loss";
  const access = createCodexResetAccess(async () => auth, async () => {
    calls++; if (mode === "loss") throw new Error("secret-token secret-account secret-credit");
    return new Response("secret", { status: 500 });
  });
  for (auth of [undefined, "bad", token("other-account")]) {
    const result = await access.consume(attempt, signal());
    assert.equal(result.kind, "not-sent"); assert(!JSON.stringify(result).includes("secret"));
  }
  assert.equal(calls, 0);
  auth = token("secret-account");
  for (mode of ["loss", "status"]) {
    const result = await access.consume(attempt, signal());
    assert.equal(result.kind, "uncertain"); assert(!JSON.stringify(result).includes("secret"));
  }
  assert.equal(calls, 2);
});


test("flow gates submit, coalesces rapid keys, and retries the identical attempt", async () => {
  const pending = deferred<ResetOutcome>(), attempts: unknown[] = [], refreshed: string[] = [];
  let inventories = 0, ids = 0;
  const flow = createCodexResetFlow([target], {
    inventory: async (chosen) => { inventories++; return { account: { target: chosen, accountId: "secret-account" }, credits: [credit] }; },
    consume: async (chosen) => { attempts.push(chosen); return attempts.length === 1 ? pending.promise : { kind: "accepted", outcome: "reset" }; },
    afterReset: async chosen => { refreshed.push(chosen.id); }, uuid: () => { ids++; return "request-1"; },
  });
  flow.open(); flow.renderLines(80); flow.handleInput("r");
  assert.equal(attempts.length, 0); assert.equal(inventories, 0);
  flow.handleInput("\r"); await flush();
  assert.equal(flow.state().kind, "credits"); assert.equal(inventories, 1);
  flow.handleInput("\r"); assert.equal(flow.state().kind, "confirm");
  assert.match(flow.renderLines(80).join(" "), /irreversibly spends exactly one/);
  flow.handleInput("n"); assert.equal(flow.state().kind, "credits"); assert.equal(attempts.length, 0);
  flow.handleInput("\r"); flow.handleInput("y"); flow.handleInput("y"); flow.handleInput("t");
  assert.equal(flow.state().kind, "submitting"); assert.equal(ids, 1); assert.equal(attempts.length, 1);
  pending.resolve({ kind: "uncertain", message: "The credit may or may not have been spent. Check codex /usage; t retries with the same request id." });
  await flush(); assert.equal(flow.state().kind, "done"); assert.deepEqual(refreshed, [target.id]);
  flow.handleInput("t"); await flush(); assert.equal(attempts.length, 2); assert.equal(attempts[0], attempts[1]);
  assert.equal(ids, 1); assert.deepEqual(refreshed, [target.id, target.id]);
  flow.handleInput("t"); assert.equal(attempts.length, 2);
});

test("late inventory cannot overwrite a new account selection", async () => {
  const a: CodexResetTarget = { id: "codex", name: "Codex 1" }, b: CodexResetTarget = target;
  const slow = deferred<{ account: { target: CodexResetTarget; accountId: string }; credits: ResetCredit[] }>();
  const selected: string[] = [];
  const flow = createCodexResetFlow([a, b], {
    inventory: async chosen => { selected.push(chosen.id); return chosen === a ? slow.promise : { account: { target: b, accountId: "second" }, credits: [credit] }; },
    consume: async () => { throw new Error("must not submit"); }, afterReset: async () => {},
  });
  flow.open(); flow.handleInput("\r"); flow.handleInput("\x1b"); flow.open(); flow.handleInput("\x1b[B"); flow.handleInput("\r");
  await flush(); assert.equal(flow.state().kind, "credits");
  slow.resolve({ account: { target: a, accountId: "first" }, credits: [credit] }); await flush();
  const state = flow.state(); assert(state.kind === "credits"); assert.equal(state.account.target, b);
  assert.deepEqual(selected, ["codex", "codex-2"]);
});


test("not-sent does not refresh; empty inventory and cancellation never consume", async () => {
  let posts = 0, refreshes = 0;
  let empty = true;
  const flow = createCodexResetFlow([target], {
    inventory: async chosen => ({ account: { target: chosen, accountId: "secret-account" }, credits: empty ? [] : [credit] }),
    consume: async () => { posts++; return { kind: "not-sent", message: "unavailable" }; },
    afterReset: async () => { refreshes++; },
  });
  flow.open(); flow.handleInput("\r"); await flush();
  assert.match(flow.renderLines(80).join(" "), /No reset credits/);
  flow.handleInput("\x1b"); empty = false;
  flow.open(); flow.handleInput("\r"); await flush(); flow.handleInput("\r"); flow.handleInput("n");
  assert.equal(posts, 0); flow.handleInput("\r"); flow.handleInput("y"); await flush();
  assert.equal(posts, 1); assert.equal(refreshes, 0);
});

test("abort after fetch starts is uncertain", async () => {
  const access = createCodexResetAccess(async () => token("secret-account"), async (_url, init) => {
    assert(init?.signal); throw new DOMException("timeout", "TimeoutError");
  });
  assert.equal((await access.consume(attempt, signal())).kind, "uncertain");
});
