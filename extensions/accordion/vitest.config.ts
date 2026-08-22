import { fileURLToPath } from "node:url";
import base from "./app/vitest.config.ts";

export default {
	...base,
	root: fileURLToPath(new URL("./app", import.meta.url)),
};
