import { describe, expect, it } from 'vitest';
import { deliveryStatus, isOnline, validDraft, validTeacherName, type Broadcast, type Classroom, type Delivery } from '../lib/domain';
const now = Date.parse('2026-09-08T10:00:00Z');
const room: Classroom = { id: '8-1', device_id: 'one', device_name: 'PC', connected: true, last_seen_at: new Date(now - 139_999).toISOString() };
const d: Delivery = { id: 'one', classroom_id: '8-1', device_id: 'device', online_at_send: true, received_at: null, started_at: null, displayed_at: null, playback_started_at: null, played_at: null, finished_at: null, audio_error: null };
const b: Broadcast = { id: 'one', body: '测试', created_at: new Date(now - 30_000).toISOString(), expires_at: new Date(now).toISOString(),
  source_id: null, teacher_name: '王老师', repeat_count: 1, auto_close: true, emotion: 'normal', voice_type: 101001, deliveries: [d] };
describe('truthful device status', () => {
  it('expires the heartbeat at exactly 140 seconds', () => { expect(isOnline(room, now)).toBe(true); expect(isOnline(room, now + 1)).toBe(false); });
  it('requires a current binding and a working connection', () => { expect(isOnline({ ...room, device_id: null }, now)).toBe(false); expect(isOnline({ ...room, connected: false }, now)).toBe(false); });
  it('does not mistake server creation for receipt or playback', () => { expect(deliveryStatus(d, b, now - 1).label).toBe('等待接收'); });
  it('expires queued broadcasts without expiring one already playing', () => {
    expect(deliveryStatus({ ...d, received_at: 'time' }, b, now).label).toBe('排队过期 · 未播放');
    expect(deliveryStatus({ ...d, playback_started_at: 'time' }, b, now + 60_000).label).toBe('播放中');
  });
  it('keeps text-only distinct from played', () => { expect(deliveryStatus({ ...d, displayed_at: 'time', audio_error: 'failed', finished_at: 'time' }, b, now).label).toBe('仅文字 · 语音失败'); });
  it('labels a deliberate zero-repeat broadcast as text-only', () => { expect(deliveryStatus({ ...d, displayed_at: 'time', finished_at: 'time' }, { ...b, repeat_count: 0 }, now).label).toBe('已完成 · 仅文字'); });
  it('requires nonempty text and targets with a 300 code point limit', () => { expect(validDraft('  ', ['8-1'])).toBe(false); expect(validDraft('你好', [])).toBe(false); expect(validDraft('🎒'.repeat(300), ['8-1'])).toBe(true); expect(validDraft('字'.repeat(301), ['8-1'])).toBe(false); });
  it('requires a teacher name on the new login', () => { expect(validTeacherName('王老师')).toBe(true); expect(validTeacherName(' ')).toBe(false); expect(validTeacherName('字'.repeat(41))).toBe(false); });
});
