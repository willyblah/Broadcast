using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Layout;
using Avalonia.Media;
using Broadcast.Core;
using System.Text.Json;

namespace Broadcast.Classroom;

internal sealed class SetupWindow : Window
{
    private readonly ServiceConfig _config;
    private readonly DeviceCredential? _existing;
    private readonly StackPanel _content = new() { Spacing = 18 };
    private readonly TextBlock _error = new() { Foreground = new SolidColorBrush(Color.Parse("#b42318")), FontSize = 15, TextWrapping = TextWrapping.Wrap };
    private BackendClient? _admin;
    private string? _selected;
    private string? _currentClass;
    private bool _busy;
    private readonly bool _exitOnly;
    private readonly CancellationTokenSource _life = new();
    public event Action<RegisteredDevice>? Bound;
    public event Action? Unbound;
    public event Action? ExitAuthorized;

    public SetupWindow(ServiceConfig config, DeviceCredential? existing, bool exitOnly = false, string? notice = null)
    {
        _config = config; _existing = existing; _exitOnly = exitOnly;
        Title = "校园广播 · 教室设置"; Width = 480; Height = 560; MinWidth = 420; MinHeight = 460;
        CanResize = false; WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Background = new SolidColorBrush(Color.Parse("#f6f8fb"));
        FontFamily = new FontFamily("Microsoft YaHei, Segoe UI");
        Content = new ScrollViewer { Content = new Border { Padding = new Thickness(32), Child = _content } };
        Closed += (_, _) => { _life.Cancel(); _admin?.Dispose(); };
        ShowLogin(notice);
    }
    private static TextBlock Heading(string text) => new() { Text = text, FontSize = 25, FontWeight = FontWeight.SemiBold };
    private static TextBlock Note(string text) => new() { Text = text, FontSize = 15, Foreground = new SolidColorBrush(Color.Parse("#526078")), TextWrapping = TextWrapping.Wrap, LineHeight = 25 };
    private static Button ActionButton(string label) => new() { Content = label, FontSize = 16, MinHeight = 46, Padding = new Thickness(18, 10), HorizontalAlignment = HorizontalAlignment.Stretch };
    private void ShowLogin(string? notice)
    {
        _content.Children.Clear();
        _content.Children.Add(Heading(_exitOnly ? "退出校园广播" : _existing is null ? "设置这间教室" : "管理教室设备"));
        if (!_config.IsConfigured)
        {
            _content.Children.Add(Note("广播服务尚未配置。请填写程序旁 appsettings.json 中的 Supabase 和腾讯云语音配置，然后重新启动。"));
            var close = ActionButton("关闭"); close.Click += (_, _) => Close(); _content.Children.Add(close); return;
        }
        _content.Children.Add(Note(notice ?? "输入管理员密码后，选择这台电脑所属的班级。"));
        _content.Children.Add(new TextBlock { Text = "管理员密码", FontSize = 15, Margin = new Thickness(0, 8, 0, -8) });
        var password = new TextBox { PasswordChar = '●', FontSize = 18, MinHeight = 46 };
        _content.Children.Add(password);
        var login = ActionButton("验证密码");
        login.Background = new SolidColorBrush(Color.Parse("#2563eb")); login.Foreground = Brushes.White;
        login.Click += async (_, _) => await RunAsync(login, async () =>
        {
            _admin?.Dispose(); _admin = new BackendClient(_config);
            await _admin.LoginAdminAsync(password.Text ?? "", _life.Token); password.Text = "";
            if (_exitOnly) { ExitAuthorized?.Invoke(); Close(); return; }
            await ShowClassesAsync();
        });
        password.KeyDown += (_, e) => { if (e.Key == Avalonia.Input.Key.Enter) login.RaiseEvent(new Avalonia.Interactivity.RoutedEventArgs(Button.ClickEvent)); };
        _content.Children.Add(login); _content.Children.Add(_error);
        Opened += (_, _) => password.Focus();
    }
    private async Task ShowClassesAsync()
    {
        var state = await _admin!.RpcAsync<ClassroomStatus>("classroom_status", new { }, _life.Token);
        _currentClass = state.Classrooms.FirstOrDefault(r => r.DeviceId == _existing?.Id && r.DeviceId is not null)?.Id;
        _selected = _currentClass;
        _content.Children.Clear(); _content.Children.Add(Heading("选择所属班级"));
        _content.Children.Add(Note("已被其他电脑绑定的班级无法选择。"));
        var grid = new UniformGrid { Columns = 2, Rows = 3 };
        var buttons = new List<Button>();
        foreach (var room in state.Classrooms)
        {
            var available = room.DeviceId is null || room.DeviceId == _existing?.Id;
            var button = ActionButton(room.Id + (available ? "" : "  已绑定"));
            button.Margin = new Thickness(4); button.Height = 62; button.IsEnabled = available;
            button.Click += (_, _) => { _selected = room.Id; Paint(); };
            button.Tag = room.Id; buttons.Add(button); grid.Children.Add(button);
        }
        _content.Children.Add(grid);
        var bind = ActionButton(_existing is null ? "绑定并开始接收" : "保存设置");
        bind.Background = new SolidColorBrush(Color.Parse("#2563eb")); bind.Foreground = Brushes.White;
        bind.Click += async (_, _) => await RunAsync(bind, async () =>
        {
            if (_selected is null) throw new InvalidOperationException("请先选择班级");
            RegisteredDevice result;
            if (_existing is null)
                result = await _admin.ApiAsync<RegisteredDevice>(new { action = "register-device", classroom_id = _selected, name = Environment.MachineName }, _life.Token);
            else
            {
                await _admin.RpcAsync<JsonElement>("bind_device", new { p_device = _existing.Id, p_classroom = _selected, p_name = Environment.MachineName }, _life.Token);
                result = new RegisteredDevice(_existing, _selected);
            }
            LocalState.SaveDevice(result.Credential); LocalState.EnableAutoStart(); Bound?.Invoke(result); Close();
        });
        _content.Children.Add(bind);
        if (_currentClass is not null)
        {
            var unbind = ActionButton("解除当前班级绑定");
            unbind.Click += async (_, _) => await RunAsync(unbind, async () =>
            {
                await _admin.RpcAsync<JsonElement>("unbind_device", new { p_classroom = _currentClass }, _life.Token);
                LocalState.ForgetDevice(); Unbound?.Invoke(); Close();
            });
            _content.Children.Add(unbind);
        }
        _content.Children.Add(_error); Paint();
        void Paint()
        {
            foreach (var button in buttons)
            {
                var selected = Equals(button.Tag, _selected);
                button.Background = new SolidColorBrush(Color.Parse(selected ? "#eaf1ff" : "#ffffff"));
                button.BorderBrush = new SolidColorBrush(Color.Parse(selected ? "#2563eb" : "#dce2eb"));
                button.BorderThickness = new Thickness(selected ? 2 : 1);
                button.Foreground = new SolidColorBrush(Color.Parse("#182236"));
            }
        }
    }
    private async Task RunAsync(Button button, Func<Task> action)
    {
        if (_busy) return;
        _busy = true; button.IsEnabled = false; _error.Text = "";
        try { await action(); }
        catch (OperationCanceledException) when (_life.IsCancellationRequested) { }
        catch (Exception e) { _error.Text = e.Message; LocalState.Log(e); }
        finally { _busy = false; button.IsEnabled = true; }
    }
}
