using System.Diagnostics;
using System.Text.Json;

namespace Broadcast.Core;

public static class Json
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower, WriteIndented = true };
}

public sealed record ServiceConfig(string SupabaseUrl = "", string SupabaseAnonKey = "", string AdminEmail = "admin@broadcast.local")
{
    public bool IsConfigured => Uri.TryCreate(SupabaseUrl, UriKind.Absolute, out var uri)
        && (uri.Scheme == "https" || (uri.Scheme == "http" && uri.IsLoopback)) && !string.IsNullOrWhiteSpace(SupabaseAnonKey);
}
public sealed record AuthUser(string Id, Dictionary<string, JsonElement> AppMetadata);
public sealed record AuthSession(string AccessToken, string RefreshToken, long ExpiresAt, AuthUser User, int ExpiresIn = 3600);
public sealed record RegisteredDevice(AuthSession Session, string ClassroomId);
public sealed record Classroom(string Id, string? DeviceId, string? DeviceName, string? LastSeenAt, bool Connected);
public sealed record ClassroomStatus(DateTimeOffset ServerNow, Classroom[] Classrooms);
public sealed record Heartbeat(bool Active, string? ClassroomId, DateTimeOffset ServerNow);
public sealed record PendingBatch(DateTimeOffset ServerNow, Delivery[] Items);
public sealed record Delivery(Guid DeliveryId, Guid BroadcastId, string Body, DateTimeOffset CreatedAt,
    DateTimeOffset ExpiresAt, string? AudioId, string? TtsError);
public sealed record AudioLink(string Url);
public sealed record Receipt(Guid DeliveryId, string Event, DateTimeOffset At, string? Error = null);

public sealed class ServerClock
{
    private DateTimeOffset _server = DateTimeOffset.UtcNow;
    private long _stamp = Stopwatch.GetTimestamp();
    private readonly object _lock = new();
    public DateTimeOffset Now { get { lock (_lock) return _server + Stopwatch.GetElapsedTime(_stamp); } }
    public void Sync(DateTimeOffset server) { lock (_lock) { _server = server; _stamp = Stopwatch.GetTimestamp(); } }
}

public interface IBackend
{
    Task<PendingBatch> PendingAsync(CancellationToken ct);
    Task<bool> ClaimAsync(Guid id, CancellationToken ct);
    Task AcknowledgeAsync(Receipt receipt, CancellationToken ct);
    Task<byte[]> DownloadAudioAsync(Guid deliveryId, CancellationToken ct);
}
public interface IDisplay
{
    Task ShowAsync(string body, CancellationToken ct);
    Task HideAsync();
}
public interface IAudioPlayer
{
    Task PlayAsync(byte[] audio, Action started, CancellationToken ct);
}
