# 云端接入与发布

生产 Supabase 项目 `kmuuixuiipqxzeyoawap` 已完成数据库、管理员、云函数和本地来源配置。迁移 `202609080001_broadcast.sql` 已登记为已应用，避免后续 CLI 重复执行。以下步骤保留为复现和维护说明。

## Supabase

1. 创建 Supabase 项目，记录项目 URL、publishable/anon 公钥。客户端使用公钥，绝不能填写 service_role 密钥。当前项目 URL 为 `https://kmuuixuiipqxzeyoawap.supabase.co`。
2. 使用 Supabase CLI 链接项目并按文件名顺序应用 `supabase/migrations` 下的所有 SQL。`202609120001_broadcast_options.sql` 新增老师姓名、播放次数、关闭方式、情感和音色字段，并更新发送与待播查询。
3. 保持 Auth 用户自助注册关闭。创建一个邮箱密码用户，例如 `admin@broadcast.local`，确认邮箱，并通过受信任的 Admin API 将 `app_metadata.role` 设置为 `admin`。必须使用 **app_metadata**，不能使用用户可写的 user_metadata。前端和教室端的管理员邮箱必须与此一致。
4. 部署 `broadcast-api` Edge Function。`supabase/config.toml` 中该函数设置 `verify_jwt=false`，函数内部会调用 `auth.getUser(token)` 验证每一个请求并检查管理员或设备权限，因此不能删除函数内鉴权。
5. 配置函数 Secret：`ALLOWED_ORIGINS`、`TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY`，可选 `TENCENT_TTS_REGION`（默认 `ap-guangzhou`）。Supabase 中的腾讯云凭据只用于老师端固定短句试听；正式广播仍由教室电脑直连腾讯云生成。
6. `ALLOWED_ORIGINS` 为逗号分隔的老师端完整来源，包括协议及端口；本地使用 `http://127.0.0.1:5173,http://localhost:5173`。GitHub Pages 使用来源 `https://willyblah.github.io`；URL 路径 `/Broadcast/` 不属于 Origin。

示例 CLI（在用户下发配置指令后使用）：

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase secrets set --env-file supabase/.env
supabase functions deploy broadcast-api
```

设备注册由管理员验证后的 Edge Function 使用 Auth Admin API 创建独立设备用户。设备公钥只承担项目访问，不提供管理员权限。设备的 Realtime 使用 **Postgres Changes** 与表级 RLS；未使用客户端任意 Broadcast 消息作为指令来源。保留项目默认的 Realtime Channel 访问设置即可，publication 与 SELECT 策略由迁移配置。

## 腾讯云

开通基础语音合成，确认账号可调用 `TextToVoice`。老师端提供腾讯云智瑜 `101001`、智云 `101004`、智燕 `101011`、智辉 `101013`、智甜 `101016` 五种中文音色。

合成使用 `tts.tencentcloudapi.com`、API 版本 `2019-08-23`、正常语速、16kHz WAV。超过单次中文长度限制时拆成最多 150 字的片段，并解析 RIFF 块拼接 PCM。客户端会在合成音频前加入一秒静音，让蓝牙、HDMI 或 USB 音频设备完成唤醒后再输出语音。整个合成流程限时 10 秒，失败自动转为文字广播。

每台教室电脑从程序同目录的 `appsettings.json` 读取腾讯云凭据与语音参数，并在收到广播正文后直接请求腾讯云。音色由每条广播决定，不在教室配置文件中固定。音频只在教室客户端内存中生成和播放，不上传到 Supabase。

## 老师端

在 `apps/teacher/.env.local` 填写：

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_KEY
VITE_ADMIN_EMAIL=admin@broadcast.local
```

重启开发服务器；生成正式产物使用 `npm --prefix apps/teacher run build`。输出是 `apps/teacher/dist`，可自行放到普通静态网站服务器。环境变量在构建时写入，配置变更后需要重新构建。

手机安装 PWA 需要通过 HTTPS 访问；手机不能通过自己的 localhost 访问 Mac 上的服务。

`.github/workflows/pages.yml` 在 `main` 分支推送时构建并部署老师端，使用 `/Broadcast/` 作为 Vite、manifest 和 Service Worker 基础路径。首次使用前需在 GitHub 仓库的 Pages 设置中选择 **GitHub Actions** 作为发布来源。项目 URL 和 publishable key 是浏览器公开配置，已经写入工作流；service role 与腾讯云密钥不得写入老师端工作流。

## Windows 客户端

将分发包中的 `appsettings.json` 填为：

```json
{
  "supabase_url": "https://YOUR_PROJECT.supabase.co",
  "supabase_anon_key": "YOUR_PUBLIC_KEY",
  "admin_email": "admin@broadcast.local",
  "tencent_tts": {
    "secret_id": "YOUR_TENCENT_SECRET_ID",
    "secret_key": "YOUR_TENCENT_SECRET_KEY",
    "region": "ap-guangzhou",
    "model_type": 1,
    "sample_rate": 16000,
    "speed": 0,
    "volume": 0
  }
}
```

不需要重新编译 EXE。此文件包含腾讯云密钥，应限制程序目录的读取权限。仓库内的 `appsettings.json` 是不含腾讯云密钥的安全模板；本地发布时可把完整配置保存在被忽略的 `appsettings.local.json`，`scripts/publish-windows.sh` 会优先将它作为分发包内的 `appsettings.json`。运行后选择班级；管理员可以在老师端设备管理中解除失效电脑的绑定。

首次联调至少用一台 Windows x64 电脑，通过真实腾讯云音频完成接收、显示、播放与历史回执，再执行 `VALIDATION.md` 中的现场验收项。
