export const CLASSROOM_IDS = ['8-1', '8-2', '8-3', '8-4', '8-5', '8-6'];
export type Emotion = 'normal' | 'happy' | 'sad' | 'angry' | 'warning';
export const EMOTIONS: { id: Emotion; label: string; emoji: string }[] = [
  { id: 'normal', label: '普通', emoji: '' },
  { id: 'happy', label: '高兴', emoji: '😀' },
  { id: 'sad', label: '难过', emoji: '☹️' },
  { id: 'angry', label: '生气', emoji: '😡' },
  { id: 'warning', label: '提醒', emoji: '⚠️' },
];
export const VOICES = [
  { id: 101001, name: '智瑜', detail: '情感女声' },
  { id: 101004, name: '智云', detail: '通用男声' },
  { id: 101011, name: '智燕', detail: '新闻女声' },
  { id: 101013, name: '智辉', detail: '新闻男声' },
  { id: 101016, name: '智甜', detail: '女童声' },
] as const;
export interface Classroom {
  id: string; device_id: string | null; device_name: string | null;
  last_seen_at: string | null; connected: boolean;
}
export interface Delivery {
  id: string; classroom_id: string; device_id: string | null; online_at_send: boolean;
  received_at: string | null; started_at: string | null; displayed_at: string | null;
  playback_started_at: string | null; played_at: string | null; finished_at: string | null;
  audio_error: string | null;
  execution_error?: string | null;
}
export interface Broadcast {
  id: string; body: string; created_at: string; expires_at: string;
  source_id: string | null; teacher_name: string; repeat_count: number; auto_close: boolean;
  emotion: Emotion; voice_type: number;
  deliveries: Delivery[];
}
export function isOnline(room: Classroom, now: number): boolean {
  return !!room.device_id && room.connected && !!room.last_seen_at && now - Date.parse(room.last_seen_at) < 140_000;
}
export function deliveryStatus(d: Delivery, b: Broadcast, now: number): { label: string; tone: string } {
  if (d.played_at) return { label: `已播放 ${b.repeat_count} 遍`, tone: 'success' };
  if (d.execution_error) return { label: d.execution_error, tone: 'warning' };
  if (d.started_at && !d.finished_at && now - Date.parse(d.started_at) > 300_000) return { label: '结果待确认 · 回执中断', tone: 'warning' };
  if (d.audio_error && d.displayed_at) return { label: '仅文字 · 语音失败', tone: 'warning' };
  if (d.finished_at) return { label: b.repeat_count === 0 ? '已完成 · 仅文字' : '展示已结束', tone: 'muted' };
  if (d.playback_started_at) return { label: '播放中', tone: 'blue' };
  if (d.displayed_at) return { label: b.repeat_count === 0 ? '正在展示文字' : '正文已显示', tone: 'blue' };
  if (d.started_at) return { label: '正在打开广播', tone: 'blue' };
  if (now >= Date.parse(b.expires_at)) return { label: d.received_at ? '排队过期 · 未播放' : '已过期 · 未收到', tone: 'muted' };
  if (d.received_at) return { label: '已收到 · 等待播放', tone: 'blue' };
  return { label: d.device_id ? '等待接收' : '未绑定设备', tone: 'muted' };
}
export function validDraft(body: string, selected: string[]): boolean {
  return !!body.trim() && Array.from(body.trim()).length <= 300 && selected.length > 0;
}
export function validTeacherName(name: string): boolean {
  const length = Array.from(name.trim()).length;
  return length > 0 && length <= 40;
}
