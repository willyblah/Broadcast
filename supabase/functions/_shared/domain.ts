export const CLASSROOMS = ['8-1', '8-2', '8-3', '8-4', '8-5', '8-6'] as const;
export const EMOTIONS = ['normal', 'happy', 'sad', 'angry', 'warning'] as const;
export const VOICE_TYPES = [101001, 101004, 101011, 101013, 101016] as const;

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

export function validateTeacherName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > 40) {
    throw new Error('请输入 1–40 字老师姓名');
  }
  return value.trim();
}

export function validateRepeatCount(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 5) {
    throw new Error('播报次数必须为 0–5');
  }
  return value as number;
}

export function validateAutoClose(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('请选择广播完成后的关闭方式');
  return value;
}

export function validateEmotion(value: unknown): string {
  if (typeof value !== 'string' || !EMOTIONS.includes(value as typeof EMOTIONS[number])) {
    throw new Error('请选择有效的情感');
  }
  return value;
}

export function validateVoiceType(value: unknown): number {
  if (typeof value !== 'number' || !VOICE_TYPES.includes(value as typeof VOICE_TYPES[number])) {
    throw new Error('请选择有效的音色');
  }
  return value;
}

export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error('请求编号无效');
  }
  return value;
}
