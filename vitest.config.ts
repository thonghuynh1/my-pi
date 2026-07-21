import base from "./extensions/accordion/app/vitest.config.ts";

export default {
	...base,
	test: {
		...base.test,
		include: ["extensions/accordion/app/src/lib/**/*.test.ts", "extensions/accordion/extension/**/*.test.ts"],
		setupFiles: ["./extensions/accordion/app/src/lib/test/setup-component.ts"],
		testTimeout: 30_000,
	},
};
