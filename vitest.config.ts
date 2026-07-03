import base from "./vendor/accordion/app/vitest.config.ts";

export default {
	...base,
	test: {
		...base.test,
		include: ["vendor/accordion/app/src/lib/**/*.test.ts", "vendor/accordion/extension/**/*.test.ts"],
		testTimeout: 30_000,
	},
};
