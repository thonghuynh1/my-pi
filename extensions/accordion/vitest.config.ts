import base from "./app/vitest.config.ts";

export default {
	...base,
	test: {
		...base.test,
		include: ["app/src/lib/**/*.test.ts", "extension/**/*.test.ts"],
		environmentMatchGlobs: [
			["app/src/lib/ui/**/*.test.ts", "jsdom"],
			["app/src/lib/**/*.svelte.test.ts", "jsdom"],
		],
		setupFiles: ["./app/src/lib/test/setup-component.ts"],
	},
};
