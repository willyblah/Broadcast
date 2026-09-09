namespace Broadcast.Core;

public sealed class DeliveryQueue(IBackend backend, IDisplay display, IAudioPlayer audio, ReceiptOutbox outbox,
    ServerClock clock, Func<TimeSpan, CancellationToken, Task>? delay = null)
{
    private readonly SemaphoreSlim _signal = new(0, 1);
    private readonly SemaphoreSlim _sync = new(1, 1);
    private readonly Dictionary<Guid, Delivery> _waiting = [];
    private readonly HashSet<Guid> _handled = [];
    private readonly object _lock = new();
    private readonly Func<TimeSpan, CancellationToken, Task> _delay = delay ?? Task.Delay;
    public event Action<Exception>? Error;

    public async Task SyncAsync(CancellationToken ct)
    {
        await _sync.WaitAsync(ct);
        try
        {
            var batch = await backend.PendingAsync(ct);
            clock.Sync(batch.ServerNow);
            lock (_lock)
            {
                foreach (var item in batch.Items)
                {
                    if (_handled.Contains(item.DeliveryId) || item.ExpiresAt <= clock.Now || _waiting.ContainsKey(item.DeliveryId)) continue;
                    _waiting.Add(item.DeliveryId, item);
                    outbox.Enqueue(new Receipt(item.DeliveryId, "received", clock.Now));
                }
                foreach (var id in _waiting.Where(p => p.Value.ExpiresAt <= clock.Now).Select(p => p.Key).ToArray()) _waiting.Remove(id);
                if (_waiting.Count > 0 && _signal.CurrentCount == 0) _signal.Release();
            }
        }
        finally { _sync.Release(); }
    }
    public async Task RunAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await _signal.WaitAsync(ct);
            while (true)
            {
                Delivery? item;
                lock (_lock)
                {
                    item = _waiting.Values.OrderBy(d => d.CreatedAt).ThenBy(d => d.BroadcastId).FirstOrDefault();
                    if (item is not null) { _waiting.Remove(item.DeliveryId); _handled.Add(item.DeliveryId); }
                }
                if (item is null) break;
                if (item.ExpiresAt <= clock.Now) continue;
                var claimed = false;
                try
                {
                    claimed = await backend.ClaimAsync(item.DeliveryId, ct);
                    if (!claimed) continue;
                    if (item.ExpiresAt <= clock.Now)
                    {
                        outbox.Enqueue(new Receipt(item.DeliveryId, "failed", clock.Now, "开始前广播已过期"));
                        continue;
                    }
                    await PlayAsync(item, ct);
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
                catch (Exception e)
                {
                    if (!claimed) { lock (_lock) _handled.Remove(item.DeliveryId); }
                    else outbox.Enqueue(new Receipt(item.DeliveryId, "failed", clock.Now, "广播显示未完成"));
                    Error?.Invoke(e);
                }
            }
        }
    }
    private async Task PlayAsync(Delivery item, CancellationToken ct)
    {
        try
        {
            await display.ShowAsync(item.Body, ct);
            Report("displayed");
            var shownAt = System.Diagnostics.Stopwatch.GetTimestamp();
            var played = false;
            try
            {
                if (item.AudioId is null) throw new InvalidOperationException(item.TtsError ?? "语音不可用");
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
                timeout.CancelAfter(TimeSpan.FromSeconds(5));
                var bytes = await backend.DownloadAudioAsync(item.DeliveryId, timeout.Token);
                await audio.PlayAsync(bytes, () => Report("playing"), ct);
                Report("played"); played = true;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch (Exception) { Report("audio_failed", "语音合成、下载或播放失败"); }
            var remaining = played ? TimeSpan.FromSeconds(3) : TimeSpan.FromSeconds(10) - System.Diagnostics.Stopwatch.GetElapsedTime(shownAt);
            if (remaining > TimeSpan.Zero) await _delay(remaining, ct);
            Report("finished");
        }
        finally { await display.HideAsync(); }
        void Report(string kind, string? error = null) => outbox.Enqueue(new Receipt(item.DeliveryId, kind, clock.Now, error));
    }
}
