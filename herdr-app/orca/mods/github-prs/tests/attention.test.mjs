import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboard, latestFeedback, unseenFeedback, trackFeedback, prKey, dashboardHidden, toggleDashboardPR, feedbackTooltip, feedbackSummary, dismissDashboardPR, prFields } from '../attention.js';
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

test('dashboard deduplicates authored/direct/team PRs and preserves discovery labels', async () => {
  const calls = [];
  const exec = async (_cmd,args) => {
    calls.push(args);
    if(args[1].startsWith('user/teams')) return ok([{organization:{login:'org'},slug:'devs'}]);
    assert.match(args[3],/author:@me/);
    assert.match(args[3],/review-requested:@me/);
    assert.match(args[3],/team-review-requested:org\/devs/);
    return ok({data:{viewer:{login:'me'},s0:{nodes:[pr()],pageInfo:{hasNextPage:false}},s1:{nodes:[pr()],pageInfo:{hasNextPage:false}},s2:{nodes:[pr()],pageInfo:{hasNextPage:false}}}});
  };
  const result = await dashboard(exec);
  assert.equal(result.rows.length,1);
  assert.deepEqual(result.rows[0].assignments,['Your PR','Your review requested','Team · org/devs']);
  assert.equal(result.warning,''); assert.equal(calls.length,2);
  assert.ok(calls.every(args => !args.includes('-X') && !args.includes('PATCH')));
});

test('team permission failure keeps authored and direct PRs and reports partial coverage', async () => {
  const result = await dashboard(async (_cmd,args) => args[1].startsWith('user/teams')
    ? {code:1,stdout:'',stderr:'HTTP 403'}
    : ok({data:{viewer:{login:'me'},s0:{nodes:[pr()],pageInfo:{hasNextPage:true}},s1:{nodes:[pr(2)],pageInfo:{hasNextPage:false}}}}));
  assert.equal(result.rows.length,2);
  assert.match(result.warning,/Team assignments unavailable/);
  assert.match(result.warning,/25 most recently/);
});

test('authored PR returns after dismissal when external feedback arrives without a review request', async () => {
  const old = {...pr(442), updatedAt:'2026-11-03T08:26:39Z'};
  const updated = {...old, updatedAt:'2026-11-05T06:48:05Z', reviews:{nodes:[
    {id:'approval', state:'APPROVED', submittedAt:'2026-11-05T06:48:05Z', author:{login:'reviewer'}}
  ]}};
  const state = dismissDashboardPR(old, {seen:{[prKey(old)]:'2026-11-02T09:53:33Z'}});
  const result = await dashboard(async (_cmd,args) => {
    if (args[1].startsWith('user/teams')) return ok([]);
    assert.match(args[3], /is:pr is:open author:@me sort:updated-desc/);
    return ok({data:{viewer:{login:'me'},
      s0:{nodes:[updated],pageInfo:{hasNextPage:false}},
      s1:{nodes:[],pageInfo:{hasNextPage:false}}}});
  });
  assert.equal(result.rows.length,1);
  assert.deepEqual(result.rows[0].assignments,['Your PR']);
  assert.equal(dashboardHidden(result.rows[0],state),false);
  const next = trackFeedback(result.rows,result.viewer,state);
  assert.equal(feedbackTooltip(unseenFeedback(result.rows[0],result.viewer,next.seen,next.pending)), '@reviewer · Approved');
  assert.equal(dashboardHidden(result.rows[0],toggleDashboardPR(updated,state)),true);
});

test('cancellation discards dashboard results', async () => {
  let current = true;
  const result = await dashboard(async () => { current=false; return ok([]); },()=>current);
  assert.equal(result,null);
});

test('bounded team discovery reports cap and searches at most 20 teams plus authored and direct searches', async () => {
  let searches = 0;
  const result = await dashboard(async (_cmd,args) => {
    if(args[1].startsWith('user/teams')) return ok(Array.from({length:21},(_,i)=>({organization:{login:'org'},slug:`team${i}`})));
    const aliases = [...args[3].matchAll(/s(\d+): search/g)]; searches += aliases.length;
    const data = {viewer:{login:'me'}};
    for(const [,i] of aliases) data[`s${i}`]={nodes:[],pageInfo:{hasNextPage:false}};
    return ok({data});
  });
  assert.equal(searches,22); assert.match(result.warning,/first 20 teams/);
});

test('My PR summaries retain viewer and only authored PRs', async () => {
  const query = queryFor([{name:'Org/Repo'}]);
  assert.match(query,/comments\(last:5\)/); assert.match(query,/reviews\(last:5\)/);
  const result = await pullRequests(async()=>ok({data:{viewer:{login:'Me'},r0:{pullRequests:{nodes:[pr(),{...pr(2),author:{login:'other'}}],pageInfo:{hasNextPage:false}}}}}),['Org/Repo'],true,100);
  assert.equal(result.viewer,'Me'); assert.equal(result.rows.length,1);
});

test('removed dashboard PR stays hidden after updates and can be restored', () => {
  const row=pr();
  const original={seen:{keep:'timestamp'},pending:{keep:{at:'date'}}};
  const state=toggleDashboardPR(row,original);
  assert.equal(dashboardHidden(row,state),true);
  const updated={...row,updatedAt:'2026-11-04T12:00:00Z'};
  assert.equal(dashboardHidden(updated,JSON.parse(JSON.stringify(state))),true);
  assert.equal(dashboardHidden(pr(2),state),false);
  assert.equal(dashboardHidden({...row,repository:{nameWithOwner:'other/repo'}},state),false);
  const restored=toggleDashboardPR(updated,state);
  assert.equal(dashboardHidden(updated,restored),false);
  assert.deepEqual(restored.seen,original.seen);
  assert.deepEqual(restored.pending,original.pending);
  assert.equal(original.unfollowed,undefined);
});

test('legacy temporary dismissals remain restorable without changing seen feedback', () => {
  const row=pr(),state={dismissed:{[prKey(row)]:row.updatedAt}};
  assert.equal(dashboardHidden(row,state),true);
  assert.equal(dashboardHidden({...row,updatedAt:'later'},state),false);
  assert.equal(dashboardHidden(row,toggleDashboardPR(row,state)),false);
});

test('comment notification is people plus unread count, never comment text', () => {
  const comment=(id,who,at)=>({id,author:{login:who},updatedAt:at,bodyText:'Do not show this body'});
  const row={...pr(),comments:{nodes:[
    comment('1','Alice','2026-11-03T10:00:00Z'),
    comment('2','Bob','2026-11-03T11:00:00Z'),
    comment('3','Alice','2026-11-03T12:00:00Z'),
    comment('4','Bob','2026-11-03T13:00:00Z'),
    comment('own','me','2026-11-03T14:00:00Z'),
  ]}};
  const event=unseenFeedback(row,'me');
  assert.equal(feedbackSummary(event).label,'4 new comments');
  assert.equal(feedbackSummary(event).people,'@Bob, @Alice');
  assert.equal(feedbackTooltip(event),'@Bob, @Alice · 4 new comments');
  assert.doesNotMatch(feedbackTooltip(event),/Do not show|2026/);
  assert.equal(feedbackTooltip(null),'');
  const seen={[prKey(row)]:'2026-11-03T12:00:00Z'};
  assert.equal(feedbackTooltip(unseenFeedback(row,'me',seen)),'@Bob · 1 new comment');
});

test('inline comments are counted and repeated refreshes do not double count', () => {
  const row={...pr(),reviews:{nodes:[{id:'review',state:'CHANGES_REQUESTED',submittedAt:pr().updatedAt,author:{login:'reviewer'},comments:{nodes:[
    {id:'inline1',updatedAt:'2026-11-03T13:00:00Z',author:{login:'reviewer'}},
    {id:'inline2',updatedAt:'2026-11-03T14:00:00Z',author:{login:'other'}},
  ]}}]}};
  let state=trackFeedback([row],'me',{});
  state=trackFeedback([row],'me',JSON.parse(JSON.stringify(state)));
  assert.equal(feedbackSummary(state.pending[prKey(row)]).label,'2 new comments');
  row.reviews.nodes=[];
  state=trackFeedback([row],'me',state);
  assert.equal(feedbackSummary(unseenFeedback(row,'me',state.seen,state.pending)).label,'2 new comments');
  assert.equal(unseenFeedback(row,'me',{[prKey(row)]:'2026-11-03T14:00:00Z'},state.pending),null);
});

test('dismiss only hides the current update while remove persists independently', () => {
  const row=pr(), updated={...row,updatedAt:'2026-11-05T12:00:00Z'};
  const state=dismissDashboardPR(row,{seen:{keep:'date'}});
  assert.equal(dashboardHidden(row,state),true);
  assert.equal(dashboardHidden(updated,state),false);
  assert.deepEqual(state.seen,{keep:'date'});
  assert.equal(state.unfollowed,undefined);
  const removed=toggleDashboardPR(updated,state);
  const dismissedAgain=dismissDashboardPR(updated,removed);
  assert.equal(dashboardHidden({...updated,updatedAt:'2026-11-06T12:00:00Z'},dismissedAgain),true);
});


test('list queries load feedback and aggregate CI without branch/file detail', () => {
  for (const query of [prFields, queryFor([{name:'Org/Repo'}])]) {
    assert.ok(query.includes('hasPreviousPage'));
    assert.doesNotMatch(query,/bodyText/);
    assert.doesNotMatch(query,/headRefName|changedFiles|files\(|messageHeadline/);
    assert.match(query,/ciCommit: commits\(last:1\)/);
    assert.match(query,/statusCheckRollup \{ state \}/);
  }
});

test('approval notification stays short and may also summarize unread comments', () => {
  const row={...pr(),author:{login:'teammate'},reviews:{nodes:[{id:'r',state:'APPROVED',submittedAt:pr().updatedAt,author:{login:'reviewer'},bodyText:'Hidden review text'}]}};
  const state=trackFeedback([row],'me',{});
  const before=JSON.stringify(state);
  const event=unseenFeedback(row,'me',state.seen,state.pending);
  assert.equal(feedbackTooltip(event),'@reviewer · Approved');
  assert.equal(JSON.stringify(state),before);
  assert.equal(unseenFeedback(row,'me',{[prKey(row)]:event.at},state.pending),null);
  row.comments={nodes:[{id:'c',updatedAt:'2026-11-03T11:00:00Z',author:{login:'Alice'}}]};
  assert.equal(feedbackTooltip(unseenFeedback(row,'me')),'@reviewer · Approved\n@Alice · 1 new comment');
});

test('dashboard feedback survives rollover for PRs authored by someone else', () => {
  const row={...pr(),author:{login:'teammate'},comments:{nodes:[{id:'1',updatedAt:pr().updatedAt,author:{login:'teammate'},bodyText:'Hidden body'}]}};
  const state=trackFeedback([row],'me',{});
  const refreshed=trackFeedback([{...row,comments:{nodes:[]}}],'me',state);
  assert.equal(feedbackTooltip(unseenFeedback({...row,comments:{nodes:[]}},'me',refreshed.seen,refreshed.pending)),'@teammate · 1 new comment');
  assert.deepEqual(trackFeedback([row],'',{}).pending,{});
});

test('edited comments keep stable IDs and partial windows use a plus count', () => {
  const row={...pr(),comments:{nodes:[{id:'c',updatedAt:pr().updatedAt,author:{login:'Alice'}}]}};
  const state=trackFeedback([row],'me',{});
  row.comments.nodes[0].updatedAt='2026-11-03T14:00:00Z';
  const next=trackFeedback([row],'me',state);
  assert.equal(feedbackSummary(next.pending[prKey(row)]).label,'1 new comment');
  row.comments.pageInfo={hasPreviousPage:true};
  assert.equal(feedbackSummary(unseenFeedback(row,'me')).label,'1+ new comments');
});

test('legacy saved notifications migrate without duplicates or retained previews', () => {
  const row={...pr(),comments:{nodes:[{id:'c',updatedAt:pr().updatedAt,author:{login:'Alice'}}]}};
  const pending={[prKey(row)]:{at:row.updatedAt,label:'New comment',who:'Alice',tone:'blue',preview:'Old body'}};
  const event=unseenFeedback(row,'me',{},pending);
  assert.equal(feedbackSummary(event).label,'1 new comment');
  assert.doesNotMatch(JSON.stringify(event),/Old body|preview/);
});

test('stored event count and actor display remain bounded without claiming completeness', () => {
  const row={...pr(),comments:{nodes:Array.from({length:210},(_,i)=>({id:String(i),updatedAt:pr().updatedAt,author:{login:'person'+i}}))}};
  const event=unseenFeedback(row,'me');
  assert.equal(event.events.length,200);
  assert.equal(feedbackSummary(event).label,'200+ new comments');
  assert.match(feedbackSummary(event).people,/197 others/);
});

test('legacy notification edited before migration is not counted twice', () => {
  const row={...pr(),comments:{nodes:[{id:'c',updatedAt:'2026-11-03T14:00:00Z',author:{login:'Alice'}}]}};
  const pending={[prKey(row)]:{at:pr().updatedAt,label:'New comment',who:'Alice',tone:'blue',preview:'Old body'}};
  const event=unseenFeedback(row,'me',{},pending);
  assert.equal(event.events.length,1);
  assert.equal(feedbackSummary(event).label,'1+ new comments');
  const next=trackFeedback([row],'me',{pending});
  assert.equal(next.pending[prKey(row)].events.length,1);
});
