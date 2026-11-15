import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeChain, mergeStatus, syncStatus, compactBranch, chainSync, chainOrigin } from '../merge.js';

const repo = 'org/repo';
const selected = {number: 3, repository: {nameWithOwner: repo}};
const raw = (number, head, base, extra = {}) => ({number, title: `PR ${number}`, html_url: `https://github.com/${repo}/pull/${number}`,
  user: {login: 'other-author'}, state: 'open', mergeable: true, mergeable_state: 'clean',
  head: {ref: head, sha: `${head}-sha`, repo: {full_name: repo}}, base: {ref: base, sha: `${base}-sha`, repo: {full_name: repo}}, ...extra});
function fixture(prs, options = {}) {
  const calls = [];
  const exec = async (command, args) => {
    assert.equal(command, 'gh'); assert.equal(args[0], 'api');
    const path = args[1]; calls.push(path);
    if (options.handler) { const result = await options.handler(path, calls); if (result) return result; }
    let value;
    if (path === `repos/${repo}`) value = {default_branch: 'master'};
    else if (path === `repos/${repo}/commits/master`) value = {sha: 'master-sha'};
    else if (path.includes('/pulls/')) value = prs.find(p => p.number === Number(path.split('/').at(-1)));
    else if (path.includes('/pulls?')) {
      const head = new URL(`https://api.github.com/${path}`).searchParams.get('head').slice('org:'.length);
      value = prs.filter(p => p.head.ref === head);
    } else if (path.includes('/compare/')) value = {ahead_by: 2, behind_by: path.includes('master-sha...') ? 4 : 0, status: 'diverged'};
    else throw new Error(`Unexpected API request: ${path}`);
    if (!value) return {code: 1, stderr: 'HTTP 404'};
    return {code: 0, stdout: JSON.stringify(value)};
  };
  return {exec, calls};
}

test('follows a stacked chain to default; compares in base...head direction', async () => {
  const f = fixture([raw(3, 'mine', 'parent'), raw(2, 'parent', 'grandparent'), raw(1, 'grandparent', 'master')]);
  const result = await mergeChain(f.exec, selected);
  assert.equal(result.end, 'default');
  assert.deepEqual(result.steps.map(p => p.number), [3, 2, 1]);
  assert.equal(result.steps[0].comparison.behind_by, 0);
  assert.equal(result.steps[0].baseDrift.behind_by, 4);
  assert.ok(f.calls.includes(`repos/${repo}/compare/parent-sha...mine-sha?per_page=1`));
  assert.ok(f.calls.includes(`repos/${repo}/compare/master-sha...parent-sha?per_page=1`));
  assert.ok(f.calls.filter(c => c.includes('/pulls?')).every(c => c.includes('state=open') && !c.includes('author')));
});
test('a direct default-branch PR stops without a parent lookup', async () => {
  const f = fixture([raw(3, 'mine', 'master')]);
  const r = await mergeChain(f.exec, selected);
  assert.equal(r.steps.length, 1); assert.equal(r.end, 'default');
  assert.equal(r.steps[0].comparison.behind_by, 4);
  assert.ok(!f.calls.some(c => c.includes('/pulls?')));
});
test('selected head and base have independent default-branch ancestry', async () => {
  const f = fixture([raw(3, 'mine', 'parent')], {handler: path => {
    if (path.includes('/compare/master-sha...mine-sha')) return {code: 0, stdout: JSON.stringify({ahead_by: 3, behind_by: 0})};
  }});
  const r = await mergeChain(f.exec, selected);
  assert.equal(r.steps[0].headDrift.behind_by, 0);
  assert.equal(r.steps[0].baseDrift.behind_by, 4);
  const g = fixture([raw(3, 'mine', 'parent')], {handler: path => {
    if (path.includes('/compare/master-sha...parent-sha')) return {code: 0, stdout: JSON.stringify({ahead_by: 3, behind_by: 0})};
  }});
  const s = await mergeChain(g.exec, selected);
  assert.equal(s.steps[0].headDrift.behind_by, 4);
  assert.equal(s.steps[0].baseDrift.behind_by, 0);
});
test('missing parent does not guess the base branch targets master', async () => {
  const f = fixture([raw(3, 'mine', 'feature/unknown')]);
  const r = await mergeChain(f.exec, selected);
  assert.equal(r.end, 'missing'); assert.equal(r.steps.length, 1);
  assert.equal(r.steps[0].baseDrift.behind_by, 4);
  assert.ok(f.calls.some(c => c.includes('head=org%3Afeature%2Funknown')));
});
test('multiple parent PRs require explicit inspection, not arbitrary selection', async () => {
  const f = fixture([raw(3, 'mine', 'parent'), raw(2, 'parent', 'master'), raw(1, 'parent', 'release')]);
  const r = await mergeChain(f.exec, selected);
  assert.equal(r.end, 'ambiguous'); assert.equal(r.alternatives.length, 2); assert.equal(r.steps.length, 1);
});
test('does not mistake a fork branch of the same name for the base-branch PR', async () => {
  const fork = raw(2, 'parent', 'master'); fork.head.repo.full_name = 'someone/repo';
  const f = fixture([raw(3, 'mine', 'parent'), fork]);
  assert.equal((await mergeChain(f.exec, selected)).end, 'missing');
});
test('cycles and depth limits are explicit and bounded', async () => {
  const f = fixture([raw(3, 'mine', 'parent'), raw(2, 'parent', 'mine')]);
  const r = await mergeChain(f.exec, selected);
  assert.equal(r.end, 'cycle'); assert.equal(r.steps.length, 2);
  const g = fixture([raw(3, 'mine', 'parent'), raw(2, 'parent', 'master')]);
  const limited = await mergeChain(g.exec, selected, () => true, 1);
  assert.equal(limited.end, 'limit'); assert.equal(limited.steps.length, 1);
  assert.ok(!g.calls.some(c => c.endsWith('/pulls/2')));
});
test('unavailable comparisons preserve the chain and are not shown as up to date', async () => {
  const f = fixture([raw(3, 'mine', 'master')], {handler: path => path.includes('/compare/') && {code: 1, stderr: 'HTTP 404: commit missing'}});
  const r = await mergeChain(f.exec, selected);
  assert.equal(r.end, 'default'); assert.ok(r.steps[0].comparisonError.includes('404'));
  assert.equal(syncStatus(r.steps[0].comparison, 'master').color, 'muted');
});
test('rate limits stop further requests but keep already fetched steps', async () => {
  const f = fixture([raw(3, 'mine', 'parent')], {handler: path => path.includes('/compare/') && {code: 1, stderr: 'API rate limit exceeded'}});
  const r = await mergeChain(f.exec, selected);
  assert.equal(r.end, 'unavailable'); assert.equal(r.steps.length, 1);
  assert.ok(r.warnings[0].includes('rate limit')); assert.ok(!f.calls.some(c => c.includes('/pulls?')));
});
test('obsolete selections stop scheduling and return no stale chain', async () => {
  let current = true;
  const f = fixture([raw(3, 'mine', 'master')], {handler: () => {current = false;}});
  assert.equal(await mergeChain(f.exec, selected, () => current), null);
  assert.equal(f.calls.length, 1);
});
test('a full parent lookup page is explicitly incomplete', async () => {
  const f = fixture([raw(3, 'mine', 'parent')], {handler: path => path.includes('/pulls?') && {code: 0, stdout: JSON.stringify(Array.from({length: 100}, (_, i) => raw(i + 10, 'parent', 'master')))}});
  const r = await mergeChain(f.exec, selected);
  assert.equal(r.end, 'limit'); assert.ok(r.warnings[0].includes('100 results'));
});
test('missing upstream PR shows default as an explicit comparison reference, not a PR target', () => {
  const top = {base: {name: 'feature/66077'}, baseDrift: {ahead_by: 40, behind_by: 4}};
  const chain = {steps: [top], defaultBranch: 'master', end: 'missing'};
  assert.deepEqual(chainOrigin(chain), {reference: 'master', status: {label: 'need-merge', color: 'working'}});
  top.baseDrift.behind_by = 0;
  assert.equal(chainOrigin(chain).status.label, 'up to date');
  delete top.baseDrift;
  assert.equal(chainOrigin(chain).status.label, 'unknown');
  for (const end of ['', 'default', 'ambiguous', 'cycle', 'limit', 'unavailable']) {
    assert.deepEqual(chainOrigin({...chain, end}), {reference: '', status: null});
  }
  assert.deepEqual(chainOrigin(undefined), {reference: '', status: null});
  assert.equal(chainOrigin({...chain, steps: []}).reference, '');
});
test('compact chain labels preserve work-item IDs and ordinary branch names', () => {
  assert.equal(compactBranch('feature/66340-mark-read-unread-native'), 'feature/66340');
  assert.equal(compactBranch('feature/67916-signalr-functions'), 'feature/67916');
  assert.equal(compactBranch('master'), 'master');
  assert.equal(compactBranch('release/2026/November'), 'release/2026/November');
  assert.equal(compactBranch(), 'unknown');
});
test('compact chain sync refers only to the immediate target; unknown is not green', () => {
  assert.equal(chainSync({comparison: {ahead_by: 3, behind_by: 0}, headDrift: {behind_by: 10}}).label, 'up to date');
  assert.equal(chainSync({comparison: {ahead_by: 3, behind_by: 2}}).label, 'need-merge');
  assert.equal(chainSync({}).label, 'unknown');
  assert.equal(chainSync({}, true).label, 'checking…');
  assert.equal(chainSync({comparisonError: '404'}, true).label, 'unknown');
  assert.equal(chainSync({mergeable: false, comparison: {behind_by: 0}}).label, 'conflicts');
  assert.equal(chainSync({merged: true}).label, 'merged');
});
test('merge statuses distinguish conflicts, rules, unknown and actual mergeability', () => {
  assert.equal(mergeStatus({mergeable: false}).color, 'blocked');
  assert.match(mergeStatus({isDraft: true, mergeable: false}).label, /conflicts/);
  assert.match(mergeStatus({mergeable: true, mergeableState: 'blocked'}).label, /Blocked/);
  assert.match(mergeStatus({mergeable: true, mergeableState: 'behind'}).label, /required/);
  assert.match(mergeStatus({mergeable: null}).label, /not calculated/);
  assert.match(mergeStatus({merged: true}).label, /Already merged/);
  assert.match(mergeStatus({state: 'closed'}).label, /Closed/);
  assert.match(mergeStatus({isDraft: true}).label, /Draft/);
  assert.equal(mergeStatus({mergeableState: 'clean'}).color, 'ansi2');
  assert.match(syncStatus({ahead_by: 3, behind_by: 0}, 'master').label, /Up to date/);
  assert.match(syncStatus({ahead_by: 3, behind_by: 4}, 'master').label, /4 commits behind/);
});
