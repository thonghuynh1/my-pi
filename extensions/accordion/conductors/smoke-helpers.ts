import WebSocket from "ws";

export async function connectWhenReady(port: number): Promise<WebSocket> {
	const deadline = Date.now() + 8_000;
	let lastError: Error | undefined;
	while (Date.now() < deadline) {
		const ws = new WebSocket(`ws://127.0.0.1:${port}`);
		try {
			await new Promise<void>((resolve, reject) => {
				ws.once("open", resolve);
				ws.once("error", reject);
			});
			return ws;
		} catch (error) {
			lastError = error as Error;
			ws.close();
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}
	throw lastError ?? new Error(`timed out waiting for conductor on port ${port}`);
}
