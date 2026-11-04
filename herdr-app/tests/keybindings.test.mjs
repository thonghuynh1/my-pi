import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const keys=JSON.parse(await readFile(new URL('../keys.json',import.meta.url),'utf8'));

test('portable preset includes navigation, terminal editing and packaged prefix shortcuts', async () => {
  assert.equal(keys.global['ctrl-b'],'mod.open:legacy-prefix');
  assert.equal(keys.global['alt-1'],'space.select:1');
  assert.equal(keys.global['ctrl-1'],'tab.select:1');
  assert.equal(keys.global['alt-h'],'pane.go:left');
  assert.equal(keys.terminal['ctrl-backspace'],'send:\u0017');
  assert.equal(keys.terminal['ctrl-left'],'send:\u001bb');
  const metadata=JSON.parse(await readFile(new URL('../mods/legacy-prefix/mod.json',import.meta.url),'utf8'));
  assert.equal(metadata.place,'none');
});

test('bundled Ctrl+B prefix dispatches tab and pane shortcuts after closing itself', async () => {
  const source=(await readFile(new URL('../mods/legacy-prefix/main.js',import.meta.url),'utf8'))
    .replace(/^import .*;\r?\n/gm,'').replace('export const BINDINGS','const BINDINGS')
    .replace('export default class LegacyPrefix','return class LegacyPrefix');
  const calls=[];
  const Prefix=new Function('View','props','closeOverlay','run',source)(
    class {},()=>({overlay:'prefix'}),id=>calls.push(['close',id]),(...args)=>calls.push(['run',...args]));
  const view=new Prefix();
  const cx={stop_propagation:()=>{},notify:()=>{}};
  view.key({key:'c',key_char:'c',modifiers:{}},cx);
  assert.deepEqual(calls,[['close','prefix'],['run','tab.new',undefined]]);
  calls.length=0;
  view.key({key:'v',key_char:'v',modifiers:{}},cx);
  assert.deepEqual(calls,[['close','prefix'],['run','pane.split',{direction:'right'}]]);
  calls.length=0;
  view.target={pane:'pane-original',terminal:'t-original'};
  view.key({key:'x',key_char:'x',modifiers:{}},cx);
  assert.deepEqual(calls,[['close','prefix'],['run','terminal.kill',{terminal:'t-original'}]]);
  calls.length=0;
  view.target={pane:'mod-pane'};
  view.key({key:'x',key_char:'x',modifiers:{}},cx);
  assert.deepEqual(calls,[['close','prefix'],['run','pane.close',{pane:'mod-pane'}]]);
  calls.length=0;
  view.target={terminal:'composition-terminal'};
  view.key({key:'x',key_char:'x',modifiers:{}},cx);
  assert.deepEqual(calls,[]);
});
