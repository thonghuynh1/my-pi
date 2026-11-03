import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboard, latestFeedback, unseenFeedback, trackFeedback, prKey } from '../attention.js';
import { queryFor, pullRequests } from '../data.js';

const pr = (n = 1) => ({ number:n, title:'Example', url:`https://github.com/org/repo/pull/${n}`, updatedAt:'2026-11-03T12:00:00Z', repository:{nameWithOwner:'Org/Repo'}, author:{login:'me'} });
const ok = value => ({code:0, stdout:JSON.stringify(value), stderr:''});

test('activity ignores own feedback and pending reviews, chooses latest external event', () => {
  const row = {...pr(), comments:{nodes:[{updatedAt:'2026-11-03T11:00:00Z', author:{login:'ME'}}]}, reviews:{nodes:[{state:'PENDING', author:{login:'reviewer'}, submittedAt:null, comments:{nodes:[]}}]}};
  assert.equal(latestFeedback(row,'me'),null);
  row.reviews.nodes = [{state:'APPROVED',submittedAt:'2026-11-03T10:00:00Z',author:{login:'reviewer'},comments:{nodes:[{updatedAt:'2026-11-03T11:00:00Z',author:{login:'other'}}]}}];
  assert.equal(latestFeedback(row,'me').label,'Review comment');
  assert.equal(unseenFeedback(row,'me',{[prKey(row)]:'2026-11-03T11:00:00Z'}),null);
  assert.equal(unseenFeedback(row,'me',{}).who,'other');
  assert.equal(latestFeedback(row,''),null);
});

test('observed feedback survives own replies and bounded summary rollover until acknowledged', () => {
  const row = {...pr(), comments:{nodes:[{updatedAt:pr().updatedAt, author:{login:'reviewer'}}]}};
  const state = trackFeedback([row],'me',{seen:{}});
  row.comments.nodes = [{updatedAt:'2026-11-03T13:00:00Z',author:{login:'me'}}];
  const next = trackFeedback([row],'me',state);
  assert.equal(unseenFeedback(row,'me',next.seen,next.pending).who,'reviewer');
  assert.equal(unseenFeedback(row,'me',{[prKey(row)]:pr().updatedAt},next.pending),null);
});

test('approval and changes-requested events preserve kind and actor', () => {
  for (const [state,label] of [['APPROVED','Approved'],['CHANGES_REQUESTED','Changes requested']]) {
    const row = {...pr(),reviews:{nodes:[{state,submittedAt:pr().updatedAt,author:{login:'reviewer'}}]}};
    assert.equal(latestFeedback(row,'me').label,label);
  }
});

test('dashboard deduplicates direct/team requests and preserves assignment labels', async () => {
  const calls = [];
  const exec = async (_cmd,args) => {
    calls.push(args);
    if(args[1].startsWith('user/teams')) return ok([{organization:{login:'org'},slug:'devs'}]);
    assert.match(args[3],/review-requested:@me/);
    assert.match(args[3],/team-review-requested:org\/devs/);
    return ok({data:{viewer:{login:'me'},s0:{nodes:[pr()],pageInfo:{hasNextPage:false}},s1:{nodes:[pr()],pageInfo:{hasNextPage:false}}}});
  };
  const result = await dashboard(exec);
  assert.equal(result.rows.length,1);
  assert.deepEqual(result.rows[0].assignments,['Your review requested','Team · org/devs']);
  assert.equal(result.warning,''); assert.equal(calls.length,2);
  assert.ok(calls.every(args => !args.includes('-X') && !args.includes('PATCH')));
});

test('team permission failure keeps direct requests and reports partial coverage', async () => {
  const result = await dashboard(async (_cmd,args) => args[1].startsWith('user/teams')
    ? {code:1,stdout:'',stderr:'HTTP 403'}
    : ok({data:{viewer:{login:'me'},s0:{nodes:[pr()],pageInfo:{hasNextPage:true}}}}));
  assert.equal(result.rows.length,1);
  assert.match(result.warning,/Team assignments unavailable/);
  assert.match(result.warning,/25 most recently/);
});

test('cancellation discards dashboard results', async () => {
  let current = true;
  const result = await dashboard(async () => { current=false; return ok([]); },()=>current);
  assert.equal(result,null);
});

test('bounded team discovery reports cap and searches at most 20 teams plus viewer', async () => {
  let searches = 0;
  const result = await dashboard(async (_cmd,args) => {
    if(args[1].startsWith('user/teams')) return ok(Array.from({length:21},(_,i)=>({organization:{login:'org'},slug:`team${i}`})));
    const aliases = [...args[3].matchAll(/s(\d+): search/g)]; searches += aliases.length;
    const data = {viewer:{login:'me'}};
    for(const [,i] of aliases) data[`s${i}`]={nodes:[],pageInfo:{hasNextPage:false}};
    return ok({data});
  });
  assert.equal(searches,21); assert.match(result.warning,/first 20 teams/);
});

test('My PR summaries retain viewer and only authored PRs', async () => {
  const query = queryFor([{name:'Org/Repo'}]);
  assert.match(query,/comments\(last:5\)/); assert.match(query,/reviews\(last:5\)/);
  const result = await pullRequests(async()=>ok({data:{viewer:{login:'Me'},r0:{pullRequests:{nodes:[pr(),{...pr(2),author:{login:'other'}}],pageInfo:{hasNextPage:false}}}}}),['Org/Repo'],true,100);
  assert.equal(result.viewer,'Me'); assert.equal(result.rows.length,1);
});
