import type { Model, Provider } from "@earendil-works/pi-ai";
import { createProvider } from "@earendil-works/pi-ai/models";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { BUILTIN_CODEX } from "./codex-accounts.ts";

let builtin: Provider | undefined;

function builtinCodex(): Provider {
  builtin ??= builtinProviders().find((provider) => provider.id === BUILTIN_CODEX);
  if (!builtin) throw new Error("Pi's built-in openai-codex provider is unavailable");
  return builtin;
}

// A clone shares the built-in login flow, refresh, and transport; only the
// provider id (and so its auth.json slot) differs. `models` should be the live
// openai-codex catalog; the built-in static list is the fallback.
export function createCodexCloneProvider(id: string, name: string, models: readonly object[]): Provider {
  const base = builtinCodex();
  const source = models.length > 0 ? models : base.getAllModels?.() ?? base.getModels();
  return createProvider({
    id,
    name,
    baseUrl: base.baseUrl,
    headers: base.headers,
    auth: base.auth,
    models: source.map((model) => ({ ...model, provider: id })) as unknown as Model<string>[],
    api: {
      stream: (model, context, options) => base.stream(model, context, options),
      streamSimple: (model, context, options) => base.streamSimple(model, context, options),
    },
  });
}
