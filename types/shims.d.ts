declare const process: any;
declare const Buffer: any;
declare const __dirname: string | undefined;
declare const console: any;

declare function require(id: string): any;
declare function setTimeout(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): any;
declare function clearTimeout(timeoutId: any): void;

declare namespace NodeJS {
	interface Timeout {}
	interface ErrnoException extends Error {
		code?: string;
	}
}

declare module "@earendil-works/pi-coding-agent" {
	export interface ExtensionContext {
		hasUI: boolean;
		mode?: string;
		ui: {
			notify: (...args: any[]) => any;
			setStatus: (...args: any[]) => any;
			setWidget: (...args: any[]) => any;
			setFooter: (...args: any[]) => any;
			custom: <T>(factory: (...args: any[]) => any, options?: any) => Promise<T>;
		};
		[key: string]: any;
	}

	export interface ExtensionCommandContext extends ExtensionContext {}

	export interface ExtensionAPI {
		on(event: string, handler: (event: any, ctx: ExtensionContext) => any): void;
		registerCommand(name: string, options: { description?: string; handler: (args: string | undefined, ctx: ExtensionCommandContext) => any }): void;
		registerTool(...args: any[]): any;
		getThinkingLevel(...args: any[]): any;
		getActiveTools(...args: any[]): any;
		setActiveTools(...args: any[]): any;
		[key: string]: any;
	}

	export type Theme = any;
	export type TurnEndEvent = any;
	export const SessionManager: any;
	export type ToolDefinition<P = any, R = any> = any;
	export const createAgentSessionFromServices: any;
	export const createAgentSessionServices: any;
	export const createBashTool: any;
	export const createEditTool: any;
	export const createFindTool: any;
	export const createGrepTool: any;
	export const createLsTool: any;
	export const createReadTool: any;
	export const createWriteTool: any;
	export const getAgentDir: any;
	export const getSelectListTheme: any;
	export const getSettingsListTheme: any;
	export const keyText: any;
	export function parseFrontmatter<T = Record<string, unknown>>(content: string): { frontmatter: T; body: string };
}

declare module "@earendil-works/pi-ai" {
	export type Message = any;
	export const StringEnum: any;
}

declare module "@earendil-works/pi-tui" {
	export class Container {
		constructor(...args: any[]);
		addChild(...args: any[]): void;
		clear(...args: any[]): void;
		render(...args: any[]): any;
	}
	export class Input {
		constructor(...args: any[]);
		onSubmit?: (...args: any[]) => any;
		getValue(...args: any[]): string;
		handleInput(...args: any[]): void;
		value?: string;
	}
	export class SelectList {
		constructor(...args: any[]);
		getSelectedItem(): any;
		setSelectedIndex(...args: any[]): void;
		handleInput(...args: any[]): void;
		onSelect?: (...args: any[]) => any;
		onCancel?: (...args: any[]) => any;
	}
	export class SettingsList {
		constructor(...args: any[]);
		handleInput(...args: any[]): void;
	}
	export class Spacer {
		constructor(...args: any[]);
	}
	export class Text {
		constructor(...args: any[]);
	}
	export type SelectItem = any;
	export type SettingItem = any;
	export const getKeybindings: any;
	export const matchesKey: any;
	export const truncateToWidth: any;
	export const visibleWidth: any;
	export const wrapTextWithAnsi: any;
}

declare module "typebox" {
	export const Type: any;
	export type Static<T> = any;
}

declare module "playwright-core" {
	export const chromium: any;
	export type Browser = any;
	export type BrowserContext = any;
	export type ConsoleMessage = any;
	export type Page = any;
	export type Request = any;
}

declare module "ws" {
	export class WebSocket {
		static OPEN: number;
		OPEN: number;
		readyState: number;
		send(...args: any[]): any;
		on(...args: any[]): any;
		close(...args: any[]): any;
	}
	export class WebSocketServer {
		constructor(...args: any[]);
		clients: Set<WebSocket>;
		on(...args: any[]): any;
		close(...args: any[]): any;
	}
}

declare module "ffmpeg-static" {
	const ffmpegPath: string;
	export default ffmpegPath;
}

declare module "node:fs" {
	export type Dirent = any;
	export const appendFileSync: (...args: any[]) => void;
	export const existsSync: (...args: any[]) => boolean;
	export const mkdirSync: (...args: any[]) => any;
	export const mkdtempSync: (...args: any[]) => string;
	export const readdirSync: (...args: any[]) => any[];
	export const readFileSync: (...args: any[]) => string;
	export const rmSync: (...args: any[]) => void;
	export const statSync: (...args: any[]) => any;
	export const writeFileSync: (...args: any[]) => void;
	const fs: any;
	export default fs;
}

declare module "fs" {
	export * from "node:fs";
	const fs: any;
	export default fs;
}

declare module "node:path" {
	export const basename: (...args: any[]) => string;
	export const dirname: (...args: any[]) => string;
	export const extname: (...args: any[]) => string;
	export const isAbsolute: (...args: any[]) => boolean;
	export const join: (...args: any[]) => string;
	export const normalize: (...args: any[]) => string;
	export const resolve: (...args: any[]) => string;
	export const sep: string;
	const path: any;
	export default path;
}

declare module "path" {
	export * from "node:path";
	const path: any;
	export default path;
}

declare module "node:os" {
	export const homedir: (...args: any[]) => string;
	export const tmpdir: (...args: any[]) => string;
}

declare module "os" {
	export * from "node:os";
}

declare module "node:child_process" {
	export const execSync: any;
	export const spawn: any;
	export const spawnSync: any;
	export type ChildProcess = any;
	export type ChildProcessWithoutNullStreams = any;
}

declare module "node:url" {
	export const fileURLToPath: (...args: any[]) => string;
}

declare module "node:http" {
	export const createServer: any;
	export type IncomingMessage = any;
	export type Server = any;
	export type ServerResponse = any;
}
