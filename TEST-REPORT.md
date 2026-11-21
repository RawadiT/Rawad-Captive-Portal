# TEST-REPORT.md — التقرير الشامل للاختبارات والأداء والتحقق النهائي

يوثّق هذا التقرير النتائج الفعلية المُقاسة والمُلاحظة مباشرة أثناء تنفيذ المراحل 5 و6 و7 و8 على مختبر المحاكاة المعزول (`Rawad-CHR-Lab` RouterOS `7.25.1 x86_64` + `RAWAD-WIN10-CLIENT` + Supabase `Rawad Test` `efqsmehqnhuzohzjztni`).

> **تنبيه معماري إلزامي:** جميع أرقام التزامن وزمن الاستجابة وأحمال المعالج/الذاكرة الواردة هنا قِيست في بيئة مختبر `VirtualBox / CHR x86_64` واتصال الإنترنت المحلي عبر `Supabase Rawad Test`، **ولا تمثّل قياس أداء عتادي لراوتر الإنتاج `MikroTik RB4011iGS+RM (ARM32)`**. كما لم يُستخدم `POST /cleanup/execute` إطلاقاً على بيانات `Rawad Test` الحية.

---

## 1. ملخص نتائج المرحلة 5 — الاختبارات الوظيفية والأمنية واستعادة الأعطال (`RB-016` — `RB-021`)

### أ. اختبارات الوظائف وEdge Functions و`RAWAD-WIN10-CLIENT` (`RB-016`, `RB-017`)
| المعرف | الاختبار المُنفذ فعلياً | النتيجة المُلاحظة | الحالة |
| :--- | :--- | :--- | :--- |
| `RB-017/A` | تسجيل دخول لوحة الإدارة للأدوار الثلاثة عبر `POST /admin-api/login` | `site_owner`, `general`, `subordinate` حققوا `HTTP 200` + أدوار صحيحة | `PASSED` |
| `RB-017/PS` | دورة `GET/PUT /portal-settings` + تعقيم الروابط + التحقق من `GET /portal-auth` | رفض `javascript:alert(1)` و`DROP TABLE;` برمز `HTTP 400`؛ تحديث النص/واتساب وانعكاسه الفوري ثم الاستعادة | `PASSED` |
| `RB-016/FREE` | الحصة المجانية `30m` عبر `portal-auth` + `verify-mac` + `session_status` + `logout` + استنفاد اليوم | `ALLOW:1799`، ثم `logout` فرفض `403`، ثم انتهاء الصلاحية فأرجع `action=free` رمز `403` | `PASSED` |
| `RB-016/LIM` | حساب محدود `45m` + دخول متعدد MAC + سحب الجلسة السابقة | `ALLOW:2699`؛ تسجيل الدخول من MAC ثانٍ نقل الجلسة وأدرج `MAC1` في `action=revoked` | `PASSED` |
| `RB-016/UNLIM` | حساب مفتوح `is_unlimited=true` -> تعطيل -> سحب -> `ACK` -> حذف | `verify-mac` أرجع `ALLOW:UNLIMITED`؛ التعطيل أنهى `session_status` (`disconnected`)، وتم مسح السحب بـ `ACK:1`/`ACK:3` | `PASSED` |
| `RB-016/VM` | دخول HotSpot حي على `RAWAD-WIN10-CLIENT` (`08:00:27:44:DC:6B`) | `Free`: أدرج RouterOS `rawad-verified` (`timeout=29m49s`); `Limited 60m`: (`59m43s`, الإنترنت `200`, `10.10.20.5` محجوب); `Unlimited`: (`dynamic=no` دون timeout)، وبعد التعطيل أُزيل تلقائياً من CHR خلال ≤18ث | `PASSED` |

### ب. اختبارات الأمان وتحصين الصلاحيات (`RB-018`)
| الاختبار الأمني | السلوك المُثبت | الحالة |
| :--- | :--- | :--- |
| **RLS Direct REST Lock** | طلبات `GET /rest/v1/{admins,users,sessions,free_quotas,portal_settings}` بمفتاح `anon` | جميع الجداول الخمسة رُفضت برمز **`HTTP 401`** (صفر تسريب) | `PASSED` |
| **تسلسل الصلاحيات (`RBAC`)** | `subordinate` أمام `PUT /portal-settings`، `GET /free-quotas`، `PATCH/DELETE /users`، `/admins`، `/cleanup/*` | جميعها رُفضت برمز **`HTTP 403`** (`general` مُنع من `/admins` و`/cleanup/*` بـ **`403`**) | `PASSED` |
| **حصانة مدير الموقع (`site_owner`)** | محاولة `PATCH` و`DELETE` ضد حساب `hashim` حتى من حساب `site_owner` اختباري | رُفضت برمز **`HTTP 403`** | `PASSED` |
| **حماية `HMAC` والتلاعب بالرموز** | `status_token` مُعدّل البايت أو مستخدم عبر `MAC` مختلف + `JWT` باطل على `admin-api` | `status_token` المزور/المنقول رفض **`HTTP 403`**؛ `JWT` الباطل رفض **`HTTP 401`** | `PASSED` |
| **حماية `verify-mac` و`ACK` وMAC Spoof** | طلب بدون `x-router-secret`؛ طلب `MAC` غير مسجل؛ `action=ack&ids=bad-uuid` | بدون سر **`401 DENY:unauthorized`**؛ `MAC` مجهول **`403 DENY:not_authorized`**؛ `ACK` غير صالح **`400 ERR:invalid_ids`** | `PASSED` |
| **العزل الجداري (`Firewall`)** | `RAWAD-WIN10-CLIENT` يحاول `ping 10.10.10.1` و`10.10.20.5`/`30.5`/`40.5`؛ WAN غير المصرح لـ `8088` | حُظر بالعدّادات الفعلية (`input` #0 و`forward` #4) في CHR | `PASSED` |

> **ملاحظة TLS الميدانية (`Walled Garden`):** في بيئة `RAWAD-WIN10-CLIENT` قبل مصادقة HotSpot، حقق `curl.exe --ssl-no-revoke` على `Supabase` استجابة `HTTP 200` وتفتح Microsoft Edge البوابة وتحمّل `portal_settings` فوراً (`HTTP 200`)، بينما يفشل `curl.exe` بدون `--ssl-no-revoke` برمز Windows SChannel `0x80092013` لأن خوادم فحص إلغاء الشهادات الخارجية (CRL/OCSP) غير مضافة في Walled Garden (وهو سلوك متوقع تديره المتصفحات عبر soft-fail).

### ج. واجهة لوحة الإدارة (`RB-019` عبر Chromium DevTools على `http://192.168.56.2:8088/`)
- **Desktop (`1440×900`):** `scrollW=1440, innerW=1440` (صفر overflow)، `dir="rtl"`, `lang="ar"`, خط `Cairo`, الشعار محمّل، جميع الأصول الستة المحلية (`index.html`, `style.css`, `admin.js`, `logo.png`, خطا `Cairo`) `HTTP 200`, التوقيع `Powered BY Hashim Hasanen` ظاهر، معاينة البوابة الحية تتحدث فوراً (`prevText="معاينة حية رواد"`), لوحة التنظيف القرائية تعرض إحصاءات بغداد (`2026-11-21`).
- **Mobile (`390×844`):** `scrollW=390, innerW=390, overflow=false`، **0 أخطاء أو تحذيرات في Console** قبل وبعد تحديث `admin.js`.

### د. اختبارات استعادة الأعطال (`RB-020` — 5 سيناريوهات حية)
1. **قطع واستعادة WAN (`setlinkstate1 off/on`):** أثناء القطع فشل `fetch` من CHR وبقيت لوحة الإدارة عبر Host-Only (`192.168.56.2:8088`) `HTTP 200`؛ بعد الوصل عاد إيجار `ether1` واتصال Supabase (`HTTP 200` خلال ~8–10 ثوانٍ بعد تجدد DHCP/DNS).
2. **تعذر الوصول إلى Supabase (Fail-Closed):** عند فشل الاتصال بـ `verify-mac` لا يُضاف `MAC` إلى `rawad-verified` وتُسقط جلسة HotSpot.
3. **إيقاف وتشغيل الحاوية (`/container stop 0` -> `start 0`):** أثناء الإيقاف توقف المنفذ `8088` (انقضاء مهلة الاتصال)، وبعد `start 0` عادت `192.168.56.2:8088` و`127.0.0.1:8088` إلى **`HTTP 200`**.
4. **قطع وإعادة وصل شبكة العميل (`RAWAD-WIN10-CLIENT` `setlinkstate1 off/on`):** أثناء القطع `NIC_OFF_HS=000`، وبعد إعادة الوصل استعاد العميل `NIC_ON_HS=200` و`NIC_ON_ADM=200`.
5. **إعادة تشغيل CHR (`/system reboot`):** عاد CHR (`uptime: 1m21s`)، وعادت تلقائياً الحاوية `busybox:musl` بحالة `R - RUNNING` (`748.0KiB`), خادم `hotspot1`, مجدول `rawad-sync-revocations`, وبقيت `192.168.56.2:8088` و`127.0.0.1:8088` تستجيب بـ **`HTTP 200`**.

---

## 2. نتائج اختبار الأحمال المتدرج (`Stage 6`: 10، 25، 40، 60، 100 طلب متزامن — `RB-022` — `RB-024`)

تم التنفيذ عبر السكربت الآلي `run_stage6_load.mjs` مع تنظيف فوري لكل صفوف الاختبار (`02:99:%` و`__rb_load_%`) بين المستويات وفي `finally`.

| التزامن (`n`) | `CHR BusyBox` (`192.168.56.2:8088`) | `portal-auth GET` | `verify-mac?action=revoked` | `portal-auth POST free` (DB Write) | موارد `CHR` بعد المستوى (`CPU / RAM حرة / RAM حاوية / Writes`) |
| :---: | :--- | :--- | :--- | :--- | :--- |
| **10** | `200: 10` \| `12.0 rps` \| `p50=23ms` \| `p95=807ms` \| `max=807ms` | `200: 10` \| `9.2 rps` \| `p50=1022ms` \| `max=1072ms` | `200: 10` \| `11.1 rps` \| `p50=872ms` \| `max=900ms` | `200: 10` \| `11.7 rps` \| `p50=408ms` \| `max=850ms` | `0%` \| `276.7MiB` \| `916.0KiB` \| `800` |
| **25** | `200: 25` \| `3.3 rps` \| `p50=2266ms` \| `p95=4897ms` \| `max=7597ms` | `200: 25` \| `21.2 rps` \| `p50=949ms` \| `max=1178ms` | `200: 25` \| `25.3 rps` \| `p50=846ms` \| `max=986ms` | `200: 25` \| `25.6 rps` \| `p50=486ms` \| `max=975ms` | `0%` \| `276.4MiB` \| `1088.0KiB` \| `864` |
| **40** | `200: 40` \| `2.4 rps` \| `p50=5296ms` \| `p95=9806ms` \| `max=16968ms` | `200: 40` \| `34.2 rps` \| `p50=1056ms` \| `max=1159ms` | `200: 40` \| `31.9 rps` \| `p50=476ms` \| `max=1251ms` | `200: 40` \| `34.9 rps` \| `p50=422ms` \| `max=1143ms` | `0%` \| `275.9MiB` \| `1284.0KiB` \| `936` |
| **60** | `200: 60` \| `1.7 rps` \| `p50=5848ms` \| `p95=34578ms` \| `max=34648ms` | `200: 60` \| `51.8 rps` \| `p50=1009ms` \| `max=1144ms` | `200: 60` \| `57.1 rps` \| `p50=874ms` \| `max=1047ms` | `200: 60` \| `65.0 rps` \| `p50=684ms` \| `max=919ms` | `0%` \| `275.4MiB` \| `1568.0KiB` \| `1008` |
| **100** | **`200: 87`, `ERR: 13`** \| `1.4 rps` \| `p50=10004ms` \| `p95=56093ms` \| `max=70645ms` | `200: 100` \| `52.5 rps` \| `p50=1410ms` \| `max=1890ms` | `200: 100` \| `94.3 rps` \| `p50=601ms` \| `max=1059ms` | `200: 100` \| `84.9 rps` \| `p50=564ms` \| `max=1177ms` | `0%` \| `274.8MiB` \| `1576.0KiB` \| `1144` |

- **التعافي بعد الذروة (`POST_LOAD_RECOVERY`):** استجابة `adminStatic = 200` و`portalAuth = 200` مباشرة، `CPU = 1%`, `freeMem = 274.8MiB`, `freeHdd = 64.8MiB`, `writes = 1176`.
- **الاستنتاج الهندسي:** دوال Supabase الثلاث صمدت بنسبة **100% (`0` أخطاء و`0` رفض `429/5xx`) حتى 100 طلب متزامن**، بينما اختنق خادم `BusyBox httpd` على معالج CHR الواحد بدءاً من `25–100` اتصالات متزامنة (`13%` فشل اتصالات عند `n=100`) — ما يؤكد ضرورة اعتماد خادم LAN داخلي حقيقي (أو التشغيل المباشر) لملفات `admin/` بدلاً من BusyBox على الراوتر.

---

## 3. إصلاحات المرحلة 7 والانحدار (`RB-025` — `RB-026`)
1. **[routeros/deploy.rsc](routeros/deploy.rsc) (السطر 290):** إضافة `hotspot=auth` لقاعدة `cUnverified` لضمان عدم اعتراض زيارات Walled Garden قبل المصادقة مهما كان ترتيب القواعد.
2. **[routeros/preflight.rsc](routeros/preflight.rsc) (السطر 29):** استبدال الفحص القديم (`rawad-api`, `rawad-api-group`) بأسماء الموارد المعتمدة حالياً (`rawad-verified-prof`, `rawad-gate`, `rawad-sync-revocations`).
3. **[admin/admin.js](admin/admin.js) (السطور 117–122):** قصر أزرار التعديل والتعطيل والحذف النهائي في جدول المستخدمين على `canManageOperations()` وإظهار `عرض فقط` للمدير الفرعي `subordinate` مطابقةً لـ `admin-api` (`HTTP 403`)، مع مزامنة الملف إلى حاوية CHR (`32382 bytes`, `HTTP 200`).
4. **[tests/verify_system.mjs](tests/verify_system.mjs):** إضافة فحوص انحدار دائمة للإصلاحات الثلاثة واجتياز `ALL SYSTEM VERIFICATIONS PASSED` وإعادة تشغيل اختبار المرحلة 5 (`7/7 PASS`).

---

## 4. نتائج اختبار القبول النهائي البارد (`FINAL-ACCEPTANCE-TEST` — 17 نقطة بعد الإصلاحات النهائية)

| # | بند التحقق الإلزامي | الدليل المُقاس فعلياً بعد الإقلاع البارد الكامل | النتيجة |
| :---: | :--- | :--- | :---: |
| 1 | إطفاء بارد كامل (`poweroff`) للجهازين | `VBoxManage list runningvms` -> فارغ (`NONE`) | `PASSED` |
| 2 | تشغيل بارد من الصفر (`CHR` + `Win10`) | إقلاع `Rawad-CHR-Lab` في `~38s` وحصول `Win10` على `192.168.88.250` خلال `+3s` | `PASSED` |
| 3 | التشغيل التلقائي لخدمات CHR بعد الإقلاع | `busybox:musl` (`R - RUNNING`, `668.0KiB`)، `hotspot1`، و`rawad-sync-revocations` (`15s`) تلقائياً | `PASSED` |
| 4 | لوحة الإدارة من Windows 11 | `http://192.168.56.2:8088/` (`HTTP 200`, `25015B`) و`http://127.0.0.1:8088/` (`HTTP 200`) و`admin.js` (`HTTP 200`, `32382 bytes`) | `PASSED` |
| 5 | لوحة الإدارة من Windows 10 VM | `http://192.168.88.1:8088/` (`HTTP 200`) قبل وبعد إقلاع المختبر | `PASSED` |
| 6 | بوابة العميل `http://hotspot.rawad.test/login` من Win10 | انفتحت تلقائياً في Edge على البوابة محملةً `portal_settings` من Supabase مباشرة (`أهلاً بك في شبكة رواد` + شعار روتانا) | `PASSED` |
| 7 | اختبار جميع أنواع الحسابات بعد الإقلاع البارد | `Free`: `29m48s dynamic=yes` (`FAT_FREE=200`)؛ `Limited`: `59m44s` + `FAT_INET=200`؛ `Unlimited`: `dynamic=no` دون timeout (`FAT_UNLIM=200`) | `PASSED` |
| 8 | التكامل مع `Rawad Test` | مصادقة حية والتحقق عبر `verify-mac` + `portal-auth`، ونظافة قاعدة البيانات (`admins=2: hashim, testo` و`users=2: test, hashim`) | `PASSED` |
| 9 | السحب والفصل التلقائي بعد التعطيل | تعطيل `__rb_vm_unlim` فصل `08:00:27:44:DC:6B` وأفرغ `/ip hotspot active` و`rawad-verified` تلقائياً خلال `≤18s` | `PASSED` |
| 10 | العزل الجداري للضيوف وWAN | محاولة `10.10.10.1` (`input drop 1 packet / 60B`) و`10.10.20.5` (`forward drop 1 packet / 60B`)؛ WAN محجوب عن `8088` | `PASSED` |
| 11 | قطع واستعادة إنترنت WAN | `setlinkstate1 off` -> `WAN_OFF_BLOCKED`؛ بعد الاستعادة عاد `fetch` لـ Supabase إلى `CHR_WAN_NOW=200` وعاد DHCP `10.0.2.15/24` | `PASSED` |
| 12 | إعادة تشغيل CHR (`/system reboot`) | تم التحقق في `RB-020` وفي الإقلاع البارد مع عودة الحاوية وHotSpot والمجدول والواجهة بـ `HTTP 200` | `PASSED` |
| 13 | إعادة تشغيل الحاوية (`/container stop 0` -> `start 0`) | `CONT_RESTART_ADMIN_HTTP=200` بعد إعادة التشغيل | `PASSED` |
| 14 | اختبارات الانحدار والأمان النهائية | `node tests/verify_system.mjs` (`ALL SYSTEM VERIFICATIONS PASSED`) و`run_stage5_tests.mjs` (`7/7 PASS`) | `PASSED` |
| 15 | التحقق من اكتمال وتناسق الملفات الـ 7 | وجود وتناسق `TASKS.md`, `PROGRESS.md`, `TEST-REPORT.md`, `RB4011-COMPATIBILITY.md`, `PRODUCTION-READINESS.md`, `LAB-SETUP.md`, `ROLLBACK.md` | `PASSED` |
| 16 | فحص نظافة `git status` و`git diff` | جميع التغييرات محصورة في السكربتات والتوثيق والاختبارات المتعمدة دون ملفات مؤقتة أو `scratch/` | `PASSED` |
| 17 | فحص تسرب الأسرار وبيانات الاعتماد | `git grep` على الملفات المتتبعة يؤكد صفر أسرار، صفر كلمات مرور، وعدم تتبع `pgpass.conf` أو النسخ الاحتياطية | `PASSED` |
