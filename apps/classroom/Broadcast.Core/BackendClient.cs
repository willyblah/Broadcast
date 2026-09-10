using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace Broadcast.Core;

public sealed class BackendException(string message, HttpStatusCode status) : Exception(message)
{
    public HttpStatusCode Status { get; } = status;
}
public sealed class SessionExpiredException() : Exception("设备登录已失效，请重新绑定");

public sealed class BackendClient(ServiceConfig config, AuthSession? session = null) : IBackend, IDisposable
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(20) };
    private readonly SemaphoreSlim _refresh = new(1, 1);
    public ServiceConfig Config { get; } = config;
    public AuthSession? Session { get; private set; } = session;
    public event Action<AuthSession>? SessionChanged;

    public async Task LoginAdminAsync(string password, CancellationToken ct = default)
    {
        var result = await RequestAsync<AuthSession>("auth/v1/token?grant_type=password", new { email = Config.AdminEmail, password }, null, ct);
        if (!result.User.AppMetadata.TryGetValue("role", out var role) || role.GetString() != "admin")
            throw new InvalidOperationException("此账号没有管理员权限");
        Session = Normalize(result);
    }

    private static AuthSession Normalize(AuthSession value) => value.ExpiresAt > 0 ? value : value with
    { ExpiresAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds() + value.ExpiresIn };

    public async Task<string> AccessTokenAsync(CancellationToken ct)
    {
        await _refresh.WaitAsync(ct);
        try
        {
            if (Session is null) throw new InvalidOperationException("设备尚未登录");
            if (Session.ExpiresAt < DateTimeOffset.UtcNow.ToUnixTimeSeconds() + 120)
            {
                try
                {
                    Session = Normalize(await RequestAsync<AuthSession>("auth/v1/token?grant_type=refresh_token",
                        new { refresh_token = Session.RefreshToken }, null, ct));
                }
                catch (BackendException e) when (e.Status is HttpStatusCode.BadRequest or HttpStatusCode.Unauthorized)
                { throw new SessionExpiredException(); }
                SessionChanged?.Invoke(Session);
            }
            return Session.AccessToken;
        }
        finally { _refresh.Release(); }
    }

    public async Task<T> RpcAsync<T>(string name, object input, CancellationToken ct = default) =>
        await RequestAsync<T>("rest/v1/rpc/" + name, input, await AccessTokenAsync(ct), ct);
    public async Task<T> ApiAsync<T>(object input, CancellationToken ct = default) =>
        await RequestAsync<T>("functions/v1/broadcast-api", input, await AccessTokenAsync(ct), ct);
    public Task<PendingBatch> PendingAsync(CancellationToken ct) => RpcAsync<PendingBatch>("pending_broadcasts", new { }, ct);
    public Task<bool> ClaimAsync(Guid id, CancellationToken ct) => RpcAsync<bool>("start_delivery", new { p_delivery = id }, ct);
    public async Task AcknowledgeAsync(Receipt receipt, CancellationToken ct) =>
        await RpcAsync<JsonElement>("ack_delivery", new { p_delivery = receipt.DeliveryId, p_event = receipt.Event, p_at = receipt.At, p_error = receipt.Error }, ct);
    private async Task<T> RequestAsync<T>(string path, object input, string? token, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, Config.SupabaseUrl.TrimEnd('/') + "/" + path);
        request.Headers.Add("apikey", Config.SupabaseAnonKey);
        if (token is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Content = new StringContent(JsonSerializer.Serialize(input, Json.Options), Encoding.UTF8, "application/json");
        using var response = await _http.SendAsync(request, ct);
        var text = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
        {
            string detail = "连接服务失败，请稍后重试";
            try
            {
                using var error = JsonDocument.Parse(text);
                foreach (var field in new[] { "error_description", "message", "error" })
                    if (error.RootElement.TryGetProperty(field, out var value) && value.ValueKind == JsonValueKind.String)
                    { detail = value.GetString()!; break; }
            }
            catch (JsonException) { }
            throw new BackendException(detail, response.StatusCode);
        }
        return JsonSerializer.Deserialize<T>(text, Json.Options)!;
    }
    public void Dispose() { _http.Dispose(); _refresh.Dispose(); }
}
