import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { constantTimeEqual } from '../_shared/crypto.ts';

function text(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

Deno.serve(async (req) => {
  const routerSecret = Deno.env.get('ROUTER_SHARED_SECRET') ?? '';
  const providedSecret = req.headers.get('x-router-secret') ?? '';
  if (!routerSecret || !constantTimeEqual(providedSecret, routerSecret)) {
    return text('DENY:unauthorized', 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    return text('DENY:server_misconfigured', 500);
  }

  const url = new URL(req.url);
  const action = (url.searchParams.get('action') ?? '').trim();

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (action === 'revoked') {
    const { data, error } = await db.rpc('get_revoked_sessions');
    if (error) return text('ERR:db_error', 500);
    const rows = Array.isArray(data) ? data : [];
    const lines = rows
      .filter((r) => r?.session_id && r?.mac_address && r?.ip_address)
      .map((r) => `${r.session_id}|${r.mac_address}|${r.ip_address}`);
    return text(lines.join('\n'), 200);
  }

  if (action === 'ack') {
    const parts = (url.searchParams.get('ids') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (parts.length === 0 || parts.some((s) => !uuidRe.test(s))) {
      return text('ERR:invalid_ids', 400);
    }
    const { data, error } = await db.rpc('ack_revoked_sessions', { p_session_ids: parts });
    if (error) return text('ERR:db_error', 500);
    return text(`ACK:${Number(data ?? 0)}`, 200);
  }

  const mac = (url.searchParams.get('mac') ?? '').trim().toUpperCase();
  const ip = (url.searchParams.get('ip') ?? '').trim();

  if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)) {
    return text('DENY:invalid_mac', 400);
  }

  const { data, error } = await db.rpc('verify_mac_authorization', {
    p_mac: mac,
    p_ip: ip || null,
  });

  if (error) {
    return text('DENY:db_error', 500);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.allowed || !row.remaining_seconds || row.remaining_seconds <= 0) {
    return text('DENY:not_authorized', 403);
  }

  return text(`ALLOW:${row.remaining_seconds}`, 200);
});
