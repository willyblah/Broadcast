# 后续云端接入

本文件是操作说明；本阶段没有执行以下云端操作。

## Supabase

1. 创建 Supabase 项目，记录项目 URL、publishable/anon 公钥。客户端使用公钥，绝不能填写 service_role 密钥。
2. 使用 Supabase CLI 链接项目并应用 `supabase/migrations/202609080001_broadcast.sql`。迁移创建六个班级、设备表、广播及回执、权限函数、Realtime publication 和私有音频桶。
3. 保持 Auth 用户自助注册关闭。创建一个邮箱密码用户，例如 `admin@broadcast.local`，确认邮箱，并通过受信任的 Admin API 将 `app_metadata.role` 设置为 `admin`。必须使用 **app_metadata**，不能使用用户可写的 user_metadata。前端和教室端的管理员邮箱必须与此一致。
4. 部署 `broadcast-api` Edge Function。`supabase/config.toml` 中该函数设置 `verify_jwt=false`，函数内部会调用 `auth.getUser(token)` 验证每一个请求并检查管理员或设备权限，因此不能删除函数内鉴权。
5. 配置函数 Secrets：`TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY`、`TENCENT_REGION`、`TENCENT_VOICE_TYPE`、`ALLOWED_ORIGINS`。Supabase 自带的 URL、anon key 和 service_role key 由函数环境提供。
6. `ALLOWED_ORIGINS` 为逗号分隔的老师端完整来源，包括协议及端口；本地使用 `http://127.0.0.1:5173,http://localhost:5173`。部署到其他 HTTPS 地址时加入该来源。

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

开通基础语音合成，确认账号可调用 `TextToVoice`、默认音色 `101001` 可用。按需配置其他音色编号；本版老师端不提供音色下拉菜单。

合成使用 `tts.tencentcloudapi.com`、API 版本 `2019-08-23`、正常语速、16kHz WAV。超过单次中文长度限制时拆成最多 150 字的片段，并解析 RIFF 块拼接 PCM。整个合成流程限时 10 秒，失败自动转为文字广播。

密钥只保存在 Supabase Secrets。相同正文和音色复用 Storage 中的 WAV，老师试听和教室播放使用相同内容。音频桶为私有，客户端只获得 10 分钟有效的签名 URL。

## 老师端

在 `apps/teacher/.env.local` 填写：

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_KEY
VITE_ADMIN_EMAIL=admin@broadcast.local
```

重启开发服务器；生成正式产物使用 `npm --prefix apps/teacher run build`。输出是 `apps/teacher/dist`，可自行放到普通静态网站服务器。环境变量在构建时写入，配置变更后需要重新构建。

手机安装 PWA 需要通过 HTTPS 访问；手机不能通过自己的 localhost 访问 Mac 上的服务。本项目没有指定或执行托管部署。

## Windows 客户端

将分发包中的 `appsettings.json` 填为：

```json
{
  "supabase_url": "https://YOUR_PROJECT.supabase.co",
  "supabase_anon_key": "YOUR_PUBLIC_KEY",
  "admin_email": "admin@broadcast.local"
}
```

不需要重新编译 EXE。运行后选择班级；管理员可以在老师端设备管理中解除失效电脑的绑定。

首次联调至少用一台 Windows x64 电脑，通过真实腾讯云音频完成接收、显示、播放与历史回执，再执行 `VALIDATION.md` 中的现场验收项。
