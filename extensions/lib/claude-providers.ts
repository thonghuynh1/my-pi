import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CLAUDE_BRIDGE, claudeLoginSteps, claudeProfiles, isProfileReady, withClaudeProfileEnv, type ClaudeProfile } from "./claude-profiles.ts";

// pi-claude-bridge stores the streamSimple that owns its session state here
// (first loaded instance wins). Clones route through it so every account
// shares one bridge, one session map, and one prompt-cache strategy.
const ACTIVE_STREAM_SIMPLE = Symbol.for("claude-bridge:activeStreamSimple");

type StreamSimple = (model: unknown, context: unknown, options?: unknown) => unknown;
type ModelConfig = { readonly id: string };
type BridgeRegistry = { getRegisteredProviderConfig(provider: string): { streamSimple?: unknown } | undefined };

// The bridge clears ACTIVE_STREAM_SIMPLE on /new, /resume and fork and never
// sets it again, so fall back to the streamSimple its provider registered in
// the current session's registry (same function, same session state).
let bridgeRegistry: BridgeRegistry | undefined;

export function bindBridgeRegistry(registry: BridgeRegistry | undefined): void {
  bridgeRegistry = registry;
}

function resolveBridge(): StreamSimple | undefined {
  const active = (globalThis as Record<symbol, StreamSimple | undefined>)[ACTIVE_STREAM_SIMPLE];
  if (active) return active;
  const registered = bridgeRegistry?.getRegisteredProviderConfig(CLAUDE_BRIDGE)?.streamSimple;
  return typeof registered === "function" ? (registered as StreamSimple) : undefined;
}

// Load-time fallback, mirroring the bridge's own projection: bare (undated)
// anthropic ids with zeroed prices. Replaced by the live claude-bridge list
// once a session starts.
export function fallbackBridgeModels(): ModelConfig[] {
  return getBuiltinModels("anthropic")
    .filter((m) => !/-20\d{6}$/.test(m.id))
    .map(({ id, name, reasoning, input, contextWindow, maxTokens, thinkingLevelMap }) => ({
      id, name, reasoning, input, contextWindow, maxTokens, thinkingLevelMap,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }));
}

// The bridge only replays thinking signatures from messages labeled
// claude-bridge; relabel this clone's own messages so it keeps them.
export function relabelForBridge<T>(context: T, provider: string): T {
  const messages = (context as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return context;
  return {
    ...context,
    messages: messages.map((msg) => (msg?.role === "assistant" && msg.provider === provider ? { ...msg, provider: CLAUDE_BRIDGE } : msg)),
  };
}

export function claudeCloneConfig(profile: ClaudeProfile, models: readonly ModelConfig[]) {
  return {
    name: `Claude Code · ${profile.name}`,
    // baseUrl stays "claude-bridge": the bridge keys its tool UI off it. The
    // api gets its own name so this handler never replaces the bridge's.
    baseUrl: CLAUDE_BRIDGE,
    apiKey: "not-used",
    api: profile.provider,
    models: models.map((model) => {
      const { provider: _p, api: _a, baseUrl: _b, ...rest } = model as Record<string, unknown>;
      return rest;
    }),
    streamSimple: (model: unknown, context: unknown, options?: unknown) => {
      if (!profile.useApiKey && !isProfileReady(profile.configDir)) {
        throw new Error(`${profile.name} is not logged in (${profile.configDir}).\n${claudeLoginSteps(profile.configDir)}`);
      }
      const bridge = resolveBridge();
      if (!bridge) throw new Error("pi-claude-bridge is not loaded; Claude accounts need it");
      return withClaudeProfileEnv(profile, () => bridge(model, relabelForBridge(context, profile.provider), options));
    },
  };
}

const registered = new Set<string>();

// Registers claude-bridge-N for every non-bridge profile and drops clones
// whose profile was removed.
export function registerClaudeClones(pi: ExtensionAPI, models: readonly ModelConfig[] = fallbackBridgeModels()): void {
  const clones = claudeProfiles().filter((profile) => profile.provider !== CLAUDE_BRIDGE);
  for (const provider of registered) {
    if (!clones.some((profile) => profile.provider === provider)) {
      pi.unregisterProvider(provider);
      registered.delete(provider);
    }
  }
  for (const profile of clones) {
    try {
      pi.registerProvider(profile.provider, claudeCloneConfig(profile, models) as never);
      registered.add(profile.provider);
    } catch (error) {
      console.warn(`[account] could not register ${profile.provider}: ${(error as Error).message}`);
    }
  }
}
