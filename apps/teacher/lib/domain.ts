export const CLASSROOM_IDS = ['8-1', '8-2', '8-3', '8-4', '8-5', '8-6'];
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
  source_id: string | null;
  deliveries: Delivery[];
}
export function isOnline(room: Classroom, now: number): boolean {
  return !!room.device_id && room.connected && !!room.last_seen_at && now - Date.parse(room.last_seen_at) < 140_000;
}
export function deliveryStatus(d: Delivery, b: Broadcast, now: number): { label: string; tone: string } {
  if (d.played_at) return { label: '已播放', tone: 'success' };
  if (d.execution_error) return { label: d.execution_error, tone: 'warning' };
  if (d.started_at && !d.finished_at && now - Date.parse(d.started_at) > 300_000) return { label: '结果待确认 · 回执中断', tone: 'warning' };
  if (d.audio_error && d.displayed_at) return { label: '仅文字 · 语音失败', tone: 'warning' };
  if (d.finished_at) return { label: '展示已结束', tone: 'muted' };
  if (d.playback_started_at) return { label: '播放中', tone: 'blue' };
  if (d.displayed_at) return { label: '正文已显示', tone: 'blue' };
  if (d.started_at) return { label: '正在打开广播', tone: 'blue' };
  if (now >= Date.parse(b.expires_at)) return { label: d.received_at ? '排队过期 · 未播放' : '已过期 · 未收到', tone: 'muted' };
  if (d.received_at) return { label: '已收到 · 等待播放', tone: 'blue' };
  return { label: d.device_id ? '等待接收' : '未绑定设备', tone: 'muted' };
}
export function validDraft(body: string, selected: string[]): boolean {
  return !!body.trim() && Array.from(body.trim()).length <= 300 && selected.length > 0;
}
