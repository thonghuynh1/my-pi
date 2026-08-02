import WebSocket from "ws";
import { blk, mockHarness } from "../fixtures/helpers";
import type { WireBlock } from "../../src/lib/live/protocol";
import type { PerfScenario } from "./scenarios";

export interface PerfHello {
	type: "hello";
	protocolVersion: 1;
	sessionId: string;
	meta: { title: string; cwd: string; model: string; contextWindow: number };
}

export interface PerfSync {
	type: "sync";
	reqId: number;
	full: true;
	blocks: WireBlock[];
	contextWindow: number;
	harness: typeof mockHarness;
}

export function generateBlocks(setup: PerfScenario["setup"], start = 0): WireBlock[] {
	const tokens = setup.tokensPerBlock ?? 150;
	return Array.from({ length: setup.blockCount }, (_, offset) => {
		const block = blk(start + offset, "text", tokens);
		return {
			id: block.id,
			kind: block.kind,
			turn: block.turn,
			order: block.order,
			text: block.text,
			tokens: block.tokens,
			proactivelyCompressed: false,
		};
	});
}

export function createHelloFrame(): PerfHello {
	return {
		type: "hello",
		protocolVersion: 1,
		sessionId: "perf-bench",
		meta: { title: "Perf Benchmark", cwd: "/tmp", model: "benchmark", contextWindow: 200_000 },
	};
}

export function createSyncFrame(scenario: PerfScenario, blocks = generateBlocks(scenario.setup)): PerfSync {
	return { type: "sync", reqId: 1, full: true, blocks, contextWindow: 200_000, harness: mockHarness };
}

export class PerfInjector {
	private nextReqId = 1;
	private readonly pending = new Map<number, (value: unknown) => void>();

	constructor(private readonly ws: WebSocket) {
		ws.on("message", (raw) => {
			try {
				const message: unknown = JSON.parse(raw.toString());
				if (typeof message === "object" && message !== null && "reqId" in message && typeof message.reqId === "number") {
					this.pending.get(message.reqId)?.(message);
					this.pending.delete(message.reqId);
				}
			} catch {
				// Ignore non-JSON frames. The protocol response still controls completion.
			}
		});
	}

	private send(message: object): void {
		this.ws.send(JSON.stringify(message));
	}

	waitForPlan(reqId: number, timeoutMs = 10_000): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(reqId);
				reject(new Error(`Timed out waiting for plan ${reqId}`));
			}, timeoutMs);
			this.pending.set(reqId, (message) => {
				clearTimeout(timer);
				resolve(message);
			});
		});
	}

	async sendSync(blocks: WireBlock[], full = true): Promise<void> {
		const reqId = this.nextReqId++;
		const reply = this.waitForPlan(reqId);
		this.send({ ...createSyncFrame({ setup: { blockCount: 0 }, name: "sync", action: { type: "full-reset" }, thresholds: {} }, blocks), reqId, full });
		await reply;
	}

	async run(scenario: PerfScenario): Promise<void> {
		const action = scenario.action;
		this.send(createHelloFrame());
		await this.sendSync(generateBlocks(scenario.setup));
		if (action.type === "append") {
			await this.sendSync(generateBlocks({ ...scenario.setup, blockCount: action.blocks }, scenario.setup.blockCount), false);
		} else if (action.type === "full-reset") {
			await this.sendSync(generateBlocks(scenario.setup));
		} else if (action.type === "rapid-fire") {
			for (let i = 0; i < action.messages; i++) {
				await this.sendSync(generateBlocks({ ...scenario.setup, blockCount: 1 }, scenario.setup.blockCount + i), false);
				await new Promise((resolve) => setTimeout(resolve, action.intervalMs));
			}
		}
	}
}

export async function connectInjector(url: string): Promise<{ socket: WebSocket; injector: PerfInjector }> {
	const socket = new WebSocket(url);
	await new Promise<void>((resolve, reject) => {
		socket.once("open", resolve);
		socket.once("error", () => reject(new Error(`Could not connect to app at ${url}. Is the app running?`)));
	});
	return { socket, injector: new PerfInjector(socket) };
}
