import { createClient } from 'npm:@supabase/supabase-js@2';
import { uuid, validateAutoClose, validateBody, validateEmotion, validateRepeatCount, validateTargets,
  validateTeacherName, validateVoiceType } from '../_shared/domain.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const key = Deno.env.get('SUPABASE_ANON_KEY')!;
const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') || 'http://127.0.0.1:5173,http://localhost:5173').split(',').map(s => s.trim());
const previewText = '请Badger去吃饭';
const encoder = new TextEncoder();

function hex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function hmac(key: ArrayBuffer, value: string): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return await crypto.subtle.sign('HMAC', imported, encoder.encode(value));
}

async function synthesizePreview(voiceType: number): Promise<string> {
  const secretId = Deno.env.get('TENCENT_SECRET_ID');
  const secretKey = Deno.env.get('TENCENT_SECRET_KEY');
  if (!secretId || !secretKey) throw new Error('音色试听尚未配置');
  const host = 'tts.tencentcloudapi.com';
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const payload = JSON.stringify({ Text: previewText, SessionId: crypto.randomUUID(), ModelType: 1,
    VoiceType: voiceType, Speed: 0, Volume: 0, SampleRate: 16000, Codec: 'wav' });
  const scope = `${date}/tts/tc3_request`;
  const canonical = `POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:${host}\n\ncontent-type;host\n${await sha256(payload)}`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${await sha256(canonical)}`;
  const dateKey = await hmac(encoder.encode('TC3' + secretKey).buffer, date);
  const serviceKey = await hmac(dateKey, 'tts');
  const signingKey = await hmac(serviceKey, 'tc3_request');
  const signature = hex(await hmac(signingKey, stringToSign));
  const response = await fetch(`https://${host}`, { method: 'POST', body: payload, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'X-TC-Action': 'TextToVoice',
    'X-TC-Version': '2019-08-23', 'X-TC-Timestamp': String(timestamp),
    'X-TC-Region': Deno.env.get('TENCENT_TTS_REGION') || 'ap-guangzhou',
    'Authorization': `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=content-type;host, Signature=${signature}`,
  } });
  if (!response.ok) throw new Error(`语音服务暂不可用（${response.status}）`);
  const result = (await response.json()).Response as { Audio?: string; Error?: { Code: string; Message: string } };
  if (result.Error) throw new Error(`腾讯云语音合成失败：${result.Error.Code} · ${result.Error.Message}`);
  if (!result.Audio) throw new Error('腾讯云语音合成失败：响应中没有音频');
  return result.Audio;
}

Deno.serve(async (request) => {
  const origin = request.headers.get('Origin');
  const cors: Record<string, string> = { 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' };
  if (origin && allowedOrigins.includes(origin)) cors['Access-Control-Allow-Origin'] = origin;
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (origin && !allowedOrigins.includes(origin)) return reply({ error: '此访问地址未获允许' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return reply({ error: '仅支持 POST' }, 405);
  try {
    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return reply({ error: '请先登录' }, 401);
    const { data: { user }, error: authError } = await service.auth.getUser(token);
    if (authError || !user) return reply({ error: '登录已失效，请重新登录' }, 401);
    const admin = user.app_metadata.role === 'admin';
    const client = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const input = await request.json();
    if (!admin) return reply({ error: '需要管理员权限' }, 403);
    if (input.action === 'send') {
      const id = uuid(input.request_id);
      const body = validateBody(input.body);
      const classrooms = validateTargets(input.classrooms);
      const teacherName = validateTeacherName(input.teacher_name);
      const repeatCount = validateRepeatCount(input.repeat_count);
      const autoClose = validateAutoClose(input.auto_close);
      const emotion = validateEmotion(input.emotion);
      const voiceType = validateVoiceType(input.voice_type);
      const source = input.source_id ? uuid(input.source_id) : null;
      const existing = await client.from('broadcasts').select('id,body,teacher_name,repeat_count,auto_close,emotion,voice_type,source_id').eq('id', id).maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data) {
        if (existing.data.body !== body || existing.data.teacher_name !== teacherName || existing.data.repeat_count !== repeatCount ||
          existing.data.auto_close !== autoClose || existing.data.emotion !== emotion || existing.data.voice_type !== voiceType || existing.data.source_id !== source) {
          throw new Error('请求编号冲突');
        }
        return reply({ id });
      }
      const created = await client.rpc('create_broadcast', { p_id: id, p_body: body, p_classrooms: classrooms,
        p_source: source, p_teacher_name: teacherName, p_repeat_count: repeatCount, p_auto_close: autoClose,
        p_emotion: emotion, p_voice_type: voiceType });
      if (created.error) throw created.error;
      return reply({ id: created.data });
    }
    if (input.action === 'voice-preview') {
      return reply({ audio: await synthesizePreview(validateVoiceType(input.voice_type)), text: previewText });
    }
    if (input.action === 'register-device') {
      const classroom = validateTargets([input.classroom_id])[0];
      const name = typeof input.name === 'string' ? input.name.trim().slice(0, 100) : '';
      if (!name) throw new Error('设备名称不能为空');
      const password = crypto.randomUUID() + crypto.randomUUID();
      const email = `device-${crypto.randomUUID()}@devices.broadcast.invalid`;
      const created = await service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role: 'device' } });
      if (created.error) throw created.error;
      try {
        const bound = await service.rpc('bind_device', { p_device: created.data.user.id, p_classroom: classroom, p_name: name });
        if (bound.error) throw bound.error;
        const deviceAuth = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
        const signedIn = await deviceAuth.auth.signInWithPassword({ email, password });
        if (signedIn.error) throw signedIn.error;
        return reply({ session: signedIn.data.session, classroom_id: classroom });
      } catch (error) {
        await service.auth.admin.deleteUser(created.data.user.id);
        throw error;
      }
    }
    return reply({ error: '未知操作' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : (error as { message?: string })?.message || '操作失败';
    return reply({ error: message }, 400);
  }
});
