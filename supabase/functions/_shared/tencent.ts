import { joinWav, splitText } from './domain.ts';

const encoder = new TextEncoder();
const hex = (data: ArrayBuffer) => [...new Uint8Array(data)].map(b => b.toString(16).padStart(2, '0')).join('');
export async function sha256(value: string) { return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
async function hmac(key: Uint8Array, text: string): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, encoder.encode(text)));
}

export async function synthesize(body: string, signal: AbortSignal): Promise<Uint8Array> {
  const secretId = Deno.env.get('TENCENT_SECRET_ID');
  const secretKey = Deno.env.get('TENCENT_SECRET_KEY');
  if (!secretId || !secretKey) throw new Error('腾讯云语音尚未配置');
  const voice = Number(Deno.env.get('TENCENT_VOICE_TYPE') || '101001');
  const files: Uint8Array[] = [];
  for (const text of splitText(body)) {
    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const payload = JSON.stringify({ Text: text, SessionId: crypto.randomUUID(), ModelType: 1,
      VoiceType: voice, Speed: 0, Volume: 0, SampleRate: 16000, Codec: 'wav' });
    const canonical = `POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:tts.tencentcloudapi.com\n\ncontent-type;host\n${await sha256(payload)}`;
    const scope = `${date}/tts/tc3_request`;
    const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${await sha256(canonical)}`;
    const dateKey = await hmac(encoder.encode(`TC3${secretKey}`), date);
    const serviceKey = await hmac(dateKey, 'tts');
    const signingKey = await hmac(serviceKey, 'tc3_request');
    const signature = hex((await hmac(signingKey, stringToSign)).buffer as ArrayBuffer);
    const response = await fetch('https://tts.tencentcloudapi.com', {
      method: 'POST', signal, body: payload,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-TC-Action': 'TextToVoice',
        'X-TC-Version': '2019-08-23', 'X-TC-Timestamp': String(timestamp),
        'X-TC-Region': Deno.env.get('TENCENT_REGION') || 'ap-guangzhou',
        Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=content-type;host, Signature=${signature}` },
    });
    if (!response.ok) throw new Error(`语音服务暂不可用（${response.status}）`);
    const json = await response.json();
    if (json.Response?.Error || !json.Response?.Audio) throw new Error('腾讯云语音合成失败');
    files.push(Uint8Array.from(atob(json.Response.Audio), c => c.charCodeAt(0)));
  }
  return joinWav(files);
}
