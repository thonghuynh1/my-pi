import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = (await readFile(new URL('../mods/project-spaces/main.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '').replace('export default class Projects', 'return class Projects');
test('project groups toggle independently, persist and restore after reload', () => {
  const storage = new Map(); let notifications = 0;
  const localStorage = { getItem:key=>storage.get(key) ?? null, setItem:(key,value)=>storage.set(key,value) };
  const Projects = new Function('View','localStorage','props',source)(class {},localStorage,()=>({spaceMenu:{}}));
  const cx = {notify:()=>notifications++};
  const view = new Projects(); view.init({},cx);
  assert.equal(view.collapsed.size,0);
  view.toggleProject('my-pi',cx);
  view.toggleProject('tstack',cx);
  assert.deepEqual([...view.collapsed],['my-pi','tstack']);
  view.toggleProject('my-pi',cx);
  assert.deepEqual([...view.collapsed],['tstack']);
  const restored = new Projects(); restored.init({},cx);
  assert.deepEqual([...restored.collapsed],['tstack']);
  assert.equal(notifications,3);
});
