alter table public.broadcasts
  add column teacher_name text not null default '未知老师',
  add column repeat_count smallint not null default 1,
  add column auto_close boolean not null default true,
  add column emotion text not null default 'normal',
  add column voice_type integer not null default 101001,
  add constraint broadcasts_teacher_name_check check (char_length(btrim(teacher_name)) between 1 and 40),
  add constraint broadcasts_repeat_count_check check (repeat_count between 0 and 5),
  add constraint broadcasts_emotion_check check (emotion in ('normal','happy','sad','angry','warning')),
  add constraint broadcasts_voice_type_check check (voice_type in (101001,101004,101011,101013,101016));

alter table public.broadcasts alter column teacher_name drop default;

drop function public.create_broadcast(uuid,text,text[],uuid);

create function public.create_broadcast(
  p_id uuid,
  p_body text,
  p_classrooms text[],
  p_source uuid,
  p_teacher_name text,
  p_repeat_count integer,
  p_auto_close boolean,
  p_emotion text,
  p_voice_type integer
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_count int; v_created timestamptz := clock_timestamp();
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if coalesce(array_length(p_classrooms, 1), 0) not between 1 and 6 then raise exception '请选择班级'; end if;
  select count(distinct id) into v_count from public.classrooms where id = any(p_classrooms);
  if v_count <> array_length(p_classrooms, 1) then raise exception '班级列表无效'; end if;
  if char_length(btrim(p_teacher_name)) not between 1 and 40 then raise exception '老师姓名无效'; end if;
  if p_repeat_count not between 0 and 5 then raise exception '播报次数无效'; end if;
  if p_auto_close is null then raise exception '关闭方式无效'; end if;
  if p_emotion not in ('normal','happy','sad','angry','warning') then raise exception '情感无效'; end if;
  if p_voice_type not in (101001,101004,101011,101013,101016) then raise exception '音色无效'; end if;
  insert into public.broadcasts(id, body, created_by, source_id, teacher_name, repeat_count, auto_close, emotion, voice_type, created_at, expires_at)
    values(p_id, btrim(p_body), auth.uid(), p_source, btrim(p_teacher_name), p_repeat_count, p_auto_close, p_emotion, p_voice_type,
      v_created, v_created + interval '30 seconds')
    on conflict(id) do nothing;
  if not found then
    if not exists(select 1 from public.broadcasts where id = p_id and created_by = auth.uid() and body = btrim(p_body)
      and source_id is not distinct from p_source and teacher_name = btrim(p_teacher_name) and repeat_count = p_repeat_count
      and auto_close = p_auto_close and emotion = p_emotion and voice_type = p_voice_type) then
      raise exception '请求编号冲突';
    end if;
    return p_id;
  end if;
  insert into public.deliveries(broadcast_id, classroom_id, device_id, online_at_send)
    select p_id, c.id, c.device_id, coalesce(d.connected and d.last_seen_at > v_created - interval '140 seconds', false)
    from public.classrooms c left join public.devices d on d.id = c.device_id where c.id = any(p_classrooms);
  return p_id;
end $$;

create or replace function public.pending_broadcasts() returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('server_now', clock_timestamp(), 'items', coalesce((
    select jsonb_agg(jsonb_build_object('delivery_id', d.id, 'broadcast_id', b.id, 'body', b.body,
      'teacher_name', b.teacher_name, 'repeat_count', b.repeat_count, 'auto_close', b.auto_close,
      'emotion', b.emotion, 'voice_type', b.voice_type, 'created_at', b.created_at, 'expires_at', b.expires_at)
      order by b.created_at, b.id)
    from public.deliveries d join public.broadcasts b on b.id = d.broadcast_id
    where public.owns_device(d.device_id) and d.classroom_id = public.device_classroom() and d.started_at is null and b.expires_at > clock_timestamp()
  ), '[]'::jsonb))
$$;

revoke execute on function public.create_broadcast(uuid,text,text[],uuid,text,integer,boolean,text,integer) from public, anon;
grant execute on function public.create_broadcast(uuid,text,text[],uuid,text,integer,boolean,text,integer) to authenticated;
grant execute on function public.create_broadcast(uuid,text,text[],uuid,text,integer,boolean,text,integer) to service_role;
