# TASKS.md — خطة تنفيذ نظام Captive Portal (روتانا - شركة رواد التقنيات)

تم تنفيذ واختبار جميع مراحل التطوير المحلية بنجاح بنسبة 100%.

---

## المرحلة 1: التخطيط والهوية البصرية والأصول المحلية (Phase 1: Planning, Brand Assets & Scaffolding)
- [x] **T1.1** تحليل المتطلبات وفحص الموقع المرجعي (`https://rawad-system.vercel.app/`) واستخراج الهوية البصرية (خط Cairo، RTL، تدرجات الأزرق الملكي/النيلي، Glassmorphism).
- [x] **T1.2** إنشاء ملفات التخطيط الأساسية: `TASKS.md`، `PROGRESS.md`، `ARCHITECTURE.md`، `README.md`.
- [x] **T1.3** إنشاء هيكل المجلدات الكامل للمشروع، وحفظ الشعار الرسمي المرفق محلياً، وتنزيل خطوط Cairo محلياً لضمان العمل دون إنترنت.

## المرحلة 2: قاعدة البيانات والطبقة التحتية (Phase 2: Database & Persistence)
- [x] **T2.1** تصميم وإنشاء مخطط قاعدة البيانات (`database/schema/001_initial.sql`) يشمل: `admins`، `users`، `free_quotas`، `sessions`، `audit_logs` مع قيود منع تعديل/حذف سجلات التدقيق.
- [x] **T2.2** إنشاء نظام الترحيل (`database/migrations/`) وأدوات النسخ الاحتياطي والاستعادة (`database/backup/`).
- [x] **T2.3** اختبار استمرارية البيانات والقيود (Unique MAC+BaghdadDate، عدم قبول UPDATE/DELETE على `audit_logs`).

## المرحلة 3: الخادم الخلفي ومنطق العمل (Phase 3: Backend Core & MikroTik Adapter)
- [x] **T3.1** إعداد مشروع `backend/` بـ TypeScript وNode.js (تثبيت الحزم وإعداد `tsconfig.json`).
- [x] **T3.2** بناء طبقة `backend/mikrotik/`: واجهة `MikroTikAdapter`، عميل `RouterOSRestClient` (HTTPS REST API + Retry/Timeout)، ومحرك المحاكاة `MockMikroTikAdapter`.
- [x] **T3.3** بناء طبقة `backend/authentication/`: تشفير كلمات المرور (`scrypt` + Salt)، جلسات المدراء (HMAC-SHA256 Token)، وصلاحيات `super_admin` مقابل `admin`.
- [x] **T3.4** بناء طبقة `backend/quota-manager/`: حساب التاريخ المحلي بتوقيت `Asia/Baghdad` (تجدد 00:00)، منح 30 دقيقة مجانية ذرياً (Atomic Transaction + Concurrency Lock)، واستهلاك الرصيد التراكمي لحسابات المستخدمين.
- [x] **T3.5** بناء طبقة `backend/session-monitor/`: مراقب الجلسات الدوري، مزامنة الاستهلاك مع MikroTik، قطع الجلسة عند انتهاء الوقت، وبث التحديثات اللحظية (SSE).
- [x] **T3.6** بناء طبقة `backend/audit-logs/`: تسجيل جميع العمليات الإدارية التسع المطلوبة مع عنوان IP والقيم السابقة والجديدة.
- [x] **T3.7** بناء طبقة `backend/api/`: نقاط النهاية للزبائن (`/api/guest/*`) وللإدارة (`/api/admin/*`) والحماية (CORS، Rate Limit، التحقق من المصدر، عدم كشف أسرار الراوتر).
- [x] **T3.8** نجاح `tsc` Build للخادم الخلفي.

## المرحلة 4: بوابة الزبائن وملفات HotSpot (Phase 4: Guest Portal & MikroTik HotSpot Files)
- [x] **T4.1** إعداد تطبيق Next.js + TypeScript + Tailwind CSS في `frontend/guest-portal/` مع خط Cairo المحلي والشعار الرسمي وواجهة RTL.
- [x] **T4.2** بناء الخلفية التقنية المتحركة (أيقونات هواتف، حواسيب، شاشات، راوترات، موجات Wi-Fi بتقنيات CSS/SVG خفيفة متوافقة مع GPU و`prefers-reduced-motion`).
- [x] **T4.3** بناء شاشة الدخول الأساسية بخيارين فقط: (1) 30 دقيقة مجانية، (2) تسجيل الدخول (اسم المستخدم + كلمة المرور)، مع استجابة تفاعلية كاملة.
- [x] **T4.4** بناء شاشة حالة الاتصال والعداد الدائري السلس (SVG `stroke-dashoffset`) المعتمد على وقت الخادم الفعلي، مع حالة انتهاء الوقت والمنع اليومي.
- [x] **T4.5** إنشاء ملفات `hotspot/` (`login.html`، `status.html`، `logout.html`، `error.html`، `api.json`، `assets/`) لدعم Captive Portal Detection (بما في ذلك RFC 7710) والمسار اليدوي البديل.
- [x] **T4.6** نجاح `next build` لبوابة الزبائن.

## المرحلة 5: لوحة التحكم الإدارية (Phase 5: Admin Dashboard)
- [x] **T5.1** إعداد تطبيق Next.js + TypeScript + Tailwind CSS في `frontend/admin-dashboard/` منفصل تماماً عن بوابة الزبائن وبنفس الهوية البصرية.
- [x] **T5.2** بناء صفحة تسجيل دخول المدراء ولوحة المؤشرات الرئيسية (Dashboard): النشطون، الحسابات، الجلسات، المدراء، حالة اتصال الراوتر.
- [x] **T5.3** بناء قسم المتصلين حالياً (`Active Users`) مع التحديث شبه اللحظي (كل 2.5 ثانية via SSE دون إعادة تحميل) وزر إنهاء الجلسة، دون اختراع أسماء/طرازات أجهزة غير موثوقة.
- [x] **T5.4** بناء قسم إدارة المستخدمين (`User Management`): إنشاء، تعديل، مدة محددة أو مفتوحة، تعطيل، حظر، حذف، إنهاء جلسة.
- [x] **T5.5** بناء قسم إدارة المدراء (`Admin Management`): فصل صلاحيات المدير الرئيسي عن المدراء العاديين.
- [x] **T5.6** بناء قسم سجل العمليات (`Activity Logs`) غير القابل للتعديل أو الحذف.
- [x] **T5.7** نجاح `next build` للوحة الإدارة.

## المرحلة 6: سكربتات RouterOS 7.x وملفات النشر (Phase 6: RouterOS 7.x Scripts & Deployment)
- [x] **T6.1** كتابة ومراجعة `routeros/preflight.rsc` لفحص `ether10` والـ Bridge والشبكات والتعارضات دون تعديل.
- [x] **T6.2** كتابة ومراجعة `routeros/deploy.rsc` لإعداد `ether10` (192.168.20.1/24)، DHCP، HotSpot، Walled Garden، عزل شبكة الضيوف عن `ether9` ولوحة الإدارة، منع DNS الخارجي وIPv6، وحساب API محدود الصلاحيات.
- [x] **T6.3** كتابة ومراجعة `routeros/verify.rsc` و`routeros/rollback.rsc`.
- [x] **T6.4** إنشاء ملفات النشر: `deployment/Dockerfile`، `deployment/docker-compose.yml`، `deployment/.env.example`، وسكربتات التثبيت (`deployment/install/`).

## المرحلة 7: الاختبارات الشاملة والتوثيق النهائي (Phase 7: Testing, Verification & Documentation)
- [x] **T7.1** اختبارات الوحدة (`tests/unit/core.test.mjs`).
- [x] **T7.2** اختبارات التكامل والمحاكاة (`tests/integration/quota-and-auth.test.mjs`، `tests/simulation/full-flow.test.mjs`).
- [x] **T7.3** اختبارات الأمان (`tests/security/security.test.mjs`).
- [x] **T7.4** اختبارات الأداء وتوافق الأجهزة (`tests/performance/perf.test.mjs`، `tests/device-compatibility/compatibility.test.mjs`).
- [x] **T7.5** كتابة جميع الوثائق في `docs/`: `INSTALLATION.md`، `CONFIGURATION.md`، `SECURITY.md`، `TEST-REPORT.md`، `MIKROTIK-DEPLOYMENT.md`.
- [x] **T7.6** المراجعة النهائية الشاملة ومراجعة توافق TLS/CAPPORT (النطاق الحقيقي، DNS-01، Split-Horizon DNS، إزالة OCSP واعتماد CRL، NTP، وتنظيف المراجع) وتحديث `PROGRESS.md`.
