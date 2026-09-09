import { joinWav, splitText, validateBody, validateTargets } from '../functions/_shared/domain.ts';
function assert(value: unknown, message = 'Assertion failed'): asserts value { if (!value) throw new Error(message); }
function rejects(fn: () => unknown) { try { fn(); } catch { return; } throw new Error('Expected rejection'); }
Deno.test('TTS splits preserve exact Unicode content and respect the API limit', () => {
  for (const text of ['通知。'.repeat(100), '中'.repeat(300), '🎒'.repeat(300), 'Hello. 请回到教室！']) {
    const parts = splitText(text); assert(parts.join('') === text); assert(parts.every(p => [...p].length <= 150));
  }
});
Deno.test('server-side text and classroom validation', () => {
  assert(validateBody('  广播  ') === '广播'); assert(validateTargets(['8-1','8-6']).length === 2);
  rejects(() => validateBody(' ')); rejects(() => validateBody('字'.repeat(301)));
  rejects(() => validateTargets([])); rejects(() => validateTargets(['8-1','8-1'])); rejects(() => validateTargets(['8-7']));
});
function wav(samples: number[]): Uint8Array {
  const result = new Uint8Array(44 + samples.length * 2); const v = new DataView(result.buffer);
  const text = (i: number, s: string) => result.set(new TextEncoder().encode(s), i);
  text(0,'RIFF'); v.setUint32(4, result.length - 8, true); text(8,'WAVE'); text(12,'fmt '); v.setUint32(16,16,true);
  v.setUint16(20,1,true); v.setUint16(22,1,true); v.setUint32(24,16000,true); v.setUint32(28,32000,true); v.setUint16(32,2,true); v.setUint16(34,16,true);
  text(36,'data'); v.setUint32(40,samples.length*2,true); samples.forEach((s,i) => v.setInt16(44+i*2,s,true)); return result;
}
Deno.test('WAV concatenation preserves PCM samples and fixes RIFF lengths', () => {
  const joined = joinWav([wav([1,2]),wav([3,4,5])]); const v = new DataView(joined.buffer);
  assert(joined.length === 54); assert(v.getUint32(4,true) === 46); assert(v.getUint32(40,true) === 10);
  assert([1,2,3,4,5].every((n,i) => v.getInt16(44+i*2,true) === n));
});
Deno.test('WAV concatenation rejects corrupt or incompatible files', () => {
  rejects(() => joinWav([new Uint8Array(0)])); const wrong = wav([1]); new DataView(wrong.buffer).setUint32(24,24000,true);
  rejects(() => joinWav([wav([2]), wrong])); rejects(() => joinWav([wav([1]).slice(0,-1)]));
});
