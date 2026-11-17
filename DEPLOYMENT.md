# دليل التشغيل والنشر والنقل على USB — روتانا - شركة رواد التقنيات

## 1. البنية المعتمدة
- **قاعدة البيانات:** `Supabase PostgreSQL` (عبر HTTPS من Backend فقط باستخدام `SUPABASE_SERVICE_ROLE_KEY`). لا توجد أي قاعدة بيانات محلية أو SQLite.
- **الحصة المجانية:** 30 دقيقة مرة واحدة فقط لكل `MAC Address` بنظام `Wall-Clock` UTC (لا يوجد تجديد يومي).
- **الحسابات المدفوعة/المخصصة:** تبدأ مدتها عند أول تسجيل دخول ناجح بنظام `Wall-Clock` UTC ولا ترتبط بـ `MAC`.
- **فرض انتهاء الصلاحية:** يفرضه MikroTik فعلياً عبر `session-timeout` في Profile مخصص لكل جلسة (`comment="rawad-guest-portal-managed"`).
- **تدفق المعاملات والاسترداد ثلاثي المراحل (3-Step Transaction & Failure-Recovery):**
  1. يستدعي Backend دالة PostgreSQL (`begin_free_provisioning` أو `begin_user_provisioning`) المحمية بـ `pg_advisory_xact_lock` وفهارس الجلسة الفريدة لحجز حالة `'provisioning'` (مع `lease_expires_at` مدته دقيقتان) **دون** استهلاك `free_quotas` أو بدء `started_at` للحساب بعد.
  2. ينفّذ Backend تفعيل الجلسة على MikroTik أولاً؛ فإذا فشل MikroTik يستدعي `abort_provisioning` لتحرير الحجز دون استهلاك الحصة المجانية أو بدء مدة الحساب.
  3. بعد نجاح MikroTik، يستدعي Backend دالة الاعتماد النهائي (`finalize_free_session` أو `finalize_user_session`) التي تتحقق من صلاحية الحجز وتثبّت الجلسة كـ `'active'`. وإذا فشل الاعتماد، ينفّذ Backend إلغاءً صارماً على MikroTik، وإذا تعذر الإلغاء أيضاً يُبقي الجلسة في حالة `'revocation_pending'` (دون تحريرها أو تجاهل الخطأ) ليُعيد `SessionMonitor` محاولة إلغائها تلقائياً حتى ينجح الإلغاء على الراوتر.

---

## 2. محتويات حزمة USB (`usb-package/`)
تُبنى الحزمة عبر `.\deployment\build-usb-package.ps1` وتحتوي فقط على ملفات التشغيل الإنتاجية (دون أسرار أو اختبارات):
- `backend/` (`dist/` + `node_modules` الإنتاجية فقط)
- `frontend/` (Next.js standalone)
- `supabase/schema.sql`
- `routeros/` (`preflight.rsc`, `deploy.rsc`, `verify.rsc`, `rollback.rsc`)
- `hotspot/`
- `deployment/` (`docker-compose.yml`, `.env.example`, `nginx/nginx.conf`, سكربتات الشهادات)
- `start-windows.bat` و`DEPLOYMENT.md`

---

## 3. إعداد Supabase PostgreSQL
1. افتح **SQL Editor** في مشروع Supabase ونفّذ [supabase/schema.sql](supabase/schema.sql) بالكامل.
2. من **Project Settings -> API** انسخ `Project URL` (`SUPABASE_URL`) و`service_role` key (`SUPABASE_SERVICE_ROLE_KEY`).
3. ضع المفاتيح في `deployment/.env` فقط (ممنوع وضع `service_role` في `frontend/` أو المتصفح).

---

## 4. التشغيل والتحقق (Windows USB أو Docker)
1. انسخ `deployment/.env.example` إلى `deployment/.env` واضبط القيم (بما فيها `GUEST_PROXY_BIND_IP` و`GUEST_PORTAL_ORIGIN` و`MIKROTIK_API_PASSWORD`).
2. **التشغيل المباشر على Windows (حزمة USB):**
   - شغّل `start-windows.bat` (يحمّل `deployment/.env` عبر `--env-file` ويربط `/api/*` عبر `API_BACKEND_URL=http://127.0.0.1:4000`).
3. **التشغيل عبر Docker Compose (مع Nginx TLS):**
   ```bash
   cd deployment
   docker compose up -d --build
   docker compose ps   # تحقق من حالة (healthy) لـ backend وfrontend
   ```
4. **التحقق من صحة Backend وSupabase (مربوط بـ `127.0.0.1:4000` محلياً فقط):**
   ```bash
   curl http://127.0.0.1:4000/api/health
   ```
   الاستجابة المتوقعة: `{"ok":true,"database":"supabase-https",...}`. (ملاحظة: المنفذ `4000` مقيد بـ `127.0.0.1` فقط في Docker ولا يُنشر خارجياً).

---

## 5. النشر على MikroTik (منفذ `ether10` فقط)
1. نفّذ `/import preflight.rsc` وتأكد من عدم وجود تعارض Bridge أو IP على `ether10`.
2. انسخ محتويات `hotspot/` إلى مجلد `hotspot` على MikroTik.
3. حدّث `apiPassword` و`portalDomain` و`backendServerIp` داخل `routeros/deploy.rsc` ثم نفّذ `/import deploy.rsc`.
4. نفّذ `/import verify.rsc`، وعند الحاجة للتراجع الآمن نفّذ `/import rollback.rsc`.
