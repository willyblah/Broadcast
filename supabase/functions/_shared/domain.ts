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

export function splitText(body: string, limit = 150): string[] {
  const chars = [...body];
  const parts: string[] = [];
  while (chars.length) {
    let end = Math.min(limit, chars.length);
    if (chars.length > limit) {
      for (let i = end - 1; i >= Math.floor(limit / 2); i--) {
        if (/[。！？；，.!?;\n]/u.test(chars[i])) { end = i + 1; break; }
      }
    }
    parts.push(chars.splice(0, end).join(''));
  }
  return parts;
}

// RIFF chunks may include metadata and padding; never assume a fixed 44-byte header.
export function joinWav(files: Uint8Array[]): Uint8Array {
  const decode = new TextDecoder();
  let format: Uint8Array | undefined;
  const data: Uint8Array[] = [];
  for (const file of files) {
    const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
    if (decode.decode(file.slice(0, 4)) !== 'RIFF' || decode.decode(file.slice(8, 12)) !== 'WAVE') throw new Error('音频格式无效');
    let foundData = false;
    for (let offset = 12; offset + 8 <= file.length;) {
      const kind = decode.decode(file.slice(offset, offset + 4));
      const length = view.getUint32(offset + 4, true);
      const chunk = file.slice(offset + 8, offset + 8 + length);
      if (chunk.length !== length) throw new Error('音频文件不完整');
      if (kind === 'fmt ') {
        if (format && (format.length !== chunk.length || format.some((b, i) => b !== chunk[i]))) throw new Error('音频格式不一致');
        format = chunk;
      }
      if (kind === 'data') { data.push(chunk); foundData = true; }
      offset += 8 + length + (length % 2);
    }
    if (!foundData) throw new Error('音频内容为空');
  }
  if (!format || !data.length) throw new Error('音频内容为空');
  const bytes = data.reduce((n, p) => n + p.length, 0);
  const fmtLength = format.length + format.length % 2;
  const result = new Uint8Array(28 + fmtLength + bytes + bytes % 2);
  const view = new DataView(result.buffer);
  const write = (at: number, value: string) => result.set(new TextEncoder().encode(value), at);
  write(0, 'RIFF'); view.setUint32(4, result.length - 8, true); write(8, 'WAVE');
  write(12, 'fmt '); view.setUint32(16, format.length, true); result.set(format, 20);
  write(20 + fmtLength, 'data'); view.setUint32(24 + fmtLength, bytes, true);
  let offset = 28 + fmtLength;
  for (const chunk of data) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
