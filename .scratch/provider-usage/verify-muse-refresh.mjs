import assert from "node:assert/strict";
import { providerReaders } from "../../extensions/lib/provider-usage/readers.ts";
import { compactFooterRows } from "../../extensions/lib/provider-usage/model.ts";

const reader = providerReaders().find((entry) => entry.id === "muse");
assert(reader);
const value = await reader.read(new AbortController().signal);
assert.equal(value.kind, "quota");
const group = value.groups[0];
assert(group.asOf > Date.now() - 120_000, "Muse CLI allowance was observed within two minutes");
assert.deepEqual(group.windows.map((w) => w.id), ["5h", "week"]);
console.log(JSON.stringify({
  observedAt: new Date(group.asOf).toISOString(),
  windows: group.windows,
  footer: compactFooterRows([{ id: reader.id, name: reader.name, status: "available", value }]),
}, null, 2));
