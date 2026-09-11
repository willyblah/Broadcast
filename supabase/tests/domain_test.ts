import { validateAutoClose, validateBody, validateEmotion, validateRepeatCount, validateTargets, validateTeacherName, validateVoiceType } from '../functions/_shared/domain.ts';
function assert(value: unknown, message = 'Assertion failed'): asserts value { if (!value) throw new Error(message); }
function rejects(fn: () => unknown) { try { fn(); } catch { return; } throw new Error('Expected rejection'); }
Deno.test('server-side text and classroom validation', () => {
  assert(validateBody('  广播  ') === '广播'); assert(validateTargets(['8-1','8-6']).length === 2);
  rejects(() => validateBody(' ')); rejects(() => validateBody('字'.repeat(301)));
  rejects(() => validateTargets([])); rejects(() => validateTargets(['8-1','8-1'])); rejects(() => validateTargets(['8-7']));
});
Deno.test('server-side broadcast option validation', () => {
  assert(validateTeacherName(' 王老师 ') === '王老师');
  assert(validateRepeatCount(0) === 0); assert(validateRepeatCount(5) === 5);
  assert(validateAutoClose(false) === false); assert(validateEmotion('warning') === 'warning');
  assert(validateVoiceType(101013) === 101013);
  rejects(() => validateTeacherName(' ')); rejects(() => validateTeacherName('字'.repeat(41)));
  rejects(() => validateRepeatCount(6)); rejects(() => validateRepeatCount(1.5));
  rejects(() => validateAutoClose('true')); rejects(() => validateEmotion('excited')); rejects(() => validateVoiceType(999));
});
