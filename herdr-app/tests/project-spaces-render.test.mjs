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

test('collapsed project still announces a finished agent in its header and the sidebar total', () => {
  const text=[];
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
    svg:()=>element(),theme:()=>({done:'#a3be8c'}),shared:()=>[],
    spaces:()=>[{id:'open',folder:'C:/Repo',tabs:[],status:'done'}],panes:()=>[],terminals:()=>[]};
  const Projects=new Function(...Object.keys(dependencies),source)(...Object.values(dependencies));
  const view=new Projects();
  Object.assign(view,{projects:[{key:'p',name:'Repo'}],rows:{p:[{path:'C:/Repo',branch:'main'}]},
    collapsed:new Set(['p']),errors:{},error:'',busy:false});
  view.render({});
  assert.ok(text.includes('Done'),'project header shows the attention pill while collapsed');
  assert.ok(text.includes('1 done'),'sidebar header shows the finished total');
});

test('space tree names each space, folds inactive ones, and keeps pane detail in tooltips', () => {
  const text=[], tips=[];
  const element=()=>{
    let proxy;
    proxy=new Proxy({}, {get:(_target,key)=>(...args)=>{
      if(key==='when' && args[0]) args[1](proxy);
      if(key==='child' && typeof args[0]==='string') text.push(args[0]);
      if(key==='tooltip') tips.push(args[0]);
      return proxy;
    }});
    return proxy;
  };
  const dependencies={...data,View:class {},div:element,h_flex:element,v_flex:element,
    svg:()=>element(),theme:()=>({}),shared:()=>[],spaces:()=>[],panes:()=>[],terminals:()=>[]};
  const Projects=new Function(...Object.keys(dependencies),source)(...Object.values(dependencies));
  const view=new Projects();
  const ps=[
    {pane:'p1',tab:'t1',title:'Pi',program:{name:'Pi'},status:'working'},
    {pane:'p2',tab:'t2',title:'shell',program:{name:'pwsh'},status:null},
    {pane:'p3',tab:'t3',title:'Pi',program:{name:'Pi'},status:'done'},
  ];
  const idle={id:'s2',name:'second',active:false,status:null,tabs:[
    {id:'t2',index:1,name:'1',named:false,active:true,status:null,panes:1},
    {id:'t3',index:2,name:'2',named:false,active:false,status:'done',panes:1}]};
  view.workTree(idle, ps, {}, true);
  assert.ok(text.includes('second'),'inactive space renders its own header');
  assert.ok(text.includes('2 tabs · 2 panes ▸'),'inactive space folds to one summary line');
  assert.equal(text.includes('Tab 1'),false,'inactive space hides its tab rows');
  text.length=0;
  const active={id:'s1',name:'first',active:true,status:'working',tabs:[
    {id:'t1',index:1,name:'Fix login',named:true,active:true,status:'working',panes:1}]};
  view.workTree(active, ps, {}, true);
  assert.ok(text.includes('first'),'active space renders its header');
  assert.ok(text.includes('Fix login'),'active space lists its tab');
  assert.ok(tips.some(tip=>tip.includes('Pi · working')),'pane detail lives in the tab tooltip');
  assert.equal(/on_hover|hoverWork/.test(source),false,'no hover state: it rebuilds the list mid-scroll');
});

test('collapsed project shows a working agent in its header, below attention priority', () => {
  const text=[];
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
    svg:()=>element(),theme:()=>({working:'#81a1c1'}),shared:()=>[],
    spaces:()=>[{id:'open',folder:'C:/Repo',tabs:[],status:'working'}],panes:()=>[],terminals:()=>[]};
  const Projects=new Function(...Object.keys(dependencies),source)(...Object.values(dependencies));
  const view=new Projects();
  Object.assign(view,{projects:[{key:'p',name:'Repo'}],rows:{p:[{path:'C:/Repo',branch:'main'}]},
    collapsed:new Set(['p']),errors:{},error:'',busy:false});
  view.render({});
  assert.ok(text.includes('Working'),'project header shows the working pill while collapsed');
  assert.ok(text.includes('1 working'),'sidebar header shows the working total');
  assert.equal(text.includes('Done'),false,'working never masquerades as finished');
});
