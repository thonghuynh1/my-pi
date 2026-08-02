/** Shared jsdom browser primitives required to render ContextMap in component tests. */
Object.defineProperty(window, "matchMedia", {
	writable: true,
	value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
});
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
	configurable: true,
	value: () => ({
		setTransform: () => {}, scale: () => {}, clearRect: () => {}, fillRect: () => {}, beginPath: () => {},
		closePath: () => {}, fill: () => {}, stroke: () => {}, arc: () => {}, moveTo: () => {}, lineTo: () => {}, arcTo: () => {},
		measureText: () => ({ width: 0 }), fillText: () => {}, drawImage: () => {}, save: () => {}, restore: () => {},
		createLinearGradient: () => ({ addColorStop: () => {} }),
	}),
});
Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 500 });
Object.defineProperty(HTMLCanvasElement.prototype, "getBoundingClientRect", {
	configurable: true,
	value: () => new DOMRect(0, 0, 800, 500),
});
(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class {
	constructor(private readonly callback: ResizeObserverCallback) {}
	observe(target: Element) {
		this.callback([{ contentRect: new DOMRect(0, 0, 800, 500), target } as ResizeObserverEntry], this as unknown as ResizeObserver);
	}
	unobserve() {}
	disconnect() {}
} as unknown as typeof ResizeObserver;
