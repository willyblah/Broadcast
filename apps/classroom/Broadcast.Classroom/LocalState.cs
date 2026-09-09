using System.Security.Cryptography;
using System.Text.Json;
using Broadcast.Core;
using Microsoft.Win32;

namespace Broadcast.Classroom;

internal static class LocalState
{
    public static string Folder { get; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BroadcastClassroom");
    private static string SessionPath => Path.Combine(Folder, "device.session");
    public static ServiceConfig Config()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "appsettings.json");
        var local = Path.Combine(AppContext.BaseDirectory, "appsettings.local.json");
        if (File.Exists(local)) path = local;
        return File.Exists(path) ? JsonSerializer.Deserialize<ServiceConfig>(File.ReadAllText(path), Json.Options)! : new();
    }
    public static AuthSession? LoadSession()
    {
        if (!File.Exists(SessionPath)) return null;
        var data = File.ReadAllBytes(SessionPath);
        if (!OperatingSystem.IsWindows()) return null;
        return JsonSerializer.Deserialize<AuthSession>(ProtectedData.Unprotect(data, null, DataProtectionScope.CurrentUser), Json.Options);
    }
    public static void SaveSession(AuthSession session)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("设备绑定仅在 Windows 上保存");
        Directory.CreateDirectory(Folder);
        var bytes = ProtectedData.Protect(JsonSerializer.SerializeToUtf8Bytes(session, Json.Options), null, DataProtectionScope.CurrentUser);
        File.WriteAllBytes(SessionPath + ".tmp", bytes);
        File.Move(SessionPath + ".tmp", SessionPath, true);
    }
    public static void ForgetSession() { if (File.Exists(SessionPath)) File.Delete(SessionPath); }
    public static void EnableAutoStart()
    {
        if (!OperatingSystem.IsWindows()) return;
        using var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run");
        key.SetValue("BroadcastClassroom", "\"" + Environment.ProcessPath + "\" --background");
    }
    public static void Log(Exception error)
    {
        Directory.CreateDirectory(Folder);
        var path = Path.Combine(Folder, "client.log");
        lock (Folder)
        {
            if (File.Exists(path) && new FileInfo(path).Length > 1_000_000) File.Move(path, path + ".previous", true);
            File.AppendAllText(path, DateTimeOffset.Now.ToString("O") + " " + error.GetType().Name + ": " + error.Message + Environment.NewLine);
        }
    }
}
