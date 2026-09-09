using Avalonia;
using System.IO.Pipes;
using System.Security.Cryptography;
using System.Text;

namespace Broadcast.Classroom;

internal static class Program
{
    private static Mutex? _instance;
    internal static readonly string InstanceName = "BroadcastClassroom-" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Environment.UserName)))[..16];
    [STAThread]
    public static void Main(string[] args)
    {
        _instance = new Mutex(true, InstanceName, out var first);
        if (!first)
        {
            try { using var pipe = new NamedPipeClientStream(".", InstanceName, PipeDirection.Out); pipe.Connect(1000); pipe.WriteByte(1); }
            catch (TimeoutException) { }
            return;
        }
        try { BuildAvaloniaApp().StartWithClassicDesktopLifetime(args); }
        finally { _instance.ReleaseMutex(); _instance.Dispose(); }
    }
    public static AppBuilder BuildAvaloniaApp() => AppBuilder.Configure<App>().UsePlatformDetect().LogToTrace();
}
