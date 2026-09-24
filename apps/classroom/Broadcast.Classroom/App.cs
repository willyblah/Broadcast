using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Platform;
using Avalonia.Styling;
using Avalonia.Themes.Fluent;
using Avalonia.Threading;
using Broadcast.Core;
using System.IO.Pipes;

namespace Broadcast.Classroom;

public sealed class App : Application
{
    private IClassicDesktopStyleApplicationLifetime _desktop = null!;
    private ServiceConfig _config = new();
    private BackendClient? _backend;
    private TencentSpeechSynthesizer? _speech;
    private SetupWindow? _settings;
    private TrayIcon? _tray;
    private CancellationTokenSource? _receiverLife;
    private Task? _receiverTask;
    private readonly CancellationTokenSource _appLife = new();
    private readonly SemaphoreSlim _transition = new(1, 1);
    public override void Initialize() { Styles.Add(new FluentTheme()); RequestedThemeVariant = ThemeVariant.Light; }
    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            _desktop = desktop; desktop.ShutdownMode = ShutdownMode.OnExplicitShutdown;
            try { _config = LocalState.Config(); } catch (Exception e) { LocalState.Log(e); }
            var menu = new NativeMenu();
            var setup = new NativeMenuItem("教室设置"); setup.Click += (_, _) => ShowSettings();
            var exit = new NativeMenuItem("退出广播"); exit.Click += (_, _) => ShowSettings(true);
            menu.Add(setup); menu.Add(new NativeMenuItemSeparator()); menu.Add(exit);
            _tray = new TrayIcon { ToolTipText = "校园广播 · 尚未绑定", Menu = menu,
                Icon = new WindowIcon(AssetLoader.Open(new Uri("avares://Broadcast.Classroom/Assets/icon.png"))) };
            _tray.Clicked += (_, _) => ShowSettings(); TrayIcon.SetIcons(this, [_tray]);
            desktop.Exit += (_, _) => { _appLife.Cancel(); _receiverLife?.Cancel(); _tray.Dispose(); };
            _ = ListenForSecondInstance();
            Dispatcher.UIThread.Post(async () =>
            {
                try
                {
                    var device = LocalState.LoadDevice();
                    if (device is not null && _config.IsConfigured) { LocalState.EnableAutoStart(); await StartAsync(device); }
                    else ShowSettings(notice: LocalState.HasLegacySession ? "程序已更新，需要重新绑定。若班级显示已绑定，请先在老师端的设备管理中解绑。" : null);
                }
                catch (Exception e) { LocalState.Log(e); ShowSettings(notice: "设备登录信息无法读取，请重新绑定。"); }
            });
        }
        base.OnFrameworkInitializationCompleted();
    }
    private void ShowSettings(bool exitOnly = false, string? notice = null)
    {
        if (_settings is not null) { _settings.Activate(); return; }
        _settings = new SetupWindow(_config, _backend?.Device, exitOnly, notice);
        _settings.Closed += (_, _) => { _settings = null; if (!_config.IsConfigured && _backend is null) _desktop.Shutdown(); };
        _settings.Bound += result => Dispatcher.UIThread.Post(async () => await TransitionAsync(() => StartAsync(result.Credential)));
        _settings.Unbound += () => Dispatcher.UIThread.Post(async () => await TransitionAsync(async () => { await StopAsync(); ShowSettings(notice: "已解除绑定，可重新选择班级。"); }));
        _settings.ExitAuthorized += () => Dispatcher.UIThread.Post(async () => await TransitionAsync(async () => { await StopAsync(); _desktop.Shutdown(); }));
        _settings.Show(); _settings.Activate();
    }
    private async Task TransitionAsync(Func<Task> action)
    {
        await _transition.WaitAsync();
        try { await action(); }
        catch (Exception e) { LocalState.Log(e); ShowSettings(notice: e.Message); }
        finally { _transition.Release(); }
    }
    private async Task StartAsync(DeviceCredential device)
    {
        await StopAsync();
        _backend = new BackendClient(_config, device: device);
        _speech = new TencentSpeechSynthesizer(_config.Tts);
        var clock = new ServerClock();
        var outbox = new ReceiptOutbox(Path.Combine(LocalState.Folder, "receipts-" + device.Id + ".json"));
        var queue = new DeliveryQueue(_backend, new BroadcastDisplay(), _speech, new AudioPlayer(), outbox, clock);
        var receiver = new ReceiverService(_backend, queue, outbox, clock);
        receiver.StatusChanged += state => Dispatcher.UIThread.Post(() => { if (_tray is not null) _tray.ToolTipText = "校园广播 · " + state; });
        receiver.Error += LocalState.Log;
        receiver.BindingRevoked += () => Dispatcher.UIThread.Post(async () => await TransitionAsync(async () =>
        { await StopAsync(); LocalState.ForgetDevice(); ShowSettings(notice: "设备已解绑或登录失效，请重新绑定。"); }));
        _receiverLife = CancellationTokenSource.CreateLinkedTokenSource(_appLife.Token);
        _receiverTask = Task.Run(() => receiver.RunAsync(_receiverLife.Token));
    }
    private async Task StopAsync()
    {
        if (_receiverLife is not null) await _receiverLife.CancelAsync();
        if (_receiverTask is not null)
        {
            try { await _receiverTask; } catch (OperationCanceledException) { } catch (Exception e) { LocalState.Log(e); }
        }
        _receiverLife?.Dispose(); _receiverLife = null; _receiverTask = null;
        _speech?.Dispose(); _speech = null;
        _backend?.Dispose(); _backend = null;
        if (_tray is not null) _tray.ToolTipText = "校园广播 · 尚未绑定";
    }
    private async Task ListenForSecondInstance()
    {
        while (!_appLife.IsCancellationRequested)
        {
            try
            {
                using var pipe = new NamedPipeServerStream(Program.InstanceName, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await pipe.WaitForConnectionAsync(_appLife.Token);
                var buffer = new byte[1]; await pipe.ReadExactlyAsync(buffer, _appLife.Token);
                Dispatcher.UIThread.Post(() => ShowSettings());
            }
            catch (OperationCanceledException) { return; }
            catch (Exception e) { LocalState.Log(e); return; }
        }
    }
}
