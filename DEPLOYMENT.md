# DEPLOYMENT.md — دليل النشر (MikroTik HotSpot + Supabase)

1. **إعداد Supabase:**
   - نفّذ [supabase/schema.sql](supabase/schema.sql) في مشروع Supabase.
   - انشر Edge Functions الثلاث: `portal-auth`, `verify-mac`, `admin-api`.
   - اضبط الأسرار على Supabase (`ROUTER_SHARED_SECRET`, `ADMIN_TOKEN_SECRET`).
   - أضف حساب المدير الأول في `public.admins` باستخدام `hashPassword` (PBKDF2).

2. **إعداد ملفات الواجهة والإدارة:**
   - حدّث `supabaseUrl` و`supabaseAnonKey` في [hotspot/login.html](hotspot/login.html) و[admin/index.html](admin/index.html) (لا تضع `service_role` أو `ROUTER_SHARED_SECRET` أبداً في المتصفح).
   - ارفع محتويات `hotspot/` إلى مجلد `hotspot` داخل MikroTik.
   - افتح [admin/index.html](admin/index.html) محلياً أو استضف مجلد `admin/` كملفات ثابتة (بدون Vercel/VPS).

3. **إعداد MikroTik (`ether10` فقط):**
   - عدّل `:local supabaseHost` و`:local routerSecret` في [routeros/deploy.rsc](routeros/deploy.rsc).
   - نفّذ `deploy.rsc`، ثم تحقق عبر [routeros/verify.rsc](routeros/verify.rsc).
   - للتراجع الآمن: نفّذ [routeros/rollback.rsc](routeros/rollback.rsc).
