# 通信契约

所有时间使用 UTC ISO 8601，ID 使用 UUID，正文上限 300 个 Unicode code point。管理员依赖 Supabase Auth 的 `app_metadata.role=admin`。设备 UID 即 `devices.id`，有效绑定由 `classrooms.device_id` 决定。

## Edge Function

入口：`POST /functions/v1/broadcast-api`，传 `Authorization: Bearer <access_token>` 和 `apikey`。请求及响应使用 JSON。异常响应为 `{ "error": "可读错误" }`。

| action | 其他请求参数 | 结果 |
| --- | --- | --- |
| `send` | `request_id`, `body`, `classrooms: string[]`, `teacher_name`, `repeat_count` (0–5), `auto_close`, `emotion`, `voice_type`, 可空 `source_id` | `id` |
| `register-device` | `classroom_id`, `name` | Supabase `session`, `classroom_id`, 设备固定登录凭据 `credential`（`id`, `email`, `password`） |

两个操作均仅管理员可用。创建请求以 `request_id` 去重；同一逻辑重试必须保留该 ID，明确重新发送使用新 ID。Edge Function 只发送正文和投递信息，不生成、保存或返回音频。

## 数据库 RPC

| RPC | 参数 | 返回 / 权限 |
| --- | --- | --- |
| `classroom_status` | 无 | `{server_now, classrooms}`；管理员 |
| `bind_device` | `p_device`, `p_classroom`, `p_name` | 空；管理员或服务端 |
| `unbind_device` | `p_classroom` | 空；管理员 |
| `device_heartbeat` | `p_connected` | `{active, classroom_id, server_now}`；当前设备 |
| `pending_broadcasts` | 无 | `{server_now, items}`；只返回本设备当前班级、未开始且未过期的投递 |
| `start_delivery` | `p_delivery` | boolean；服务器原子验证绑定、30 秒有效期和未开始条件 |
| `ack_delivery` | `p_delivery`, `p_event`, `p_at`, 可空 `p_error` | 空；本设备回执，可重试 |
| `broadcast_history` | 可空 `p_before`, 可空 `p_id` | 最多 20 条广播及嵌套 `deliveries`；管理员 |

`create_broadcast` 供发送云函数在管理员身份下调用，参数为 `p_id`, `p_body`, `p_classrooms`, `p_source`，一次事务写入广播和所有班级投递。

`pending_broadcasts.items` 每项包含 `delivery_id`, `broadcast_id`, `body`, `teacher_name`, `repeat_count`, `auto_close`, `emotion`, `voice_type`, `created_at`, `expires_at`。查询不传入设备 ID，由服务端从 JWT 确定身份。教室客户端根据 `body` 和 `voice_type` 直接调用腾讯云 TTS，并在本机播放生成的 WAV。当 `repeat_count` 大于 1 时重用同一份 WAV。

`emotion` 可取 `normal` / `happy` / `sad` / `angry` / `warning`；`voice_type` 可取 `101001` / `101004` / `101011` / `101013` / `101016`。老师端随网页发布这 5 种音色的固定 WAV 样音，文本均为“请Badger去吃饭”，试听时不请求腾讯云或 Supabase。

回执事件：`received`、`displayed`、`playing`、`played`、`audio_failed`、`finished`、`failed`。字段分别保存第一次收到的事件时间；回执不能将已经存在的时间覆盖，也不能直接更新数据库表。`played` 要求该投递已经开始且存在 `playing` 回执。时间来自客户端校准后的服务端时钟，服务端拒绝明显的未来时间。

## Realtime 与在线

老师端订阅 `devices`、`classrooms` 和 `deliveries` 的 Postgres Changes。教室端通过 Supabase 官方 Phoenix v1 JSON 协议订阅 `deliveries` INSERT，过滤 `device_id=eq.<UID>`，RLS 再校验当前班级。WebSocket 消息只触发有效投递查询，不直接绕过数据库有效期和绑定检查。

教室收到订阅成功后开始上报心跳；随后每 60 秒发送 WebSocket heartbeat 并等待确认，再上报设备心跳。服务端超过 140 秒没有收到有效心跳时将教室标记为离线。重连自动退避至约 10 秒，并在连接恢复后查询未过期消息。每轮正常心跳同时补查有效投递，避免单条通知丢失。

`start_delivery` 是防重复播放的持久化闸门。若闸门已成功写入但程序在显示前崩溃，不会重新播放，历史保留开始记录并等待执行回执；缺失完成回执超过 5 分钟显示“结果待确认”。这是“不得重复播放”与进程崩溃之间的明确取舍，不把未知结果伪装成已播放。

回执与在线状态分别展示。30 秒有效期仅限制开始执行，不中断正在播放的广播。重连只能恢复投递及补交回执，不会复播已经开始的任务。
