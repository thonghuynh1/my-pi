import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseWorktrees, parseStatus, inside, projectKey, checkoutFor, spacesFor, removalBlock } from '../mods/project-spaces/data.js';

test('NUL worktree records preserve unusual paths, detached, locked, prunable and bare entries', () => {
  const rows = parseWorktrees('worktree C:/项目/repo\0HEAD abc\0branch refs/heads/main\0\0worktree C:/tree with\nnewline\0HEAD def\0detached\0locked reason\0\0worktree C:/missing\0prunable missing gitdir\0\0worktree C:/bare\0bare\0\0');
  assert.equal(rows.length, 4);
  assert.equal(rows[0].branch, 'main'); assert.equal(rows[0].main, true);
  assert.equal(rows[1].path, 'C:/tree with\nnewline'); assert.equal(rows[1].main, false);
  assert.equal(rows[1].branch, null); assert.equal(rows[1].locked, 'reason');
  assert.equal(rows[2].prunable, 'missing gitdir'); assert.equal(rows[3].bare, true);
  assert.deepEqual(parseWorktrees(''), []);
});

test('status tracks changes and upstream without implying deletion safety', () => {
  assert.deepEqual(parseStatus('# branch.head topic\n# branch.upstream origin/topic\n# branch.ab +2 -3\n'), { dirty:false, upstream:'origin/topic', ahead:2, behind:3 });
  assert.equal(parseStatus('? untracked\n').dirty, true);
  assert.equal(parseStatus('1 .M N... 100644 100644 100644 abc abc file\n').dirty, true);
  assert.equal(parseStatus('u UU N... conflict\n').dirty, true);
  assert.equal(parseStatus('# branch.head (detached)\n').upstream, null);
});

test('Windows paths deduplicate, Unix paths stay case-sensitive and machines remain distinct', () => {
  assert.equal(projectKey(null, 'C:\\Repo\\.git\\'), projectKey(null, 'c:/repo/.git'));
  assert.notEqual(projectKey('remote', '/repo/.git'), projectKey(null, '/repo/.git'));
  assert.equal(inside('C:\\repo\\src', 'c:/Repo'), true);
  assert.equal(inside('/repo-other', '/repo'), false);
  assert.equal(inside('/Repo/src', '/repo'), false);
  assert.equal(inside(null, '/repo'), false);
  assert.notEqual(projectKey(null, '/tmp/tree\\\\name'), projectKey(null, '/tmp/tree/name'));
});

test('deepest checkout owns a space, including nested cwd and machine separation', () => {
  const rows = [{path:'/repo'}, {path:'/repo/trees/topic'}];
  const sp = [
    {id:'main',machine:null,folder:'/repo',tabs:[]},
    {id:'topic',machine:null,folder:'/old',tabs:[{id:'tab'}]},
    {id:'remote',machine:'remote',folder:'/repo/trees/topic',tabs:[]},
  ];
  const ps = [{tab:'tab',cwd:'/repo/trees/topic/src'}];
  assert.equal(checkoutFor('/repo/trees/topic/src',rows), rows[1]);
  assert.deepEqual(spacesFor(rows[1],rows,sp,ps,null).map(s=>s.id), ['topic']);
  assert.deepEqual(spacesFor(rows[0],rows,sp,ps,null).map(s=>s.id), ['main']);
});

test('deletion fails closed for main, dirty, locked, missing, open, and unknown checkouts', () => {
  const clean = {path:'/tree',branch:'topic',status:{dirty:false}};
  assert.equal(removalBlock(clean,false), null);
  for (const row of [undefined, {...clean,main:true}, {...clean,bare:true}, {...clean,locked:true}, {...clean,branch:null}, {...clean,prunable:true}, {...clean,error:'offline'}, {path:'/tree'}, {...clean,status:{dirty:true}}]) {
    assert.ok(removalBlock(row,false));
  }
  assert.match(removalBlock(clean,true), /Close/);
});

test('real Git lists unopened worktrees from common dir and reports dirty/untracked state', async t => {
  const root = await mkdtemp(join(tmpdir(), 'herdr-projects-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const git = (cwd,args) => execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true});
  const repo = join(root,'project'), tree = join(root,'tree with spaces');
  git(root,['init',repo]);
  git(repo,['-c','user.name=Test','-c','user.email=test@example.com','commit','--allow-empty','-m','initial']);
  git(repo,['worktree','add','-b','topic',tree]);
  const common = git(tree,['rev-parse','--path-format=absolute','--git-common-dir']).trim();
  const rows = parseWorktrees(git(common,['worktree','list','--porcelain','-z']));
  assert.equal(rows.length,2); assert.equal(rows[1].branch,'topic');
  assert.equal(parseStatus(git(tree,['status','--porcelain=v2','--branch'])).dirty,false);
  const {writeFile} = await import('node:fs/promises');
  await writeFile(join(tree,'untracked.txt'),'keep');
  assert.equal(parseStatus(git(tree,['status','--porcelain=v2','--branch'])).dirty,true);
  assert.throws(()=>git(common,['worktree','remove','--',tree]));
});
