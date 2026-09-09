using Broadcast.Core;
using System.Collections.Concurrent;

var tests = new (string Name, Func<Task> Run)[]
{
    ("Audio receipt order and three-second linger", Happy),
    ("TTS failure displays only text for ten seconds", TextOnly),
    ("Audio player failure does not report played", AudioFailure),
    ("FIFO skips a queued broadcast that expires", ExpiredQueue),
    ("Expired delivery never claims or shows", Expired),
    ("Duplicate notifications and restart do not replay", Duplicates),
    ("Uncommitted claim failure retries on next sync", Retry),
    ("Receipts survive restart and flush idempotently", Persistence),
    ("Failed display emits a failure receipt", DisplayFailure),
};
var failed = 0;
foreach (var test in tests)
{
    try { await test.Run(); Console.WriteLine("PASS " + test.Name); }
    catch (Exception e) { failed++; Console.WriteLine("FAIL " + test.Name + ": " + e.Message); }
}
Console.WriteLine($"{tests.Length - failed} passed, {failed} failed");
if (args.Contains("--realtime"))
{
    try { await RealtimeSmoke(); Console.WriteLine("PASS Real WebSocket join, subscription readiness and heartbeat acknowledgement"); }
    catch (Exception e) { failed++; Console.WriteLine("FAIL Realtime smoke: " + e.Message); }
    try { await RefreshSmoke(false); Console.WriteLine("PASS Concurrent token refresh rotates credentials once"); }
    catch (Exception e) { failed++; Console.WriteLine("FAIL Token refresh: " + e.Message); }
    try { await RefreshSmoke(true); Console.WriteLine("PASS Revoked refresh token requires a new binding"); }
    catch (Exception e) { failed++; Console.WriteLine("FAIL Revoked token: " + e.Message); }
}
return failed == 0 ? 0 : 1;

static async Task RefreshSmoke(bool invalid)
{
    using var backend = new BackendClient(new ServiceConfig("http://127.0.0.1:54329", "fixture-key"),
        new AuthSession("expired", invalid ? "invalid" : "valid-refresh", 1,
            new AuthUser("20000000-0000-4000-8000-000000000001", [])));
    var updates = 0; backend.SessionChanged += _ => updates++;
    if (invalid)
    {
        try { await backend.AccessTokenAsync(default); } catch (SessionExpiredException) { return; }
        throw new Exception("Expected a session expiry");
    }
    var tokens = await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => backend.AccessTokenAsync(default)));
    Check(tokens.All(t => t == "rotated-token") && updates == 1 && backend.Session!.RefreshToken == "rotated-refresh");
}

static async Task RealtimeSmoke()
{
    using var backend = new BackendClient(new ServiceConfig("http://127.0.0.1:54329", "fixture-public-key"),
        new AuthSession("fixture-access-token", "fixture-refresh-token", DateTimeOffset.UtcNow.AddHours(1).ToUnixTimeSeconds(),
            new AuthUser("20000000-0000-4000-8000-000000000001", [])));
    using var life = new CancellationTokenSource(TimeSpan.FromSeconds(20));
    var changes = 0; var beats = 0;
    try
    {
        await new RealtimeConnection(backend).RunAsync(() => changes++, async ct =>
        {
            var result = await backend.RpcAsync<Heartbeat>("device_heartbeat", new { p_connected = true }, ct);
            Check(result.Active && result.ClassroomId == "8-1");
            if (++beats == 2) life.Cancel();
        }, life.Token);
    }
    catch (OperationCanceledException) when (beats == 2) { }
    Check(beats == 2 && changes >= 2, "Subscription/heartbeat did not confirm readiness");
}

static void Check(bool condition, string message = "Assertion failed") { if (!condition) throw new Exception(message); }
static async Task Until(Func<bool> condition)
{
    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
    while (!condition()) await Task.Delay(5, timeout.Token);
}
static async Task Happy()
{
    await using var h = new Harness(); h.Backend.Items = [h.Item("A")];
    await h.Start(); await Until(() => h.Display.Hidden == 1); await h.Outbox.FlushAsync(h.Backend, default);
    Check(h.Backend.Receipts.Select(r => r.Event).SequenceEqual(new[] { "received", "displayed", "playing", "played", "finished" }));
    Check(h.Delays.Single() == TimeSpan.FromSeconds(3));
}
static async Task TextOnly()
{
    await using var h = new Harness(); h.Backend.Items = [h.Item("text") with { AudioId = null }];
    await h.Start(); await Until(() => h.Display.Hidden == 1); await h.Outbox.FlushAsync(h.Backend, default);
    Check(h.Display.Shown.Single() == "text"); Check(h.Audio.Played == 0);
    Check(h.Delays.Single().TotalSeconds is > 9 and <= 10);
    Check(h.Backend.Receipts.Any(r => r.Event == "audio_failed") && !h.Backend.Receipts.Any(r => r.Event == "played"));
}
static async Task AudioFailure()
{
    await using var h = new Harness(); h.Backend.Items = [h.Item("A")]; h.Audio.Fail = true;
    await h.Start(); await Until(() => h.Display.Hidden == 1); await h.Outbox.FlushAsync(h.Backend, default);
    Check(h.Backend.Receipts.Any(r => r.Event == "audio_failed")); Check(!h.Backend.Receipts.Any(r => r.Event == "played"));
}
static async Task ExpiredQueue()
{
    await using var h = new Harness(); var one = h.Item("first"); var two = h.Item("second") with { CreatedAt = one.CreatedAt.AddSeconds(1) };
    h.Backend.Items = [two, one]; h.Audio.Gate = new(TaskCreationOptions.RunContinuationsAsynchronously);
    await h.Start(); await Until(() => h.Audio.Played == 1); h.Clock.Sync(DateTimeOffset.UtcNow.AddMinutes(1)); h.Audio.Gate.SetResult();
    await Until(() => h.Display.Hidden == 1); await Task.Delay(30);
    Check(h.Display.Shown.SequenceEqual(new[] { "first" })); Check(h.Backend.Claims.Count == 1);
}
static async Task Expired()
{
    await using var h = new Harness(); h.Backend.Items = [h.Item("old") with { ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(-1) }];
    await h.Start(); await Task.Delay(30); Check(h.Display.Shown.IsEmpty); Check(h.Backend.Claims.IsEmpty);
}
static async Task Duplicates()
{
    await using var h = new Harness(); h.Backend.Items = [h.Item("once")]; await h.Start();
    await Until(() => h.Display.Hidden == 1); await h.Queue.SyncAsync(default); await Task.Delay(30);
    Check(h.Display.Shown.Count == 1);
    using var life = new CancellationTokenSource();
    var restarted = new DeliveryQueue(h.Backend, h.Display, h.Audio, h.Outbox, h.Clock, (_, _) => Task.CompletedTask);
    await restarted.SyncAsync(default); var task = restarted.RunAsync(life.Token); await Task.Delay(30);
    life.Cancel(); try { await task; } catch (OperationCanceledException) { }
    Check(h.Display.Shown.Count == 1);
}
static async Task Retry()
{
    await using var h = new Harness(); h.Backend.Items = [h.Item("retry")]; h.Backend.FailClaim = true;
    await h.Start(); await Until(() => h.Errors.Count == 1); await h.Queue.SyncAsync(default);
    await Until(() => h.Display.Hidden == 1); Check(h.Display.Shown.Count == 1);
}
static async Task Persistence()
{
    await using var h = new Harness(); var receipt = new Receipt(Guid.NewGuid(), "received", DateTimeOffset.UtcNow);
    h.Outbox.Enqueue(receipt); h.Outbox.Enqueue(receipt);
    var recovered = new ReceiptOutbox(h.Path); await recovered.FlushAsync(h.Backend, default); await recovered.FlushAsync(h.Backend, default);
    Check(h.Backend.Receipts.Count == 1);
}
static async Task DisplayFailure()
{
    await using var h = new Harness(); h.Display.Fail = true; h.Backend.Items = [h.Item("oops")];
    await h.Start(); await Until(() => h.Errors.Count == 1); await h.Outbox.FlushAsync(h.Backend, default);
    Check(h.Backend.Receipts.Any(r => r.Event == "failed")); Check(!h.Backend.Receipts.Any(r => r.Event == "played"));
}

sealed class Harness : IAsyncDisposable
{
    public readonly FakeBackend Backend = new(); public readonly FakeDisplay Display = new(); public readonly FakeAudio Audio = new();
    public readonly ServerClock Clock = new(); public readonly ConcurrentBag<TimeSpan> Delays = []; public readonly ConcurrentBag<Exception> Errors = [];
    public readonly string Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "broadcast-tests-" + Guid.NewGuid(), "outbox.json");
    public readonly ReceiptOutbox Outbox; public readonly DeliveryQueue Queue;
    private readonly CancellationTokenSource _life = new(); private Task? _task;
    public Harness()
    {
        Outbox = new(Path); Queue = new(Backend, Display, Audio, Outbox, Clock, (span, _) => { Delays.Add(span); return Task.CompletedTask; });
        Queue.Error += Errors.Add;
    }
    public Delivery Item(string body) => new(Guid.NewGuid(), Guid.NewGuid(), body, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddSeconds(30), "audio", null);
    public async Task Start() { await Queue.SyncAsync(_life.Token); _task = Queue.RunAsync(_life.Token); }
    public async ValueTask DisposeAsync()
    {
        await _life.CancelAsync(); if (_task is not null) try { await _task; } catch (OperationCanceledException) { }
        _life.Dispose(); if (Directory.Exists(System.IO.Path.GetDirectoryName(Path))) Directory.Delete(System.IO.Path.GetDirectoryName(Path)!, true);
    }
}
sealed class FakeBackend : IBackend
{
    public Delivery[] Items = []; public bool FailClaim;
    public readonly ConcurrentDictionary<Guid, byte> Claims = []; public readonly ConcurrentQueue<Receipt> Receipts = [];
    public Task<PendingBatch> PendingAsync(CancellationToken ct) => Task.FromResult(new PendingBatch(DateTimeOffset.UtcNow, Items));
    public Task<bool> ClaimAsync(Guid id, CancellationToken ct)
    { if (FailClaim) { FailClaim = false; throw new IOException("offline"); } return Task.FromResult(Claims.TryAdd(id, 0)); }
    public Task AcknowledgeAsync(Receipt r, CancellationToken ct) { Receipts.Enqueue(r); return Task.CompletedTask; }
    public Task<byte[]> DownloadAudioAsync(Guid id, CancellationToken ct) => Task.FromResult(new byte[] { 1 });
}
sealed class FakeDisplay : IDisplay
{
    public readonly ConcurrentQueue<string> Shown = []; public int Hidden; public bool Fail;
    public Task ShowAsync(string body, CancellationToken ct) { if (Fail) throw new IOException("display unavailable"); Shown.Enqueue(body); return Task.CompletedTask; }
    public Task HideAsync() { Interlocked.Increment(ref Hidden); return Task.CompletedTask; }
}
sealed class FakeAudio : IAudioPlayer
{
    public int Played; public bool Fail; public TaskCompletionSource? Gate;
    public async Task PlayAsync(byte[] audio, Action started, CancellationToken ct)
    { if (Fail) throw new IOException("no device"); Interlocked.Increment(ref Played); started(); if (Gate is not null) await Gate.Task.WaitAsync(ct); }
}
