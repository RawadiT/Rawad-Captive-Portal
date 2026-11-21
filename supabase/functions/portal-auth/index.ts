import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { signPortalStatusToken, verifyPassword, verifyPortalStatusToken } from '../_shared/crypto.ts';

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
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;
const PORTAL_SETTINGS_COLUMNS =
  'site_title, welcome_title, welcome_subtitle, free_notice, instagram_url, instagram_enabled, facebook_url, facebook_enabled, tiktok_url, tiktok_enabled, whatsapp_url, whatsapp_enabled, phone_number, phone_enabled, updated_at';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const statusSecret = Deno.env.get('PORTAL_STATUS_SECRET') || Deno.env.get('ADMIN_TOKEN_SECRET') || '';
  if (!supabaseUrl || !serviceKey || !statusSecret) {
    return json({ ok: false, error: 'Server configuration error' }, 500);
  }

  const db = getDb(supabaseUrl, serviceKey);

  if (req.method === 'GET') {
    const { data: settings, error: sErr } = await db
      .from('portal_settings')
      .select(PORTAL_SETTINGS_COLUMNS)
      .eq('id', 1)
      .maybeSingle();
    if (sErr) return json({ ok: false, error: 'تعذر تحميل إعدادات البوابة' }, 500);
    return json({ ok: true, settings: settings ?? null });
  }

  try {
    const body = await req.json();
    const action = String(body?.action || '');

    if (action === 'portal_settings') {
      const { data: settings, error: sErr } = await db
        .from('portal_settings')
        .select(PORTAL_SETTINGS_COLUMNS)
        .eq('id', 1)
        .maybeSingle();
      if (sErr) return json({ ok: false, error: 'تعذر تحميل إعدادات البوابة' }, 500);
      return json({ ok: true, settings: settings ?? null });
    }

    if (action === 'session_status') {
      const statusToken = String(body?.status_token || '').trim();
      const tokenPayload = await verifyPortalStatusToken(statusToken, statusSecret);
      if (!tokenPayload) {
        return json({ ok: false, error: 'رمز حالة الجلسة غير صالح أو منتهي الصلاحية' }, 403);
      }

      const providedMac = String(body?.mac || '').trim().toUpperCase();
      if (providedMac && (!MAC_RE.test(providedMac) || providedMac !== tokenPayload.mac)) {
        return json({ ok: false, error: 'رمز الجلسة لا يطابق عنوان الجهاز' }, 403);
      }

      const { data: sess, error: sessErr } = await db
        .from('sessions')
        .select('id, session_type, user_id, mac_address, expires_at, status')
        .eq('id', tokenPayload.sid)
        .eq('mac_address', tokenPayload.mac)
        .maybeSingle();

      if (sessErr) return json({ ok: false, error: 'تعذر التحقق من حالة الجلسة' }, 500);
      if (!sess || !['authorized', 'active'].includes(sess.status)) {
        return json({ ok: true, active: false, reason: sess?.status || 'ended' });
      }

      if (sess.session_type === 'user') {
        if (!sess.user_id) return json({ ok: true, active: false, reason: 'deleted' });
        const { data: usr, error: usrErr } = await db
          .from('users')
          .select('id, is_disabled, is_unlimited, expires_at')
          .eq('id', sess.user_id)
          .maybeSingle();
        if (usrErr) return json({ ok: false, error: 'تعذر التحقق من حالة الحساب' }, 500);
        if (!usr || usr.is_disabled) {
          return json({ ok: true, active: false, reason: 'disabled' });
        }
        if (usr.is_unlimited) {
          return json({
            ok: true,
            active: true,
            session_type: 'user',
            is_unlimited: true,
            remaining_seconds: null,
            expires_at: null,
          });
        }
        if (!usr.expires_at) return json({ ok: true, active: false, reason: 'expired' });
        const rem = Math.max(0, Math.floor((Date.parse(usr.expires_at) - Date.now()) / 1000));
        if (rem <= 0) return json({ ok: true, active: false, reason: 'expired' });
        return json({
          ok: true,
          active: true,
          session_type: 'user',
          is_unlimited: false,
          remaining_seconds: rem,
          expires_at: usr.expires_at,
        });
      }

      const rem = sess.expires_at ? Math.max(0, Math.floor((Date.parse(sess.expires_at) - Date.now()) / 1000)) : 0;
      if (rem <= 0) return json({ ok: true, active: false, reason: 'expired' });
      return json({
        ok: true,
        active: true,
        session_type: 'free',
        is_unlimited: false,
        remaining_seconds: rem,
        expires_at: sess.expires_at,
      });
    }

    const mac = String(body?.mac || '').trim().toUpperCase();
    const ip = String(body?.ip || '').trim();

    if (!MAC_RE.test(mac) || !ip) {
      return json({ ok: false, error: 'تعذر التحقق من عنوان الجهاز (MAC/IP)' }, 400);
    }

    if (action === 'free') {
      const { data, error } = await db.rpc('request_free_quota', {
        p_mac: mac,
        p_ip: ip,
        p_duration_seconds: 1800,
      });
      if (error) return json({ ok: false, error: 'تعذر معالجة طلب الحصة المجانية' }, 400);
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.allowed || !row?.session_id || row.remaining_seconds <= 0) {
        return json({
          ok: false,
          error: 'تم استهلاك الحصة المجانية اليومية (30 دقيقة) لهذا الجهاز. تتجدد عند منتصف الليل بتوقيت بغداد.',
        }, 403);
      }
      const statusToken = await signPortalStatusToken(
        { sid: row.session_id, mac, typ: 'free' },
        statusSecret,
        Math.max(3600, Number(row.remaining_seconds) + 3600)
      );
      return json({
        ok: true,
        session_type: 'free',
        is_unlimited: false,
        remaining_seconds: row.remaining_seconds,
        expires_at: row.expires_at,
        is_new: row.is_new,
        status_token: statusToken,
      });
    }

    if (action === 'login') {
      const username = String(body?.username || '').trim();
      const password = String(body?.password || '');
      if (!username || !password) {
        return json({ ok: false, error: 'يرجى إدخال اسم المستخدم وكلمة المرور' }, 400);
      }

      const { data: user, error: uErr } = await db
        .from('users')
        .select('id, username, password_hash, is_disabled, is_unlimited')
        .eq('username', username)
        .maybeSingle();

      if (uErr) return json({ ok: false, error: 'خطأ في التحقق من الحساب' }, 500);
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        return json({ ok: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' }, 401);
      }
      if (user.is_disabled) {
        return json({ ok: false, error: 'هذا الحساب معطل حالياً' }, 403);
      }

      const { data, error } = await db.rpc('authorize_user_login', {
        p_user_id: user.id,
        p_mac: mac,
        p_ip: ip,
      });
      if (error) return json({ ok: false, error: 'تعذر إتمام تسجيل الدخول في الخادم' }, 400);
      const row = Array.isArray(data) ? data[0] : data;
      const isUnlimited = Boolean(user.is_unlimited);
      if (!row?.allowed || !row?.session_id || (!isUnlimited && (!row.remaining_seconds || row.remaining_seconds <= 0))) {
        return json({ ok: false, error: 'انتهت صلاحية هذا الحساب أو تم تعطيله' }, 403);
      }
      const ttl = isUnlimited ? 7 * 86400 : Math.max(3600, Number(row.remaining_seconds) + 3600);
      const statusToken = await signPortalStatusToken(
        { sid: row.session_id, mac, typ: 'user' },
        statusSecret,
        ttl
      );
      return json({
        ok: true,
        session_type: 'user',
        is_unlimited: isUnlimited,
        remaining_seconds: isUnlimited ? null : row.remaining_seconds,
        started_at: row.started_at,
        expires_at: isUnlimited ? null : row.expires_at,
        status_token: statusToken,
      });
    }

    if (action === 'logout') {
      await db.rpc('disconnect_mac_session', { p_mac: mac });
      return json({ ok: true });
    }

    return json({ ok: false, error: 'إجراء غير مدعوم' }, 400);
  } catch {
    return json({ ok: false, error: 'طلب غير صالح' }, 400);
  }
});
