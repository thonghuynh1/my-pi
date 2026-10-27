import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { claudeProfiles } from '../../extensions/lib/claude-profiles.ts';
import { readClaudeUsageAt } from '../../extensions/lib/provider-usage/claude.ts';
import { createProcessRunner } from '../../extensions/lib/provider-usage/readers.ts';
const events = [];
const runner = createProcessRunner({ spawn(launch) {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: claudeProfiles().personal.configDir, DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1', DISABLE_AUTOUPDATER: '1' };
  delete env.ANTHROPIC_API_KEY; delete env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
  const child = spawn(launch.file, [...launch.args, '--debug-to-stderr'], { env, stdio: 'pipe', windowsHide: true, windowsVerbatimArguments: launch.windowsVerbatimArguments });
  let buffer = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (/fetchUtilization|Failed to load usage data|Usage read answered from a snapshot/.test(line)) events.push({ stream: 'stderr', line: line.slice(0, 350) });
    }
  });
  child.stdout.on('data', chunk => { if (chunk.toString().includes('usage-read')) events.push({ stream: 'stdout', event: 'usage response' }); });
  return child;
} });
const raw = await readClaudeUsageAt(runner, AbortSignal.timeout(35000), claudeProfiles().personal.configDir);
const report = JSON.stringify({ verifiedAt: new Date().toISOString(), raw, events }, null, 2);
await writeFile('.scratch/provider-usage/stderr-order-evidence.json', report + '\n');
console.log(report);
