// Local protocol fixture only. It does not connect to a Supabase project.
const device = '20000000-0000-4000-8000-000000000001';
let heartbeats = 0;
Deno.serve({ hostname: '127.0.0.1', port: 54329 }, async request => {
  const url = new URL(request.url);
  if (url.pathname === '/realtime/v1/websocket') {
    const { socket, response } = Deno.upgradeWebSocket(request);
    socket.onmessage = event => {
      const input = JSON.parse(event.data);
      const reply = (event: string, payload: unknown) => socket.send(JSON.stringify({ topic: input.topic, event, ref: input.ref, join_ref: input.join_ref, payload }));
      if (input.event === 'phx_join') {
        if (!input.join_ref || input.payload.config.postgres_changes[0].filter !== `device_id=eq.${device}`) {
          reply('phx_reply', { status: 'error', response: {} }); return;
        }
        reply('phx_reply', { status: 'ok', response: { postgres_changes: [{ id: 1 }] } });
        reply('system', { extension: 'postgres_changes', status: 'ok', message: 'Subscribed to PostgreSQL' });
        reply('postgres_changes', { ids: [1], data: { type: 'INSERT', record: {} } });
      }
      if (input.event === 'heartbeat') reply('phx_reply', { status: 'ok', response: {} });
    };
    return response;
  }
  if (url.pathname.endsWith('/device_heartbeat')) {
    const input = await request.json();
    if (input.p_connected) heartbeats++;
    return Response.json({ active: true, classroom_id: '8-1', server_now: new Date().toISOString() });
  }
  if (url.pathname === '/auth/v1/token') {
    const input = await request.json();
    if (input.refresh_token === 'invalid') return Response.json({ error_description: 'Invalid Refresh Token: Refresh Token Not Found' }, { status: 400 });
    if (url.searchParams.get('grant_type') === 'password') {
      if (input.password !== 'device-password') return Response.json({ error_description: 'Invalid login credentials' }, { status: 400 });
      return Response.json({ access_token: 'device-token', refresh_token: 'device-refresh', expires_in: 3600, user: { id: device, app_metadata: { role: 'device' } } });
    }
    return Response.json({ access_token: 'rotated-token', refresh_token: 'rotated-refresh', expires_in: 3600, user: { id: device, app_metadata: { role: 'device' } } });
  }
  if (url.pathname === '/stats') return Response.json({ heartbeats });
  return new Response('Not found', { status: 404 });
});
