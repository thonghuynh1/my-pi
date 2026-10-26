import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { providerReaders } from '../../extensions/lib/provider-usage/readers.ts';
import { detailText, compactFooterRows, type ProviderState } from '../../extensions/lib/provider-usage/model.ts';
const states: ProviderState[] = [];
for (const reader of providerReaders().filter(r => r.id.startsWith('claude-'))) {
  const lastAttempt = Date.now();
  try {
    const value = await reader.read(AbortSignal.timeout(35000));
    assert.equal(value.kind, 'spend');
    assert.equal(value.fetchedAt, undefined, 'must not invent a provider fetch timestamp');
    states.push({id:reader.id,name:reader.name,status:'available',value,lastAttempt,lastSuccess:Date.now()});
  } catch (e) {
    states.push({id:reader.id,name:reader.name,status:'error',lastAttempt,error:e instanceof Error?e.message:'failed'});
  }
}
assert.equal(states.length,2);
const report = ['Production Claude control reader',new Date().toISOString(),detailText(states),'FOOTER',...compactFooterRows(states)].join('\n');
writeFileSync('.scratch/provider-usage/claude-control-evidence.txt',report+'\n');
console.log(report);
assert(states.every(state => state.status === 'available'), 'both Claude profiles must return account usage');
const personal = states.find(state => state.id === 'claude-personal')!;
assert(personal.value?.kind === 'spend' && personal.value.windows.some(window => window.id === '5h') && personal.value.windows.some(window => window.id === 'week'), 'personal must report both quota windows');
console.log('VERIFY_COMPLETE');
