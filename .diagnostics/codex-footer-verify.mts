import assert from "node:assert/strict";
import { ModelRuntime, ModelRegistry } from "@earendil-works/pi-coding-agent";
const { ReadOnlyAuthStorage } = await import(new URL("./core/auth-storage.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
import { providerReaders } from "../extensions/lib/provider-usage/readers.ts";
import { ProviderUsageMonitor } from "../extensions/lib/provider-usage/monitor.ts";
import { SharedUsageCache } from "../extensions/lib/provider-usage/shared-cache.ts";
import { installUsageFooter } from "../extensions/usage-footer.ts";
import { detailText } from "../extensions/lib/provider-usage/model.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const runtime = await ModelRuntime.create({ credentials: new ReadOnlyAuthStorage(), modelsPath: null, refreshOnCreate: false });
const registry = new ModelRegistry(runtime);
const apiKey = async () => {
  const auth = await registry.getProviderAuth("openai-codex");
  assert(auth?.source === "OAuth" && auth.auth.apiKey);
  return auth.auth.apiKey;
};
const root = await mkdtemp(join(tmpdir(), "codex-footer-proof-"));
try {
  const readers = providerReaders(undefined, undefined, undefined, undefined, {codexApiKey: apiKey}).filter(r => r.id === "codex");
  const monitor = new ProviderUsageMonitor(readers, undefined, new SharedUsageCache({root}));
  await monitor.refresh();
  assert.equal(monitor.snapshot()[0].status, "available");
  let component: any;
  const ctx: any = {mode:"tui",hasUI:true,model:{provider:"openai-codex",id:"live-proof"},getContextUsage:()=>undefined,sessionManager:{getBranch:()=>[]},
    ui:{setFooter:(factory:any)=>{component=factory({requestRender(){}},{fg:(_:string,value:string)=>value});}}};
  installUsageFooter({getThinkingLevel:()=>"medium"} as any, ctx, monitor);
  const lines = component.render(180);
  assert.equal(lines.length, 3);
  assert.match(lines[1], /Codex 5h-\d+% wk-\d+%/);
  assert(!lines.join("\n").includes("43200m"));
  console.log("PASS live Pi OAuth -> account-scoped cache -> actual 3-line footer");
  console.log(lines.join("\n"));
  console.log(detailText(monitor.snapshot()));
  component.dispose(); monitor.stop();
} finally { await rm(root,{recursive:true,force:true}); }
