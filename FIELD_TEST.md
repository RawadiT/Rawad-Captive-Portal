# FIELD_TEST.md — دليل الاختبار الميداني الآمن والمعزول

هذه الوثيقة تشرح كيفية تشغيل حزمة الاختبار الميداني المعزولة تماماً عن بيئة الإنتاج وعن راوتر MikroTik الحقيقي لشركة رواد التقنيات.

---

## 1. الفرق بين أوضاع التشغيل الثلاثة

| البند | Local Isolated Test (الاختبار المحلي المعزول) | MikroTik Lab Test (اختبار معمل معزول) | Production Deployment (النشر الإنتاجي) |
| :--- | :--- | :--- | :--- |
| **الغرض** | التحقق من الـ API، الجلسات، الحصة المجانية، ومنطق الأمان محلياً | اختبار تكامل REST API الفعلي مع راوتر **معمل معزول** (غير متصل بشبكة الشركة) | التشغيل الفعلي لضيوف الشركة على `ether10` |
| **وضع MikroTik** | `MIKROTIK_MODE=mock` (`MockMikroTikAdapter` في الذاكرة) | `MIKROTIK_MODE=routeros-rest` نحو راوتر معمل معزول فقط | `MIKROTIK_MODE=routeros-rest` نحو `192.168.20.1` (`ether10`) |
| **قاعدة البيانات** | PostgreSQL اختباري محلي (`TEST_DATABASE_URL`) أو محاكاة معزولة (`http://127.0.0.1:...`) | مشروع Supabase تجريبي منفصل تماماً عن الإنتاج | مشروع Supabase الإنتاجي المعتمد |
| **حماية الإنتاج** | `FIELD_TEST_MODE=true` يمنع التشغيل مع `*.supabase.co` أو `MIKROTIK_HOST` غير `mock.local` | يجب استخدام بيانات اعتماد ومفاتيح معملية فقط | `NODE_ENV=production` مع أسرار وشهادات TLS حقيقية |
| **تعديل الراوتر** | **لا يوجد أي اتصال أو تعديل** | على راوتر المعمل فقط بعد مراجعة السكربتات | تنفيذ `routeros/deploy.rsc` على `ether10` فقط |

---

## 2. المتطلبات المسبقة للاختبار المحلي المعزول
- Node.js `>= 20` و`npm`.
- عدم تشغيل أو تعديل أي إعدادات على راوتر الشركة (`ether1`–`ether9` أو WAN أو `ether10`).
- عدم استخدام مفاتيح أو روابط Supabase الإنتاجية.

---

## 3. خطوات تشغيل الاختبار المحلي المعزول

### الخطوة 1: بناء Backend وFrontend
```powershell
cd backend
npm ci
npm run build
cd ..\frontend
npm ci
npx tsc --noEmit
npm run build
cd ..
```

### الخطوة 2: تشغيل حزمة اختبارات Field-Test المعزولة (12 اختباراً)
```powershell
node tests/verify_field_test.mjs
```
يتحقق هذا الاختبار تلقائياً من:
- صحة بناء Backend وFrontend.
- استجابة `/api/health` في وضع `FIELD_TEST_MODE=true` و`MIKROTIK_MODE=mock`.
- محاكاة `MockMikroTikAdapter` دون أي اتصال شبكي.
- إنشاء جلسة مجانية 30 دقيقة (`1800s`) وربطها بـ MAC، ومنع استهلاكها مرتين لنفس الجهاز (`409` أثناء النشاط، `403` بعد الانتهاء).
- إنشاء حساب Username/Password وبداية المدة عند أول تسجيل دخول ناجح فقط، دون ربطه بـ MAC (`bindMac: false`).
- انتهاء الجلسات وإلغاؤها عبر `SessionMonitor`.
- تطبيق Fail-Closed عند فشل قاعدة البيانات أو غيابها، ورفض أي إعداد يشير إلى عناوين إنتاجية (`*.supabase.co`، `192.168.20.1`، إلخ).

### الخطوة 3: اختبار حزمة USB بأمان
```powershell
pwsh -NoProfile -File "deployment\build-usb-package.ps1"
```
- تأكد أن `usb-package\deployment\` لا يحتوي على أي ملف `.env` فعلي أو شهادات TLS خاصة (`certs/` أو `*.key`/`*.pem`).
- لتجربة تشغيل وضع الاختبار من قالب البيئة: انسخ `deployment\.env.field-test.example` يدوياً إلى `deployment\.env` في بيئة الاختبار فقط (لا تقم برفع `.env` إلى Git).

---

## 4. طريقة الإيقاف والتنظيف
- لإيقاف خادم Backend أو Frontend عند تشغيله يدوياً: اضغط `Ctrl + C` في نافذة الطرفية.
- لا تترك أي ملف `.env` فعلي داخل `usb-package\deployment\` أو مستودع Git.

---

## 5. حدود الاختبار (Test Boundaries)
- **اختبار المحاكاة (`MockMikroTikAdapter`) لا يُغني عن اختبار جهاز MikroTik الحقيقي** في مرحلة Lab Test أو عند النشر الفعلي.
- **لا يُنفّذ أي اختبار اتصال بـ Supabase الإنتاجية أو MikroTik الحقيقي** في وضع Local Isolated Test.
- أي اختبار يتطلب قاعدة PostgreSQL حقيقية (`tests/verify_fencing_race.mjs`) يتم تشغيله عبر حاوية PostgreSQL 16 مؤقتة في GitHub Actions أو عبر `TEST_DATABASE_URL` محلي معزول.
