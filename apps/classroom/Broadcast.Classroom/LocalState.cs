using System.Security.Cryptography;
using System.Text.Json;
using Broadcast.Core;
using Microsoft.Win32;

namespace Broadcast.Classroom;

internal static class LocalState
{
    public static string Folder { get; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BroadcastClassroom");
    private static string CredentialPath => Path.Combine(Folder, "device.credential");
    private static string LegacySessionPath => Path.Combine(Folder, "device.session");
    public static ServiceConfig Config()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "appsettings.json");
        var local = Path.Combine(AppContext.BaseDirectory, "appsettings.local.json");
        if (File.Exists(local)) path = local;
        return File.Exists(path) ? JsonSerializer.Deserialize<ServiceConfig>(File.ReadAllText(path), Json.Options)! : new();
    }
    public static bool HasLegacySession => File.Exists(LegacySessionPath);
    public static DeviceCredential? LoadDevice()
    {
        if (!File.Exists(CredentialPath) || !OperatingSystem.IsWindows()) return null;
        return JsonSerializer.Deserialize<DeviceCredential>(ProtectedData.Unprotect(File.ReadAllBytes(CredentialPath), null, DataProtectionScope.CurrentUser), Json.Options);
    }
    public static void SaveDevice(DeviceCredential device)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("设备绑定仅在 Windows 上保存");
        Directory.CreateDirectory(Folder);
        var bytes = ProtectedData.Protect(JsonSerializer.SerializeToUtf8Bytes(device, Json.Options), null, DataProtectionScope.CurrentUser);
        File.WriteAllBytes(CredentialPath + ".tmp", bytes);
        File.Move(CredentialPath + ".tmp", CredentialPath, true);
        File.Delete(LegacySessionPath);
    }
    public static void ForgetDevice() { File.Delete(CredentialPath); File.Delete(LegacySessionPath); }
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
            File.AppendAllText(path, DateTimeOffset.Now.ToString("O") + " " + error + Environment.NewLine);
        }
    }
}
