# TASKS.md — خطة التنفيذ النهائية (المواصفات المرجعية النهائية)

- [x] **F1** قياس حجم المشروع قبل التنظيف (`930.80 MB`).
- [x] **F2** إنشاء مخطط `supabase/schema.sql` (PostgreSQL + دوال ذرية `claim_free_quota` و`activate_user_on_first_login`) وحذف SQLite نهائياً.
- [x] **F3** تحديث `backend/` للعمل حصرياً مع Supabase PostgreSQL عبر HTTPS، وتطبيق `Wall-Clock` UTC، وفرض `session-timeout` في MikroTik (بدلاً من `limit-uptime`)، وحصر الإدارة بالوظائف الأساسية.
- [x] **F4** توحيد `frontend/` (بوابة الزبائن `/` + لوحة الإدارة `/admin` مع عزل المسار الإداري) والحفاظ على الهوية البصرية والشعار والخطوط المحلية.
- [x] **F5** حصر جميع ملفات `routeros/*.rsc` بمنفذ `ether10` فقط دون أي إشارة أو تعديل على `ether1`–`ether9`.
- [x] **F6** تنظيف الملفات غير المستخدمة و`node_modules` المكررة و`.next/cache` (تقليص المشروع من `930.80 MB` إلى `441.70 MB`)، وإنشاء حزمة النقل المستقلة `usb-package/` (`57.19 MB`).
- [x] **F7** تنفيذ جميع الاختبارات المطلوبة (17/17 ناجحاً) وإعادة البناء بعد التنظيف.
- [x] **F8** توثيق النتائج في `PROGRESS.md` و`TEST-REPORT.md` و`DEPLOYMENT.md` والرفع إلى `main`.
- [ ] **F9 (غداً في الشركة)** تطبيق `supabase/schema.sql` على Supabase الفعلي، وتشغيل `preflight.rsc` و`deploy.rsc` و`verify.rsc` على MikroTik RB4011 الحقيقي، واختبار الأجهزة الفعلية.
