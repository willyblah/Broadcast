import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { ArrowLeft, ArrowUpRight, AudioLines, Check, ChevronRight, Clock3, LogOut, Radio, Send, Settings2, Square, WifiOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { registerBroadcastTools } from '@/lib/webmcp';
import { adminEmail, api, configured, getClassrooms, getHistory, rpc, supabase } from '@/lib/api';
import { CLASSROOM_IDS, deliveryStatus, isOnline, validDraft, type Broadcast, type Classroom } from '@/lib/domain';

const emptyRooms: Classroom[] = CLASSROOM_IDS.map(id => ({ id, device_id: null, device_name: null, connected: false, last_seen_at: null }));
const time = (value: string) => new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
const message = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!configured);
  const [password, setPassword] = useState('');
  const [rooms, setRooms] = useState<Classroom[]>(emptyRooms);
  const [selected, setSelected] = useState<string[]>([]);
  const [body, setBody] = useState(() => localStorage.getItem('broadcast-draft') || '');
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [history, setHistory] = useState<Broadcast[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [tab, setTab] = useState<'send' | 'history' | 'devices'>('send');
  const [latestId, setLatestId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [live, setLive] = useState(false);
  const [network, setNetwork] = useState(navigator.onLine);
  const [now, setNow] = useState(Date.now);
  const clock = useRef({ server: 0, local: 0 });
  const [confirmRoom, setConfirmRoom] = useState<Classroom | null>(null);
  const sw = useRegisterSW();
  const userId = session?.user.id;
  const length = Array.from(body.trim()).length;

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) setError('登录状态读取失败，请重新登录');
      setSession(data.session); setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, current) => { setSession(current); setAuthReady(true); if (!current) setLive(false); });
    return () => { mounted = false; data.subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    clock.current = { server: Date.now(), local: performance.now() };
    const online = () => setNetwork(true);
    const offline = () => { setNetwork(false); setLive(false); };
    window.addEventListener('online', online); window.addEventListener('offline', offline);
    const timer = window.setInterval(() => setNow(clock.current.server + performance.now() - clock.current.local), 1000);
    return () => { clearInterval(timer); window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }, [clock]);
  const mergeHistory = useCallback((items: Broadcast[]) => setHistory(old => {
    const all = new Map(old.map(item => [item.id, item]));
    items.forEach(item => all.set(item.id, item));
    return [...all.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }), []);
  const refreshRooms = useCallback(async () => {
    const result = await getClassrooms();
    clock.current = { server: Date.parse(result.server_now), local: performance.now() };
    setNow(clock.current.server); setRooms(result.classrooms);
  }, [clock]);
  useEffect(() => {
    if (!userId || !supabase || !network) return;
    let disposed = false;
    const load = async () => {
      try {
        await refreshRooms();
        const items = await getHistory();
        if (!disposed) { mergeHistory(items); setHasMore(items.length === 20); }
      } catch (e) { if (!disposed) { setError(message(e)); setLive(false); } }
    };
    const channel = supabase.channel('teacher-status')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, () => { void refreshRooms().catch(e => setError(message(e))); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'classrooms' }, () => { void refreshRooms().catch(e => setError(message(e))); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, payload => {
        const id = (payload.new as { broadcast_id?: string }).broadcast_id;
        if (id) void getHistory(null, id).then(mergeHistory).catch(e => setError(message(e)));
      })
      .subscribe(status => {
        if (disposed) return;
        setLive(status === 'SUBSCRIBED');
        if (status === 'SUBSCRIBED') void load();
      });
    void load();
    const resume = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', resume);
    return () => { disposed = true; document.removeEventListener('visibilitychange', resume); void supabase!.removeChannel(channel); };
  }, [userId, network, refreshRooms, mergeHistory]);
  useEffect(() => { localStorage.setItem('broadcast-draft', body); }, [body]);

  async function run(name: string, action: () => Promise<void>) {
    setBusy(name); setError(''); setNotice('');
    try { await action(); } catch (e) { setError(message(e)); } finally { setBusy(''); }
  }
  async function login() {
    await run('login', async () => {
      const result = await supabase!.auth.signInWithPassword({ email: adminEmail, password });
      if (result.error) throw new Error('密码不正确或登录服务暂不可用');
      if (result.data.user.app_metadata.role !== 'admin') { await supabase!.auth.signOut(); throw new Error('此账号没有管理员权限'); }
      setPassword('');
    });
  }
  async function send() {
    if (!validDraft(body, selected)) return;
    await run('send', async () => {
      const fingerprint = JSON.stringify([body.trim(), [...selected].sort(), sourceId]);
      let attempt: { fingerprint: string; id: string } | null = null;
      try { attempt = JSON.parse(localStorage.getItem('broadcast-attempt') || 'null'); } catch { /* Ignore invalid local storage. */ }
      if (attempt?.fingerprint !== fingerprint) attempt = { fingerprint, id: crypto.randomUUID() };
      localStorage.setItem('broadcast-attempt', JSON.stringify(attempt));
      const result = await api<{ id: string }>({ action: 'send', request_id: attempt.id, body, classrooms: selected, source_id: sourceId });
      localStorage.removeItem('broadcast-attempt');
      setLatestId(result.id); setSourceId(null);
      setNotice('广播已发出，正在等待教室回执');
      await getHistory(null, result.id).then(mergeHistory).catch(() => setError('广播已创建，回执暂时无法读取，请检查历史记录'));
    });
  }
  function resend(item: Broadcast) {
    setBody(item.body); setSelected(item.deliveries.map(d => d.classroom_id)); setSourceId(item.id);
    setTab('send'); setLatestId(null); setNotice('已填入历史内容，可调整班级后发送'); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const known = configured && !!session && live && network;
  const ready = configured && !!session && network;
  const latest = history.find(b => b.id === latestId);
  useEffect(() => registerBroadcastTools(
    () => ({ connected: known, classrooms: rooms.map(room => ({ id: room.id, online: known ? isOnline(room, clock.current.server + performance.now() - clock.current.local) : null })) }),
    (text, targets) => { setBody(text); setSelected(targets); setSourceId(null); setTab('send'); },
  ), [known, rooms, clock]);
  function receipts(item: Broadcast) {
    return <div className="receipts">{item.deliveries.map(delivery => {
      const state = deliveryStatus(delivery, item, now);
      const room = rooms.find(r => r.id === delivery.classroom_id)!;
      return <div className="receipt-row" key={delivery.id}>
        <span className="receipt-class">{delivery.classroom_id}<span className={'tiny-dot ' + (known && isOnline(room, now) ? 'online' : '')} /></span>
        <span className={'receipt-state ' + state.tone}>{state.label}</span>
        {known && !isOnline(room, now) && <span className="muted receipt-offline">当前离线</span>}
      </div>;
    })}</div>;
  }

  if (configured && !authReady) return <main className="login-shell"><p>正在恢复登录…</p></main>;
  if (configured && !session) return <main className="login-shell"><form className="login-card" onSubmit={e => { e.preventDefault(); void login(); }}>
    <div className="brand-icon"><Radio size={27} /></div><h1>校园广播</h1><p className="muted">输入管理员密码，开始向教室广播。</p>
    <label htmlFor="password">管理员密码</label><Input id="password" className="password-input" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
    {error && <p className="feedback error" role="alert">{error}</p>}
    <Button className="action primary login-submit" type="submit" disabled={!!busy || !network}>{busy ? '正在登录…' : '进入广播'}</Button>
  </form></main>;
  return <div className="app-shell">
    <header className="app-header"><div className="brand"><span className="brand-icon"><Radio size={22} /></span><span>校园广播</span></div>
      <div className="header-actions"><Button variant="ghost" className="icon-action" aria-label="设备管理" onClick={() => setTab('devices')}><Settings2 size={20} /></Button>
      {session && <Button variant="ghost" className="icon-action" aria-label="退出登录" onClick={() => void run('logout', async () => { const { error } = await supabase!.auth.signOut(); if (error) throw error; setHistory([]); setRooms(emptyRooms); })}><LogOut size={19} /></Button>}</div>
    </header>
    <main className="workspace">
      <nav className="tabs" aria-label="主要导航"><button className={tab === 'send' ? 'active' : ''} onClick={() => setTab('send')}><AudioLines size={19} />发广播</button><button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><Clock3 size={18} />广播历史</button></nav>
      {!configured && <div className="feedback config-notice"><span className="tiny-dot" />广播服务尚未配置，连接后即可使用。</div>}
      {configured && !known && <output className="feedback warning"><WifiOff size={17} />{network ? '正在连接，设备状态待确认' : '网络已断开，草稿已保留'}</output>}
      {error && <div className="feedback error" role="alert">{error}<button aria-label="关闭提示" onClick={() => setError('')}><X size={17} /></button></div>}
      {notice && <output className="feedback info">{notice}</output>}
      {sw.needRefresh[0] && <div className="feedback info">有新版本可用<Button variant="link" onClick={() => void sw.updateServiceWorker(true)} disabled={!!busy}>更新应用</Button></div>}
      {tab === 'send' && <>
        <section className="section classrooms-section"><div className="section-heading"><div><h1>选择班级</h1><p className="muted">{known ? rooms.filter(r => isOnline(r, now)).length + ' / 6 个班级在线' : '8 年级 · 共 6 个班级'}</p></div>
          <button className="select-all" onClick={() => setSelected(selected.length === 6 ? [] : [...CLASSROOM_IDS])}>{selected.length === 6 ? <Check size={17} /> : <Square size={17} />}{selected.length === 6 ? '取消全选' : '全选'}</button></div>
          <div className="class-grid">{rooms.map(room => <button key={room.id} className={'class-card ' + (selected.includes(room.id) ? 'selected' : '')} aria-pressed={selected.includes(room.id)} onClick={() => setSelected(old => old.includes(room.id) ? old.filter(id => id !== room.id) : [...old, room.id])}>
            <span className="class-top"><span className="class-number">{room.id}</span><span className="selection-mark">{selected.includes(room.id) && <Check size={15} strokeWidth={3} />}</span></span>
            <span className="class-status"><span className={'tiny-dot ' + (known && isOnline(room, now) ? 'online' : '')} />{!known ? '状态待确认' : isOnline(room, now) ? '在线' : room.device_id ? '离线' : '离线 · 未绑定'}</span>
          </button>)}</div>
        </section>
        <section className="section composer"><div className="section-heading"><h2>广播内容</h2><span className={'character-count ' + (length > 300 ? 'error-text' : '')}>{length} / 300</span></div>
          <Textarea className="broadcast-input" aria-label="广播内容" placeholder="输入需要广播的内容…" value={body} onChange={e => setBody(e.target.value)} />
          <div className="composer-bottom"><span className="selected-count">{selected.length ? <>已选择 <strong>{selected.length}</strong> 个班级</> : '请选择接收班级'}</span><div className="send-actions">
            <Button className="action primary" onClick={() => void send()} disabled={!ready || !!busy || !validDraft(body, selected)}><Send size={17} />{busy === 'send' ? '发送中…' : '发送广播'}</Button>
          </div></div>
        </section>
        {latest && <section className="section delivery-panel" aria-live="polite"><div className="section-heading"><h2>本次广播</h2><span className="muted">{time(latest.created_at)}</span></div><p className="broadcast-body">{latest.body}</p>{receipts(latest)}</section>}
        {!latest && history.length > 0 && <button className="recent-link" onClick={() => { setTab('history'); setExpanded(history[0].id); }}><span><span className="muted">最近广播 · {time(history[0].created_at)}</span><span className="recent-body">{history[0].body}</span></span><ArrowUpRight size={20} /></button>}
      </>}
      {tab === 'history' && <section className="history-section"><div className="section-heading"><h1>广播历史</h1><span className="muted">按发送时间排列</span></div>
        {!history.length && <div className="empty-state"><Clock3 size={32} /><h2>{configured ? '还没有广播记录' : '连接后查看广播历史'}</h2><p className="muted">发过的内容和教室回执会保存在这里。</p></div>}
        {history.map(item => <article key={item.id} className="history-card"><button className="history-summary" aria-expanded={expanded === item.id} onClick={() => setExpanded(expanded === item.id ? null : item.id)}><span className="history-meta"><time>{time(item.created_at)}</time><span>{item.deliveries.length} 个班级</span></span><p className="broadcast-body">{item.body}</p><span className="history-footer"><span>{item.deliveries.filter(d => d.played_at).length} / {item.deliveries.length} 已播放</span><span>送达详情<ChevronRight size={17} className={expanded === item.id ? 'rotated' : ''} /></span></span></button>
          {expanded === item.id && <div className="history-detail">{receipts(item)}<Button variant="outline" className="action resend" onClick={() => resend(item)}><Send size={16} />重新发送</Button></div>}</article>)}
        {hasMore && <Button variant="outline" className="action load-more" disabled={!!busy || !ready} onClick={() => void run('history', async () => { const items = await getHistory(history.at(-1)!.created_at); mergeHistory(items); setHasMore(items.length === 20); })}>加载更多</Button>}
      </section>}
      {tab === 'devices' && <section className="section devices-panel"><Button variant="ghost" className="back-button" onClick={() => setTab('send')}><ArrowLeft size={18} />返回广播</Button><h1>教室设备</h1><p className="muted device-intro">更换电脑前，可在这里解除原设备绑定。</p>{rooms.map(room => <div className="device-row" key={room.id}><div><strong>{room.id}</strong><p className="muted">{room.device_name || '未绑定设备'}</p></div><Button variant="outline" className="action" disabled={!room.device_id || !ready} onClick={() => setConfirmRoom(room)}>解绑</Button></div>)}</section>}
      <AlertDialog open={!!confirmRoom} onOpenChange={open => { if (!open && !busy) setConfirmRoom(null); }}>
        <AlertDialogContent className="confirm-card"><AlertDialogTitle>解除 {confirmRoom?.id} 的绑定？</AlertDialogTitle><AlertDialogDescription>这台电脑将停止接收广播，班级可以绑定新设备。</AlertDialogDescription>
          <div className="confirm-actions"><AlertDialogCancel className="action" disabled={!!busy}>取消</AlertDialogCancel><Button className="action primary" disabled={!!busy} onClick={() => void run('unbind', async () => { if (!confirmRoom) return; await rpc('unbind_device', { p_classroom: confirmRoom.id }); setConfirmRoom(null); await refreshRooms(); setNotice('已解除设备绑定'); })}>确认解绑</Button></div>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  </div>;
}
