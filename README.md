# 校园教室广播系统

老师端 React + TypeScript PWA，教室端 C# + Avalonia，后端 Supabase。固定支持 8-1 至 8-6 六个班级，一班一台设备。

代码包含真实登录、绑定、心跳、广播、语音和回执接口。Supabase 生产项目、管理员、数据库迁移和云函数已经配置；老师端的 GitHub Pages Actions 工作流也已就绪。GitHub Pages 尚待在仓库设置中启用，真实 Windows、手机和教室网络联调仍需按验收清单执行。

## 目录

| 目录 | 用途 |
| --- | --- |
| `apps/teacher` | Vite + React 老师端及 PWA |
| `apps/classroom/Broadcast.Classroom` | Windows 桌面、托盘、设置、全屏文字、音频 |
| `apps/classroom/Broadcast.Core` | 登录会话、Realtime、FIFO 队列、过期校验、回执暂存 |
| `supabase` | SQL 迁移、Edge Function、鉴权与广播投递 |
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

浏览器打开 `http://127.0.0.1:5173`。老师端采用白色和浅灰工作界面，班级多选、输入框和发送按钮直接位于主页；未配置后端时发送不可用。

```bash
# 从项目根目录执行
npm --prefix apps/teacher run build
dotnet run --project apps/classroom/Broadcast.Core.Tests
dotnet run --project apps/classroom/Broadcast.Visual.Tests -- artifacts/visual-qa
bash scripts/verify.sh
bash scripts/publish-windows.sh
```

如 SDK 不在 PATH 中，可给脚本设置 `DOTNET_BIN=/完整路径/dotnet`。本次构建使用的临时 SDK 位于 `/tmp/broadcast-dotnet/dotnet`，后续可安装常规 SDK 替代。

Windows 产物在 `artifacts/windows-x64/Broadcast.Classroom.exe`；分发包是 `artifacts/Broadcast.Classroom-win-x64.zip`，内含 EXE、配置和使用说明。自包含 EXE 不依赖目标机器预装 .NET。发布脚本优先将不入库的 `appsettings.local.json` 写入本地分发包，没有本地覆盖时使用安全模板。

## 业务规则

- 老师登录时填写姓名并输入共享管理员密码；姓名跟随每条广播保存和显示。老师姓名仅存在当前浏览器，不写入共享管理员账号。
- 教室首次绑定需要管理员验证，绑定后使用独立设备身份。班级占用由数据库事务及唯一约束保证。
- 设备在 Realtime 订阅和心跳确认正常时，每 60 秒上报一次。服务端超过 140 秒没有收到有效心跳即将教室视为离线。老师端自己掉线时显示状态待确认。
- 广播最多 300 个 Unicode 字符，按服务器正式创建时间计算 30 秒有效期。合成语音的等待不占用有效期。
- 教室按 FIFO 播放；超过 30 秒还未开始的直接跳过，已开始的正常播完。已开始的处理记录由服务器原子保存，客户端重启不重新播放。
- 每条广播可选 0–5 遍语音、0 遍时仅显示文字。多遍播放只请求一次语音合成，不重复产生合成费用。
- 可选高兴、难过、生气、提醒或普通显示，教室端用鲜明字色及 emoji 区分。也可选择腾讯云的 5 种中文音色。
- 自动关闭时，正常音频结束后停留 3 秒；语音失败或 0 遍时按 10 秒总展示时长处理。手动关闭时，完成后显示大号“关闭”按钮。
- 接收、正文显示、音频开始、音频结束都是不同的客户端回执。“已播放”表示软件音频播放完成，不代表现场扬声器音量一定可听见。
- 断线期间回执存入磁盘，重连后补交；补回执不触发补播。换绑不将旧投递转给新设备。
- 历史保留正文及逐班结果；重新发送创建独立记录和新的 30 秒有效期。

## 配置与验证

后续接入参见 [云端配置说明](docs/SETUP.md)，接口参见 [通信契约](docs/CONTRACT.md)，教室端使用参见 [Windows 说明](docs/WINDOWS-使用说明.md)。

自动化测试不使用真实云账号：Postgres 规则在 PGlite PostgreSQL 引擎内测试，队列使用可控语音合成与显示设备，Avalonia 排版用无界面渲染验证。真实云端联调和 Windows 实机启动、音频测试需在配置后完成，详见 [验收记录](docs/VALIDATION.md)。

`.github/workflows/verify.yml` 提供前端、数据库与 Windows 编译验证；`.github/workflows/pages.yml` 在 `main` 更新时构建并发布老师端。首次发布前需在 GitHub Pages 设置中选择 GitHub Actions 作为来源。
