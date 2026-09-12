import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(join(root, 'apps/classroom/Broadcast.Classroom/appsettings.local.json'), 'utf8')).tencent_tts;
const output = join(root, 'apps/teacher/public/voice-previews');
const voices = [101001, 101004, 101011, 101013, 101016];
const host = 'tts.tencentcloudapi.com';
const text = '请Badger去吃饭';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();

if (!config?.secret_id || !config?.secret_key) throw new Error('本机腾讯云 TTS 凭据未配置');
await mkdir(output, { recursive: true });
for (const voiceType of voices) {
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const payload = JSON.stringify({ Text: text, SessionId: randomUUID(), ModelType: 1, VoiceType: voiceType,
    Speed: 0, Volume: 0, SampleRate: 16000, Codec: 'wav' });
  const scope = `${date}/tts/tc3_request`;
  const canonical = `POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:${host}\n\ncontent-type;host\n${sha256(payload)}`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${sha256(canonical)}`;
  const signingKey = hmac(hmac(hmac(Buffer.from(`TC3${config.secret_key}`), date), 'tts'), 'tc3_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const response = await fetch(`https://${host}`, { method: 'POST', body: payload, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'X-TC-Action': 'TextToVoice',
    'X-TC-Version': '2019-08-23', 'X-TC-Timestamp': String(timestamp),
    'X-TC-Region': config.region || 'ap-guangzhou',
    'Authorization': `TC3-HMAC-SHA256 Credential=${config.secret_id}/${scope}, SignedHeaders=content-type;host, Signature=${signature}`,
  } });
  if (!response.ok) throw new Error(`语音服务暂不可用（${response.status}）`);
  const result = (await response.json()).Response;
  if (result.Error) throw new Error(`腾讯云语音合成失败：${result.Error.Code} · ${result.Error.Message}`);
  await writeFile(join(output, `${voiceType}.wav`), Buffer.from(result.Audio, 'base64'));
  console.log(`Generated ${voiceType}.wav`);
}
