import { validateBody, validateTargets } from '../functions/_shared/domain.ts';
function assert(value: unknown, message = 'Assertion failed'): asserts value { if (!value) throw new Error(message); }
function rejects(fn: () => unknown) { try { fn(); } catch { return; } throw new Error('Expected rejection'); }
Deno.test('server-side text and classroom validation', () => {
  assert(validateBody('  广播  ') === '广播'); assert(validateTargets(['8-1','8-6']).length === 2);
  rejects(() => validateBody(' ')); rejects(() => validateBody('字'.repeat(301)));
  rejects(() => validateTargets([])); rejects(() => validateTargets(['8-1','8-1'])); rejects(() => validateTargets(['8-7']));
});
