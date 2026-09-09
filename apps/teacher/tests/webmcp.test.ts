import { afterEach, expect, it, vi } from 'vitest';
import { registerBroadcastTools } from '../lib/webmcp';
afterEach(() => vi.unstubAllGlobals());
it('validates staged broadcasts and never sends them', () => {
  const registered = new Map<string, { execute(input: unknown): unknown; signal: AbortSignal }>();
  vi.stubGlobal('document', { modelContext: { registerTool(tool: {name: string;execute(input:unknown):unknown}, options: {signal:AbortSignal}) { registered.set(tool.name, {...tool, signal: options.signal}); } } });
  const compose = vi.fn();
  const cleanup = registerBroadcastTools(() => ({ connected: false }), compose);
  expect(registered.get('get_classroom_status')!.execute({})).toEqual({ connected: false });
  expect(registered.get('prepare_broadcast')!.execute({ body: '请回教室', classrooms: ['8-1','8-6'] })).toEqual({ prepared: true, sent: false });
  expect(compose).toHaveBeenCalledExactlyOnceWith('请回教室', ['8-1','8-6']);
  expect(() => registered.get('prepare_broadcast')!.execute({ body: '', classrooms: ['8-7'] })).toThrow();
  expect(compose).toHaveBeenCalledTimes(1);
  cleanup(); expect(registered.get('prepare_broadcast')!.signal.aborted).toBe(true);
});
