import { SharedUsageCache, type SharedObservation } from "./shared-cache.ts";
import type { ProviderId, ProviderState, UsageMetric } from "./model.ts";
import { providerReaders, UsageReadError, type ProviderReader } from "./readers.ts";

export interface MonitorClock {
  now(): number;
  every(callback: () => void, ms: number): unknown;
  after(callback: () => void, ms: number): unknown;
  cancelEvery(handle: unknown): void;
  cancelAfter(handle: unknown): void;
}
const clock: MonitorClock = {
  now: Date.now,
  every: (cb, ms) => setInterval(cb, ms),
  after: (cb, ms) => setTimeout(cb, ms),
  cancelEvery: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  cancelAfter: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
export class ProviderUsageMonitor {
  private states: ProviderState[];
  private listeners = new Set<() => void>();
  private pending = new Map<ProviderId, { promise: Promise<void>; controller: AbortController; cancelTimeout(): void }>();
  private timer: unknown;
  private running = false;
  private generation = 0;
  private readers: ProviderReader[];
  private clock: MonitorClock;
  private sharedCache: Pick<SharedUsageCache, "read">;

  constructor(readers = providerReaders(), timerClock = clock, sharedCache: Pick<SharedUsageCache, "read"> = new SharedUsageCache()) {
    this.readers = readers;
    this.clock = timerClock;
    this.sharedCache = sharedCache;
    this.states = readers.map(({ id, name, experimental }) => ({ id, name, experimental, status: "error", error: "Not refreshed yet" }));
  }
  snapshot(): readonly ProviderState[] { return this.states; }
  subscribe(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => { this.listeners.delete(callback); };
  }
  private update(id: ProviderId, patch: Partial<ProviderState>): void {
    this.states = this.states.map((state) => state.id === id ? { ...state, ...patch } : state);
    for (const listener of this.listeners) listener();
  }
  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = this.clock.every(() => { void this.refresh(); }, 300_000);
    void this.refresh();
  }
  stop(): void {
    this.running = false;
    this.generation++;
    if (this.timer !== undefined) this.clock.cancelEvery(this.timer);
    this.timer = undefined;
    const interrupted = new Set(this.pending.keys());
    for (const { controller, cancelTimeout } of this.pending.values()) { cancelTimeout(); controller.abort(); }
    this.states = this.states.map((state) => interrupted.has(state.id)
      ? { ...state, status: "error", error: "Read canceled (monitor stopped)" }
      : state);
    this.pending.clear();
  }
  refresh(): Promise<void> {
    return Promise.all(this.readers.map((reader) => this.refreshOne(reader))).then(() => {});
  }
  private refreshOne(reader: ProviderReader): Promise<void> {
    const existing = this.pending.get(reader.id);
    if (existing) return existing.promise;
    const generation = this.generation;
    const controller = new AbortController();
    let timeout: unknown;
    let abortListener: () => void;
    const canceled = new Promise<never>((_resolve, reject) => {
      abortListener = () => reject(new UsageReadError("Read canceled"));
      controller.signal.addEventListener("abort", abortListener, { once: true });
      timeout = this.clock.after(() => {
        reject(new UsageReadError("Read timed out (30 seconds)"));
        controller.abort();
      }, 30_000);
    });
    // Invoke readers in a microtask so synchronous readers still share the same pending entry.
    const promise = Promise.race<UsageMetric | SharedObservation>([Promise.resolve().then<UsageMetric | SharedObservation>(() => {
      if (controller.signal.aborted) throw new UsageReadError("Read canceled");
      return reader.scope ? this.sharedCache.read(reader, controller.signal) : reader.read(controller.signal);
    }), canceled]).then((value) => {
      if (generation !== this.generation || controller.signal.aborted) return;
      if ("status" in value) {
        this.update(reader.id, { status: value.status, value: value.value, lastAttempt: value.lastAttempt,
          lastSuccess: value.lastSuccess, error: value.status === "error" ? value.error : undefined });
      } else this.update(reader.id, { status: "available", value, lastSuccess: this.clock.now(), error: undefined });
    }, (error: unknown) => {
      if (generation !== this.generation) return;
      const reason = error instanceof UsageReadError ? error.message : "Usage fields unavailable or CLI read failed";
      this.update(reader.id, { status: "error", error: reason, ...(reader.scope ? { value: undefined, lastSuccess: undefined } : {}) });
    }).finally(() => {
      this.clock.cancelAfter(timeout);
      controller.signal.removeEventListener("abort", abortListener);
      if (this.pending.get(reader.id)?.controller === controller) this.pending.delete(reader.id);
    });
    this.pending.set(reader.id, { promise, controller, cancelTimeout: () => this.clock.cancelAfter(timeout) });
    this.update(reader.id, { status: "loading", ...(reader.scope ? {} : { lastAttempt: this.clock.now() }) });
    return promise;
  }
}
