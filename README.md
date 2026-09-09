# 校园教室广播系统

老师端 React + TypeScript PWA，教室端 C# + Avalonia，后端 Supabase。固定支持 8-1 至 8-6 六个班级，一班一台设备。

代码包含真实登录、绑定、心跳、广播、语音和回执接口。当前没有创建或修改任何 Supabase / 腾讯云项目，也没有发布到 Sites。缺少配置时，老师端明确显示服务尚未配置；教室端提示填写连接信息。

## 目录

| 目录 | 用途 |
| --- | --- |
| `apps/teacher` | Vite + React 老师端及 PWA |
| `apps/classroom/Broadcast.Classroom` | Windows 桌面、托盘、设置、全屏文字、音频 |
| `apps/classroom/Broadcast.Core` | 登录会话、Realtime、FIFO 队列、过期校验、回执暂存 |
| `supabase` | SQL 迁移、Edge Function、腾讯云 TTS |
| `scripts` | 本地验证、图标生成、Windows 打包 |
| `docs` | 接入步骤、接口及验收说明 |
| `artifacts` | 本地生成的 EXE、ZIP、静态网站和排版检查图片，不入库 |

## 本地开发

需要 Node.js 24、.NET SDK 10；云函数检查使用 Deno 2。可先不配置云服务查看老师端。

```bash
cd apps/teacher
npm ci
cp .env.example .env.local
npm run dev
```

浏览器打开 `http://127.0.0.1:5173`。老师端采用白色和浅灰工作界面，班级多选、输入框和发送按钮直接位于主页；未配置后端时发送和试听不可用。

```bash
# 从项目根目录执行
npm --prefix apps/teacher run build
dotnet run --project apps/classroom/Broadcast.Core.Tests
dotnet run --project apps/classroom/Broadcast.Visual.Tests -- artifacts/visual-qa
bash scripts/verify.sh
bash scripts/publish-windows.sh
```

如 SDK 不在 PATH 中，可给脚本设置 `DOTNET_BIN=/完整路径/dotnet`。本次构建使用的临时 SDK 位于 `/tmp/broadcast-dotnet/dotnet`，后续可安装常规 SDK 替代。

Windows 产物在 `artifacts/windows-x64/Broadcast.Classroom.exe`；分发包是 `artifacts/Broadcast.Classroom-win-x64.zip`，内含 EXE、空配置模板和使用说明。自包含 EXE 不依赖目标机器预装 .NET。发布脚本仅生成本地文件。

## 业务规则

- 老师首次只输入共享管理员密码，后续保存 Supabase Auth 会话并自动刷新，不保存明文密码。
- 教室首次绑定需要管理员验证，绑定后使用独立设备身份。班级占用由数据库事务及唯一约束保证。
- 设备在 Realtime 订阅和心跳确认正常时，每 10 秒上报一次。超过 25 秒没有有效心跳即离线。老师端自己掉线时显示状态待确认。
- 广播最多 300 个 Unicode 字符，按服务器正式创建时间计算 30 秒有效期。合成语音的等待不占用有效期。
- 教室按 FIFO 播放；超过 30 秒还未开始的直接跳过，已开始的正常播完。已开始的处理记录由服务器原子保存，客户端重启不重新播放。
- 正常播放后停留 3 秒；语音合成或下载、播放失败时正文仍显示，按 10 秒总展示时长处理。
- 接收、正文显示、音频开始、音频结束都是不同的客户端回执。“已播放”表示软件音频播放完成，不代表现场扬声器音量一定可听见。
- 断线期间回执存入磁盘，重连后补交；补回执不触发补播。换绑不将旧投递转给新设备。
- 历史保留正文及逐班结果；重新发送创建独立记录和新的 30 秒有效期。

## 配置与验证

后续接入参见 [云端配置说明](docs/SETUP.md)，接口参见 [通信契约](docs/CONTRACT.md)，教室端使用参见 [Windows 说明](docs/WINDOWS-使用说明.md)。

自动化测试不使用真实云账号：Postgres 规则在 PGlite PostgreSQL 引擎内测试，语音用 PCM 样本验证拆分和拼接，队列使用可控音频与显示设备，Avalonia 排版用无界面渲染验证。真实云端联调和 Windows 实机启动、音频测试需在配置后完成，详见 [验收记录](docs/VALIDATION.md)。

`.github/workflows/verify.yml` 提供前端、数据库与 Windows 编译验证，只有仓库后续接入 GitHub 并触发工作流时才会运行。
