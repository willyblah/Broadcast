export const CLASSROOMS = ['8-1', '8-2', '8-3', '8-4', '8-5', '8-6'] as const;

export function validateBody(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > 300) {
    throw new Error('请输入 1–300 字广播正文');
  }
  return value.trim();
}

export function validateTargets(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 6 ||
    value.some((id) => !CLASSROOMS.includes(id)) || new Set(value).size !== value.length) {
    throw new Error('请选择有效的班级');
  }
  return value;
}

export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error('请求编号无效');
  }
  return value;
}
