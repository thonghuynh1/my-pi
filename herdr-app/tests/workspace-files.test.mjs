import test from 'node:test';
import assert from 'node:assert/strict';
import { fullPath, captureTarget, insertPath } from '../mods/workspace-files/insert.js';
const pane={pane:'p1',terminal:'t1',tab:'tab1'};
const focus={pane:'p1',terminal:'t1',space:'space1',tab:'tab1',shown:null};
function setup(current=focus,ps=[pane]) {
  const events=[]; let clipboard='old clipboard\n';
  const api={focused:()=>current,panes:()=>ps,close:()=>events.push(['close']),
    copy:text=>{clipboard=text;events.push(['copy',text]);},readClipboard:()=>clipboard,
    run:(...args)=>events.push(['run',...args])};
  return {api,events,target:captureTarget(focus,[pane])};
}
test('absolute paths preserve spaces, Unicode, quotes, and Unix backslashes',()=>{
  assert.equal(fullPath('C:\\My Work\\repo','文档/a b.txt'),'C:/My Work/repo/文档/a b.txt');
  assert.equal(fullPath('/repo/',"a'b.txt"),"/repo/a'b.txt");
  assert.equal(fullPath('/repo\\name','file'),'/repo\\name/file');
  assert.equal(fullPath('/','file'),'/file');
});
test('control characters cannot trigger submission or escape sequences',()=>{
  for(const bad of ['a\nb','a\rb','a\x1bb','a\0b','a\tb','a\u2028b']) {
    assert.throws(()=>fullPath('/repo',bad),/control/);
    const h=setup();
    assert.throws(()=>insertPath({path:bad,target:h.target},h.api),/safely/);
    assert.deepEqual(h.events,[]);
  }
});
test('path insertion uses clipboard and native paste, never send or Enter',()=>{
  const h=setup(),path='/repo/file with spaces.txt';
  insertPath({path,target:h.target},h.api);
  assert.deepEqual(h.events,[['copy',path],['close'],['run','pane.focus',{pane:'p1'}],['run','terminal.paste']]);
});
test('wrong terminal, pane, space, tab, removed pane and shown replacement abort without side effects',()=>{
  for(const current of [null,{...focus,terminal:'t2'},{...focus,pane:'p2'},{...focus,pane:null},{...focus,space:'other'},{...focus,tab:'other'},{...focus,shown:'t9'}]) {
    const h=setup(current);
    assert.throws(()=>insertPath({path:'/repo/file',target:h.target},h.api),/changed/);
    assert.deepEqual(h.events,[]);
  }
  const h=setup(focus,[]);
  assert.throws(()=>insertPath({path:'/repo/file',target:h.target},h.api),/changed/);
  assert.deepEqual(h.events,[]);
});
test('no terminal or a mod pane cannot capture an insertion target',()=>{
  assert.equal(captureTarget(null,[]),null);
  assert.equal(captureTarget({...focus,terminal:null},[]),null);
  assert.equal(captureTarget({...focus,shown:'t2'},[pane]),null);
  assert.equal(captureTarget(focus,[]),null);
});
test('composition terminals use an explicit terminal address',()=>{
  const current={...focus,pane:null,terminal:'remote/t1'},h=setup(current,[]);
  const target=captureTarget(current,[]);
  insertPath({path:'/remote/file',target},h.api);
  assert.deepEqual(h.events[2],['run','pane.focus',{terminal:'remote/t1'}]);
});
test('clipboard mismatch aborts before closing popup or pasting old clipboard',()=>{
  const h=setup(); h.api.readClipboard=()=> 'stale\ncommand';
  assert.throws(()=>insertPath({path:'/repo/file',target:h.target},h.api),/clipboard changed/);
  assert.deepEqual(h.events,[['copy','/repo/file']]);
});
