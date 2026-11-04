import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FileDocument, EDIT_LIMIT } from '../mods/workspace-files/editor.js';
import { fullPath } from '../mods/workspace-files/insert.js';

function storage() {
  const map = new Map(), writes = []; let flushes = 0;
  return { flush: async () => { flushes++; }, get flushes() { return flushes; }, getItem: k => map.get(k) ?? null, setItem: (k,v) => { writes.push(k); map.set(k,v); }, removeItem: k => map.delete(k), map, writes };
}
function setup(options = {}) {
  let disk = 'original\r\n文档'; const writes = [], store = storage();
  const write = async (path, value, expected) => {
    writes.push({ path, value, expected });
    if (expected !== disk) throw new Error('File changed externally');
    disk = value;
  };
  const create = (path = "C:/My Work/a'b.txt", extra = {}) => new FileDocument(path, disk, { storage: store, write, ...options, ...extra });
  return { create, store, writes, get disk() { return disk; }, setDisk: v => { disk = v; } };
}

test('local edit saves exact Unicode content using the original disk snapshot', async () => {
  const h = setup(), doc = h.create();
  assert.equal(doc.dirty, false);
  doc.update('edited\r\n文档'); assert.equal(doc.dirty, true);
  await doc.save();
  assert.deepEqual(h.writes, [{ path: "C:/My Work/a'b.txt", value: 'edited\r\n文档', expected: 'original\r\n文档' }]);
  assert.equal(h.disk, doc.value); assert.equal(doc.dirty, false); assert.equal(h.store.map.size, 0);
});
test('conflicting external changes never get overwritten and retain a recoverable draft', async () => {
  const h = setup(), doc = h.create(); doc.update('mine'); h.setDisk('theirs');
  await doc.save();
  assert.equal(h.disk, 'theirs'); assert.equal(doc.dirty, true); assert.match(doc.error, /changed externally/);
  const restored = h.create();
  assert.equal(restored.value, 'mine'); assert.equal(restored.expected, 'original\r\n文档');
  await restored.save(); assert.equal(h.disk, 'theirs'); assert.equal(restored.dirty, true);
});
test('drafts recover across new documents and are isolated by path and machine', () => {
  const h = setup(); h.create().update('draft');
  assert.equal(h.create().value, 'draft');
  assert.equal(h.create('/other').value, h.disk);
  assert.equal(h.create(undefined, { on: 'remote' }).value, h.disk);
});
test('remote and truncated files cannot be edited or written', async () => {
  for (const extra of [{ on: 'remote' }, {}]) {
    const h = setup(extra); if (!extra.on) h.setDisk('x'.repeat(EDIT_LIMIT + 1));
    const doc = h.create(); const before = doc.value;
    assert.ok(doc.readonly); doc.update('changed'); await doc.save();
    assert.equal(doc.value, before); assert.equal(doc.dirty, false); assert.equal(h.writes.length, 0);
  }
});
test('edits made during save stay dirty; repeated Save does not duplicate writes', async () => {
  const h = setup(); let finish; const writes = [];
  const doc = h.create(undefined, { write: (...args) => { writes.push(args); return new Promise(r => { finish = r; }); } });
  doc.update('first'); const saving = doc.save();
  doc.update('second'); await doc.save();
  assert.equal(writes.length, 1); finish(); await saving;
  assert.equal(doc.expected, 'first'); assert.equal(doc.value, 'second'); assert.equal(doc.dirty, true);
  assert.equal(JSON.parse(h.store.getItem(doc.key)).value, 'second');
});
test('undo during an in-flight save retains a recovery snapshot even before disk changes', async () => {
  const h = setup(); let finish;
  const doc = h.create(undefined, { write: () => new Promise(r => { finish = r; }) });
  const original = doc.value;
  doc.update('saving'); const save = doc.save(); doc.update(original);
  const backup = JSON.parse(h.store.getItem(doc.key));
  assert.equal(backup.value, original); assert.equal(backup.pending, 'saving');
  const recovered = h.create();
  assert.equal(recovered.value, original); assert.equal(recovered.dirty, true);
  h.setDisk('saving'); await recovered.save();
  assert.equal(h.disk, original); finish(); await save;
});
test('a pending save that never committed can retry against the unchanged original', async () => {
  const h = setup(); const doc = h.create();
  h.store.setItem(doc.key, JSON.stringify({ expected: h.disk, value: 'pending edit', pending: 'pending edit' }));
  const recovered = h.create(); assert.equal(recovered.expected, h.disk);
  await recovered.save(); assert.equal(h.disk, 'pending edit'); assert.equal(recovered.dirty, false);
});
test('draft recovery is independent of a missing, binary, or oversized disk replacement', () => {
  for (const disk of [null, 'binary\0data', 'x'.repeat(EDIT_LIMIT + 1)]) {
    const h = setup(); h.create().update('precious draft'); h.setDisk(disk);
    const recovered = h.create();
    assert.equal(recovered.value, 'precious draft'); assert.equal(recovered.readonly, null);
    assert.equal(recovered.unavailable, false); assert.equal(recovered.dirty, true);
  }
});
test('storage errors do not lose the in-memory draft or prevent a safe save', async () => {
  const h = setup(), doc = h.create(undefined, { storage: { getItem: () => null, setItem: () => { throw Error('full'); }, removeItem: () => {} } });
  doc.update('mine'); assert.match(doc.backupError, /backup failed/); assert.equal(doc.dirty, true);
  await doc.save(); assert.equal(h.disk, 'mine'); assert.equal(doc.dirty, false); assert.equal(doc.backupError, null);
});

const source = (await readFile(new URL('../mods/workspace-files/main.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '').replace('export default class Files', 'return class Files');
function element() {
  const node = { nodes: [] }; let proxy;
  proxy = new Proxy(node, { get: (target, key) => {
    if (key === 'child') return child => { target.nodes.push(child); return proxy; };
    if (key === 'children') return children => { target.nodes.push(...children); return proxy; };
    if (key === 'id') return id => { target.elementId = id; return proxy; };
    if (key === 'when') return (condition, fn) => { if (condition) fn(proxy); return proxy; };
    if (key in target) return target[key];
    return () => proxy;
  } });
  return proxy;
}
function flatten(node) { return typeof node === 'object' && node ? [node, ...(node.nodes ?? []).flatMap(flatten)] : [node]; }
function harness() {
  const tasks = [], states = [], store = storage(), timers = []; let resolveRead, notifications = 0, reads = 0;
  let read = async () => 'original'; const commands = [];
  const deps = {
    View: class {}, div: element, h_flex: element, v_flex: element, svg: element, Editor: { new: element },
    spaces: () => [{ active: true, id: 's1', folder: '/repo' }], focused: () => ({}), panes: () => [],
    FileDocument, EDIT_LIMIT, fullPath, localStorage: store,
    readTextFile: (...a) => { reads++; return read(...a); }, writeTextFile: async () => {},
    theme: () => ({}), settings: () => ({}),
    exec: async (...args) => { commands.push(args); return { code: 0, stdout: '/repo' }; },
    EditorState: { new: options => {
      let value = options.value; const handlers = {};
      const state = { options, released: false, value: () => value, on: (name, f) => { handlers[name] = f; }, release() { this.released = true; },
        edit: text => { value = text; handlers.change({}, cx); }, blur: () => handlers.blur({}, cx) };
      states.push(state); return state;
    } },
  };
  const Files = new Function(...Object.keys(deps), source)(...Object.values(deps));
  const view = new Files();
  view.fileRequest = 0; view.documents = new Map(); view.root = '/repo'; view.on = null;
  view.context = { key: JSON.stringify({ cwd: '/repo', on: null, space: 's1' }), cwd: '/repo', on: null };
  view.refreshReal = view.refresh; view.refresh = () => {};
  const cx = { spawn: fn => tasks.push(fn(cx)), notify() { notifications++; },
    timer: { after: (ms, fn) => { const task = { ms, fn, cancelled: false, cancel() { this.cancelled = true; } }; timers.push(task); return task; } } };
  return { view, cx, states, store, commands, get notifications() { return notifications; }, get reads() { return reads; },
    drain: async () => { while (tasks.length) await tasks.shift(); },
    tick: () => { for (const task of timers.splice(0)) if (!task.cancelled) task.fn(cx); },
    setRead: fn => { read = fn; },
    delayRead: () => { read = () => new Promise(r => { resolveRead = r; }); }, resolve: text => resolveRead(text) };
}
test('editor wires change events, dirty state, navigation recovery and explicit discard confirmation', async () => {
  const h = harness(); h.view.show('file.txt', h.cx); await h.drain();
  assert.equal(h.states[0].options.readonly, false);
  h.states[0].edit('unsaved'); assert.equal(h.view.document.dirty, true);
  h.view.show(null); h.view.show('file.txt', h.cx); await h.drain();
  assert.equal(h.view.code.value(), 'unsaved');
  h.view.reload(h.cx); assert.equal(h.view.discardConfirm, true); assert.equal(h.view.code.value(), 'unsaved');
  h.view.reload(h.cx); await h.drain();
  assert.equal(h.view.code.value(), 'original'); assert.equal(h.store.map.size, 0);
});
test('late async file reads cannot reopen a closed file', async () => {
  const h = harness(); h.delayRead(); h.view.show('file.txt', h.cx); h.view.show(null);
  h.resolve('late'); await h.drain(); assert.equal(h.view.code, null); assert.equal(h.view.document, null);
});
test('a missing or binary replacement does not hide a draft after navigating back', async () => {
  for (const text of [null, 'binary\0data']) {
    const h = harness(); h.view.show('file', h.cx); await h.drain(); h.view.code.edit('keep me');
    h.view.show(null); h.setRead(async () => text); h.view.show('file', h.cx); await h.drain();
    assert.equal(h.view.code.value(), 'keep me'); assert.equal(h.view.document.dirty, true);
    assert.equal(h.reads, 1); // Cached drafts do not wait for another disk read.
  }
});
test('binary files and unavailable files never create an editable buffer', async () => {
  for (const text of ['a\0b', null]) {
    const h = harness(); h.delayRead(); h.view.show('file', h.cx); h.resolve(text); await h.drain();
    assert.equal(h.view.code, null); assert.ok(h.view.fileError);
  }
});

test('typing batches backups and only redraws the dirty-state transition', async () => {
  const h = harness(); h.view.show('file', h.cx); await h.drain();
  const before = h.notifications;
  for (let i = 0; i < 100; i++) h.view.code.edit('edited ' + i);
  assert.equal(h.store.writes.length, 1); // First edit is backed up immediately.
  assert.equal(h.notifications - before, 1);
  h.tick();
  assert.equal(h.store.writes.length, 2);
  assert.equal(JSON.parse(h.store.getItem(h.view.document.key)).value, 'edited 99');
  assert.equal(h.notifications - before, 1);
});
test('blur, navigation, and close flush the most recent edits without waiting for a timer', async () => {
  for (const exit of ['blur', 'navigate', 'close']) {
    const h = harness(); h.view.show('file', h.cx); await h.drain();
    h.view.code.edit('first'); h.view.code.edit('latest');
    const key = h.view.document.key;
    if (exit === 'blur') h.view.code.blur();
    else if (exit === 'navigate') h.view.show(null);
    else { await h.view.close(); assert.equal(h.store.flushes, 1); }
    assert.equal(JSON.parse(h.store.getItem(key)).value, 'latest');
    const writes = h.store.writes.length;
    h.tick(); assert.equal(h.store.writes.length, writes); // Cancelled callbacks cannot rewrite stale drafts.
  }
});
test('discard cancels a queued backup instead of resurrecting the discarded draft', async () => {
  const h = harness(); h.view.show('file', h.cx); await h.drain();
  h.view.code.edit('first'); h.view.code.edit('latest');
  h.view.reload(h.cx); h.view.reload(h.cx); await h.drain(); h.tick();
  assert.equal(h.store.map.size, 0); assert.equal(h.view.code.value(), 'original');
});
test('save includes the newest queued edit and clears its backup after success', async () => {
  const h = harness(); h.view.show('file', h.cx); await h.drain();
  h.view.code.edit('first'); h.view.code.edit('latest');
  h.view.save(h.cx); await h.drain(); h.tick();
  assert.equal(h.view.document.expected, 'latest');
  assert.equal(h.view.document.dirty, false); assert.equal(h.store.map.size, 0);
});

test('failed discard leaves the newest backup scheduled and flushable', async () => {
  const h = harness(); h.view.show('file', h.cx); await h.drain();
  h.view.code.edit('first'); h.view.code.edit('latest');
  const key = h.view.document.key;
  h.store.removeItem = () => { throw Error('storage busy'); };
  h.view.reload(h.cx); h.view.reload(h.cx);
  assert.match(h.view.document.error, /Cannot clear/);
  h.view.show(null);
  assert.equal(JSON.parse(h.store.getItem(key)).value, 'latest');
});
test('opening an editor interrupts further folder scans and Git work', async () => {
  const h = harness(); let finish;
  const folders = [];
  h.view.folders = new Set(['one', 'two']);
  h.view.loadFolder = path => { folders.push(path); return new Promise(r => { finish = r; }); };
  h.view.refreshReal(h.cx);
  assert.deepEqual(folders, ['']);
  h.view.file = 'file'; finish(); await h.drain();
  assert.deepEqual(folders, ['']); assert.equal(h.commands.length, 0);
});
test('refresh does not start filesystem or Git work while editing', async () => {
  const h = harness(); h.view.show('file', h.cx); await h.drain();
  h.view.loadFolder = () => { throw Error('unexpected directory scan'); };
  h.view.refreshReal(h.cx); await h.drain();
  assert.equal(h.commands.length, 0);
});

test('returning to a recent unchanged file retains its native editor and cursor/undo state', async () => {
  const h = harness(); h.view.show('one', h.cx); await h.drain();
  const first = h.view.code; first.cursor = 42; first.undoHistory = ['previous edit'];
  h.view.show('two', h.cx); await h.drain();
  assert.equal(first.released, false);
  h.view.show('one', h.cx); await h.drain();
  assert.equal(h.view.code, first); assert.equal(h.states.length, 2);
  assert.equal(h.view.code.cursor, 42); assert.deepEqual(h.view.code.undoHistory, ['previous edit']);
});
test('clean cached buffers revalidate disk content before reuse', async () => {
  const h = harness(); h.view.show('file', h.cx); await h.drain(); const old = h.view.code;
  h.view.show(null); h.setRead(async () => 'external change');
  h.view.show('file', h.cx); await h.drain();
  assert.equal(old.released, true); assert.notEqual(h.view.code, old);
  assert.equal(h.view.code.value(), 'external change');
});
test('inactive editor callbacks cannot change or flush the active draft', async () => {
  const h = harness(); h.view.show('one', h.cx); await h.drain(); const first = h.view.code;
  h.view.show('two', h.cx); await h.drain();
  h.view.code.edit('first edit'); h.view.code.edit('newest edit');
  const pending = h.view.draftTask, writes = h.store.writes.length;
  first.blur(); first.edit('stale callback');
  assert.equal(h.view.draftTask, pending); assert.equal(h.store.writes.length, writes);
  assert.equal(h.view.document.value, 'newest edit'); h.tick();
});
test('native editor retention is bounded to eight recent buffers and close releases them', async () => {
  const h = harness();
  for (let i = 0; i < 12; i++) { h.view.show('file' + i, h.cx); await h.drain(); }
  assert.equal(h.states.filter(s => !s.released).length, 8);
  assert.equal(h.view.documents.size, 8);
  await h.view.close(); assert.ok(h.states.every(s => s.released));
});
test('normal editing has no status strip and Save appears only for unsaved work', async () => {
  const h = harness(); h.view.show('file.txt', h.cx); await h.drain();
  let nodes = flatten(h.view.render(h.cx));
  assert.equal(nodes.some(n => n?.elementId === 'file-warning'), false);
  assert.equal(nodes.some(n => n?.elementId === 'file-save'), false);
  h.view.code.edit('unsaved'); nodes = flatten(h.view.render(h.cx));
  assert.equal(nodes.some(n => n?.elementId === 'file-save'), true);
  assert.equal(nodes.some(n => n?.elementId === 'file-warning'), false);
  h.view.document.error = 'Conflict'; nodes = flatten(h.view.render(h.cx));
  assert.equal(nodes.some(n => n?.elementId === 'file-warning'), true);
  assert.ok(nodes.includes('Conflict'));
});

test('discard confirmation stays visible even when the file already has an error', async () => {
  const h = harness(); h.view.show('file', h.cx); await h.drain(); h.view.code.edit('unsaved');
  h.view.document.error = 'Conflict'; h.view.reload(h.cx);
  const nodes = flatten(h.view.render(h.cx));
  assert.ok(nodes.includes('Discard unsaved edits? Click ↻ again to reload.'));
  assert.equal(h.view.code.value(), 'unsaved');
});
test('failed draft recovery is an actionable warning, not a hidden routine notice', async () => {
  const h = harness(); h.store.getItem = () => '{corrupt';
  h.view.show('file', h.cx); await h.drain();
  assert.ok(h.view.document.recoveryError);
  const nodes = flatten(h.view.render(h.cx));
  assert.ok(nodes.includes(h.view.document.recoveryError));
});
test('closing cancels late file opens and ignores callbacks from released editors', async () => {
  const h = harness(); h.view.show('one', h.cx); await h.drain(); const old = h.view.code;
  h.delayRead(); h.view.show('two', h.cx); await h.view.close();
  h.resolve('late disk content'); await h.drain(); old.edit('stale'); old.blur(); h.tick();
  assert.equal(h.view.code, null); assert.equal(h.view.document, null);
  assert.equal(h.states.length, 1); assert.equal(old.released, true);
  assert.equal(h.store.map.size, 0);
});
