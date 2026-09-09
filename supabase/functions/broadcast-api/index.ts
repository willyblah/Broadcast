import { createClient } from 'npm:@supabase/supabase-js@2';
import { uuid, validateBody, validateTargets } from '../_shared/domain.ts';
import { sha256, synthesize } from '../_shared/tencent.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const key = Deno.env.get('SUPABASE_ANON_KEY')!;
const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') || 'http://127.0.0.1:5173,http://localhost:5173').split(',').map(s => s.trim());

async function audioAsset(body: string): Promise<string> {
  const id = await sha256(JSON.stringify({ body, voice: Deno.env.get('TENCENT_VOICE_TYPE') || '101001', version: 1 }));
  const existing = await service.from('audio_assets').select('id').eq('id', id).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return id;
  const audio = await synthesize(body, AbortSignal.timeout(10_000));
  const path = `${id}.wav`;
  const uploaded = await service.storage.from('broadcast-audio').upload(path, audio, { contentType: 'audio/wav', upsert: true });
  if (uploaded.error) throw uploaded.error;
  const saved = await service.from('audio_assets').upsert({ id, storage_path: path });
  if (saved.error) throw saved.error;
  return id;
}

async function signAudio(id: string) {
  const { data, error } = await service.from('audio_assets').select('storage_path').eq('id', id).single();
  if (error) throw new Error('语音文件不存在');
  const signed = await service.storage.from('broadcast-audio').createSignedUrl(data.storage_path, 600);
  if (signed.error) throw signed.error;
  return { audio_id: id, url: signed.data.signedUrl, expires_at: new Date(Date.now() + 600_000).toISOString() };
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
    if (input.action === 'audio-url') {
      const deliveryId = uuid(input.delivery_id);
      const delivery = await service.from('deliveries').select('device_id,classroom_id,started_at,broadcasts!inner(audio_id,expires_at)').eq('id', deliveryId).single();
      if (delivery.error) return reply({ error: '广播不存在' }, 404);
      const broadcast = delivery.data.broadcasts as unknown as { audio_id: string | null; expires_at: string };
      if (!admin) {
        const binding = await service.from('classrooms').select('id').eq('id', delivery.data.classroom_id).eq('device_id', user.id).maybeSingle();
        if (delivery.data.device_id !== user.id || !binding.data || (!delivery.data.started_at && Date.parse(broadcast.expires_at) <= Date.now())) {
          return reply({ error: '广播已失效或设备已解绑' }, 403);
        }
      }
      if (!broadcast.audio_id) return reply({ error: '本条广播没有语音' }, 404);
      return reply(await signAudio(broadcast.audio_id));
    }
    if (!admin) return reply({ error: '需要管理员权限' }, 403);
    if (input.action === 'preview') {
      return reply(await signAudio(await audioAsset(validateBody(input.body))));
    }
    if (input.action === 'send') {
      const id = uuid(input.request_id);
      const body = validateBody(input.body);
      const classrooms = validateTargets(input.classrooms);
      const existing = await client.from('broadcasts').select('id,body').eq('id', id).maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data) {
        if (existing.data.body !== body) throw new Error('请求编号冲突');
        return reply({ id });
      }
      let audio: string | null = null;
      let ttsError: string | null = null;
      try { audio = await audioAsset(body); }
      catch { ttsError = '语音合成失败，本条广播仅显示文字'; }
      const created = await client.rpc('create_broadcast', { p_id: id, p_body: body, p_classrooms: classrooms,
        p_audio: audio, p_tts_error: ttsError, p_source: input.source_id ? uuid(input.source_id) : null });
      if (created.error) throw created.error;
      return reply({ id: created.data, tts_error: ttsError });
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
