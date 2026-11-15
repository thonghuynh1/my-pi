import test from 'node:test';
import assert from 'node:assert/strict';
import { ciStatus, prCIStatus, reviewers, reviewStatus } from '../details.js';
const review = (login, state, submittedAt = '2026-11-03') => ({author: {login}, state, submittedAt});

test('CI uses compact failed/building/passed/absent indicators', () => {
  assert.equal(ciStatus().state, 'none');
  assert.equal(ciStatus([{status: 'COMPLETED', conclusion: 'SUCCESS'}]).state, 'passed');
  assert.equal(ciStatus([{status: 'QUEUED'}]).state, 'building');
  assert.equal(ciStatus([{state: 'PENDING'}]).state, 'building');
  assert.equal(ciStatus([{state: 'SUCCESS'}]).state, 'passed');
  assert.equal(ciStatus([{conclusion: 'SKIPPED'}]).state, 'neutral');
  assert.equal(ciStatus([{status: 'IN_PROGRESS'}, {state: 'FAILURE'}]).state, 'failed');
});
test('requested user and team reviewers have no approval ticks', () => {
  const result = reviewers({reviewRequests: [{__typename: 'User', login: 'alice'}, {__typename: 'Team', name: 'Frontend', slug: 'org/frontend'}]});
  assert.equal(result.length, 2); assert.ok(result.every(r => r.state === 'REQUESTED'));
  assert.ok(result.some(r => r.team && r.name === 'Team · Frontend'));
  assert.ok(!reviewStatus('REQUESTED').label.includes('✓'));
});
test('latest decisive review wins; a later comment does not revoke approval', () => {
  const result = reviewers({reviews: [review('alice', 'COMMENTED', '2026-11-05'), review('alice', 'APPROVED', '2026-11-04'), review('alice', 'CHANGES_REQUESTED')]});
  assert.equal(result.length, 1); assert.equal(result[0].state, 'APPROVED');
  assert.equal(reviewStatus(result[0].state).label, '✓ Approved');
});
test('dismissed approval and requested re-review must not appear approved', () => {
  assert.equal(reviewers({reviews: [review('alice', 'APPROVED'), review('alice', 'DISMISSED', '2026-11-04') ]})[0].state, 'DISMISSED');
  const result = reviewers({reviews: [review('alice', 'APPROVED')], reviewRequests: [{login: 'ALICE'}]});
  assert.equal(result.length, 1); assert.equal(result[0].state, 'REQUESTED');
});
test('approved reviewers sort first; deleted reviewers and unsubmitted drafts are ignored', () => {
  const result = reviewers({reviews: [review('z', 'APPROVED'), review('a', 'CHANGES_REQUESTED'), review('b', 'PENDING'), {author: null, state: 'APPROVED'}]});
  assert.equal(result.length, 2); assert.equal(result[0].name, '@z');
  assert.equal(reviewers().length, 0);
});


test('PR card CI uses full latest-head rollup, not a sampled set of checks', () => {
  const pr = state => ({ciCommit:{nodes:[{commit:{statusCheckRollup:{state}}}]}});
  for (const [state, expected, color, icon] of [
    ['SUCCESS','passed','ansi2','check'],
    ['FAILURE','failed','blocked','ci-failed'],
    ['ERROR','failed','blocked','ci-failed'],
    ['PENDING','building','working','ci-pending'],
    ['EXPECTED','building','working','ci-pending'],
  ]) {
    const result=prCIStatus(pr(state));
    assert.equal(result.state,expected);
    assert.equal(result.color,color);
    assert.equal(result.icon,icon);
  }
  assert.equal(prCIStatus({ciCommit:{nodes:[{commit:{statusCheckRollup:null}}]}}).state,'none');
  for (const row of [{},{ciCommit:null},{ciCommit:{nodes:[]}},{ciCommit:{nodes:[{commit:{}}]}},pr(null),pr('FUTURE_STATE')]) {
    assert.equal(prCIStatus(row).state,'unknown');
  }
});
