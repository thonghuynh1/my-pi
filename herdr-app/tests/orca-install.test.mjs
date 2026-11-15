import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installOrca, orcaMods } from '../orca/install.mjs';

const missing = async path => { try { await access(path); return false; } catch { return true; } };
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'herdr-orca-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, 'home'); await mkdir(target);
  return { target };
}

test('installs the orca bundle scoped: mods, layout, bundle tooling, layout-only keys', async t => {
  const { target } = await fixture(t), calls = [];
  await writeFile(join(target, 'keys.json'), JSON.stringify({ global: { 'ctrl-t': 'tab.new' }, 'layout:orca': { 'cmd-w': 'mine.first' } }));
  await writeFile(join(target, 'shared.json'), 'personal state');
  const result = await installOrca({ target, activate: true, run: args => calls.push(args) });
  assert.ok(JSON.parse(await readFile(join(target, 'layouts', 'orca.json'), 'utf8')));
  assert.ok(JSON.parse(await readFile(join(target, 'bundles', 'orca', 'manifest.json'), 'utf8')));
  assert.equal(await missing(join(target, 'mods', 'automations')), true, 'automations mod is not installed');
  assert.equal(await missing(join(target, 'bundles', 'orca', 'src')), true, 'no Go source is installed');
  for (const name of orcaMods) assert.match(await readFile(join(target, 'mods', name, 'main.js'), 'utf8'), /class|View/);
  const keys = JSON.parse(await readFile(join(target, 'keys.json'), 'utf8'));
  assert.equal(keys.global['ctrl-t'], 'tab.new', 'other sections untouched');
  assert.equal(keys['layout:orca']['cmd-w'], 'mine.first', 'an existing binding wins over the bundle');
  assert.ok(keys['layout:orca']['cmd-n'], 'missing chords are merged in');
  assert.deepEqual(result.conflicts, ['cmd-w']);
  assert.equal(await readFile(join(target, 'shared.json'), 'utf8'), 'personal state');
  assert.equal(calls.filter(args => args[0] === 'check').length, orcaMods.length);
  assert.deepEqual(calls.at(-1), ['do', 'layout.switch', '--name', 'orca']);
});

test('failed checks restore the previous keys and remove newly installed mods', async t => {
  const { target } = await fixture(t);
  await writeFile(join(target, 'keys.json'), '{"global":{}}');
  await assert.rejects(
    installOrca({ target, run: args => { if (args[0] === 'check') throw new Error('broken render'); } }),
    /previous files restored/,
  );
  assert.equal(await readFile(join(target, 'keys.json'), 'utf8'), '{"global":{}}');
  assert.equal(await missing(join(target, 'mods', 'better-sidebar')), true);
  assert.equal(await missing(join(target, 'layouts', 'orca.json')), true);
});
