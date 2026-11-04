import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as data from '../mods/project-spaces/data.js';

const source = (await readFile(new URL('../mods/project-spaces/main.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '').replace('export default class Projects', 'return class Projects');

test('project index preserves deepest checkout, multiple locations, machines and space order', () => {
  const rows = [{path:'C:/Repo'}, {path:'c:/repo/trees/topic'}, {path:'C:/bare',bare:true}];
  const sp = [
    {id:'both',folder:'C:/Repo',tabs:[{id:'tab'}]},
    {id:'topic',folder:'C:/Repo/trees/topic/src',tabs:[]},
    {id:'remote',machine:'remote',folder:'C:/Repo/trees/topic',tabs:[]},
    {id:'other',folder:'C:/Repo-other',tabs:[]},
  ];
  const ps = [{tab:'tab',cwd:'C:\\Repo\\trees\\topic\\src'}, {tab:'tab',cwd:'C:/Repo/trees/topic'}];
  const index = data.projectSpaceIndex(rows,sp,ps,null);
  assert.deepEqual(index.get(rows[0]).map(s=>s.id),['both']);
  assert.deepEqual(index.get(rows[1]).map(s=>s.id),['both','topic']);
  assert.equal(index.has(rows[2]),false);
  assert.deepEqual(data.projectSpaceIndex(rows,sp,ps,'remote').get(rows[1]).map(s=>s.id),['remote']);
  assert.deepEqual(data.spacesFor(rows[1],rows,sp,ps,null),index.get(rows[1]));
});

test('matching reads and normalizes checkout paths once, not once per card and space', () => {
  let reads=0;
  const rows=Array.from({length:500},(_,i)=>({get path(){reads++;return `C:/repo/tree-${i}`;}}));
  const sp=Array.from({length:80},(_,i)=>({id:String(i),folder:`C:/repo/tree-${i}/src`,tabs:[]}));
  const index=data.projectSpaceIndex(rows,sp,[],null);
  assert.equal(index.size,80);
  assert.ok(reads<=rows.length*2,`checkout path reads: ${reads}`);
});

test('collapsed groups match spaces but never build hidden checkout cards', () => {
  const icons=[], text=[];
  const element=()=>{
    let proxy;
    proxy=new Proxy({}, {get:(_target,key)=>(...args)=>{
      if(key==='when' && args[0]) args[1](proxy);
      if(key==='child' && typeof args[0]==='string') text.push(args[0]);
      return proxy;
    }});
    return proxy;
  };
  const dependencies={...data,View:class {},div:element,h_flex:element,v_flex:element,
    svg:path=>{icons.push(path);return element();},theme:()=>({}),shared:()=>[],
    spaces:()=>[{id:'open',folder:'C:/Repo',tabs:[]}],panes:()=>[],terminals:()=>[]};
  const Projects=new Function(...Object.keys(dependencies),source)(...Object.values(dependencies));
  const view=new Projects();
  Object.assign(view,{projects:[{key:'p',name:'Repo'}],rows:{p:[{path:'C:/Repo',get branch(){throw Error('built hidden card');}}]},
    collapsed:new Set(['p']),errors:{},error:'',busy:false});
  assert.doesNotThrow(()=>view.render({}));
  assert.equal(icons.some(path=>/\/(home|branch)\.svg$/.test(path)),false);
  assert.equal(text.includes('OTHER SPACES'),false,'collapsed project still owns its open space');
});
