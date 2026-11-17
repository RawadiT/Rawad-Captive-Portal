# FIELD_TEST.md — دليل الاختبار الميداني الآمن والمعزول

هذه الوثيقة تشرح مستويات الاختبار الأربعة المعتمدة وتفصلها عن بيئة الإنتاج وعن راوتر MikroTik الحقيقي لشركة رواد التقنيات.

---

## 1. الفرق بين مستويات الاختبار والنشر الأربعة

| البند | 1. In-Memory Application Test | 2. Real Local PostgreSQL/Supabase Integration | 3. MikroTik Lab Test | 4. Production Deployment |
| :--- | :--- | :--- | :--- | :--- |
| **الأداة / المسار** | `node tests/verify_field_test.mjs` | `deployment/docker-compose.field-test.yml` + `node tests/verify_supabase_integration.mjs` | راوتر معمل معزول + `MIKROTIK_MODE=routeros-rest` | راوتر الشركة `ether10` + Supabase الإنتاجية |
| **قاعدة البيانات** | محاكاة في الذاكرة (ليست PostgreSQL حقيقية) | PostgreSQL 16 + PostgREST محلي على `127.0.0.1:54321` مع `supabase/schema.sql` | قاعدة بيانات اختبارية معزولة | Supabase الإنتاجية (HTTPS) |
| **MikroTik** | `MockMikroTikAdapter` (على مستوى Node.js API) | `MockMikroTikAdapter` (أو غير مستخدم في اختبار DB) | راوتر معمل معزول تماماً | `192.168.20.1` (`ether10` فقط) |
| **العنوان / البروتوكول** | `HOST=127.0.0.1` (Loopback فقط) | `127.0.0.1:54321` / `127.0.0.1:54322` | شبكة المعمل المعزولة | `https://wifi.YOUR_COMPANY_DOMAIN.com` |

---

## 2. حدود ضمانات عزل الشبكة (API-Level vs Container/OS-Level)
- **عزل على مستوى التطبيق / API (`tests/verify_field_test.mjs`):**
  - يتحقق من رفض `loadConfig()` لروابط `*.supabase.co` وعناوين MikroTik غير المحاكاة وعناوين `HOST` غير Loopback.
  - يتحقق على مستوى Node.js (`net.Socket.prototype.connect`, `http.request`, `https.request`) من أن `MockMikroTikAdapter` لا يفتح أي اتصال صادر. **هذا فحص على مستوى Node.js API وليس بديلاً عن عزل الشبكة على مستوى نظام التشغيل أو الحاويات.**
- **عزل على مستوى الحاويات (`deployment/docker-compose.field-test.yml`):**
  - شبكتا `postgres` و`postgrest` متصلتان بشبكة `field_test_internal` (`internal: true`) دون أي وصول للإنترنت أو الشبكة المحلية الخارجية، بينما بوابة `supabase-local-gateway` مربوطة حصراً على `127.0.0.1:54321`.

---

## 3. تشغيل اختبار التطبيق في الذاكرة (المستوى 1)
```powershell
cd backend; npm run build; cd ..
cd frontend; npx tsc --noEmit; npm run build; cd ..
node tests/verify_field_test.mjs
```

---

## 4. تشغيل اختبار تكامل PostgreSQL / PostgREST المحلي (المستوى 2 — Fail-Closed)

### المتطلبات:
1. التأكد من جاهزية محرك Docker:
```powershell
docker info
```
2. بناء Backend أولاً (مطلوب لأن الاختبار يستورد `backend/dist/`):
```powershell
cd backend; npm run build; cd ..
```
3. تشغيل حاويات الاختبار المحلية والتحقق من جاهزيتها:
```powershell
docker compose -f deployment/docker-compose.field-test.yml up -d
docker compose -f deployment/docker-compose.field-test.yml ps
```
4. تشغيل اختبار التكامل الفعلي (يفشل برمز خروج غير صفري `1` تلقائياً إذا كانت الخدمة متوقفة أو غير متاحة):
```powershell
node tests/verify_supabase_integration.mjs
```

### الإيقاف والتنظيف:
```powershell
docker compose -f deployment/docker-compose.field-test.yml down -v
```

---

## 5. تشغيل حزمة USB الآمنة (وضع Field-Test الإلزامي)
```powershell
pwsh -NoProfile -File "deployment\build-usb-package.ps1"
```
- تحتوي الحزمة على `start-field-test.bat` و`start-windows.bat` (كلاهما يفرض `field-test-preflight.mjs` و`RAWAD_FIELD_TEST_PACKAGE_LOCK=true`).
- ترفض الحزمة البدء فوراً إذا لم يتحقق: `FIELD_TEST_MODE=true`، `MIKROTIK_MODE=mock`، `NODE_ENV=development`، و`HOST=127.0.0.1`.
- تم استبعاد `.env` و`.env.example` الإنتاجي ومفاتيح/شهادات TLS الخاصة من الحزمة.
