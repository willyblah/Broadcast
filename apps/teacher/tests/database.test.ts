import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const admin = '10000000-0000-4000-8000-000000000001';
const first = '20000000-0000-4000-8000-000000000001';
const second = '20000000-0000-4000-8000-000000000002';
const third = '20000000-0000-4000-8000-000000000003';
let db: PGlite;
async function identity(id: string, role = 'device') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: id, role: 'authenticated', app_metadata: { role } })]);
  await db.exec('set role authenticated');
}
async function scalar<T>(sql: string, args: unknown[] = []) { return Object.values((await db.query<Record<string, T>>(sql, args)).rows[0])[0]; }
async function create(targets = ['8-1']) {
  const id = crypto.randomUUID();
  await identity(admin, 'admin');
  await db.query('select create_broadcast($1, $2, $3)', [id, '请同学们回到教室。', targets]);
  return id;
}
async function delivery(id: string, classroom = '8-1') { await identity(admin, 'admin'); return scalar<string>('select id from deliveries where broadcast_id=$1 and classroom_id=$2', [id, classroom]); }
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims', true), '')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    create function auth.role() returns text language sql stable as $$select auth.jwt()->>'role'$$;
    grant usage on schema auth, public to authenticated, anon, service_role;
    create table storage.buckets(id text primary key, name text, public boolean);
    create publication supabase_realtime;
    insert into auth.users values ('${admin}'),('${first}'),('${second}'),('${third}');`);
  await db.exec(await readFile(new URL('../../../supabase/migrations/202609080001_broadcast.sql', import.meta.url), 'utf8'));
  await identity(admin, 'admin');
  await db.query('select bind_device($1,$2,$3)', [first, '8-1', 'classroom-one']);
  await db.query('select bind_device($1,$2,$3)', [second, '8-2', 'classroom-two']);
});
afterAll(async () => { await db?.close(); });
describe('database contract and RLS (real PostgreSQL engine)', () => {
  it('seeds exactly six classrooms', async () => { await identity(admin, 'admin'); expect(await scalar<number>('select count(*)::int from classrooms')).toBe(6); });
  it('rejects a second device competing for an occupied classroom', async () => { await identity(admin, 'admin'); await expect(db.query('select bind_device($1,$2,$3)', [third, '8-1', 'competitor'])).rejects.toThrow('已被其他设备绑定'); });
  it('prevents device users from changing bindings or sending broadcasts', async () => { await identity(first); await expect(db.query('select unbind_device($1)', ['8-2'])).rejects.toThrow('管理员'); await expect(db.query('select create_broadcast($1,$2,$3)', [crypto.randomUUID(), 'forged', ['8-2']])).rejects.toThrow('管理员'); });
  it('only exposes the device own classroom and deliveries', async () => {
    const id = await create(['8-1','8-2']); await identity(first);
    expect(await scalar<number>('select count(*)::int from classrooms')).toBe(1);
    const rows = await db.query<{ classroom_id: string }>('select classroom_id from deliveries where broadcast_id=$1', [id]);
    expect(rows.rows).toEqual([{ classroom_id: '8-1' }]);
    expect(await scalar<number>('select count(*)::int from broadcasts')).toBe(0);
  });
  it('uses a server timestamp and a 30 second TTL, and retries are idempotent', async () => {
    const id = await create(); await db.query('select create_broadcast($1,$2,$3)', [id, '请同学们回到教室。', ['8-1']]);
    expect(await scalar<number>('select count(*)::int from deliveries where broadcast_id=$1', [id])).toBe(1);
    expect(await scalar<number>('select extract(epoch from expires_at-created_at)::int from broadcasts where id=$1', [id])).toBe(30);
  });
  it('requires a client receipt and atomically claims only once', async () => {
    const id = await create(); const did = await delivery(id); await identity(first);
    await expect(db.query("select ack_delivery($1,'played',clock_timestamp())", [did])).rejects.toThrow('尚未开始');
    expect(await scalar<boolean>('select start_delivery($1)', [did])).toBe(true);
    expect(await scalar<boolean>('select start_delivery($1)', [did])).toBe(false);
    await db.query("select ack_delivery($1,'displayed',clock_timestamp())", [did]);
    await db.query("select ack_delivery($1,'playing',clock_timestamp())", [did]);
    await db.query("select ack_delivery($1,'played',clock_timestamp())", [did]);
    const played = await scalar<string>('select played_at::text from deliveries where id=$1', [did]);
    await db.query("select ack_delivery($1,'played',clock_timestamp())", [did]);
    expect(await scalar<string>('select played_at::text from deliveries where id=$1', [did])).toBe(played);
  });
  it('does not return expired messages on reconnect and refuses an expired start', async () => {
    const id = await create(); const did = await delivery(id); await db.exec('reset role');
    await db.query("update broadcasts set expires_at=clock_timestamp()-interval '1 second' where id=$1", [id]);
    await identity(first);
    const pending = await scalar<{ items: { broadcast_id: string }[] }>('select pending_broadcasts()');
    expect(pending.items.some(x => x.broadcast_id === id)).toBe(false);
    expect(await scalar<boolean>('select start_delivery($1)', [did])).toBe(false);
  });
  it('cannot write another classroom receipt', async () => { const id = await create(['8-2']); const did = await delivery(id, '8-2'); await identity(first); await expect(db.query("select ack_delivery($1,'received',clock_timestamp())", [did])).rejects.toThrow('无权'); });
  it('blocks direct writes that could forge online or playback state', async () => { await identity(first); await expect(db.query('update devices set connected=true')).rejects.toThrow('permission denied'); await expect(db.query('update deliveries set played_at=clock_timestamp()')).rejects.toThrow('permission denied'); });
  it('records real device heartbeats', async () => { await identity(first); expect((await scalar<{ active: boolean }>('select device_heartbeat(true)')).active).toBe(true); await identity(admin, 'admin'); const status = await scalar<{ classrooms: {id:string;connected:boolean}[] }>('select classroom_status()'); expect(status.classrooms.find(c => c.id === '8-1')?.connected).toBe(true); });
  it('invalidates old-class messages after rebind and does not transfer them to replacement devices', async () => {
    const id = await create(); const did = await delivery(id);
    await db.query('select bind_device($1,$2,$3)', [first, '8-3', 'moved']);
    await db.query('select bind_device($1,$2,$3)', [third, '8-1', 'replacement']);
    for (const device of [first, third]) { await identity(device); expect(await scalar<boolean>('select start_delivery($1)', [did])).toBe(false); }
    await identity(admin, 'admin'); await db.query('select unbind_device($1)', ['8-3']); await identity(first);
    expect((await scalar<{ active: boolean }>('select device_heartbeat(true)')).active).toBe(false);
  });
});
