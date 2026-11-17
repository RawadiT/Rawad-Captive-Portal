# دليل التشغيل والنشر والنقل على USB — روتانا - شركة رواد التقنيات

## 1. محتويات حزمة USB (`usb-package/`)
تم تجهيز مجلد `usb-package/` ليكون مستقلاً ومخصصاً للنقل على USB إلى كمبيوتر الشركة، ويحتوي فقط على:
- `backend/` (ملفات الإنتاج المبنية `dist/` + `node_modules` الإنتاجية فقط).
- `frontend/` (نسخة Next.js Standalone المبنية مسبقاً بدون `devDependencies` أو `cache`).
- `supabase/schema.sql` (مخطط PostgreSQL والدوال الذرية).
- `routeros/` (`preflight.rsc`, `deploy.rsc`, `verify.rsc`, `rollback.rsc` محصورة بـ `ether10` فقط).
- `hotspot/` (صفحات HotSpot التقليدية الاحتياطية).
- `deployment/` (`docker-compose.yml`, `.env.example`, `nginx/nginx.conf`, سكربتات الشهادات).
- `start-windows.bat` (لتشغيل الخادم والواجهة مباشرة على Windows).

---

## 2. متطلبات التشغيل على كمبيوتر الشركة
- **Node.js v22+** (أو Docker + Docker Compose).
- **اتصال إنترنت/HTTPS** من كمبيوتر الخادم فقط إلى مشروع **Supabase** (عبر المنفذ 443).
- **ملاحظة حول الاعتماديات:** جميع حزم Node.js المطلوبة للتشغيل مضمّنة مسبقاً داخل `usb-package/` ولا تحتاج `npm install` غداً. أما **إنشاء مشروع Supabase** وتطبيق `supabase/schema.sql` فيتطلبان الوصول إلى لوحة Supabase.

---

## 3. خطوات إعداد Supabase PostgreSQL
1. أنشئ مشروعاً في Supabase (أو افتح مشروعك الحالي).
2. افتح **SQL Editor** والصق محتوى `supabase/schema.sql` ونفّذه بالكامل.
3. من **Project Settings -> API**:
   - انسخ `Project URL` (`SUPABASE_URL`).
   - انسخ `service_role` key (`SUPABASE_SERVICE_ROLE_KEY`).
   - **تحذير:** لا تضع `service_role` key في Frontend أو المتصفح إطلاقاً؛ يوضع في `deployment/.env` للخادم الخلفي فقط.

---

## 4. إعداد متغيرات البيئة وتشغيل النظام
1. انسخ `deployment/.env.example` إلى `deployment/.env` وعدّل القيم المطلوبة:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `TOKEN_SECRET` (64 حرفاً عشوائياً)
   - `DEFAULT_ADMIN_PASSWORD` (كلمة مرور قوية)
   - `MIKROTIK_MODE=rest`, `MIKROTIK_HOST=192.168.20.1`, `MIKROTIK_API_PASSWORD`
   - `GUEST_PORTAL_ORIGIN` (النطاق الحقيقي للشركة) و`GUEST_PROXY_BIND_IP`
2. التشغيل المباشر على Windows:
   - شغّل `start-windows.bat` (أو عبر Docker: `cd deployment && docker compose up -d`).
3. التحقق من اتصال Backend وSupabase:
   ```bash
   curl http://127.0.0.1:4000/api/health
   ```
   يجب أن يعيد: `{"ok":true,"database":"supabase-https",...}`.
4. الإيقاف: إغلاق نافذتي التشغيل (أو `docker compose down`).

---

## 5. خطوات MikroTik (منفذ `ether10` فقط)
1. ارفع `routeros/preflight.rsc` ونفّذ `/import preflight.rsc` للتأكد من عدم وجود تعارض على `ether10`.
2. انسخ محتويات `hotspot/` إلى مجلد `hotspot` على MikroTik.
3. عدّل `apiPassword`, `portalDomain`, `backendServerIp` داخل `routeros/deploy.rsc` ثم نفّذ `/import deploy.rsc`.
4. نفّذ `/import verify.rsc` للتحقق، وعند أي مشكلة نفّذ `/import rollback.rsc`.
