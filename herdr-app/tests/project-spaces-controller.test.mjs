import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as data from '../mods/project-spaces/data.js';

const source = (await readFile(new URL('../mods/project-spaces/main.js',import.meta.url),'utf8'))
  .replace(/^import .*;\r?\n/gm,'').replace('export default class Projects','return class Projects');
function harness({dirty=false,sp=[],ps=[],ts=[],target='/tree'}={}) {
  const calls=[], actions=[], closed=[], overlays=[], tasks=[], storage=new Map();
  let currentDirty=dirty;
  const dependencies = {
    ...data, View:class {},
    localStorage:{getItem:key=>storage.get(key) ?? null,setItem:(key,value)=>storage.set(key,value)},
    spaces:()=>sp,panes:()=>ps,terminals:()=>ts,window:()=>({active:true}),
    props:()=>({overlay:'dialog'}),closeOverlay:id=>closed.push(id),
    openOverlay:args=>overlays.push(args), run:(...args)=>actions.push(args),
    exec:async (_command,args,options)=>{
      calls.push({args,options});
      let stdout='';
      if(args.includes('list')) stdout=`worktree /repo\0HEAD aaa\0branch refs/heads/main\0\0worktree ${target}\0HEAD bbb\0branch refs/heads/topic\0\0`;
      if(args.includes('status')) stdout=currentDirty && options.cwd===target ? '? changed\n' : '# branch.head topic\n';
      if(args.includes('rev-list')) stdout='2\n';
      return {code:0,stdout};
    },
  };
  const Projects = new Function(...Object.keys(dependencies),source)(...Object.values(dependencies));
  const view = new Projects(); view.busy=false; view.error='';
  view.dialog={project:{key:'p',cwd:'/repo/.git',machine:null},path:target};
  const cx={spawn:fn=>tasks.push(fn(cx)),notify:()=>{}};
  return {view,cx,calls,actions,closed,overlays,storage,setDirty:value=>{currentDirty=value;},drain:async()=>{while(tasks.length)await tasks.shift();}};
}

test('confirmation rechecks dirtiness; it never forces, deletes branches or closes spaces', async()=>{
  const h=harness();
  h.view.checkRemoval(h.cx); await h.drain();
  assert.equal(h.view.blocked,null);
  h.setDirty(true);
  h.view.checkRemoval(h.cx,true); await h.drain();
  assert.match(h.view.blocked,/Uncommitted/);
  assert.equal(h.calls.some(c=>c.args.includes('remove')),false);
  assert.deepEqual(h.actions,[]); assert.deepEqual(h.closed,[]);
});

test('successful removal requires confirmation and uses exact non-forced checkout path',async()=>{
  const h=harness();
  h.view.checkRemoval(h.cx); await h.drain();
  assert.equal(h.calls.some(c=>c.args.includes('remove')),false);
  h.view.checkRemoval(h.cx,true); await h.drain();
  const removals=h.calls.filter(c=>c.args.includes('remove'));
  assert.equal(removals.length,1);
  assert.deepEqual(removals[0].args.slice(-4),['worktree','remove','--','/tree']);
  assert.equal(removals[0].args.includes('--force'),false);
  assert.deepEqual(h.actions,[]); assert.deepEqual(h.closed,['dialog']);
});

test('space original folder protects checkout after every pane changes directory',async()=>{
  const h=harness({sp:[{id:'open',machine:null,folder:'/tree',tabs:[{id:'tab'}]}],ps:[{tab:'tab',cwd:'/elsewhere'}]});
  h.view.checkRemoval(h.cx,true); await h.drain();
  assert.match(h.view.blocked,/Close/);
  assert.equal(h.calls.some(c=>c.args.includes('remove')),false);
});

test('remote secondary panes protect their checkout independently of first pane',async()=>{
  const h=harness({sp:[{id:'open',machine:'remote',folder:'/elsewhere',tabs:[{id:'tab'}]}],ps:[{tab:'tab',cwd:'/elsewhere'},{tab:'tab',cwd:'/tree/src'}]});
  h.view.dialog.project.machine='remote';
  h.view.checkRemoval(h.cx,true); await h.drain();
  assert.match(h.view.blocked,/Close/);
});

test('core terminals outside Herdr spaces also block removal',async()=>{
  const h=harness({ts:[{cwd:'/tree/src',machine:null}]});
  h.view.checkRemoval(h.cx,true); await h.drain();
  assert.match(h.view.blocked,/Close/);
});

test('confirmation identity fails closed when registered path changed',async()=>{
  const h=harness({target:'/tree\\name'});
  h.view.dialog.path='/tree/name';
  h.view.checkRemoval(h.cx,true); await h.drain();
  assert.match(h.view.blocked,/no longer registered/);
  assert.equal(h.calls.some(c=>c.args.includes('remove')),false);
});

test('opening a secondary-pane checkout selects its existing space rather than duplicating',()=>{
  const h=harness({sp:[{id:'existing',machine:null,folder:'/repo',tabs:[{id:'tab'}]}],ps:[{tab:'tab',cwd:'/repo'},{tab:'tab',cwd:'/tree/src'}]});
  const rows=[{path:'/repo'},{path:'/tree'}]; h.view.rows={p:rows};
  h.view.open(h.view.dialog.project,rows[1]);
  assert.deepEqual(h.actions,[['space.select',{id:'existing'}]]);
});
