import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as data from '../mods/project-spaces/data.js';

const source = (await readFile(new URL('../mods/project-spaces/main.js',import.meta.url),'utf8'))
  .replace(/^import .*;\r?\n/gm,'').replace('export default class Projects','return class Projects');
function harness({dirty=false,sp=[],ps=[],ts=[],target='/tree',state=new Map(),removeError=''}={}) {
  const calls=[], actions=[], closed=[], overlays=[], tasks=[], notices=[], storage=new Map();
  let currentDirty=dirty;
  const dependencies = {
    ...data, View:class {},
    shared:key=>state.get(key),setShared:(key,value)=>state.set(key,value),notify:n=>notices.push(n),
    localStorage:{getItem:key=>storage.get(key) ?? null,setItem:(key,value)=>storage.set(key,value)},
    spaces:()=>sp,panes:()=>ps,terminals:()=>ts,window:()=>({active:true}),
    props:()=>({overlay:'dialog'}),closeOverlay:id=>closed.push(id),
    openOverlay:args=>overlays.push(args), run:(...args)=>actions.push(args),
    exec:async (_command,args,options)=>{
      calls.push({args,options});
      if (args.includes('remove') && removeError) return {code:1,stderr:removeError,stdout:''};
      let stdout='';
      if(args.includes('list')) stdout=`worktree /repo\0HEAD aaa\0branch refs/heads/main\0\0worktree ${target}\0HEAD bbb\0branch refs/heads/topic\0\0`;
      if(args.includes('status')) stdout=currentDirty && options.cwd===target ? '? changed\n' : '# branch.head topic\n';
      if(args.includes('rev-list')) stdout='2\n';
      return {code:0,stdout};
    },
  };
  const Projects = new Function(...Object.keys(dependencies),source)(...Object.values(dependencies));
  const view = new Projects(); view.busy=false; view.error=''; view.rows={}; view.discover=()=>{};
  view.dialog={project:{key:'p',cwd:'/repo/.git',machine:null},path:target};
  const cx={spawn:fn=>tasks.push(fn(cx)),notify:()=>{}};
  return {view,cx,calls,actions,closed,overlays,storage,notices,state,setDirty:value=>{currentDirty=value;},drain:async()=>{while(tasks.length)await tasks.shift();}};
}

test('confirmation rechecks dirtiness and force removes without deleting branches or closing spaces', async()=>{
  const h=harness();
  h.view.checkRemoval(h.cx); await h.drain();
  assert.equal(h.view.blocked,null);
  h.setDirty(true);
  h.view.confirmRemoval();
  h.view.processRemovals(h.cx); await h.drain();
  assert.equal(h.view.blocked,null);
  assert.equal(h.calls.filter(c=>c.args.includes('--force')).length,1);
  assert.deepEqual(h.actions,[]); assert.deepEqual(h.closed,['dialog']);
});

test('successful removal requires confirmation and uses double force on exact checkout path',async()=>{
  const h=harness();
  h.view.checkRemoval(h.cx); await h.drain();
  assert.equal(h.calls.some(c=>c.args.includes('remove')),false);
  h.view.confirmRemoval();
  assert.deepEqual(h.closed,['dialog']); // Modal closes before any deletion starts.
  assert.equal(h.calls.some(c=>c.args.includes('remove')),false);
  h.view.processRemovals(h.cx); await h.drain();
  assert.equal(h.notices[0].level,'success');
  const removals=h.calls.filter(c=>c.args.includes('remove'));
  assert.equal(removals.length,1);
  assert.deepEqual(removals[0].args.slice(-6),['worktree','remove','--force','--force','--','/tree']);
  assert.deepEqual(h.actions,[]); assert.deepEqual(h.closed,['dialog']);
});

test('confirmation is disabled while checking and queues only once',async()=>{
  const h=harness();
  h.view.checkRemoval(h.cx);
  assert.equal(h.view.busy,true);
  h.view.confirmRemoval();
  assert.deepEqual(h.closed,[]);
  await h.drain();
  h.view.confirmRemoval(); h.view.confirmRemoval();
  assert.equal(h.state.get('projects.removals').length,1);
  assert.deepEqual(h.closed,['dialog']);
});

test('background worker rechecks newly opened terminals and reports failure after modal closes',async()=>{
  const ts=[],h=harness({ts});
  h.view.checkRemoval(h.cx); await h.drain();
  h.view.confirmRemoval();
  ts.push({cwd:'/tree/src',machine:null});
  h.view.processRemovals(h.cx); await h.drain();
  assert.equal(h.calls.some(c=>c.args.includes('remove')),false);
  assert.deepEqual(h.closed,['dialog']);
  assert.equal(h.notices[0].level,'error');
  assert.match(h.notices[0].body,/Close/);
  assert.equal(h.view.removing,null);
});

test('separate sidebar copy owns removal after the dialog is closed',async()=>{
  const state=new Map(), dialog=harness({state}), sidebar=harness({state});
  dialog.view.checkRemoval(dialog.cx); await dialog.drain();
  dialog.view.confirmRemoval();
  assert.deepEqual(dialog.closed,['dialog']);
  assert.equal(dialog.calls.some(c=>c.args.includes('remove')),false);
  sidebar.view.processRemovals(sidebar.cx); await sidebar.drain();
  assert.equal(sidebar.calls.filter(c=>c.args.includes('remove')).length,1);
  assert.equal(sidebar.notices[0].level,'success');
  assert.deepEqual(state.get('projects.removals'),[]);
});

test('background Git errors are surfaced and do not retry deletion',async()=>{
  const h=harness({removeError:'permission denied'});
  h.view.checkRemoval(h.cx); await h.drain();
  h.view.confirmRemoval();
  h.view.processRemovals(h.cx); await h.drain();
  assert.equal(h.notices[0].level,'error');
  assert.match(h.notices[0].body,/permission denied/);
  h.view.processRemovals(h.cx); await h.drain();
  assert.equal(h.calls.filter(c=>c.args.includes('remove')).length,1);
});

test('queued and running worktrees cannot open; success removes cached card',async()=>{
  const h=harness(), project=h.view.dialog.project, row={path:'/tree'}, other={path:'/other'};
  h.view.rows={p:[row,other]};
  h.view.checkRemoval(h.cx); await h.drain();
  h.view.confirmRemoval();
  assert.equal(h.view.isRemoving(project,row.path),true);
  assert.equal(h.view.isRemoving({...project,key:'different'},row.path),false);
  assert.equal(h.view.isRemoving(project,other.path),false);
  h.view.open(project,row);
  assert.deepEqual(h.actions,[]);
  h.view.processRemovals(h.cx);
  assert.equal(h.view.isRemoving(project,row.path),true);
  h.view.open(project,row);
  assert.deepEqual(h.actions,[]);
  await h.drain();
  assert.equal(h.view.isRemoving(project,row.path),false);
  assert.deepEqual(h.view.rows.p,[other]);
});

test('failed removal unlocks the row and retains cached card',async()=>{
  const h=harness({removeError:'denied'}), project=h.view.dialog.project, row={path:'/tree'};
  h.view.rows={p:[row]};
  h.view.checkRemoval(h.cx); await h.drain();
  h.view.confirmRemoval(); h.view.processRemovals(h.cx); await h.drain();
  assert.equal(h.view.isRemoving(project,row.path),false);
  assert.deepEqual(h.view.rows.p,[row]);
  h.view.open(project,row);
  assert.equal(h.actions[0][0],'space.new');
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
