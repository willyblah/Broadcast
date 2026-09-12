import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { ArrowLeft, ArrowUpRight, AudioLines, Check, ChevronRight, Clock3, LogOut, Radio, Send, Settings2, Square, Volume2, WifiOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { registerBroadcastTools } from '@/lib/webmcp';
import { adminEmail, api, configured, getClassrooms, getHistory, rpc, supabase } from '@/lib/api';
import { CLASSROOM_IDS, EMOTIONS, VOICES, deliveryStatus, isOnline, validDraft, validTeacherName,
  type Broadcast, type Classroom, type Emotion } from '@/lib/domain';

const emptyRooms: Classroom[] = CLASSROOM_IDS.map(id => ({ id, device_id: null, device_name: null, connected: false, last_seen_at: null }));
const time = (value: string) => new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
const message = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试';
const teacherKey = 'broadcast-teacher-session-v2';
const previewUrl = (voice: number) => `${import.meta.env.BASE_URL}voice-previews/${voice}.wav`;
const rememberedTeacher = () => localStorage.getItem(teacherKey)?.trim() || '';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!configured);
  const [password, setPassword] = useState('');
  const [loginName, setLoginName] = useState('');
  const [teacherName, setTeacherName] = useState(rememberedTeacher);
  const [rooms, setRooms] = useState<Classroom[]>(emptyRooms);
  const [selected, setSelected] = useState<string[]>([]);
  const [body, setBody] = useState(() => localStorage.getItem('broadcast-draft') || '');
  const [repeatCount, setRepeatCount] = useState(1);
  const [autoClose, setAutoClose] = useState(true);
  const [emotion, setEmotion] = useState<Emotion>('normal');
  const [voiceType, setVoiceType] = useState(101001);
  const [previewing, setPreviewing] = useState<number | null>(null);
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
  const previewAudio = useRef<HTMLAudioElement | null>(null);
  const userId = session?.user.id;
  const length = Array.from(body.trim()).length;

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    void supabase.auth.getSession().then(async ({ data, error }) => {
      if (!mounted) return;
      if (error) setError('登录状态读取失败，请重新登录');
      if (data.session && !validTeacherName(rememberedTeacher())) {
        await supabase!.auth.signOut({ scope: 'local' });
        if (!mounted) return;
        setSession(null); setTeacherName(''); setAuthReady(true);
        return;
      }
      setSession(data.session); setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, current) => { setSession(current); setAuthReady(true); if (!current) setLive(false); });
    return () => { mounted = false; data.subscription.unsubscribe(); };
  }, []);
  useEffect(() => () => { previewAudio.current?.pause(); }, []);
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
    const historyRequests = new Map<string, number>();
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
        if (id) {
          const request = (historyRequests.get(id) ?? 0) + 1;
          historyRequests.set(id, request);
          void getHistory(null, id).then(items => {
            if (!disposed && historyRequests.get(id) === request) mergeHistory(items);
          }).catch(e => {
            if (!disposed && historyRequests.get(id) === request) setError(message(e));
          });
        }
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
    if (!validTeacherName(loginName)) { setError('请输入 1–40 字老师姓名'); return; }
    await run('login', async () => {
      const result = await supabase!.auth.signInWithPassword({ email: adminEmail, password });
      if (result.error) throw new Error('密码不正确或登录服务暂不可用');
      if (result.data.user.app_metadata.role !== 'admin') { await supabase!.auth.signOut(); throw new Error('此账号没有管理员权限'); }
      const name = loginName.trim();
      localStorage.setItem(teacherKey, name); setTeacherName(name); setPassword(''); setLoginName('');
    });
  }
  async function send() {
    if (!validDraft(body, selected)) return;
    await run('send', async () => {
      const fingerprint = JSON.stringify([body.trim(), [...selected].sort(), sourceId, teacherName, repeatCount, autoClose, emotion, voiceType]);
      let attempt: { fingerprint: string; id: string } | null = null;
      try { attempt = JSON.parse(localStorage.getItem('broadcast-attempt') || 'null'); } catch { /* Ignore invalid local storage. */ }
      if (attempt?.fingerprint !== fingerprint) attempt = { fingerprint, id: crypto.randomUUID() };
      localStorage.setItem('broadcast-attempt', JSON.stringify(attempt));
      const result = await api<{ id: string }>({ action: 'send', request_id: attempt.id, body, classrooms: selected,
        source_id: sourceId, teacher_name: teacherName, repeat_count: repeatCount, auto_close: autoClose, emotion, voice_type: voiceType });
      localStorage.removeItem('broadcast-attempt');
      setLatestId(result.id); setSourceId(null);
      setNotice('广播已发出，正在等待教室回执');
      await getHistory(null, result.id).then(mergeHistory).catch(() => setError('广播已创建，回执暂时无法读取，请检查历史记录'));
    });
  }
  function resend(item: Broadcast) {
    setBody(item.body); setSelected(item.deliveries.map(d => d.classroom_id)); setSourceId(item.id);
    setRepeatCount(item.repeat_count); setAutoClose(item.auto_close); setEmotion(item.emotion); setVoiceType(item.voice_type);
    setTab('send'); setLatestId(null); setNotice('已填入历史内容，可调整班级后发送'); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function previewVoice(id: number) {
    setPreviewing(id); setError('');
    try {
      previewAudio.current?.pause();
      const player = new Audio(previewUrl(id)); previewAudio.current = player;
      await player.play();
    } catch (e) { setError(message(e)); }
    finally { setPreviewing(null); }
  }
  const known = configured && !!session && live && network;
  const ready = configured && !!session && network && validTeacherName(teacherName);
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
    <div className="brand-icon"><Radio size={27} /></div><h1>校园广播</h1><p className="muted">填写姓名并验证管理员密码，同学们会看到广播由谁发布。</p>
    <label htmlFor="teacher-name">老师姓名</label><Input id="teacher-name" className="login-input" autoComplete="name" maxLength={40} required value={loginName} onChange={e => setLoginName(e.target.value)} />
    <label htmlFor="password">管理员密码</label><Input id="password" className="login-input" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
    {error && <p className="feedback error" role="alert">{error}</p>}
    <Button className="action primary login-submit" type="submit" disabled={!!busy || !network || !validTeacherName(loginName)}>{busy ? '正在登录…' : '进入广播'}</Button>
  </form></main>;
  return <div className="app-shell">
    <header className="app-header"><div className="brand"><span className="brand-icon"><Radio size={22} /></span><span>校园广播</span></div>
      <div className="header-actions"><span className="teacher-chip">{teacherName}</span><Button variant="ghost" className="icon-action" aria-label="设备管理" onClick={() => setTab('devices')}><Settings2 size={20} /></Button>
      {session && <Button variant="ghost" className="icon-action" aria-label="退出登录" onClick={() => void run('logout', async () => { const { error } = await supabase!.auth.signOut({ scope: 'local' }); if (error) throw error; localStorage.removeItem(teacherKey); setTeacherName(''); setHistory([]); setRooms(emptyRooms); })}><LogOut size={19} /></Button>}</div>
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
          <div className="broadcast-options">
            <fieldset className="option-field"><legend>播报几遍</legend><div className="choice-row compact">
              {[0, 1, 2, 3, 4, 5].map(count => <button type="button" key={count} className={repeatCount === count ? 'active' : ''} aria-pressed={repeatCount === count} onClick={() => setRepeatCount(count)}>{count}</button>)}
            </div><p>{repeatCount === 0 ? '只显示文字，不播放语音' : `音频只合成一次，本机播放 ${repeatCount} 遍`}</p></fieldset>
            <fieldset className="option-field"><legend>完成后</legend><div className="choice-row">
              <button type="button" className={autoClose ? 'active' : ''} aria-pressed={autoClose} onClick={() => setAutoClose(true)}>自动关闭</button>
              <button type="button" className={!autoClose ? 'active' : ''} aria-pressed={!autoClose} onClick={() => setAutoClose(false)}>保留，手动关闭</button>
            </div></fieldset>
            <fieldset className="option-field emotion-field"><legend>情感</legend><div className="choice-row emotion-row">
              {EMOTIONS.map(item => <button type="button" key={item.id} className={emotion === item.id ? `active emotion-${item.id}` : ''} aria-pressed={emotion === item.id} onClick={() => setEmotion(item.id)}><span>{item.emoji || '无 emoji'}</span>{item.label}</button>)}
            </div></fieldset>
            <fieldset className="option-field voice-field"><legend>音色</legend><p className="voice-note">试听固定文本“请Badger去吃饭”，不会合成上方正文。</p><div className="voice-list">
              {VOICES.map(voice => <div className={'voice-row ' + (voiceType === voice.id ? 'selected' : '')} key={voice.id}>
                <label aria-label={`${voice.name} ${voice.detail}`}><input type="radio" name="voice" checked={voiceType === voice.id} onChange={() => setVoiceType(voice.id)} /><span><strong>{voice.name}</strong><small>{voice.detail}</small></span></label>
                <Button type="button" variant="outline" className="preview-button" disabled={previewing !== null} onClick={() => void previewVoice(voice.id)}><Volume2 size={16} />{previewing === voice.id ? '加载中…' : '试听'}</Button>
              </div>)}
            </div></fieldset>
          </div>
          <div className="composer-bottom"><span className="selected-count">{selected.length ? <>已选择 <strong>{selected.length}</strong> 个班级</> : '请选择接收班级'}</span><div className="send-actions">
            <Button className="action primary" onClick={() => void send()} disabled={!ready || !!busy || !validDraft(body, selected)}><Send size={17} />{busy === 'send' ? '发送中…' : '发送广播'}</Button>
          </div></div>
        </section>
        {latest && <section className="section delivery-panel" aria-live="polite"><div className="section-heading"><h2>本次广播 · {latest.teacher_name}</h2><span className="muted">{time(latest.created_at)}</span></div><p className="broadcast-body">{latest.body}</p><p className="broadcast-meta">{latest.repeat_count ? `播放 ${latest.repeat_count} 遍` : '仅文字'} · {VOICES.find(v => v.id === latest.voice_type)?.name} · {latest.auto_close ? '自动关闭' : '手动关闭'}</p>{receipts(latest)}</section>}
        {!latest && history.length > 0 && <button className="recent-link" onClick={() => { setTab('history'); setExpanded(history[0].id); }}><span><span className="muted">最近广播 · {time(history[0].created_at)}</span><span className="recent-body">{history[0].body}</span></span><ArrowUpRight size={20} /></button>}
      </>}
      {tab === 'history' && <section className="history-section"><div className="section-heading"><h1>广播历史</h1><span className="muted">按发送时间排列</span></div>
        {!history.length && <div className="empty-state"><Clock3 size={32} /><h2>{configured ? '还没有广播记录' : '连接后查看广播历史'}</h2><p className="muted">发过的内容和教室回执会保存在这里。</p></div>}
        {history.map(item => <article key={item.id} className="history-card"><button className="history-summary" aria-expanded={expanded === item.id} onClick={() => setExpanded(expanded === item.id ? null : item.id)}><span className="history-meta"><span><strong>{item.teacher_name}</strong><time>{time(item.created_at)}</time></span><span>{item.deliveries.length} 个班级</span></span><p className="broadcast-body">{item.body}</p><span className="broadcast-meta">{EMOTIONS.find(e => e.id === item.emotion)?.emoji || '无 emoji'} · {item.repeat_count ? `播放 ${item.repeat_count} 遍` : '仅文字'} · {VOICES.find(v => v.id === item.voice_type)?.name} · {item.auto_close ? '自动关闭' : '手动关闭'}</span><span className="history-footer"><span>{item.repeat_count === 0 ? `${item.deliveries.filter(d => d.finished_at).length} / ${item.deliveries.length} 已完成` : `${item.deliveries.filter(d => d.played_at).length} / ${item.deliveries.length} 已播放`}</span><span>送达详情<ChevronRight size={17} className={expanded === item.id ? 'rotated' : ''} /></span></span></button>
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
