import test from 'node:test';
import assert from 'node:assert/strict';
import { gh, repositories, queryFor, pullRequests, checkSummary } from '../data.js';
const ok = value => ({code: 0, stdout: JSON.stringify(value), stderr: ''});
const pr = (n, date = '2026-11-03', author = 'me') => ({number: n, url: `https://github.com/o/r/pull/${n}`, updatedAt: date, author: {login: author}});
const connection = (nodes, more = false) => ({pullRequests: {nodes, pageInfo: {hasNextPage: more, endCursor: 'next-page'}}});
const response = entries => ({data: {viewer: {login: 'Me'}, ...Object.fromEntries(entries.map((e, i) => [`r${i}`, e]))}});

test('gh errors retain useful stderr and shorten rate errors', async () => {
  await assert.rejects(gh(async () => ({code: 1, stderr: 'login required'}), []), /login required/);
  await assert.rejects(gh(async () => ({code: 1, stderr: 'HTTP 403 rate limit exceeded long URL'}), []), /Please try Refresh later/);
});
test('repository list paginates, deduplicates, sorts', async () => {
  let calls = 0;
  const rows = await repositories(async (_cmd, args) => {
    calls++;
    assert.match(args[1], new RegExp(`page=${calls}`));
    return ok(calls === 1 ? Array.from({length: 100}, (_, i) => ({full_name: `o/r${i}`})) : [{full_name: 'o/r0'}, {full_name: 'a/new'}]);
  });
  assert.equal(calls, 2); assert.equal(rows.length, 101); assert.equal(rows[0].name, 'a/new');
});
test('GraphQL query scopes repositories and encodes cursors', () => {
  const q = queryFor([{name: 'o/r'}, {name: 'x/y', cursor: 'a"b'}]);
  assert.match(q, /repository\(owner:"o",name:"r"\)/);
  assert.ok(q.includes('after:"a\\"b"'));
  assert.ok(q.includes('viewer { login }'));
});
test('queries every group, deduplicates and sorts newest first with concurrency <=2', async () => {
  let calls = 0, running = 0, max = 0;
  const result = await pullRequests(async (_cmd, args) => {
    calls++; running++; max = Math.max(max, running); await Promise.resolve(); running--;
    const count = [...args[3].matchAll(/repository\(owner:/g)].length;
    return ok(response(Array.from({length: count}, () => connection([pr(1), pr(2, '2026-11-04')]))));
  }, Array.from({length: 25}, (_, i) => `o/r${i}`), true, 100);
  assert.equal(calls, 5); assert.ok(max <= 2); assert.deepEqual(result.rows.map(p => p.number), [2, 1]);
});
test('My PRs uses viewer identity case-insensitively; All PRs includes other authors', async () => {
  const exec = async () => ok(response([connection([pr(1), pr(2, '2026-11-03', 'other')])]));
  assert.equal((await pullRequests(exec, ['o/r'], true, 100)).rows.length, 1);
  assert.equal((await pullRequests(exec, ['o/r'], false, 100)).rows.length, 2);
});
test('empty repo set never issues a global public query', async () => {
  const result = await pullRequests(() => { throw Error('must not run'); }, [], false, 100);
  assert.deepEqual(result.rows, []);
});
test('partial group failure keeps successful rows with warning', async () => {
  let calls = 0;
  const result = await pullRequests(async () => ++calls === 1 ? {code: 1, stderr: 'unavailable'} : ok(response([connection([pr(1)])])),
    Array.from({length: 7}, (_, i) => `o/r${i}`), false, 100);
  assert.equal(result.rows.length, 1); assert.match(result.warning, /Partial results.*unavailable/);
});
test('all failed groups surface error', async () => {
  await assert.rejects(pullRequests(async () => ({code: 1, stderr: 'bad token'}), ['o/r'], true, 100), /bad token/);
});
test('obsolete request stops queued queries', async () => {
  let calls = 0;
  await pullRequests(async () => { calls++; return ok(null); }, ['o/r'], true, 100, () => false);
  assert.equal(calls, 0);
});
test('independent cursors fetch older PRs and stop at requested limit', async () => {
  let calls = 0;
  const exec = async (_cmd, args) => {
    calls++;
    if (calls === 1) return ok(response([connection(Array.from({length: 100}, (_, i) => pr(i)), true), connection([pr(300)])]));
    assert.ok(args[3].includes('after:"next-page"'));
    assert.ok(!args[3].includes('name:"s"'));
    return ok(response([connection([pr(200)])]));
  };
  const result = await pullRequests(exec, ['o/r', 'o/s'], false, 200);
  assert.equal(calls, 2); assert.equal(result.rows.length, 102); assert.equal(result.limited, false);
  const limited = await pullRequests(async () => ok(response([connection(Array.from({length: 100}, (_, i) => pr(i)), true)])), ['o/r'], true, 100);
  assert.equal(limited.limited, true);
});
test('check summary distinguishes failure and pending', () => {
  assert.equal(checkSummary([]), 'No checks');
  assert.match(checkSummary([{__typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE'}]), /1 failing/);
  assert.match(checkSummary([{__typename: 'CheckRun', status: 'IN_PROGRESS'}]), /1 pending/);
});

test('partial GraphQL aliases survive a nonzero gh exit', async () => {
  const body = response([connection([pr(1)]), null]);
  body.errors = [{message: 'Repository not found', path: ['r1']}];
  const result = await pullRequests(async () => ({code: 1, stdout: JSON.stringify(body), stderr: 'graphql error'}), ['o/r', 'o/gone'], false, 100);
  assert.equal(result.rows.length, 1); assert.match(result.warning, /Partial results/);
});
test('rate exhaustion stops queued groups', async () => {
  let calls = 0;
  await assert.rejects(pullRequests(async () => { calls++; return {code: 1, stderr: 'rate limit exceeded'}; },
    Array.from({length: 60}, (_, i) => `o/r${i}`), false, 100), /rate limit/);
  assert.ok(calls <= 2);
});
test('in-flight cancellation discards stale pages and stops further groups', async () => {
  let current = true, calls = 0;
  const result = await pullRequests(async () => {
    calls++; current = false;
    return ok(response([connection([pr(1)], true)]));
  }, Array.from({length: 18}, (_, i) => `o/r${i}`), false, 200, () => current);
  assert.equal(calls, 1); assert.equal(result.rows.length, 0);
});
