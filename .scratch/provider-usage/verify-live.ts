import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { providerReaders } from '../../extensions/lib/provider-usage/readers.ts';
import { footerRows, detailText, type ProviderState } from '../../extensions/lib/provider-usage/model.ts';
import { layoutUsageLines } from '../../extensions/usage-footer.ts';
import { visibleWidth } from '@earendil-works/pi-tui';

const states: ProviderState[] = await Promise.all(providerReaders().map(async reader => {
  const now = Date.now();
  try {
    const value = await reader.read(AbortSignal.timeout(35_000));
    return { id: reader.id, name: reader.name, experimental: reader.experimental, status: 'available' as const, value, lastAttempt: now, lastSuccess: Date.now() };
  } catch {
    return { id: reader.id, name: reader.name, status: 'error' as const, error: 'Live read failed', lastAttempt: now };
  }
}));
const evidence = [detailText(states)];
for (const width of [160, 80, 40]) {
  const lines = layoutUsageLines(['ctx example', 'in example · out example', 'total example'], 'model (layout example)', footerRows(states), width);
  assert(lines.every(line => visibleWidth(line) <= width));
  evidence.push(`FOOTER width=${width}\n${lines.join('\n')}`);
}
const report = evidence.join('\n\n');
writeFileSync('.scratch/provider-usage/live-evidence.txt', report);
console.log(report);
assert.equal(states.filter(state => state.status === 'available').length, 3, 'all three live adapters must succeed');
