import base from "./extensions/accordion/app/vitest.config.ts";

export default {
	...base,
	test: {
		...base.test,
		include: ["extensions/accordion/app/src/lib/**/*.test.ts"],
		exclude: ["extensions/accordion/app/src/lib/ui/**", "**/node_modules/**"],
		setupFiles: [],
		testTimeout: 120_000,
	},
};
