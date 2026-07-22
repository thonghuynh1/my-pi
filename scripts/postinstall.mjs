import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function run(cmd) {
	console.log(`postinstall: ${cmd}`);
	execSync(cmd, { cwd: root, stdio: "inherit" });
}

if (
	!existsSync(join(root, "extensions", "accordion", "app", "node_modules")) ||
	!existsSync(join(root, "extensions", "accordion", "extension", "node_modules"))
) {
	run("npm run accordion:install");
}

if (!existsSync(join(root, "extensions", "accordion", "app", "build", "index.html"))) {
	run("npm run accordion:build");
}
