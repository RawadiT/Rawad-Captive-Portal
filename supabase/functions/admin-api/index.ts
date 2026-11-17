import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { hashPassword, signAdminToken, verifyAdminToken, verifyPassword } from '../_shared/crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function toPublicUser(u: {
  id: string;
  username: string;
  duration_minutes: number;
  started_at: string | null;
  expires_at: string | null;
  is_disabled: boolean;
  created_at: string;
}) {
  const nowMs = Date.now();
  let remainingSeconds = u.duration_minutes * 60;
  let isExpired = false;
  if (u.expires_at) {
    remainingSeconds = Math.max(0, Math.floor((Date.parse(u.expires_at) - nowMs) / 1000));
    isExpired = remainingSeconds === 0;
  }
  return {
    id: u.id,
    username: u.username,
    duration_minutes: u.duration_minutes,
    started_at: u.started_at,
    expires_at: u.expires_at,
    remaining_seconds: remainingSeconds,
    is_disabled: u.is_disabled,
    is_expired: isExpired,
    created_at: u.created_at,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const tokenSecret = Deno.env.get('ADMIN_TOKEN_SECRET') ?? '';
  if (!supabaseUrl || !serviceKey || tokenSecret.length < 32) {
    return json({ error: 'Server configuration error' }, 500);
  }

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const url = new URL(req.url);
  const subPath = url.pathname.replace(/^.*\/admin-api/, '') || '/';

  if (req.method === 'POST' && subPath === '/login') {
    const body = await req.json().catch(() => ({}));
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '');
    const { data: admin } = await db
      .from('admins')
      .select('id, username, password_hash')
      .eq('username', username)
      .maybeSingle();
    if (!admin || !(await verifyPassword(password, admin.password_hash))) {
      return json({ error: 'بيانات دخول المدير غير صحيحة' }, 401);
    }
    const token = await signAdminToken({ sub: admin.id, username: admin.username }, tokenSecret);
    return json({ token, admin: { id: admin.id, username: admin.username } });
  }

  const auth = req.headers.get('authorization') ?? '';
  const rawToken = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const payload = rawToken ? await verifyAdminToken(rawToken, tokenSecret) : null;
  if (!payload) {
    return json({ error: 'غير مصرح بالوصول' }, 401);
  }

  if (req.method === 'GET' && subPath === '/me') {
    return json({ admin: { id: payload.sub, username: payload.username } });
  }

  if (req.method === 'GET' && subPath === '/users') {
    const { data, error } = await db.from('users').select('*').order('created_at', { ascending: false });
    if (error) return json({ error: error.message }, 500);
    return json({ users: (data ?? []).map(toPublicUser) });
  }

  if (req.method === 'POST' && subPath === '/users') {
    const body = await req.json().catch(() => ({}));
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '');
    const durationMinutes = Number(body?.duration_minutes);
    if (!username || !password || !Number.isFinite(durationMinutes) || durationMinutes < 1) {
      return json({ error: 'اسم المستخدم وكلمة المرور ومدة الصلاحية مطلوبة' }, 400);
    }
    const passwordHash = await hashPassword(password);
    const { data, error } = await db
      .from('users')
      .insert({ username, password_hash: passwordHash, duration_minutes: Math.floor(durationMinutes) })
      .select('*')
      .single();
    if (error) return json({ error: error.message }, 409);
    return json({ user: toPublicUser(data) }, 201);
  }

  const editMatch = subPath.match(/^\/users\/([0-9a-f-]{36})$/i);
  if (req.method === 'PATCH' && editMatch) {
    const userId = editMatch[1];
    const body = await req.json().catch(() => ({}));
    const updates: Record<string, unknown> = {};
    if (typeof body?.username === 'string' && body.username.trim()) {
      updates.username = body.username.trim();
    }
    if (typeof body?.password === 'string' && body.password.length > 0) {
      updates.password_hash = await hashPassword(body.password);
    }
    if (body?.duration_minutes !== undefined) {
      const dm = Number(body.duration_minutes);
      if (!Number.isFinite(dm) || dm < 1) return json({ error: 'مدة غير صالحة' }, 400);
      updates.duration_minutes = Math.floor(dm);
    }
    if (Object.keys(updates).length === 0) return json({ error: 'لا توجد حقول للتعديل' }, 400);

    const { data, error } = await db.from('users').update(updates).eq('id', userId).select('*').maybeSingle();
    if (error) return json({ error: error.message }, 400);
    if (!data) return json({ error: 'الحساب غير موجود' }, 404);
    return json({ user: toPublicUser(data) });
  }

  const statusMatch = subPath.match(/^\/users\/([0-9a-f-]{36})\/status$/i);
  if (req.method === 'PATCH' && statusMatch) {
    const userId = statusMatch[1];
    const body = await req.json().catch(() => ({}));
    const isDisabled = Boolean(body?.is_disabled);
    const { data, error } = await db
      .from('users')
      .update({ is_disabled: isDisabled })
      .eq('id', userId)
      .select('*')
      .maybeSingle();
    if (error) return json({ error: error.message }, 400);
    if (!data) return json({ error: 'الحساب غير موجود' }, 404);
    if (isDisabled) {
      await db.from('sessions').update({ status: 'disconnected' }).eq('user_id', userId).in('status', ['authorized', 'active']);
    }
    return json({ user: toPublicUser(data) });
  }

  if (req.method === 'GET' && subPath === '/free-quotas') {
    const { data, error } = await db.from('free_quotas').select('*').order('created_at', { ascending: false }).limit(200);
    if (error) return json({ error: error.message }, 500);
    return json({ quotas: data ?? [] });
  }

  return json({ error: 'Not found' }, 404);
});
