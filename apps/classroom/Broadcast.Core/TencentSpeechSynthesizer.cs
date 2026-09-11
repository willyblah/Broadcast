using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Broadcast.Core;

public sealed class TencentSpeechSynthesizer(TencentTtsConfig config) : ISpeechSynthesizer, IDisposable
{
    private const string Host = "tts.tencentcloudapi.com";
    private static readonly HashSet<int> SupportedVoiceTypes = [101001, 101004, 101011, 101013, 101016];
    private readonly HttpClient _http = new() { Timeout = Timeout.InfiniteTimeSpan };

    public async Task<byte[]> SynthesizeAsync(string text, int voiceType, CancellationToken ct)
    {
        if (!config.IsConfigured) throw new InvalidOperationException("腾讯云语音尚未配置");
        if (!SupportedVoiceTypes.Contains(voiceType)) throw new InvalidOperationException("音色无效");
        var files = new List<byte[]>();
        foreach (var part in SplitText(text)) files.Add(await SynthesizePartAsync(part, voiceType, ct));
        return JoinWav(files);
    }

    private async Task<byte[]> SynthesizePartAsync(string text, int voiceType, CancellationToken ct)
    {
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var date = DateTimeOffset.FromUnixTimeSeconds(timestamp).UtcDateTime.ToString("yyyy-MM-dd");
        var payload = JsonSerializer.Serialize(new
        {
            Text = text,
            SessionId = Guid.NewGuid().ToString(),
            config.ModelType,
            VoiceType = voiceType,
            config.Speed,
            config.Volume,
            config.SampleRate,
            Codec = "wav"
        });
        var scope = $"{date}/tts/tc3_request";
        var canonical = $"POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:{Host}\n\ncontent-type;host\n{Sha256(payload)}";
        var stringToSign = $"TC3-HMAC-SHA256\n{timestamp}\n{scope}\n{Sha256(canonical)}";
        var dateKey = Hmac(Encoding.UTF8.GetBytes("TC3" + config.SecretKey), date);
        var serviceKey = Hmac(dateKey, "tts");
        var signingKey = Hmac(serviceKey, "tc3_request");
        var signature = Convert.ToHexStringLower(Hmac(signingKey, stringToSign));

        using var request = new HttpRequestMessage(HttpMethod.Post, "https://" + Host);
        request.Content = new StringContent(payload, Encoding.UTF8, "application/json");
        request.Headers.Add("X-TC-Action", "TextToVoice");
        request.Headers.Add("X-TC-Version", "2019-08-23");
        request.Headers.Add("X-TC-Timestamp", timestamp.ToString());
        request.Headers.Add("X-TC-Region", config.Region);
        request.Headers.TryAddWithoutValidation("Authorization",
            $"TC3-HMAC-SHA256 Credential={config.SecretId}/{scope}, SignedHeaders=content-type;host, Signature={signature}");
        using var response = await _http.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"语音服务暂不可用（{(int)response.StatusCode}）");
        using var json = JsonDocument.Parse(await response.Content.ReadAsByteArrayAsync(ct));
        var result = json.RootElement.GetProperty("Response");
        if (result.TryGetProperty("Error", out var error))
            throw new InvalidOperationException($"腾讯云语音合成失败：{error.GetProperty("Code").GetString()} · {error.GetProperty("Message").GetString()}");
        if (!result.TryGetProperty("Audio", out var audio)) throw new InvalidOperationException("腾讯云语音合成失败：响应中没有音频");
        return Convert.FromBase64String(audio.GetString()!);
    }

    private static string Sha256(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    private static byte[] Hmac(byte[] key, string value) => HMACSHA256.HashData(key, Encoding.UTF8.GetBytes(value));

    private static IEnumerable<string> SplitText(string text)
    {
        var runes = text.EnumerateRunes().ToList();
        while (runes.Count > 0)
        {
            var end = Math.Min(150, runes.Count);
            if (runes.Count > 150)
            {
                for (var i = end - 1; i >= 75; i--)
                {
                    if ("。！？；，.!?;\n".Contains(runes[i].ToString())) { end = i + 1; break; }
                }
            }
            yield return string.Concat(runes.Take(end));
            runes.RemoveRange(0, end);
        }
    }

    private static byte[] JoinWav(IEnumerable<byte[]> files)
    {
        byte[]? format = null;
        var data = new List<byte[]>();
        foreach (var file in files)
        {
            if (file.Length < 12 || Encoding.ASCII.GetString(file, 0, 4) != "RIFF" || Encoding.ASCII.GetString(file, 8, 4) != "WAVE")
                throw new InvalidOperationException("音频格式无效");
            var foundData = false;
            for (var offset = 12; offset + 8 <= file.Length;)
            {
                var kind = Encoding.ASCII.GetString(file, offset, 4);
                var length = checked((int)BinaryPrimitives.ReadUInt32LittleEndian(file.AsSpan(offset + 4, 4)));
                if (length < 0 || offset + 8 + length > file.Length) throw new InvalidOperationException("音频文件不完整");
                var chunk = file.AsSpan(offset + 8, length).ToArray();
                if (kind == "fmt ")
                {
                    if (format is not null && !format.AsSpan().SequenceEqual(chunk)) throw new InvalidOperationException("音频格式不一致");
                    format = chunk;
                }
                if (kind == "data") { data.Add(chunk); foundData = true; }
                offset = checked(offset + 8 + length + length % 2);
            }
            if (!foundData) throw new InvalidOperationException("音频内容为空");
        }
        if (format is null || data.Count == 0) throw new InvalidOperationException("音频内容为空");
        if (format.Length < 12) throw new InvalidOperationException("音频格式无效");
        var leadIn = new byte[checked((int)BinaryPrimitives.ReadUInt32LittleEndian(format.AsSpan(8, 4)))];
        if (leadIn.Length == 0) throw new InvalidOperationException("音频格式无效");
        data.Insert(0, leadIn);
        var formatLength = format.Length + format.Length % 2;
        var audioLength = data.Sum(chunk => chunk.Length);
        var result = new byte[checked(28 + formatLength + audioLength + audioLength % 2)];
        WriteText(result, 0, "RIFF");
        BinaryPrimitives.WriteUInt32LittleEndian(result.AsSpan(4, 4), (uint)(result.Length - 8));
        WriteText(result, 8, "WAVE");
        WriteText(result, 12, "fmt ");
        BinaryPrimitives.WriteUInt32LittleEndian(result.AsSpan(16, 4), (uint)format.Length);
        format.CopyTo(result, 20);
        WriteText(result, 20 + formatLength, "data");
        BinaryPrimitives.WriteUInt32LittleEndian(result.AsSpan(24 + formatLength, 4), (uint)audioLength);
        var destination = 28 + formatLength;
        foreach (var chunk in data) { chunk.CopyTo(result, destination); destination += chunk.Length; }
        return result;
    }

    private static void WriteText(byte[] target, int offset, string value) => Encoding.ASCII.GetBytes(value).CopyTo(target, offset);
    public void Dispose() => _http.Dispose();
}
