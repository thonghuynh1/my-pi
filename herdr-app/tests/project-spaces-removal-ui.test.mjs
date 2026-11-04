import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source = await readFile(new URL('../mods/project-spaces/main.js',import.meta.url),'utf8');
test('removal uses friendly labels, native loading frames and explicit destructive warning',()=>{
  assert.doesNotMatch(source,/Force remove/);
  assert.match(source,/Checking worktree…/);
  assert.match(source,/\.frames\(/);
  assert.match(source,/uncommitted changes, untracked and ignored files/);
  assert.match(source,/Your branch will be kept/);
  assert.match(source,/Removing \$\{/);
});
