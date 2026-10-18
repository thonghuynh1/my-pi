/** Cooperative policy only: Pi owns consent, deadlines, replay, requests and billing. */
import { VERSION, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

const OWNER_CHANNEL = "my-pi:background-cache-warming:v1:owner";
const COLLECT_CHANNEL = "my-pi:background-cache-warming:v1:collect";
const MINIMUM_SAVINGS_USD = 0.05;

/** Conservative capability floor verified against the public Pi 1.3.0 contract. */
export function supportsNativeCacheWarming(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return !!match && (Number(match[1]) > 1 || (Number(match[1]) === 1 && Number(match[2]) >= 3));
}

export function backgroundCacheWarmingOptedOut(value: string | undefined): boolean {
  return /^(0|false|no|off)$/i.test((value ?? "").trim());
}

export function commandExpectsContinuation(job: { status: string; notifyOnFinish: boolean }): boolean {
  return job.status === "running" && job.notifyOnFinish;
}

// Both modes: joined blocks the parent; detached results automatically wake it.
export function subagentExpectsContinuation(job: { status: string }): boolean {
  return job.status === "running";
}

// SDK 0.84.x does not type this public host event. Keep the compatibility cast
// at registration, rather than weakening ExtensionAPI or importing host internals.
export interface NativeCacheWarmingDecision {
  type: "cache_warming_decision";
  action: "warm" | "stop";
  warmCost?: number;
  missCost?: number;
  continuationProbability?: number;
}
type WarmOverride = { action: "warm" } | undefined;
type DecisionHandler = (event: NativeCacheWarmingDecision, ctx: ExtensionContext) => WarmOverride;

export function backgroundWarmingDecision(
  event: NativeCacheWarmingDecision, expectedContinuation: boolean, optOut: string | undefined,
): WarmOverride {
  if (!expectedContinuation || backgroundCacheWarmingOptedOut(optOut)) return undefined;
  const { warmCost, missCost } = event;
  if (typeof warmCost !== "number" || !Number.isFinite(warmCost) || warmCost < 0 ||
      typeof missCost !== "number" || !Number.isFinite(missCost) || missCost <= 0) return undefined;
  // P(continuation)=1 is the only changed assumption. Preserve Pi's $0.05 floor.
  if (missCost - warmCost < MINIMUM_SAVINGS_USD || event.action === "warm") return undefined;
  return { action: "warm" };
}

interface Collection { sessionId: string; expectedContinuation: boolean }
interface Claim { claimed: boolean }
function sessionId(ctx: ExtensionContext): string | undefined {
  const id = ctx.sessionManager?.getSessionId?.();
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

/**
 * Synchronous pi.events handshake elects one active decision owner independent of
 * load order/module identity. Providers answer only for their bound session.
 * No timers, model requests, settings access, or runtime globals are involved.
 */
export function registerBackgroundCacheWarming(
  pi: ExtensionAPI, hasExpectedContinuation: () => boolean, hostVersion = VERSION,
): { bind(ctx: ExtensionContext): void; clear(): void; nativeSupported: boolean } {
  const nativeSupported = supportsNativeCacheWarming(hostVersion);
  let bound: { ctx: ExtensionContext; id: string } | undefined;
  let owner = false;
  let hookRegistered = false;
  let unsubscribeOwner: (() => void) | undefined;
  let unsubscribeProvider: (() => void) | undefined;

  const clear = () => { bound = undefined; };
  function enable(): void {
    // Real SDKs expose events; tolerate minimal old-host/test adapters without it.
    if (!nativeSupported || !pi.events || unsubscribeProvider) return;
    unsubscribeProvider = pi.events.on(COLLECT_CHANNEL, (data) => {
      const request = data as Collection;
      if (!bound || request.sessionId !== bound.id || sessionId(bound.ctx) !== bound.id) return;
      try {
        if (hasExpectedContinuation()) request.expectedContinuation = true;
      } catch { /* An unavailable registry must never force a paid refresh. */ }
    });
    const claim: Claim = { claimed: false };
    pi.events.emit(OWNER_CHANNEL, claim);
    if (claim.claimed) return;
    owner = true;
    unsubscribeOwner = pi.events.on(OWNER_CHANNEL, (data) => { (data as Claim).claimed = true; });
    if (hookRegistered) return;
    hookRegistered = true;
    const onDecision = pi.on as unknown as (name: "cache_warming_decision", handler: DecisionHandler) => void;
    onDecision("cache_warming_decision", (event, ctx) => {
      if (!owner) return undefined;
      const id = sessionId(ctx);
      if (!id) return undefined;
      const request: Collection = { sessionId: id, expectedContinuation: false };
      pi.events.emit(COLLECT_CHANNEL, request);
      return backgroundWarmingDecision(event, request.expectedContinuation, process.env.PI_BACKGROUND_CACHE_WARMING);
    });
  }
  enable();
  pi.on("session_start", () => { clear(); enable(); });
  pi.on("session_shutdown", () => {
    clear();
    unsubscribeProvider?.(); unsubscribeProvider = undefined;
    unsubscribeOwner?.(); unsubscribeOwner = undefined;
    owner = false;
  });
  return {
    nativeSupported, clear,
    bind(ctx) {
      clear();
      const id = sessionId(ctx);
      if (id) bound = { ctx, id };
    },
  };
}
