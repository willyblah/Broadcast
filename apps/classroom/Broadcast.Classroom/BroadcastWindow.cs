using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using Broadcast.Core;

namespace Broadcast.Classroom;

internal sealed class BroadcastWindow : Window
{
    private readonly TextBlock _body;
    private bool _closing;
    public BroadcastWindow(string body)
    {
        SystemDecorations = SystemDecorations.None;
        WindowState = WindowState.FullScreen;
        Topmost = true; ShowInTaskbar = false; CanResize = false;
        Background = new SolidColorBrush(Color.Parse("#111827"));
        Cursor = new Avalonia.Input.Cursor(Avalonia.Input.StandardCursorType.None);
        _body = new TextBlock { Text = body, Foreground = Brushes.White,
            FontFamily = new FontFamily("Microsoft YaHei, Segoe UI"), FontWeight = FontWeight.Medium,
            TextAlignment = TextAlignment.Center, TextWrapping = TextWrapping.Wrap,
            HorizontalAlignment = HorizontalAlignment.Stretch, VerticalAlignment = VerticalAlignment.Center };
        Content = new Border { Padding = new Thickness(64), Child = _body };
        SizeChanged += (_, _) => Fit();
        Opened += (_, _) => Fit();
        Closing += (_, e) => { if (!_closing) e.Cancel = true; };
    }
    private void Fit()
    {
        var width = Math.Max(100, ClientSize.Width - 128);
        var height = Math.Max(100, ClientSize.Height - 128);
        double lo = 12, hi = Math.Min(160, height);
        while (hi - lo > .5)
        {
            var size = (lo + hi) / 2;
            _body.FontSize = size;
            _body.Measure(new Size(width, double.PositiveInfinity));
            if (_body.DesiredSize.Height <= height && _body.DesiredSize.Width <= width + 1) lo = size; else hi = size;
        }
        _body.FontSize = lo;
    }
    public void Dismiss() { _closing = true; Close(); }
}

internal sealed class BroadcastDisplay : IDisplay
{
    private BroadcastWindow? _window;
    public async Task ShowAsync(string body, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        await Dispatcher.UIThread.InvokeAsync(() => { _window = new BroadcastWindow(body); _window.Show(); _window.Activate(); });
        await Dispatcher.UIThread.InvokeAsync(() => { }, DispatcherPriority.Render);
    }
    public async Task HideAsync() => await Dispatcher.UIThread.InvokeAsync(() => { _window?.Dismiss(); _window = null; });
}
