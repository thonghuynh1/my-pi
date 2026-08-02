import base from "../app/vitest.config.ts";

export default {
	...base,
	test: {
		...base.test,
		include: ["**/*.test.ts"],
		exclude: ["**/node_modules/**"],
		setupFiles: [],
		testTimeout: 10_000,
	},
};
