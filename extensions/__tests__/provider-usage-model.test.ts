import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCodex, parseAntigravity, parseCopilot, parseCursor, footerRows, compactFooterRows, detailText, type ProviderState } from "../lib/provider-usage/model.ts";

process.env.TZ = "UTC";

const codex = {
  rateLimits: {
    primary: { usedPercent: 69, windowDurationMins: 300, resetsAt: 1792138480 },
    secondary: { usedPercent: 16, windowDurationMins: 10080, resetsAt: 1792676195 },
    credits: { balance: "private" }, accountId: "private",
  },
};
const ag = {
  status: "SUCCESS", command: { name: "usage", data: { groups: [
    { name: "Gemini Models", buckets: [
      { id: "gemini-weekly", window: "weekly", remaining_fraction: 1, reset_time: "2026-10-23T06:34:38Z" },
      { id: "gemini-5h", window: "5h", remaining_fraction: 1, reset_time: "2026-10-16T11:34:38Z" },
    ] },
    { name: "Claude and GPT models", buckets: [
      { id: "3p-weekly", window: "weekly", remaining_fraction: 0.5174307823181152, reset_time: "2026-10-21T20:04:23Z" },
      { id: "3p-5h", window: "5h", remaining_fraction: 1, reset_time: "2026-10-16T11:34:38Z" },
    ] },
  ] } }, usage: { input_tokens: 0 }, response: "do not parse rounded text",
};

test("Codex literal fixture preserves window identity and epoch seconds, not account/credit inventory", () => {
  assert.deepEqual(parseCodex(codex), { kind: "quota", groups: [{ id: "codex", name: "Codex", shortName: "Codex", windows: [
    { id: "5h", label: "5h", usedPercent: 69, resetsAt: 1792138480000 },
    { id: "week", label: "week", usedPercent: 16, resetsAt: 1792676195000 },
  ] }] });
  assert(!JSON.stringify(parseCodex(codex)).includes("private"));
  assert.deepEqual(parseCodex({ rateLimits: { primary: codex.rateLimits.secondary, secondary: codex.rateLimits.primary } }), parseCodex(codex));
  assert.deepEqual(parseCodex({ ...codex, rateLimitsByLimitId: { codex: codex.rateLimits, unrelated: { primary: { usedPercent: 99, windowDurationMins: 300 } } } }), parseCodex(codex));
});

test("missing secondary is not zero; unknown windows are not relabeled; zero is real", () => {
  const value = parseCodex({ rateLimits: { primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: -1 } } });
  assert(value.kind === "quota");
  assert.deepEqual(value.groups[0].windows, [{ id: "5h", label: "5h", usedPercent: 0, resetsAt: undefined }]);
  const text = detailText([{ id: "codex", name: "Codex", status: "available", value }]);
  assert.match(text, /Weekly window [(]week[)]: unavailable \/ not applicable/);
  assert(!text.includes("Weekly window (week): 0%"));
  const other = parseCodex({ rateLimits: { primary: { usedPercent: 12, windowDurationMins: 60 } } });
  assert(other.kind === "quota");
  assert.equal(other.groups[0].windows[0].id, "60m");
});

test("invalid or missing quota fields never invent usage or reset dates", () => {
  for (const usedPercent of [undefined, null, "0", NaN, Infinity, -1, 101]) {
    assert.throws(() => parseCodex({ rateLimits: { primary: { usedPercent, windowDurationMins: 300 } } }));
  }
  for (const windowDurationMins of [undefined, null, 0, -1, Infinity]) {
    assert.throws(() => parseCodex({ rateLimits: { primary: { usedPercent: 0, windowDurationMins } } }));
  }
  assert.throws(() => parseCodex({}));
  assert.throws(() => parseAntigravity({ status: "SUCCESS", usage: { input_tokens: 0 } }));
});

test("Antigravity separate Gemini and third-party groups with independent resets", () => {
  const value = parseAntigravity(ag);
  assert(value.kind === "quota");
  assert.equal(value.groups.length, 2);
  assert.deepEqual(value.groups[0], { id: "gemini", name: "Gemini Models", shortName: "AG Gemini", windows: [
    { id: "5h", label: "5h", usedPercent: 0, resetsAt: Date.parse("2026-10-16T11:34:38Z") },
    { id: "week", label: "week", usedPercent: 0, resetsAt: Date.parse("2026-10-23T06:34:38Z") },
  ] });
  assert.equal(value.groups[1].name, "Claude and GPT models");
  assert.equal(value.groups[1].windows[1].usedPercent, (1 - 0.5174307823181152) * 100);
  assert.equal(value.groups[1].windows[1].resetsAt, Date.parse("2026-10-21T20:04:23Z"));
  assert.deepEqual(footerRows([{ id: "antigravity", name: "Antigravity", status: "available", value }]), [
    "AG Gemini 5h 0% · week 0% used · 5h reset 11:34", "AG Claude/GPT 5h 0% · week 48.3% used · 5h reset 11:34",
  ]);
});

test("Antigravity rejects invalid fractions and ignores extra/duplicate buckets", () => {
  const fixture = structuredClone(ag);
  fixture.command.data.groups[0].buckets.push({ id: "other", window: "monthly", remaining_fraction: 0, reset_time: "bad" });
  fixture.command.data.groups[0].buckets.push({ id: "duplicate", window: "5h", remaining_fraction: 0, reset_time: "bad" });
  assert.deepEqual(parseAntigravity(fixture), parseAntigravity(ag));
  for (const fraction of [undefined, null, "0", -0.1, 1.1, NaN, Infinity]) {
    assert.throws(() => parseAntigravity({ status: "SUCCESS", command: { name: "usage", data: { groups: [
      { name: "Gemini Models", buckets: [{ window: "5h", remaining_fraction: fraction }] },
    ] } } }));
  }
});

test("Copilot unlimited enterprise consumes credits, not remaining percentage, money or tokens", () => {
  const value = parseCopilot({ token_based_billing: true, quota_snapshots: { premium_interactions: {
    credits_used: 54386, unlimited: true, entitlement: 0, percent_remaining: 100,
  } }, quota_reset_date_utc: "2026-11-01T00:00:00.000Z" });
  assert.deepEqual(value, { kind: "credits", consumed: 54386, resetsAt: Date.parse("2026-11-01T00:00:00.000Z") });
  const state: ProviderState = { id: "copilot", name: "GitHub Copilot", experimental: true, status: "available", value };
  assert.deepEqual(footerRows([state]), ["Copilot 54,386 credits used"]);
  const text = detailText([state]);
  assert.match(text, /experimental internal API/);
  assert.match(text, /54,386 credits consumed/);
  assert(!text.includes("remaining"));
  assert.match(text, /100 credits = \$1/);
  assert.match(text, /not a verified bill/);
  assert.deepEqual(parseCopilot({ quota_snapshots: { premium_interactions: { credits_used: 0 } }, quota_reset_date_utc: "bad" }), { kind: "credits", consumed: 0, resetsAt: undefined });
  for (const credits_used of [undefined, null, "0", -1, NaN, Infinity]) {
    assert.throws(() => parseCopilot({ quota_snapshots: { premium_interactions: { credits_used, percent_remaining: 100, unlimited: true } } }));
  }
});

test("Cursor monthly included plan preserves percentage and millisecond billing reset", () => {
  const value = parseCursor({ planUsage: { totalPercentUsed: 42.25 }, billingCycleEnd: "1802600000000", accountId: "private" });
  assert(value.kind === "quota");
  assert.deepEqual(value.groups[0].windows, [{ id: "month", label: "month", usedPercent: 42.25, resetsAt: 1802600000000 }]);
  const state: ProviderState = { id: "cursor", name: "Cursor", experimental: true, status: "available", value };
  assert.deepEqual(footerRows([state]), ["Cursor month 42.3% used"]);
  const text = detailText([state]);
  assert.match(text, /Monthly included plan [(]month[)]: 42.3% used/);
  assert(text.includes(new Date(1802600000000).toLocaleString()));
  assert(!/Five-hour|Weekly|private|credits/.test(text));
  assert.match(footerRows([{ ...state, status: "error", error: "unavailable" }])[0], /stale/);
  assert.deepEqual(footerRows([{ ...state, value: undefined, status: "error" }]), []);
});

test("Cursor exposes independently reported Auto/API categories without zero defaults or adding percentages", () => {
  const value = parseCursor({ billingCycleEnd: "1802600000000", planUsage: {
    totalPercentUsed: 44.81058201058201, autoPercentUsed: 42.044444444444444, apiPercentUsed: 100,
  } });
  assert(value.kind === "quota");
  assert.deepEqual(value.groups[0].windows.map(({ id, usedPercent }) => ({ id, usedPercent })), [
    { id: "month", usedPercent: 44.81058201058201 },
    { id: "auto", usedPercent: 42.044444444444444 }, { id: "api", usedPercent: 100 },
  ]);
  const state: ProviderState = { id: "cursor", name: "Cursor", status: "available", value };
  assert.deepEqual(footerRows([state]), ["Cursor month 44.8% · Auto 42% · API 100% used"]);
  const text = detailText([state]);
  assert.match(text, /Auto: 42% used/); assert.match(text, /API: 100% used/);
  assert.match(text, /not additive/); assert.match(text, /billing-cycle end:/);
  for (const invalid of [undefined, null, "0", -1, Infinity, NaN]) {
    const partial = parseCursor({ planUsage: { totalPercentUsed: 44, autoPercentUsed: invalid, apiPercentUsed: 0 } });
    assert(partial.kind === "quota");
    assert.deepEqual(partial.groups[0].windows.map((w) => w.id), ["month", "api"]);
    assert.equal(partial.groups[0].windows[1].usedPercent, 0);
  }
});

test("Cursor accepts real zero, explicit overage and verified ratio, never absent quota", () => {
  for (const [planUsage, expected] of [
    [{ totalPercentUsed: 0 }, 0], [{ totalPercentUsed: 125 }, 125],
    [{ includedSpend: 300, limit: 2000 }, 15],
  ] as const) {
    const value = parseCursor({ planUsage, billingCycleEnd: "bad" });
    assert(value.kind === "quota");
    assert.equal(value.groups[0].windows[0].usedPercent, expected);
    assert.equal(value.groups[0].windows[0].resetsAt, undefined);
  }
  for (const totalPercentUsed of [null, "0", -1, NaN, Infinity]) {
    assert.throws(() => parseCursor({ planUsage: { totalPercentUsed, includedSpend: 0, limit: 2000 } }));
  }
  for (const raw of [{}, { spendLimitUsage: { totalSpend: 1 } }, { planUsage: {} }, { planUsage: { limit: 0, includedSpend: 0 } }, { planUsage: { limit: 20 } }]) {
    assert.throws(() => parseCursor(raw));
  }
});

test("footer shows the local five-hour reset only, never the weekly reset or an invented time", () => {
  const state: ProviderState = { id: "codex", name: "Codex", status: "available", value: parseCodex(codex) };
  assert.deepEqual(footerRows([state]), ["Codex 5h 69% · week 16% used · 5h reset 08:14"]);
  state.value = parseCodex({ rateLimits: { primary: { usedPercent: 25, windowDurationMins: 300 } } });
  assert.deepEqual(footerRows([state]), ["Codex 5h 25% used"]);
  state.value = parseCodex({ rateLimits: { secondary: codex.rateLimits.secondary } });
  assert.deepEqual(footerRows([state]), ["Codex week 16% used"]);
});

test("compact footer uses two provider rows, short labels, rounded values and stale markers", () => {
  const states: ProviderState[] = [
    { id: "codex", name: "Codex", status: "available", value: parseCodex(codex) },
    { id: "antigravity", name: "Antigravity", status: "available", value: parseAntigravity(ag) },
    { id: "copilot", name: "GitHub Copilot", status: "available", value: parseCopilot({ quota_snapshots: { premium_interactions: { credits_used: 29416 } } }) },
    { id: "cursor", name: "Cursor", status: "error", error: "unavailable", value: parseCursor({ planUsage: { totalPercentUsed: 46.7, autoPercentUsed: 44, apiPercentUsed: 100 } }) },
  ];
  assert.deepEqual(compactFooterRows(states), [
    "Codex 5h-69% wk-16% · AG-G 5h-0% wk-0% · AG-C/G 5h-0% wk-48%",
    "Copilot $294 · Cursor M-47% A-44% API-100%*",
  ]);
  assert.deepEqual(compactFooterRows([]), ["", ""]);
  const tiny: ProviderState = { id: "cursor", name: "Cursor", status: "available", value: parseCursor({ planUsage: { totalPercentUsed: 0.1 } }) };
  assert.deepEqual(compactFooterRows([tiny]), ["", "Cursor M-<1%"]);
  assert.deepEqual(compactFooterRows([{ ...tiny, value: undefined }]), ["", ""]);
});

test("Claude personal footer shows RL with cached weekly usage or an unknown weekly value", () => {
  const state: ProviderState = {
    id: "claude-personal", name: "Claude Personal", status: "error",
    error: "Claude usage refresh rate limited",
  };
  assert.deepEqual(compactFooterRows([state]), ["Claude-P 5h-RL wk-?", ""]);
  const cached: ProviderState = { ...state, value: { kind: "spend", windows: [
    { id: "5h", label: "5h", usedPercent: 84 },
    { id: "week", label: "week", usedPercent: 74 },
  ] } };
  assert.deepEqual(compactFooterRows([cached]), ["Claude-P 5h-RL wk-74%*", ""]);
  assert.match(detailText([cached]), /Reason: Claude usage refresh rate limited/);
  assert.match(detailText([cached]), /Five-hour window [(]5h[)]: 84% used/);
  assert.deepEqual(compactFooterRows([{ ...cached, error: undefined, status: "available" }]), ["Claude-P 5h-84% wk-74%", ""]);
  assert.deepEqual(compactFooterRows([{ ...cached, error: "Read timed out (30 seconds)" }]), ["Claude-P 5h-84% wk-74%*", ""]);
  assert.deepEqual(compactFooterRows([{ ...state, value: { kind: "spend", windows: [
    { id: "week", label: "week", usedPercent: 0 },
  ] } }]), ["Claude-P 5h-RL wk-0%*", ""]);
});

test("Copilot footer converts actual credits to rounded dollar equivalent, preserving raw credits", () => {
  for (const [consumed, display] of [[0, "$0"], [29500, "$295"], [29549, "$295"], [29550, "$296"], [123456, "$1,235"]] as const) {
    const state: ProviderState = { id: "copilot", name: "Copilot", status: "available", value: { kind: "credits", consumed } };
    assert.deepEqual(compactFooterRows([state]), ["", `Copilot ${display}`]);
    assert(detailText([state]).includes(`${consumed.toLocaleString("en-US")} credits consumed`));
    assert.deepEqual(compactFooterRows([{ ...state, error: "unavailable" }]), ["", `Copilot ${display}*`]);
  }
});

test("initial errors omitted from footer; stale successes kept with safe details and localized dates", () => {
  const states: ProviderState[] = [
    { id: "antigravity", name: "Antigravity", status: "error", error: "CLI not installed or not on PATH" },
    { id: "codex", name: "Codex", status: "error", error: "Read timed out (30 seconds)", value: parseCodex(codex), lastAttempt: 1792138480000, lastSuccess: 1792138400000 },
  ];
  assert.deepEqual(footerRows(states), ["Codex 5h 69% · week 16% used · 5h reset 08:14 · stale"]);
  const text = detailText(states);
  assert(text.includes(new Date(1792138480000).toLocaleString()));
  assert(text.includes(new Date(1792138400000).toLocaleString()));
  assert.match(text, /CLI not installed/);
  assert.match(text, /stale/);
  assert.match(text, /Read timed out/);
});
