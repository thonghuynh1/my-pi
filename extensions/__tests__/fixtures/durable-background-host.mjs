import { spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { join } from "node:path";
// Deliberately skip extension cleanup to simulate an abrupt host exit.
const diagnostics = openSync(join(process.argv[3], "supervisor.log"), "a", 0o600);
const child = spawn(process.execPath, [process.argv[2], process.argv[3]], { detached: true, stdio: ["ignore", diagnostics, diagnostics], windowsHide: true });
closeSync(diagnostics);
child.unref();
process.exit(3);
