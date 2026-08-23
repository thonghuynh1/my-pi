import WebSocket, { WebSocketServer } from "ws";
import { PROTOCOL_VERSION } from "../../src/lib/live/protocol";
import type { HelloMessage, PlanMessage, StreamMessage, SyncMessage, WireBlock } from "../../src/lib/live/protocol";
import { blk, mockHarness } from "../fixtures/helpers";
import type { PerfScenario } from "./scenarios";

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
		};
	});
}

export function createHelloFrame(contextWindow = 200_000): HelloMessage {
	return {
		type: "hello",
		protocolVersion: PROTOCOL_VERSION,
		sessionId: "perf-bench",
		meta: {
			title: "Perf Benchmark",
			cwd: "/tmp",
			model: "benchmark",
			contextWindow,
			format: "pi",
		},
	};
}

export function createSyncFrame(
	scenario: PerfScenario,
	blocks = generateBlocks(scenario.setup),
	options: { reqId?: number; full?: boolean } = {},
): SyncMessage {
	return {
		type: "sync",
		reqId: options.reqId ?? 1,
		full: options.full ?? true,
		blocks,
		contextWindow: scenario.setup.contextWindow ?? 200_000,
		harness: mockHarness,
	};
}

function isPlanReply(value: unknown): value is Pick<PlanMessage, "type" | "reqId"> {
	if (typeof value !== "object" || value === null || !("type" in value) || !("reqId" in value)) return false;
	return value.type === "plan" && typeof value.reqId === "number";
}

interface PendingPlan {
	resolve: () => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

/**
 * A small fake extension. The live protocol makes the extension the WebSocket server
 * and the browser app the client, so this class sends frames through the real
 * connectLive() path instead of bypassing the app with direct store hydration.
 */
export class PerfExtensionServer {
	private readonly wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
	private readonly listening: Promise<void>;
	private readonly connected: Promise<void>;
	private resolveConnected: () => void = () => {};
	private socket: WebSocket | null = null;
	private nextReqId = 1;
	private readonly pending = new Map<number, PendingPlan>();

	constructor() {
		this.listening = new Promise<void>((resolve, reject) => {
			this.wss.once("listening", resolve);
			this.wss.once("error", reject);
		});
		this.connected = new Promise<void>((resolve) => {
			this.resolveConnected = resolve;
		});
		this.wss.on("connection", (socket) => this.handleConnection(socket));
	}

	async waitForListening(): Promise<void> {
		await this.listening;
	}

	get port(): number {
		const address = this.wss.address();
		if (address === null || typeof address === "string") throw new Error("Perf WebSocket server is not listening");
		return address.port;
	}

	private handleConnection(socket: WebSocket): void {
		if (this.socket !== null && this.socket.readyState === WebSocket.OPEN) this.socket.close();
		this.socket = socket;
		socket.on("message", (raw) => {
			let parsed: unknown;
			try {
				parsed = JSON.parse(raw.toString());
			} catch {
				return;
			}
			if (!isPlanReply(parsed)) return;
			const pending = this.pending.get(parsed.reqId);
			if (!pending) return;
			clearTimeout(pending.timer);
			this.pending.delete(parsed.reqId);
			pending.resolve();
		});
		socket.on("close", () => {
			if (this.socket !== socket) return;
			this.socket = null;
			const error = new Error("Accordion browser socket closed during performance run");
			for (const [reqId, pending] of this.pending) {
				clearTimeout(pending.timer);
				this.pending.delete(reqId);
				pending.reject(error);
			}
		});
		this.sendFrame(createHelloFrame());
		this.resolveConnected();
	}

	private sendFrame(frame: HelloMessage | StreamMessage | SyncMessage): void {
		if (this.socket === null || this.socket.readyState !== WebSocket.OPEN) throw new Error("Accordion browser is not connected to the perf WebSocket server");
		this.socket.send(JSON.stringify(frame));
	}

	private waitForPlan(reqId: number, timeoutMs = 30_000): Promise<void> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(reqId);
				reject(new Error(`Timed out waiting for plan ${reqId}`));
			}, timeoutMs);
			this.pending.set(reqId, { resolve, reject, timer });
		});
	}

	async waitForConnection(timeoutMs = 15_000): Promise<void> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				this.connected,
				new Promise<never>((_, reject) => {
					timer = setTimeout(() => reject(new Error("Timed out waiting for the Accordion browser to connect")), timeoutMs);
				}),
			]);
		} finally {
			if (timer !== undefined) clearTimeout(timer);
		}
	}

	async sendSync(scenario: PerfScenario, blocks: WireBlock[], full: boolean): Promise<void> {
		const reqId = this.nextReqId++;
		const reply = this.waitForPlan(reqId);
		try {
			this.sendFrame(createSyncFrame(scenario, blocks, { reqId, full }));
		} catch (error) {
			const pending = this.pending.get(reqId);
			if (pending) {
				clearTimeout(pending.timer);
				this.pending.delete(reqId);
			}
			throw error;
		}
		await reply;
	}

	async prepare(scenario: PerfScenario): Promise<void> {
		await this.waitForConnection();
		await this.sendSync(scenario, generateBlocks(scenario.setup), true);
	}

	async runNetworkAction(scenario: PerfScenario): Promise<void> {
		const action = scenario.action;
		switch (action.type) {
			case "append":
				await this.sendSync(
					scenario,
					generateBlocks({ ...scenario.setup, blockCount: action.blocks }, scenario.setup.blockCount),
					false,
				);
				return;
			case "full-reset":
				await this.sendSync(scenario, generateBlocks(scenario.setup), true);
				return;
			case "rapid-fire":
				for (let i = 0; i < action.messages; i++) {
					await this.sendSync(
						scenario,
						generateBlocks({ ...scenario.setup, blockCount: 1 }, scenario.setup.blockCount + i),
						false,
					);
					await new Promise((resolve) => setTimeout(resolve, action.intervalMs));
				}
				return;
			case "idle-with-ghosts":
				this.startGhosts(scenario);
				return;
			case "budget-drag":
			case "group-range":
				return;
			default: {
				const _exhaustive: never = action;
				void _exhaustive;
			}
		}
	}

	private startGhosts(scenario: PerfScenario): void {
		const count = Math.max(1, Math.min(5, Math.ceil((scenario.setup.foldedPct ?? 0) / 10)));
		const kinds: StreamMessage["kind"][] = ["thinking", "text", "tool_call"];
		for (let i = 0; i < count; i++) {
			this.sendFrame({ type: "stream", phase: "start", kind: kinds[i % kinds.length], contentIndex: i });
		}
	}

	stopGhosts(): void {
		if (this.socket === null || this.socket.readyState !== WebSocket.OPEN) return;
		this.sendFrame({ type: "stream", phase: "abort", kind: "text", contentIndex: -1 });
	}

	async close(): Promise<void> {
		const error = new Error("Perf server closed");
		for (const [reqId, pending] of this.pending) {
			clearTimeout(pending.timer);
			this.pending.delete(reqId);
			pending.reject(error);
		}
		this.socket?.terminate();
		this.socket = null;
		await new Promise<void>((resolve) => {
			let done = false;
			let timer: ReturnType<typeof setTimeout>;
			const finish = (): void => {
				if (done) return;
				done = true;
				clearTimeout(timer);
				resolve();
			};
			timer = setTimeout(finish, 1_000);
			try {
				this.wss.close(finish);
			} catch {
				finish();
			}
		});
	}
}

export async function startPerfServer(): Promise<PerfExtensionServer> {
	const server = new PerfExtensionServer();
	await server.waitForListening();
	return server;
}
