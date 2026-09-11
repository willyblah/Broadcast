using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Media;
using Avalonia.Threading;
using Broadcast.Classroom;
using Broadcast.Core;

AppBuilder.Configure<Application>().UseSkia().UseHeadless(new AvaloniaHeadlessPlatformOptions { UseHeadlessDrawing = false }).SetupWithoutStarting();
var output = args.Length > 0 ? args[0] : Path.Combine(Path.GetTempPath(), "broadcast-visual-tests");
Directory.CreateDirectory(output);
foreach (var (name, body, emotion, width, height) in new[]
{
    ("short", "请同学们回到教室，准备上课。", "happy", 1920, 1080),
    ("long", string.Concat(Enumerable.Repeat("请同学们整理好课本，保持教室安静。", 16)), "sad", 1366, 768),
    ("mixed", "各位老师、同学：\n今天的英语活动在 15:30 开始。\nPlease return to classroom 8-1. Thank you!", "warning", 1280, 720),
})
{
    var delivery = new Delivery(Guid.NewGuid(), Guid.NewGuid(), body, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddSeconds(30),
        "王老师", 1, true, emotion, 101001);
    var window = new BroadcastWindow(delivery) { WindowState = WindowState.Normal, Width = width, Height = height };
    window.Show(); Dispatcher.UIThread.RunJobs();
    var text = window.Body;
    if (text.Text != body || text.TextAlignment != TextAlignment.Center || text.FontSize < 28 || window.Teacher.Text != "王老师 发布" || !window.Emoji.IsVisible)
        throw new Exception(name + ": content, alignment or readable size failed");
    text.Measure(new Size(width - 128, double.PositiveInfinity));
    if (text.DesiredSize.Height > height - 256 + 1 || text.DesiredSize.Width > width - 128 + 1)
        throw new Exception(name + ": text overflows the screen");
    if (!window.Topmost || window.SystemDecorations != SystemDecorations.None || window.ShowInTaskbar)
        throw new Exception(name + ": broadcast window chrome is visible");
    using var frame = window.CaptureRenderedFrame();
    frame?.Save(Path.Combine(output, name + ".png"));
    Console.WriteLine($"PASS {name}: {width}x{height}, font {text.FontSize:F1}px, height {text.DesiredSize.Height:F1}px");
    window.Dismiss();
}

var colors = new HashSet<string?>();
foreach (var emotion in new[] { "normal", "happy", "sad", "angry", "warning" })
{
    var delivery = new Delivery(Guid.NewGuid(), Guid.NewGuid(), "颜色测试", DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddSeconds(30),
        "李老师", 0, false, emotion, 101004);
    var window = new BroadcastWindow(delivery) { WindowState = WindowState.Normal, Width = 1280, Height = 720 };
    window.Show(); Dispatcher.UIThread.RunJobs(); colors.Add(window.Body.Foreground?.ToString());
    if ((emotion == "normal") == window.Emoji.IsVisible) throw new Exception(emotion + ": emoji visibility failed");
    window.ShowCloseButton(); Dispatcher.UIThread.RunJobs();
    if (!window.CloseButton.IsVisible) throw new Exception(emotion + ": manual close button is hidden");
    window.Dismiss();
}
if (colors.Count != 5) throw new Exception("Emotion text colors are not distinct");
Console.WriteLine("PASS emotion colors, emoji and manual close button");
