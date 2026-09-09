create table public.devices (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  last_seen_at timestamptz,
  connected boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.classrooms (
  id text primary key check (id in ('8-1','8-2','8-3','8-4','8-5','8-6')),
  device_id uuid unique references public.devices(id) on delete set null
);
insert into public.classrooms(id) values ('8-1'),('8-2'),('8-3'),('8-4'),('8-5'),('8-6');

create table public.audio_assets (
  id text primary key,
  storage_path text not null,
  created_at timestamptz not null default now()
);
create table public.broadcasts (
  id uuid primary key,
  body text not null check (char_length(btrim(body)) between 1 and 300),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp() + interval '30 seconds',
  created_by uuid not null references auth.users(id),
  audio_id text references public.audio_assets(id),
  tts_error text,
  source_id uuid references public.broadcasts(id)
);
create index broadcasts_created_idx on public.broadcasts(created_at desc, id);
create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references public.broadcasts(id) on delete cascade,
  classroom_id text not null references public.classrooms(id),
  device_id uuid references public.devices(id) on delete set null,
  online_at_send boolean not null,
  received_at timestamptz,
  started_at timestamptz,
  displayed_at timestamptz,
  playback_started_at timestamptz,
  played_at timestamptz,
  finished_at timestamptz,
  audio_error text,
  execution_error text,
  unique(broadcast_id, classroom_id)
);
create index deliveries_device_idx on public.deliveries(device_id, broadcast_id);

create function public.is_admin() returns boolean language sql stable
set search_path = '' as $$
  select coalesce(auth.jwt()->'app_metadata'->>'role' = 'admin', false)
$$;
create function public.owns_device(p_device uuid) returns boolean language sql stable security definer
set search_path = '' as $$
  select p_device = auth.uid() and exists(select 1 from public.classrooms where device_id = auth.uid())
$$;
create function public.device_classroom() returns text language sql stable security definer
set search_path = '' as $$
  select id from public.classrooms where device_id = auth.uid()
$$;

alter table public.devices enable row level security;
alter table public.classrooms enable row level security;
alter table public.audio_assets enable row level security;
alter table public.broadcasts enable row level security;
alter table public.deliveries enable row level security;
create policy admin_read_devices on public.devices for select to authenticated using (public.is_admin() or id = auth.uid());
create policy read_classrooms on public.classrooms for select to authenticated using (public.is_admin() or device_id = auth.uid());
create policy admin_read_audio on public.audio_assets for select to authenticated using (public.is_admin());
create policy admin_read_broadcasts on public.broadcasts for select to authenticated using (public.is_admin());
create policy read_deliveries on public.deliveries for select to authenticated using (public.is_admin() or (public.owns_device(device_id) and classroom_id = public.device_classroom()));

create function public.bind_device(p_device uuid, p_classroom text, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_admin() or auth.role() = 'service_role') then raise exception '需要管理员验证'; end if;
  -- Lock the fixed six rows in order so concurrent swaps cannot deadlock.
  perform id from public.classrooms order by id for update;
  if not exists(select 1 from public.classrooms where id = p_classroom) then raise exception '班级不存在'; end if;
  if exists(select 1 from public.classrooms where id = p_classroom and device_id is not null and device_id <> p_device) then
    raise exception '该班级已被其他设备绑定';
  end if;
  insert into public.devices(id, name) values(p_device, left(p_name, 100))
    on conflict(id) do update set name = excluded.name, connected = false;
  update public.classrooms set device_id = null where device_id = p_device;
  update public.classrooms set device_id = p_device where id = p_classroom;
end $$;

create function public.unbind_device(p_classroom text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_device uuid;
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  select device_id into v_device from public.classrooms where id = p_classroom for update;
  update public.classrooms set device_id = null where id = p_classroom;
  update public.devices set connected = false where id = v_device;
end $$;

create function public.device_heartbeat(p_connected boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_class text;
begin
  select id into v_class from public.classrooms where device_id = auth.uid();
  if v_class is null then return jsonb_build_object('active', false, 'server_now', clock_timestamp()); end if;
  update public.devices set last_seen_at = clock_timestamp(), connected = p_connected where id = auth.uid();
  return jsonb_build_object('active', true, 'classroom_id', v_class, 'server_now', clock_timestamp());
end $$;

create function public.classroom_status() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  return jsonb_build_object('server_now', clock_timestamp(), 'classrooms', (
    select jsonb_agg(jsonb_build_object('id', c.id, 'device_id', c.device_id, 'device_name', d.name,
      'last_seen_at', d.last_seen_at, 'connected', coalesce(d.connected, false)) order by c.id)
    from public.classrooms c left join public.devices d on d.id = c.device_id
  ));
end $$;

create function public.create_broadcast(p_id uuid, p_body text, p_classrooms text[], p_audio text default null,
  p_tts_error text default null, p_source uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_count int; v_created timestamptz := clock_timestamp();
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if coalesce(array_length(p_classrooms, 1), 0) not between 1 and 6 then raise exception '请选择班级'; end if;
  select count(distinct id) into v_count from public.classrooms where id = any(p_classrooms);
  if v_count <> array_length(p_classrooms, 1) then raise exception '班级列表无效'; end if;
  insert into public.broadcasts(id, body, created_by, audio_id, tts_error, source_id, created_at, expires_at)
    values(p_id, btrim(p_body), auth.uid(), p_audio, p_tts_error, p_source, v_created, v_created + interval '30 seconds')
    on conflict(id) do nothing;
  if not found then
    if not exists(select 1 from public.broadcasts where id = p_id and created_by = auth.uid() and body = btrim(p_body)) then
      raise exception '请求编号冲突';
    end if;
    return p_id;
  end if;
  insert into public.deliveries(broadcast_id, classroom_id, device_id, online_at_send)
    select p_id, c.id, c.device_id, coalesce(d.connected and d.last_seen_at > v_created - interval '25 seconds', false)
    from public.classrooms c left join public.devices d on d.id = c.device_id where c.id = any(p_classrooms);
  return p_id;
end $$;

create function public.pending_broadcasts() returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('server_now', clock_timestamp(), 'items', coalesce((
    select jsonb_agg(jsonb_build_object('delivery_id', d.id, 'broadcast_id', b.id, 'body', b.body,
      'created_at', b.created_at, 'expires_at', b.expires_at, 'audio_id', b.audio_id, 'tts_error', b.tts_error)
      order by b.created_at, b.id)
    from public.deliveries d join public.broadcasts b on b.id = d.broadcast_id
    where public.owns_device(d.device_id) and d.classroom_id = public.device_classroom() and d.started_at is null and b.expires_at > clock_timestamp()
  ), '[]'::jsonb))
$$;

create function public.start_delivery(p_delivery uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  -- One atomic claim is shared by duplicate messages, reconnects and process restarts.
  update public.deliveries d set started_at = clock_timestamp(), received_at = coalesce(d.received_at, clock_timestamp())
    from public.broadcasts b where d.id = p_delivery and b.id = d.broadcast_id
    and public.owns_device(d.device_id) and d.classroom_id = public.device_classroom() and d.started_at is null and b.expires_at > clock_timestamp();
  return found;
end $$;

create function public.ack_delivery(p_delivery uuid, p_event text, p_at timestamptz, p_error text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.deliveries;
begin
  select * into v from public.deliveries where id = p_delivery for update;
  if not public.owns_device(v.device_id) or v.classroom_id is distinct from public.device_classroom() then raise exception '无权提交此设备回执'; end if;
  if p_at is null or p_at > clock_timestamp() + interval '5 seconds' then raise exception '回执时间无效'; end if;
  if p_event <> 'received' and v.started_at is null then raise exception '广播尚未开始'; end if;
  if p_event = 'received' then
    update public.deliveries set received_at = coalesce(received_at, p_at) where id = p_delivery;
  elsif p_event = 'displayed' then
    update public.deliveries set displayed_at = coalesce(displayed_at, p_at) where id = p_delivery;
  elsif p_event = 'playing' then
    update public.deliveries set playback_started_at = coalesce(playback_started_at, p_at) where id = p_delivery;
  elsif p_event = 'played' then
    if v.playback_started_at is null then raise exception '语音尚未开始'; end if;
    update public.deliveries set played_at = coalesce(played_at, p_at) where id = p_delivery;
  elsif p_event = 'audio_failed' then
    update public.deliveries set audio_error = coalesce(audio_error, left(coalesce(p_error, '语音不可用'), 300)) where id = p_delivery;
  elsif p_event = 'finished' then
    update public.deliveries set finished_at = coalesce(finished_at, p_at) where id = p_delivery;
  elsif p_event = 'failed' then
    update public.deliveries set execution_error = coalesce(execution_error, left(coalesce(p_error, '广播未完成'), 300)),
      finished_at = coalesce(finished_at, p_at) where id = p_delivery;
  else raise exception '未知回执类型'; end if;
end $$;

create function public.broadcast_history(p_before timestamptz default null, p_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  return coalesce((select jsonb_agg(to_jsonb(b) || jsonb_build_object('deliveries', (
    select coalesce(jsonb_agg(to_jsonb(d) order by d.classroom_id), '[]'::jsonb) from public.deliveries d where d.broadcast_id = b.id
  )) order by b.created_at desc) from (
    select * from public.broadcasts where (p_before is null or created_at < p_before) and (p_id is null or id = p_id)
    order by created_at desc limit 20
  ) b), '[]'::jsonb);
end $$;

revoke all on all tables in schema public from anon, authenticated;
grant select on public.classrooms, public.devices, public.deliveries, public.broadcasts, public.audio_assets to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on function public.is_admin(), public.owns_device(uuid), public.device_classroom(), public.bind_device(uuid,text,text),
  public.unbind_device(text), public.device_heartbeat(boolean), public.classroom_status(),
  public.create_broadcast(uuid,text,text[],text,text,uuid), public.pending_broadcasts(), public.start_delivery(uuid),
  public.ack_delivery(uuid,text,timestamptz,text), public.broadcast_history(timestamptz,uuid) to authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter publication supabase_realtime add table public.devices, public.classrooms, public.deliveries;

insert into storage.buckets(id, name, public) values ('broadcast-audio', 'broadcast-audio', false)
  on conflict(id) do nothing;
