using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Presenters;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Styling;
using Avalonia.Threading;
using Broadcast.Core;

namespace Broadcast.Classroom;

internal sealed class BroadcastWindow : Window
{
    private readonly TextBlock _body;
    private readonly TextBlock _emoji;
    private readonly Button _close;
    private readonly TaskCompletionSource _closeRequested = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private bool _closing;
    internal TextBlock Body => _body;
    internal TextBlock Emoji => _emoji;
    internal TextBlock Teacher { get; }
    internal Button CloseButton => _close;

    public BroadcastWindow(Delivery delivery)
    {
        SystemDecorations = SystemDecorations.None;
        WindowState = WindowState.FullScreen;
        Topmost = true; ShowInTaskbar = false; CanResize = false;
        Background = new SolidColorBrush(Color.Parse("#111827"));
        Cursor = new Cursor(StandardCursorType.None);
        var (emoji, foreground) = Style(delivery.Emotion);
        Teacher = new TextBlock
        {
            Text = delivery.TeacherName + " 发布", Foreground = new SolidColorBrush(Color.Parse("#D6DEE9")),
            FontFamily = new FontFamily("Microsoft YaHei, Segoe UI"), FontSize = 28, FontWeight = FontWeight.SemiBold,
            HorizontalAlignment = HorizontalAlignment.Center, TextAlignment = TextAlignment.Center,
        };
        _emoji = new TextBlock
        {
            Text = emoji, IsVisible = emoji.Length > 0, FontSize = 78, TextAlignment = TextAlignment.Center,
            Foreground = foreground, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 0, 0, 18),
        };
        _body = new TextBlock
        {
            Text = delivery.Body, Foreground = foreground,
            FontFamily = new FontFamily("Microsoft YaHei, Segoe UI"), FontWeight = FontWeight.Medium,
            TextAlignment = TextAlignment.Center, TextWrapping = TextWrapping.Wrap,
            HorizontalAlignment = HorizontalAlignment.Stretch, VerticalAlignment = VerticalAlignment.Center,
        };
        _close = new Button
        {
            Content = "关闭", IsVisible = false, Width = 150, Height = 54, FontSize = 20,
            Background = Brushes.White, Foreground = new SolidColorBrush(Color.Parse("#111827")),
            BorderBrush = Brushes.White,
            HorizontalAlignment = HorizontalAlignment.Center, HorizontalContentAlignment = HorizontalAlignment.Center,
            VerticalContentAlignment = VerticalAlignment.Center, Padding = new Thickness(0),
            Cursor = new Cursor(StandardCursorType.Hand), Margin = new Thickness(0, 20, 0, 0),
        };
        _close.Classes.Add("broadcast-close");
        var closeForeground = new SolidColorBrush(Color.Parse("#111827"));
        foreach (var state in new[] { ":pointerover", ":pressed", ":disabled" })
        {
            Styles.Add(new Style(x => x.OfType<Button>().Class("broadcast-close").Class(state).Template().OfType<ContentPresenter>().Name("PART_ContentPresenter"))
            {
                Setters =
                {
                    new Setter(ContentPresenter.BackgroundProperty, Brushes.White),
                    new Setter(ContentPresenter.BorderBrushProperty, Brushes.White),
                    new Setter(ContentPresenter.ForegroundProperty, closeForeground),
                },
            });
        }
        _close.Click += (_, _) => { _close.IsEnabled = false; _closeRequested.TrySetResult(); };
        var message = new StackPanel { VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Stretch };
        message.Children.Add(_emoji); message.Children.Add(_body);
        var layout = new Grid { RowDefinitions = new RowDefinitions("Auto,*,Auto") };
        Grid.SetRow(Teacher, 0); Grid.SetRow(message, 1); Grid.SetRow(_close, 2);
        layout.Children.Add(Teacher); layout.Children.Add(message); layout.Children.Add(_close);
        Content = new Border { Padding = new Thickness(64, 48), Child = layout };
        SizeChanged += (_, _) => Fit();
        Opened += (_, _) => Fit();
        Closing += (_, e) => { if (!_closing) e.Cancel = true; };
    }

    private static (string Emoji, IBrush Foreground) Style(string emotion) => emotion switch
    {
        "happy" => ("😀", new SolidColorBrush(Color.Parse("#60A5FA"))),
        "sad" => ("☹️", new SolidColorBrush(Color.Parse("#FDE047"))),
        "angry" => ("😡", new SolidColorBrush(Color.Parse("#F87171"))),
        "warning" => ("⚠️", new SolidColorBrush(Color.Parse("#FB923C"))),
        _ => ("", Brushes.White),
    };

    private void Fit()
    {
        var width = Math.Max(100, ClientSize.Width - 128);
        var reserved = 96 + 50 + (_emoji.IsVisible ? 110 : 0) + (_close.IsVisible ? 74 : 0);
        var height = Math.Max(100, ClientSize.Height - reserved);
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

    public void ShowCloseButton()
    {
        _close.IsVisible = true; Cursor = new Cursor(StandardCursorType.Arrow); Fit();
    }
    public Task WaitForCloseAsync(CancellationToken ct) => _closeRequested.Task.WaitAsync(ct);
    public void Dismiss() { _closeRequested.TrySetResult(); _closing = true; Close(); }
}

internal sealed class BroadcastDisplay : IDisplay
{
    private BroadcastWindow? _window;
    public async Task ShowAsync(Delivery delivery, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        await Dispatcher.UIThread.InvokeAsync(() => { _window = new BroadcastWindow(delivery); _window.Show(); _window.Activate(); });
        await Dispatcher.UIThread.InvokeAsync(() => { }, DispatcherPriority.Render);
    }
    public async Task ShowCloseButtonAsync() => await Dispatcher.UIThread.InvokeAsync(() => _window?.ShowCloseButton());
    public async Task WaitForCloseAsync(CancellationToken ct)
    {
        var window = _window ?? throw new InvalidOperationException("广播界面未打开");
        await window.WaitForCloseAsync(ct);
    }
    public async Task HideAsync() => await Dispatcher.UIThread.InvokeAsync(() => { _window?.Dismiss(); _window = null; });
}
