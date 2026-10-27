import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { claudeProfiles } from '../../extensions/lib/claude-profiles.ts';
import { CLAUDE_USAGE_REQUEST } from '../../extensions/lib/provider-usage/claude.ts';
import { resolveLaunch, createTreeTerminator } from '../../extensions/lib/provider-usage/readers.ts';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'claude-race-'));
const debug = path.join(tmp, 'debug.log');
const launch = resolveLaunch({ ...CLAUDE_USAGE_REQUEST, args: [...CLAUDE_USAGE_REQUEST.args, '--debug-file', debug] });
const env = { ...process.env, CLAUDE_CONFIG_DIR: claudeProfiles().personal.configDir, DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1', DISABLE_AUTOUPDATER: '1' };
delete env.ANTHROPIC_API_KEY;
delete env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
const child = spawn(launch.file, launch.args, { env, stdio: 'pipe', windowsHide: true, windowsVerbatimArguments: launch.windowsVerbatimArguments });
const start = Date.now();
const snapshots = [];
const timers = [];
let buffer = '';
const send = (id, request) => child.stdin.write(JSON.stringify({ type: 'control_request', request_id: id, request }) + '\n');
try {
  await new Promise((resolve, reject) => {
    timers.push(setTimeout(() => reject(new Error('probe deadline exceeded')), 30000));
    child.once('error', reject);
    child.stderr.on('data', () => {});
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        let message;
        try { message = JSON.parse(line); } catch { reject(new Error('invalid protocol JSON')); return; }
        if (message.type !== 'control_response') continue;
        const response = message.response;
        if (response?.subtype !== 'success') { reject(new Error('control request failed')); return; }
        if (response.request_id === 'init') {
          send('usage-0', { subtype: 'get_usage', skip_behaviors: true });
        } else if (response.request_id?.startsWith('usage-')) {
          const raw = response.response;
          snapshots.push({ elapsedMs: Date.now() - start, available: raw.rate_limits_available, responseKeys: Object.keys(raw), limits: raw.rate_limits });
          if (response.request_id === 'usage-0') {
            for (const delay of [2000, 6000, 12000]) timers.push(setTimeout(() => send('usage-' + delay, { subtype: 'get_usage', skip_behaviors: true }), delay));
          }
          if (response.request_id === 'usage-12000') resolve();
        }
      }
    });
    send('init', { subtype: 'initialize' });
  });
  const log = await readFile(debug, 'utf8').catch(() => '');
  const diagnostics = log.split(/\r?\n/).filter(line => /fetchUtilization|usage.*(cache|fail|error)|utilization.*(cache|fail|error)/i.test(line)).map(line => line.replace(/https?:\/\/[^\s]+/g, '[url]').slice(0, 350));
  const report = JSON.stringify({ verifiedAt: new Date().toISOString(), snapshots, diagnostics }, null, 2);
  await writeFile('.scratch/provider-usage/refresh-race-evidence.json', report + '\n');
  console.log(report);
} finally {
  timers.forEach(clearTimeout);
  await createTreeTerminator()(child);
  await rm(tmp, { recursive: true, force: true });
}
