namespace Broadcast.Core;

public sealed class BindingRevokedException() : Exception("设备已解绑，请重新设置");

public sealed class ReceiverService(BackendClient backend, DeliveryQueue queue, ReceiptOutbox outbox, ServerClock clock)
{
    private readonly SemaphoreSlim _work = new(0, 1);
    public event Action<string>? StatusChanged;
    public event Action? BindingRevoked;
    public event Action<Exception>? Error;
    public async Task RunAsync(CancellationToken ct)
    {
        using var life = CancellationTokenSource.CreateLinkedTokenSource(ct);
        outbox.Changed += Signal;
        queue.Error += Report;
        var playback = queue.RunAsync(life.Token);
        var syncing = SyncLoop(life.Token);
        try
        {
            var attempt = 0;
            while (!life.IsCancellationRequested)
            {
                try
                {
                    StatusChanged?.Invoke("正在连接");
                    await new RealtimeConnection(backend).RunAsync(Signal, async token =>
                    {
                        var state = await backend.RpcAsync<Heartbeat>("device_heartbeat", new { p_connected = true }, token);
                        clock.Sync(state.ServerNow);
                        if (!state.Active) throw new BindingRevokedException();
                        attempt = 0;
                        StatusChanged?.Invoke(state.ClassroomId + " · 在线");
                    }, life.Token);
                }
                catch (BindingRevokedException) { BindingRevoked?.Invoke(); return; }
                catch (SessionExpiredException)
                { BindingRevoked?.Invoke(); return; }
                catch (BackendException e) when (e.Status == System.Net.HttpStatusCode.Unauthorized)
                { BindingRevoked?.Invoke(); return; }
                catch (OperationCanceledException) when (life.IsCancellationRequested) { return; }
                catch (Exception e)
                {
                    Report(e); StatusChanged?.Invoke("连接中断，正在重连");
                    await Task.Delay(TimeSpan.FromMilliseconds(Math.Min(10_000, 1000 * Math.Pow(2, Math.Min(attempt++, 4))) + Random.Shared.Next(300)), life.Token);
                }
            }
        }
        finally
        {
            outbox.Changed -= Signal; queue.Error -= Report;
            await life.CancelAsync();
            try { await Task.WhenAll(playback, syncing); } catch (OperationCanceledException) { }
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            try { await backend.RpcAsync<Heartbeat>("device_heartbeat", new { p_connected = false }, timeout.Token); } catch (Exception) { }
        }
    }
    private void Signal() { lock (_work) if (_work.CurrentCount == 0) _work.Release(); }
    private void Report(Exception e) => Error?.Invoke(e);
    private async Task SyncLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await _work.WaitAsync(ct);
            try { await queue.SyncAsync(ct); await outbox.FlushAsync(backend, ct); }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { return; }
            catch (Exception e) { Report(e); }
        }
    }
}
