using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Media;
using Avalonia.Threading;
using Broadcast.Classroom;

AppBuilder.Configure<Application>().UseSkia().UseHeadless(new AvaloniaHeadlessPlatformOptions { UseHeadlessDrawing = false }).SetupWithoutStarting();
var output = args.Length > 0 ? args[0] : Path.Combine(Path.GetTempPath(), "broadcast-visual-tests");
Directory.CreateDirectory(output);
foreach (var (name, body, width, height) in new[]
{
    ("short", "请同学们回到教室，准备上课。", 1920, 1080),
    ("long", string.Concat(Enumerable.Repeat("请同学们整理好课本，保持教室安静。", 16)), 1366, 768),
    ("mixed", "各位老师、同学：\n今天的英语活动在 15:30 开始。\nPlease return to classroom 8-1. Thank you!", 1280, 720),
})
{
    var window = new BroadcastWindow(body) { WindowState = WindowState.Normal, Width = width, Height = height };
    window.Show(); Dispatcher.UIThread.RunJobs();
    var border = (Border)window.Content!; var text = (TextBlock)border.Child!;
    if (text.Text != body || text.TextAlignment != TextAlignment.Center || text.FontSize < 28)
        throw new Exception(name + ": content, alignment or readable size failed");
    text.Measure(new Size(width - 128, double.PositiveInfinity));
    if (text.DesiredSize.Height > height - 128 + 1 || text.DesiredSize.Width > width - 128 + 1)
        throw new Exception(name + ": text overflows the screen");
    if (!window.Topmost || window.SystemDecorations != SystemDecorations.None || window.ShowInTaskbar)
        throw new Exception(name + ": broadcast window chrome is visible");
    using var frame = window.CaptureRenderedFrame();
    frame?.Save(Path.Combine(output, name + ".png"));
    Console.WriteLine($"PASS {name}: {width}x{height}, font {text.FontSize:F1}px, height {text.DesiredSize.Height:F1}px");
    window.Dismiss();
}
