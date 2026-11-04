import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access, cp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { install, mods, keyMods, restore } from '../install.mjs';

const bundle = dirname(dirname(fileURLToPath(import.meta.url)));
const missing = async path => { try { await access(path); return false; } catch { return true; } };
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'herdr-workspace-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, 'home'); await mkdir(target);
  return {root, target};
}

test('installs all managed assets, validates before activation, preserves personal state', async t => {
  const {target} = await fixture(t), calls = [];
  for (const file of ['shared.json','settings.json','keys.json']) await writeFile(join(target,file),'personal state');
  await mkdir(join(target,'layouts','.state'),{recursive:true});
  await writeFile(join(target,'layouts','.state','clicks.json'),'saved sizes');
  const result = await install({target, activate:true, run:args=>calls.push(args)});
  for (const name of mods) assert.match(await readFile(join(target,'mods',name,'main.js'),'utf8'),/export default class/);
  assert.ok(JSON.parse(await readFile(join(target,'layouts','github-workspace.json'),'utf8')).cloned_from);
  for (const file of ['shared.json','settings.json','keys.json']) assert.equal(await readFile(join(target,file),'utf8'),'personal state');
  assert.equal(await readFile(join(target,'layouts','.state','clicks.json'),'utf8'),'saved sizes');
  assert.equal(calls.filter(args=>args[0]==='check').length,mods.length);
  assert.deepEqual(calls.at(-1),['do','layout.switch','--name','github-workspace']);
  assert.ok(result.backup.startsWith(join(target,'backups')));
});

test('updates back up old files and remove stale managed code', async t => {
  const {target} = await fixture(t);
  await mkdir(join(target,'mods','github-prs'),{recursive:true});
  await writeFile(join(target,'mods','github-prs','main.js'),'old code');
  await writeFile(join(target,'mods','github-prs','stale.js'),'old module');
  const {backup} = await install({target,run:()=>{}});
  assert.equal(await readFile(join(backup,'mods','github-prs','main.js'),'utf8'),'old code');
  assert.equal(await readFile(join(backup,'mods','github-prs','stale.js'),'utf8'),'old module');
  assert.equal(await missing(join(target,'mods','github-prs','stale.js')),true);
});

test('failed validation restores old folders/layout and removes newly installed mods', async t => {
  const {target} = await fixture(t);
  await mkdir(join(target,'mods','github-prs'),{recursive:true});
  await mkdir(join(target,'layouts'),{recursive:true});
  await writeFile(join(target,'mods','github-prs','main.js'),'original');
  await writeFile(join(target,'layouts','github-workspace.json'),'original layout');
  await assert.rejects(install({target,run:args=>{if(args[0]==='check') throw new Error('broken render');}}),/previous files restored/);
  assert.equal(await readFile(join(target,'mods','github-prs','main.js'),'utf8'),'original');
  assert.equal(await readFile(join(target,'layouts','github-workspace.json'),'utf8'),'original layout');
  assert.equal(await missing(join(target,'mods','github-tabs')),true);
  assert.equal(await missing(join(target,'mods','git-changes')),true);
});

test('rejects overlapping paths and missing Herdr before changing installed files', async t => {
  const {target} = await fixture(t);
  await assert.rejects(install({source:target,target,run:()=>{}}),/separate folders/);
  await assert.rejects(install({source:target,target:join(target,'nested'),run:()=>{}}),/separate folders/);
  await assert.rejects(install({target,run:()=>{throw new Error('Herdr missing');}}),/Herdr missing/);
  assert.equal(await missing(join(target,'backups')),true);
});

test('rollback tries every entry even if restoring one fails', async () => {
  const attempts = [];
  const failures = await restore(['mods/one','mods/two'],new Set(['mods/one','mods/two']),'target','backup',{
    rm:async path=>{ attempts.push(path); if(path.endsWith('two')) throw new Error('locked'); },
    cp:async ()=>{},
  });
  assert.equal(attempts.length,2); assert.equal(failures.length,1); assert.match(failures[0],/locked/);
});

test('ancestor aliases cannot bypass source/target overlap protection', async t => {
  const {root} = await fixture(t), source = join(root,'source'), alias = join(root,'alias');
  await mkdir(source);
  try { await symlink(source,alias,process.platform === 'win32' ? 'junction' : 'dir'); }
  catch(e) { if(['EPERM','EACCES'].includes(e.code)) { t.skip('Directory links unavailable'); return; } throw e; }
  await assert.rejects(install({source,target:join(alias,'nested'),run:()=>{}}),/separate folders/);
});

test('invalid source fails before changing the target', async t => {
  const {target,root} = await fixture(t), source = join(root,'source');
  await cp(bundle,source,{recursive:true});
  await writeFile(join(source,'mods','github-tabs','mod.json'),'{bad json');
  await assert.rejects(install({target,source,run:()=>{}}),SyntaxError);
  assert.equal(await missing(join(target,'backups')),true);
});

test('opt-in shared keys replace and back up existing bindings with their helper mod', async t => {
  const {target}=await fixture(t), calls=[];
  await writeFile(join(target,'keys.json'),'old computer bindings');
  await writeFile(join(target,'settings.json'),'personal settings');
  await mkdir(join(target,'mods','legacy-prefix'),{recursive:true});
  await writeFile(join(target,'mods','legacy-prefix','main.js'),'old prefix');
  const {backup}=await install({target,withKeys:true,run:args=>calls.push(args)});
  assert.equal(await readFile(join(target,'keys.json'),'utf8'),await readFile(join(bundle,'keys.json'),'utf8'));
  assert.equal(await readFile(join(backup,'keys.json'),'utf8'),'old computer bindings');
  assert.equal(await readFile(join(backup,'mods','legacy-prefix','main.js'),'utf8'),'old prefix');
  assert.equal(await readFile(join(target,'settings.json'),'utf8'),'personal settings');
  assert.equal(calls.filter(args=>args[0]==='check').length,mods.length+keyMods.length);
  assert.ok(calls.some(args=>args[0]==='check'&&args[1].endsWith('legacy-prefix')));
});

test('default installs never change an existing prefix helper or create keys', async t => {
  const {target}=await fixture(t);
  await mkdir(join(target,'mods','legacy-prefix'),{recursive:true});
  await writeFile(join(target,'mods','legacy-prefix','main.js'),'personal prefix');
  await install({target,run:()=>{}});
  assert.equal(await missing(join(target,'keys.json')),true);
  assert.equal(await readFile(join(target,'mods','legacy-prefix','main.js'),'utf8'),'personal prefix');
});

test('failed opt-in validation rolls back old keys and helper code', async t => {
  const {target}=await fixture(t);
  await writeFile(join(target,'keys.json'),'original keys');
  await mkdir(join(target,'mods','legacy-prefix'),{recursive:true});
  await writeFile(join(target,'mods','legacy-prefix','main.js'),'original prefix');
  await assert.rejects(install({target,withKeys:true,run:args=>{
    if(args[0]==='check' && args[1].endsWith('legacy-prefix')) throw Error('prefix invalid');
  }}),/previous files restored/);
  assert.equal(await readFile(join(target,'keys.json'),'utf8'),'original keys');
  assert.equal(await readFile(join(target,'mods','legacy-prefix','main.js'),'utf8'),'original prefix');
});

test('failed fresh opt-in install removes newly created keys and prefix helper', async t => {
  const {target}=await fixture(t);
  await assert.rejects(install({target,withKeys:true,run:args=>{if(args[0]==='check') throw Error('broken');}}),/previous files restored/);
  assert.equal(await missing(join(target,'keys.json')),true);
  assert.equal(await missing(join(target,'mods','legacy-prefix')),true);
});

test('invalid shared key JSON or section shape fails before touching the target', async t => {
  const {target,root}=await fixture(t), source=join(root,'source');
  await cp(bundle,source,{recursive:true});
  for(const value of ['{broken','null','[]','{"global":[]}','{"terminal":{"ctrl-a":42}}']) {
    await writeFile(join(source,'keys.json'),value);
    await assert.rejects(install({target,source,withKeys:true,run:()=>{}}));
    assert.equal(await missing(join(target,'backups')),true);
  }
  // An unrelated optional preset must not break the default installation.
  await install({target,source,run:()=>{}});
  assert.equal(await missing(join(target,'keys.json')),true);
});

test('missing prefix dependency fails preflight for opt-in keys only', async t => {
  const {target,root}=await fixture(t), source=join(root,'source');
  await cp(bundle,source,{recursive:true});
  await rm(join(source,'mods','legacy-prefix'),{recursive:true});
  await assert.rejects(install({target,source,withKeys:true,run:()=>{}}),/ENOENT/);
  assert.equal(await missing(join(target,'backups')),true);
  await install({target,source,run:()=>{}});
});
