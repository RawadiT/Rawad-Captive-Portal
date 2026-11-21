import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { hashPassword, signAdminToken, verifyAdminToken, verifyPassword } from '../_shared/crypto.ts';

let cachedDb: SupabaseClient | null = null;
let cachedDbKey = '';

function getDb(supabaseUrl: string, serviceKey: string): SupabaseClient {
  const cacheKey = `${supabaseUrl}:${serviceKey}`;
  if (!cachedDb || cachedDbKey !== cacheKey) {
    cachedDb = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    cachedDbKey = cacheKey;
  }
  return cachedDb;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function toPublicUser(u: {
  id: string; username: string; duration_minutes: number | null; is_unlimited?: boolean;
  started_at: string | null; expires_at: string | null; is_disabled: boolean; created_at: string;
}) {
  const isUnlimited = Boolean(u.is_unlimited);
  const nowMs = Date.now();
  let remainingSeconds: number | null = isUnlimited ? null : (u.duration_minutes ?? 0) * 60;
  let isExpired = false;
  if (!isUnlimited && u.expires_at) {
    remainingSeconds = Math.max(0, Math.floor((Date.parse(u.expires_at) - nowMs) / 1000));
    isExpired = remainingSeconds === 0;
  }
  return {
    id: u.id, username: u.username, duration_minutes: isUnlimited ? (u.duration_minutes ?? null) : u.duration_minutes,
    is_unlimited: isUnlimited, started_at: u.started_at, expires_at: isUnlimited ? null : u.expires_at,
    remaining_seconds: remainingSeconds, is_disabled: u.is_disabled, is_expired: isExpired, created_at: u.created_at,
  };
}

function validateHttpUrl(raw: unknown): string | null {
  const str = String(raw ?? '').trim();
  if (!str) return '';
  try {
    const parsed = new URL(str);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 6 && value.length <= 256;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const tokenSecret = Deno.env.get('ADMIN_TOKEN_SECRET') ?? '';
  if (!supabaseUrl || !serviceKey || tokenSecret.length < 32) {
    return json({ error: 'Server configuration error' }, 500);
  }

  const db = getDb(supabaseUrl, serviceKey);
  const url = new URL(req.url);
  const subPath = url.pathname.replace(/^.*\/admin-api/, '') || '/';

  if (req.method === 'POST' && subPath === '/login') {
    const body = await req.json().catch(() => ({}));
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '');
    const { data: admin, error: adminError } = await db.from('admins')
      .select('id, username, password_hash, is_super_admin, role')
      .eq('username', username).maybeSingle();
    if (adminError) {
      console.error('admin-api login query error:', adminError.code ?? 'unknown', adminError.message);
      return json({ error: 'تعذر التحقق من بيانات الإدارة في الخادم.' }, 500);
    }
    if (!admin || !(await verifyPassword(password, admin.password_hash))) {
      return json({ error: 'بيانات الدخول غير صحيحة' }, 401);
    }
    const token = await signAdminToken({
      sub: admin.id, username: admin.username, is_super_admin: admin.is_super_admin === true,
    }, tokenSecret);
    return json({ token, admin: {
      id: admin.id, username: admin.username, is_super_admin: admin.is_super_admin === true,
      role: admin.role || (admin.is_super_admin ? 'site_owner' : 'subordinate'),
    } });
  }

  const auth = req.headers.get('authorization') ?? '';
  const rawToken = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const payload = rawToken ? await verifyAdminToken(rawToken, tokenSecret) : null;
  if (!payload) return json({ error: 'غير مصرح بالوصول' }, 401);

  // Re-read the administrator on every request. Role changes and account removal
  // take effect immediately; token claims alone are never trusted for privileges.
  const { data: actor, error: actorError } = await db.from('admins')
    .select('id, username, password_hash, is_super_admin, role')
    .eq('id', payload.sub).maybeSingle();
  if (actorError) {
    console.error('admin-api actor query error:', actorError.code ?? 'unknown', actorError.message);
    return json({ error: 'تعذر التحقق من صلاحيات المدير في الخادم.' }, 500);
  }
  if (!actor) return json({ error: 'حساب الإدارة غير موجود أو غير مفعل' }, 401);
  const isRoot = actor.is_super_admin === true || actor.role === 'site_owner';
  const role = isRoot ? 'site_owner' : (actor.role === 'general' ? 'general' : 'subordinate');
  const canManageOperations = role === 'site_owner' || role === 'general';

  if (req.method === 'GET' && subPath === '/me') {
    return json({ admin: { id: actor.id, username: actor.username, is_super_admin: isRoot, role } });
  }

  if (req.method === 'POST' && subPath === '/change-password') {
    const body = await req.json().catch(() => ({}));
    const currentPassword = String(body?.current_password || '');
    const newPassword = body?.new_password;
    if (!currentPassword || !validPassword(newPassword)) {
      return json({ error: 'أدخل كلمة المرور الحالية وكلمة مرور جديدة لا تقل عن 6 أحرف' }, 400);
    }
    if (!(await verifyPassword(currentPassword, actor.password_hash))) {
      return json({ error: 'كلمة المرور الحالية غير صحيحة' }, 400);
    }
    const { error } = await db.from('admins')
      .update({ password_hash: await hashPassword(newPassword) }).eq('id', actor.id);
    if (error) return json({ error: error.message }, 400);
    return json({ success: true });
  }

  // Super-admin-only administrator management.
  if (subPath === '/admins') {
    if (!isRoot) return json({ error: 'هذه العملية متاحة للمدير الأساسي فقط' }, 403);
    if (req.method === 'GET') {
      const { data, error } = await db.from('admins')
        .select('id, username, is_super_admin, role, created_at')
        .order('created_at', { ascending: true });
      if (error) return json({ error: error.message }, 500);
      return json({ admins: data ?? [] });
    }
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const username = String(body?.username || '').trim();
      const password = body?.password;
      const requestedRole = body?.role;
      if (!username || username.length > 64 || !validPassword(password) || !['general', 'subordinate'].includes(requestedRole)) {
        return json({ error: 'اسم المستخدم مطلوب وكلمة المرور 6 أحرف على الأقل' }, 400);
      }
      const { data, error } = await db.from('admins')
        .insert({ username, password_hash: await hashPassword(password), is_super_admin: false, role: requestedRole })
        .select('id, username, is_super_admin, role, created_at').single();
      if (error) return json({ error: error.message }, 409);
      return json({ admin: data }, 201);
    }
  }

  const adminMatch = subPath.match(/^\/admins\/([0-9a-f-]{36})$/i);
  if (adminMatch && (req.method === 'PATCH' || req.method === 'DELETE')) {
    if (!isRoot) return json({ error: 'هذه العملية متاحة للمدير الأساسي فقط' }, 403);
    const targetId = adminMatch[1];
    if (targetId === actor.id || targetId === '39c0a9e8-028d-4c04-a0e3-e46e21cef7d9') {
      return json({ error: 'لا يمكن حذف حساب المدير الأساسي أو تعديله من هذه الواجهة؛ استخدم تغيير كلمة المرور أو بيانات الحساب الخاصة به' }, 403);
    }
    const { data: target, error: targetError } = await db.from('admins')
      .select('id, is_super_admin, role').eq('id', targetId).maybeSingle();
    if (targetError) {
      console.error('admin-api target query error:', targetError.code ?? 'unknown', targetError.message);
      return json({ error: 'تعذر التحقق من حساب المدير المستهدف.' }, 500);
    }
    if (!target) return json({ error: 'حساب المدير غير موجود' }, 404);
    if (target.is_super_admin || target.role === 'site_owner') return json({ error: 'لا يمكن حذف أو تعديل حساب مدير الموقع' }, 403);
    if (req.method === 'DELETE') {
      const { error } = await db.from('admins').delete().eq('id', targetId);
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }
    const body = await req.json().catch(() => ({}));
    const updates: Record<string, unknown> = {};
    if (typeof body?.username === 'string' && body.username.trim()) updates.username = body.username.trim();
    if (body?.role !== undefined) {
      if (!['general', 'subordinate'].includes(body.role)) return json({ error: 'نوع صلاحية المدير غير صالح' }, 400);
      updates.role = body.role;
    }
    if (body?.password !== undefined && body.password !== '') {
      if (!validPassword(body.password)) return json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' }, 400);
      updates.password_hash = await hashPassword(body.password);
    }
    if (!Object.keys(updates).length) return json({ error: 'لا توجد بيانات لتعديلها' }, 400);
    const { data, error } = await db.from('admins').update(updates)
      .eq('id', targetId).select('id, username, is_super_admin, role, created_at').single();
    if (error) return json({ error: error.message }, 400);
    return json({ admin: data });
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
    const isUnlimited = Boolean(body?.is_unlimited);
    const hasDuration = body?.duration_minutes !== undefined && body?.duration_minutes !== null && body?.duration_minutes !== '';
    const durationMinutes = hasDuration ? Number(body?.duration_minutes) : null;
    if (!username || !validPassword(password)) {
      return json({ error: 'اسم المستخدم وكلمة المرور (6 أحرف على الأقل) مطلوبة' }, 400);
    }
    if (!isUnlimited && (durationMinutes === null || !Number.isFinite(durationMinutes) || durationMinutes < 1)) {
      return json({ error: 'مدة الصلاحية بالدقائق مطلوبة للحساب المحدود' }, 400);
    }
    if (isUnlimited && durationMinutes !== null && (!Number.isFinite(durationMinutes) || durationMinutes < 1)) {
      return json({ error: 'مدة غير صالحة' }, 400);
    }
    const { data, error } = await db.from('users')
      .insert({
        username,
        password_hash: await hashPassword(password),
        duration_minutes: isUnlimited ? (durationMinutes !== null ? Math.floor(durationMinutes) : null) : Math.floor(durationMinutes!),
        is_unlimited: isUnlimited,
      })
      .select('*').single();
    if (error) return json({ error: error.message }, 409);
    return json({ user: toPublicUser(data) }, 201);
  }

  const userMatch = subPath.match(/^\/users\/([0-9a-f-]{36})$/i);
  if (userMatch && req.method === 'DELETE') {
    if (!canManageOperations) return json({ error: 'حذف الحسابات متاح للمدير العام ومدير الموقع فقط' }, 403);
    const userId = userMatch[1];
    const { error: disconnectError } = await db.from('sessions')
      .update({ status: 'disconnected', revoked_at: new Date().toISOString() })
      .eq('user_id', userId).in('status', ['authorized', 'active']);
    if (disconnectError) return json({ error: 'تعذر فصل الجلسات النشطة؛ لم يتم حذف الحساب' }, 500);
    const { error } = await db.from('users').delete().eq('id', userId);
    if (error) return json({ error: error.message }, 400);
    return json({ success: true });
  }

  const editMatch = subPath.match(/^\/users\/([0-9a-f-]{36})$/i);
  if (req.method === 'PATCH' && editMatch) {
    if (!canManageOperations) return json({ error: 'تعديل بيانات الحسابات متاح للمدير العام ومدير الموقع فقط' }, 403);
    const userId = editMatch[1];
    const { data: existing, error: fetchErr } = await db.from('users').select('*').eq('id', userId).maybeSingle();
    if (fetchErr) return json({ error: 'تعذر قراءة بيانات الحساب' }, 500);
    if (!existing) return json({ error: 'الحساب غير موجود' }, 404);

    const body = await req.json().catch(() => ({}));
    const updates: Record<string, unknown> = {};
    if (typeof body?.username === 'string' && body.username.trim()) updates.username = body.username.trim();
    if (typeof body?.password === 'string' && body.password.length > 0) {
      if (!validPassword(body.password)) return json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' }, 400);
      updates.password_hash = await hashPassword(body.password);
    }

    const nextUnlimited = body?.is_unlimited !== undefined ? Boolean(body.is_unlimited) : Boolean(existing.is_unlimited);
    const hasDurationInput = body?.duration_minutes !== undefined && body?.duration_minutes !== null && body?.duration_minutes !== '';
    let parsedDuration: number | null = existing.duration_minutes;
    if (hasDurationInput) {
      const dm = Number(body.duration_minutes);
      if (!Number.isFinite(dm) || dm < 1) return json({ error: 'مدة غير صالحة' }, 400);
      parsedDuration = Math.floor(dm);
    }

    if (body?.is_unlimited !== undefined) {
      updates.is_unlimited = nextUnlimited;
    }

    if (nextUnlimited) {
      updates.duration_minutes = hasDurationInput ? parsedDuration : null;
      updates.expires_at = null;
    } else {
      if (!parsedDuration || parsedDuration < 1) {
        return json({ error: 'مدة الصلاحية بالدقائق مطلوبة عند إلغاء وضع الحساب المفتوح' }, 400);
      }
      if (hasDurationInput || body?.is_unlimited !== undefined) {
        updates.duration_minutes = parsedDuration;
      }
      if (existing.started_at && (existing.is_unlimited || existing.expires_at === null)) {
        updates.expires_at = new Date(Date.now() + parsedDuration * 60_000).toISOString();
      }
    }

    if (!Object.keys(updates).length) return json({ error: 'لا توجد حقول للتعديل' }, 400);
    const { data, error } = await db.from('users').update(updates).eq('id', userId).select('*').maybeSingle();
    if (error) return json({ error: error.message }, 400);
    if (!data) return json({ error: 'الحساب غير موجود' }, 404);

    if (updates.expires_at !== undefined) {
      await db.from('sessions')
        .update({ expires_at: updates.expires_at })
        .eq('user_id', userId).in('status', ['authorized', 'active']);
    }

    return json({ user: toPublicUser(data) });
  }

  const statusMatch = subPath.match(/^\/users\/([0-9a-f-]{36})\/status$/i);
  if (req.method === 'PATCH' && statusMatch) {
    if (!canManageOperations) return json({ error: 'تغيير حالة الحسابات متاح للمدير العام ومدير الموقع فقط' }, 403);
    const userId = statusMatch[1];
    const body = await req.json().catch(() => ({}));
    const isDisabled = Boolean(body?.is_disabled);
    const { data, error } = await db.from('users').update({ is_disabled: isDisabled })
      .eq('id', userId).select('*').maybeSingle();
    if (error) return json({ error: error.message }, 400);
    if (!data) return json({ error: 'الحساب غير موجود' }, 404);
    if (isDisabled) {
      const { error: sessErr } = await db.from('sessions')
        .update({ status: 'disconnected', revoked_at: new Date().toISOString() })
        .eq('user_id', userId).in('status', ['authorized', 'active']);
      if (sessErr) return json({ error: 'تم تعطيل الحساب لكن تعذر تحديث جلساته النشطة؛ سيتولى المجدول سحبها.' }, 500);
    }
    return json({ user: toPublicUser(data) });
  }

  if (req.method === 'GET' && subPath === '/free-quotas') {
    if (!canManageOperations) return json({ error: 'عرض الحصص متاح للمدير العام ومدير الموقع فقط' }, 403);
    const { data, error } = await db.from('free_quotas').select('*')
      .order('created_at', { ascending: false }).limit(200);
    if (error) return json({ error: error.message }, 500);
    return json({ quotas: data ?? [] });
  }

  if (subPath === '/portal-settings') {
    if (req.method === 'GET') {
      const { data, error } = await db.from('portal_settings').select('*').eq('id', 1).maybeSingle();
      if (error) return json({ error: 'تعذر تحميل إعدادات البوابة' }, 500);
      return json({ settings: data });
    }
    if (req.method === 'PUT') {
      if (!canManageOperations) return json({ error: 'تعديل إعدادات البوابة متاح للمدير العام ومدير الموقع فقط' }, 403);
      const body = await req.json().catch(() => ({}));
      const siteTitle = String(body?.site_title ?? '').trim();
      const welcomeTitle = String(body?.welcome_title ?? '').trim();
      const welcomeSubtitle = String(body?.welcome_subtitle ?? '').trim();
      const freeNotice = String(body?.free_notice ?? '').trim();

      if (!siteTitle || siteTitle.length > 80 || !welcomeTitle || welcomeTitle.length > 120) {
        return json({ error: 'عنوان الموقع وعنوان الترحيب مطلوبان ضمن الطول المسموح' }, 400);
      }
      if (welcomeSubtitle.length > 240 || freeNotice.length > 200) {
        return json({ error: 'النصوص التوضيحية تجاوزت الحد الأقصى المسموح' }, 400);
      }

      const channels = ['instagram', 'facebook', 'tiktok', 'whatsapp'] as const;
      const updates: Record<string, unknown> = {
        site_title: siteTitle,
        welcome_title: welcomeTitle,
        welcome_subtitle: welcomeSubtitle,
        free_notice: freeNotice,
        updated_at: new Date().toISOString(),
      };

      for (const ch of channels) {
        const enabled = Boolean(body?.[`${ch}_enabled`]);
        const normalizedUrl = validateHttpUrl(body?.[`${ch}_url`]);
        if (normalizedUrl === null) {
          return json({ error: `رابط ${ch} غير صالح؛ يجب أن يبدأ بـ https:// أو http://` }, 400);
        }
        if (enabled && !normalizedUrl) {
          return json({ error: `يرجى إدخال رابط ${ch} قبل تفعيله` }, 400);
        }
        updates[`${ch}_enabled`] = enabled;
        updates[`${ch}_url`] = normalizedUrl;
      }

      const phoneEnabled = Boolean(body?.phone_enabled);
      const phoneNumber = String(body?.phone_number ?? '').trim();
      if (phoneNumber && !/^[0-9+\-\s()]{3,32}$/.test(phoneNumber)) {
        return json({ error: 'رقم الهاتف غير صالح' }, 400);
      }
      if (phoneEnabled && !phoneNumber) {
        return json({ error: 'يرجى إدخال رقم الهاتف قبل تفعيله' }, 400);
      }
      updates.phone_enabled = phoneEnabled;
      updates.phone_number = phoneNumber;

      const { data, error } = await db.from('portal_settings').update(updates).eq('id', 1).select('*').single();
      if (error) return json({ error: 'تعذر حفظ إعدادات البوابة' }, 400);
      return json({ settings: data });
    }
  }

  if (req.method === 'GET' && subPath === '/cleanup/summary') {
    if (!isRoot) return json({ error: 'تنظيف قاعدة البيانات متاح لمدير الموقع فقط' }, 403);
    const { data, error } = await db.rpc('get_cleanup_summary');
    if (error) return json({ error: 'تعذر جلب ملخص التنظيف' }, 500);
    const row = Array.isArray(data) ? data[0] : data;
    return json({ summary: row ?? null });
  }

  if (req.method === 'POST' && subPath === '/cleanup/execute') {
    if (!isRoot) return json({ error: 'تنظيف قاعدة البيانات متاح لمدير الموقع فقط' }, 403);
    const body = await req.json().catch(() => ({}));
    if (body?.confirm !== 'CLEANUP') {
      return json({ error: 'تأكيد التنظيف الصريح مطلوب' }, 400);
    }
    const { data, error } = await db.rpc('cleanup_operational_data');
    if (error) return json({ error: 'تعذر تنفيذ تنظيف البيانات التشغيلية' }, 500);
    const row = Array.isArray(data) ? data[0] : data;
    return json({ result: row ?? null });
  }

  return json({ error: 'Not found' }, 404);
});
