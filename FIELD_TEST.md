# FIELD_TEST.md — دليل الاختبار الميداني الآمن والمعزول

هذه الوثيقة تشرح مستويات الاختبار الأربعة المعتمدة وتفصلها عن بيئة الإنتاج وعن راوتر MikroTik الحقيقي لشركة رواد التقنيات.

---

## 1. الفرق بين مستويات الاختبار والنشر الأربعة

| البند | 1. In-Memory Application Test | 2. Real Local PostgreSQL/Supabase Integration | 3. MikroTik Lab Test | 4. Production Deployment |
| :--- | :--- | :--- | :--- | :--- |
| **الأداة / المسار** | `node tests/verify_field_test.mjs` | `deployment/docker-compose.field-test.yml` + `node tests/verify_supabase_integration.mjs` | راوتر معمل معزول + `MIKROTIK_MODE=routeros-rest` | راوتر الشركة `ether10` + Supabase الإنتاجية |
| **قاعدة البيانات** | محاكاة في الذاكرة (ليست PostgreSQL حقيقية) | PostgreSQL 16 + PostgREST محلي على `127.0.0.1:54321` مع `supabase/schema.sql` | قاعدة بيانات اختبارية معزولة | Supabase الإنتاجية (HTTPS) |
| **MikroTik** | `MockMikroTikAdapter` (صفر اتصالات شبكية) | `MockMikroTikAdapter` (أو غير مستخدم في اختبار DB) | راوتر معمل معزول تماماً | `192.168.20.1` (`ether10` فقط) |
| **العنوان / البروتوكول** | `HOST=127.0.0.1` (Loopback فقط) | `127.0.0.1:54321` / `127.0.0.1:54322` | شبكة المعمل المعزولة | `https://wifi.YOUR_COMPANY_DOMAIN.com` |

> **تنبيه:** لا يُعتبر الاختبار في الذاكرة (`tests/verify_field_test.mjs`) بديلاً عن اختبار تكامل PostgreSQL الفعلي، كما لا يُعتبر `MockMikroTikAdapter` بديلاً عن اختبار راوتر MikroTik المعملي.

---

## 2. تشغيل اختبار التطبيق في الذاكرة وعزل الشبكة (المستوى 1)
```powershell
cd backend; npm run build; cd ..
cd frontend; npx tsc --noEmit; npm run build; cd ..
node tests/verify_field_test.mjs
```
يتحقق هذا الاختبار من:
- ربط الخادم على `127.0.0.1` فقط ورفض `0.0.0.0` وعناوين LAN/WAN في `FIELD_TEST_MODE=true`.
- عدم إنشاء أي اتصال شبكي صادر (`net.Socket.connect`, `http.request`, `https.request`) أثناء عمليات `MockMikroTikAdapter`.
- رفض `*.supabase.co`، وعناوين MikroTik الحقيقية، و`MIKROTIK_MODE=routeros-rest`، و`NODE_ENV=production`.
- رفض تشغيل حزمة USB (`RAWAD_FIELD_TEST_PACKAGE_LOCK=true`) إذا أُعطيت إعدادات إنتاجية.

---

## 3. تشغيل بيئة PostgreSQL / PostgREST المحلية (المستوى 2)

### التشغيل:
```powershell
docker compose -f deployment/docker-compose.field-test.yml up -d
node tests/verify_supabase_integration.mjs
```

### الإيقاف والتنظيف:
```powershell
docker compose -f deployment/docker-compose.field-test.yml down -v
```

---

## 4. تشغيل حزمة USB الآمنة (وضع Field-Test الإلزامي)
```powershell
pwsh -NoProfile -File "deployment\build-usb-package.ps1"
```
- تحتوي الحزمة على `start-field-test.bat` و`start-windows.bat` (كلاهما يفرض `field-test-preflight.mjs` و`RAWAD_FIELD_TEST_PACKAGE_LOCK=true`).
- ترفض الحزمة البدء فوراً إذا لم يتحقق: `FIELD_TEST_MODE=true`، `MIKROTIK_MODE=mock`، `NODE_ENV=development`، و`HOST=127.0.0.1`.
- تم استبعاد `.env` و`.env.example` الإنتاجي ومفاتيح/شهادات TLS الخاصة من الحزمة.
