using Broadcast.Core;
using NAudio.Wave;

namespace Broadcast.Classroom;

internal sealed class AudioPlayer : IAudioPlayer
{
    public async Task PlayAsync(byte[] audio, Action started, CancellationToken ct)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("音频播放需要 Windows");
        using var stream = new MemoryStream(audio, false);
        using var reader = new WaveFileReader(stream);
        using var output = new WaveOutEvent();
        var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        output.PlaybackStopped += (_, args) =>
        {
            if (args.Exception is not null) completion.TrySetException(args.Exception);
            else completion.TrySetResult();
        };
        output.Init(reader);
        ct.ThrowIfCancellationRequested();
        output.Play(); started();
        using var cancel = ct.Register(output.Stop);
        await completion.Task.WaitAsync(reader.TotalTime + TimeSpan.FromSeconds(5), ct);
        ct.ThrowIfCancellationRequested();
        if (reader.Position < reader.Length) throw new IOException("语音播放提前停止");
    }
}
