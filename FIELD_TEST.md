# FIELD_TEST.md — دليل الاختبار الميداني المعزول

## 1. الاختبار الآلي الدائم (Local / CI)
```powershell
node tests/verify_system.mjs
```
- يتحقق من أمان `hotspot/` و`admin/` و`supabase/functions/` و`routeros/`.
- عند توفر `TEST_DATABASE_URL` (كما في GitHub Actions `postgres:16`), ينفذ اختبار PostgreSQL الفعلي على `supabase/schema.sql` (تجديد الحصة عند منتصف الليل بتوقيت `Asia/Baghdad`، الحسابات من أول دخول، تعطيل الحساب، ومنع التجاوز عبر `verify_mac_authorization`).

## 2. اختبار معمل MikroTik المعزول
- يُنفذ على راوتر معمل معزول (وليس راوتر الشركة الإنتاجي) مع مشروع Supabase تجريبي منفصل تماماً عن الإنتاج.

## 3. القيود
- **لا يُنفذ أي تعديل على راوتر الإنتاج أو Supabase الإنتاجي أثناء الاختبار الميداني.**
- محاكاة / فحص السكربتات لا يُغني عن اختبار راوتر MikroTik الحقيقي في المعمل.
