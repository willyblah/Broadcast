import { CLASSROOM_IDS, validDraft } from './domain';
interface Context {
  registerTool(tool: { name: string; description: string; inputSchema: object;
    annotations: { readOnlyHint: boolean }; execute(input: unknown): unknown }, options: { signal: AbortSignal }): void | Promise<void>;
}
export function registerBroadcastTools(read: () => unknown, compose: (body: string, classrooms: string[]) => void) {
  const context = (document as Document & { modelContext?: Context }).modelContext;
  if (!context) return () => {};
  const lifetime = new AbortController();
  const tools = [
    { name: 'get_classroom_status', description: '读取当前页面的班级连接状态；状态未知时不表示在线。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: read },
    { name: 'prepare_broadcast', description: '填入广播草稿并选择班级，不发送广播；老师可试听后点击发送。',
      inputSchema: { type: 'object', properties: { body: { type: 'string', minLength: 1, maxLength: 300 }, classrooms: { type: 'array', items: { type: 'string', enum: CLASSROOM_IDS }, minItems: 1, maxItems: 6, uniqueItems: true } }, required: ['body', 'classrooms'], additionalProperties: false },
      annotations: { readOnlyHint: false }, execute(input: unknown) {
        const data = input as { body?: unknown; classrooms?: unknown } | null;
        if (!data || typeof data.body !== 'string' || !Array.isArray(data.classrooms) ||
          data.classrooms.some(id => !CLASSROOM_IDS.includes(id)) || new Set(data.classrooms).size !== data.classrooms.length || !validDraft(data.body, data.classrooms)) throw new Error('广播正文或班级无效');
        compose(data.body, data.classrooms); return { prepared: true, sent: false };
      } },
  ];
  for (const tool of tools) {
    try { void Promise.resolve(context.registerTool(tool, { signal: lifetime.signal })).catch(() => {}); } catch { /* Optional browser capability. */ }
  }
  return () => lifetime.abort();
}
