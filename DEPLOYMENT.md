# DEPLOYMENT.md — دليل النشر (MikroTik HotSpot + Supabase)

1. **إعداد Supabase:**
   - نفّذ [supabase/schema.sql](supabase/schema.sql) في مشروع Supabase (آمن لإعادة التطبيق دون حذف البيانات).
   - انشر Edge Functions الثلاث: `portal-auth`, `verify-mac`, `admin-api`.
   - اضبط الأسرار على Supabase (`ROUTER_SHARED_SECRET`, `ADMIN_TOKEN_SECRET`).
   - أضف حساب المدير الأول في `public.admins` بتوليد تجزئة `pbkdf2:<salt_hex>:<hash_hex>` (عبر دالة `hashPassword` في `_shared/crypto.ts`) وإدراجها في `public.admins`.

2. **إعداد ملفات الواجهة والإدارة:**
   - حدّث `supabaseUrl` و`supabaseAnonKey` في [hotspot/login.html](hotspot/login.html) و[admin/index.html](admin/index.html) (لا تضع `service_role` أو `ROUTER_SHARED_SECRET` أبداً في المتصفح).
   - ارفع محتويات `hotspot/` إلى مجلد `hotspot` داخل MikroTik.
   - افتح [admin/index.html](admin/index.html) محلياً أو استضف مجلد `admin/` كملفات ثابتة (بدون Vercel/VPS).

3. **إعداد MikroTik (`ether10` فقط):**
   - عدّل `:local supabaseHost` و`:local routerSecret` في [routeros/deploy.rsc](routeros/deploy.rsc).
   - نفّذ `deploy.rsc`، ثم تحقق عبر [routeros/verify.rsc](routeros/verify.rsc).
   - للتراجع الآمن: نفّذ [routeros/rollback.rsc](routeros/rollback.rsc).

4. **ملاحظات أمنية وتشغيلية مهمة:**
   - **تعطيل المستخدم المتصل:** لأن الراوتر خلف NAT ولا يفتح منافذ إدارة، يقوم مجدول `rawad-sync-revocations` بسحب الجلسات المعطلة/المنتهية من `verify-mac?action=revoked` كل 30 ثانية (حد أقصى 30 ثانية لقطع جلسة مستخدم عُطّل أثناء اتصاله).
   - **تزوير MAC قبل البوابة:** `portal-auth` يستقبل `$(mac)` من المتصفح، لكن منح الإنترنت الفعلي يتم فقط بعد تحقق `on-login` في MikroTik عبر `$"mac-address"` الحقيقي أمام `verify-mac` باستخدام `ROUTER_SHARED_SECRET`.
