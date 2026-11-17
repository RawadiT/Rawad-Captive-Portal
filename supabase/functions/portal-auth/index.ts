import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyPassword } from '../_shared/crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: 'Server configuration error' }, 500);
  }

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const body = await req.json();
    const action = String(body?.action || '');
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
      if (error) return json({ ok: false, error: error.message }, 400);
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.allowed || row.remaining_seconds <= 0) {
        return json({
          ok: false,
          error: 'تم استهلاك الحصة المجانية اليومية (30 دقيقة) لهذا الجهاز. تتجدد عند منتصف الليل بتوقيت بغداد.',
        }, 403);
      }
      return json({
        ok: true,
        session_type: 'free',
        remaining_seconds: row.remaining_seconds,
        expires_at: row.expires_at,
        is_new: row.is_new,
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
        .select('id, username, password_hash, is_disabled')
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
      if (error) return json({ ok: false, error: error.message }, 400);
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.allowed || row.remaining_seconds <= 0) {
        return json({ ok: false, error: 'انتهت صلاحية هذا الحساب أو تم تعطيله' }, 403);
      }
      return json({
        ok: true,
        session_type: 'user',
        remaining_seconds: row.remaining_seconds,
        started_at: row.started_at,
        expires_at: row.expires_at,
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
