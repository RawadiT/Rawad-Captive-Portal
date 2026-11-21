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

---

## 5. التدقيق الصادق لسجلات التشغيل السابقة غير المكتملة (`RB-032`)

تصنيف جميع مخرجات `task-*.log` السابقة وفق التصنيف الخماسي الإلزامي (`PASS | FAIL | BLOCKED | NOT TESTED | CANCELLED`):

| معرف السجل | الحدث الفعلي المُلاحظ في السجل | التصنيف الصادق | السبب الجذري والمعالجة اللاحقة |
| :--- | :--- | :---: | :--- |
| `task-1079` | تعذّر تصدير CHR بسبب علامة تنصيص مفردة في أمر RouterOS (`line 1 column 30`) وتوقّف باكر لـ `ssh 127.0.0.1:2222` | `CANCELLED` | صياغة RouterOS غير صحيحة؛ أُعيدت صياغة الأمر وتأكد الوصول عبر SSH بنجاح لاحقاً |
| `task-1141` | انقطاع سطر `-EncodedCommand` في نافذة `Win+R` على Windows 10 بسبب حد `259` حرفاً | `CANCELLED` | ليس فشلاً للنظام؛ استُبدل بفتح `cmd` من قائمة ابدأ وتنفيذ أوامر `curl.exe` قصيرة في `task-1159` (`PASS`) |
| `task-1171` | تنفيذ فحوص Win10 وحفظ اللقطة، ثم `Exit 1` في النهاية بسبب `:put '---NAT-STATS---'` داخل CHR | `FAIL` | خطأ تنصيص مفرد في استعلام CHR النهائي فقط؛ أُعيد باستعمال تنصيص مزدوج في `task-1180`/`task-1196` (`PASS`) |
| `task-1250` | `Exit 1` في `run_stage5_tests.mjs:409`: السكربت توقّع `reason === 'disabled'` بينما الخادم أرجع `'disconnected'` | `FAIL` | تطابق نصّي غير دقيق في سكربت الاختبار؛ عُدّل إلى `['disconnected', 'disabled']` وأُعيد التشغيل في `task-1267` و`task-1403` (`7/7 PASS`) |
| `task-1290` | تعارض `{ stdio: 'inherit', input: sql }` أثناء تهيئة مستخدمي Win10 في `prep_win10_users.mjs` | `CANCELLED` | خطأ عقدة Node `stdio`؛ أُزيل `stdio: 'inherit'` وعمل التشغيل التالي بنجاح (`PASS`) |
| `task-1335` | إلغاء المهلة أثناء انتظار إقلاع CHR بعد `/system reboot` | `CANCELLED` | انتظار زمني قبل جاهزية SSH فقط |
| `task-1350` | `CANCELLED` لأن نمط المطابقة `00:0[01]` لم يطابق صيغة RouterOS `1m7s` في `uptime` | `CANCELLED` | خطأ نمط Regex في فحص الانتظار وليس تعطل CHR |
| `task-1357` | خروج `0` مع مهلة مؤقتة لـ `192.168.56.2` أثناء لحظة إقلاع CHR الوسطى | `CANCELLED` | سباق زمني عابر أثناء الإقلاع؛ بعد ثوانٍ عند `uptime 1m21s` حقّقت CHR `200` والحاوية `R - RUNNING` (`PASS`) |
| `task-1367` | سقوط `13` من `100` طلب على `CHR BusyBox httpd` (`200: 87, ERR: 13`) مقابل نجاح جميع الدوال إلى `n=100` | `FAIL` | اختناق حقيقي في `BusyBox httpd` أحادي العملية على معالج واحد؛ أُثبت السبب الجذري واستُبدل إنتاجياً بالاستضافة الساكنة على LAN (`RB-034`: `100/100 PASS`) |
| `task-1436` | إخفاق المحاولة الأولى لاختبار القبول البارد: لوحة Win10 باللغة العربية `ع` حوّلت `cmd` إلى `ؤةي` داخل Edge وفشل `WAN_ON` عند ثانية `6s` قبل تجديد DHCP | `FAIL` | ضبط التبديل إلى `ENG` (`LeftWin+Space`) وانتظار تجديد `ether1` (`~8–10s`) فأكملت المحاولة الثانية `task-1461` جميع الفحوص (`PASS`) |
| `verify_system.mjs` | اجتياز جميع الفحوص الساكنة (`ALL SYSTEM VERIFICATIONS PASSED`) وتجاوز قسم PostgreSQL لعدم توفر خادم محلي شغّال حالياً | `PASS` (ساكن) / `NOT TESTED` (PG محلي الآن) | فحوص PG 17 (`UP/DOWN/UP` والـ 8 RPCs) اجتازت فعلياً في المرحلة 1 + على `Rawad Test` الحية في `RB-038` |

---

## 6. التحقق التكميلي من الواجهة والمحاكاة واختبار `Fail-Closed` الحي (`RB-031`, `RB-033`)

- **تحسين توقيع لوحة الإدارة (`RB-031` — `PASS`):**
  - تعديل `.powered-by` و`.powered-by:hover` في [admin/style.css](admin/style.css#L205-L220) إلى `#94a3b8`، بحجم `10.5px`، `font-weight: 500`، شفافية `0.78`، و`background: transparent; border: none; padding: 0`.
  - مزامنة الملف إلى حاوية CHR (`/admin-www/style.css` -> `HTTP 200`, `23015 bytes`).
  - التحقق البصري والبرمجي عبر `chrome-devtools-mcp` على `http://192.168.56.2:8088/` (`Desktop 1440×900` و`Mobile 390×844`): القيم المحسوبة مطابقة (`rgb(148, 163, 184)`, `10.5px`, `500`, `0.78`, `rgba(0, 0, 0, 0)`, `none`)، `overflow = false`، `0` أخطاء أو تحذيرات Console.
- **اختبار `Fail-Closed` المباشر والتحقق التكميلي على `RAWAD-WIN10-CLIENT` + `Rawad-CHR-Lab` (`RB-033` — `PASS`):**
  - تفريغ جلسات HotSpot الفعّالة وقائمة `rawad-verified` ثم محاولة عميل Win10 (`192.168.88.250`, MAC `08:00:27:44:DC:6B`) تمرير `http://192.168.88.1/login?username=rawad-gate&password=rawad-gate` مباشرة دون تفويض مسبق من `portal-auth`.
  - **النتيجة المرصودة (`win10-rb033-failclosed.png`):** طبع الطرفي `GATE_HTTP=200 FC_INET=000` (عُرضت صفحة/إعادة توجيه البوابة فقط وظل الإنترنت محجوباً `000` بمبدإ Fail-Closed)، وبقيت قائمة `rawad-verified` فارغة تماماً على CHR.
  - تأكيد عمل بنية المختبر: إيجار DHCP `192.168.88.250` مرتبط بـ `08:00:27:44:DC:6B`، DNS `allow-remote-requests: yes` (`1.1.1.1, 8.8.8.8`, `cache-used: 62KiB`)، وقاعدة NAT `masquerade` فعّالة (`437` حزمة).

---

## 7. تشخيص `BusyBox httpd` عند `n=100` وقياس الاستضافة المحلية الساكنة على LAN (`RB-034`)

- **تشخيص العطل في `CHR BusyBox httpd` (`http://192.168.56.2:8088/`, `n=100`, مهلة `15s`) — `FAIL` (للحمل 100):**
  - `63` استجابة `HTTP 200`، مقابل **`26` خطأ اتصال مُعاد ضبطه (`ERR:23` — `ECONNRESET`/`WSAECONNRESET`)** و**`11` انتهاء مهلة اتصال (`ERR:UND_ERR_CONNECT_TIMEOUT`)**.
  - الزمن الإجمالي: `15021ms` (`6.7 rps`, `p50=10477ms`, `p95=15003ms`, `max=15004ms`).
  - **السبب الجذري:** خادم `BusyBox httpd` داخل الحاوية أحادي العملية بطابور `listen backlog` محدود على معالج واحد، فتُسقِط نواة الشبكة اتصالات TCP المتدفقة متزامنةً عند `n=100`.
- **قياس البديل المعتمد للإنتاج: استضافة ساكنة داخلية على LAN الشركة (`admin/`) مع دوال Supabase (`scratch/rb034_load_results.json`) — `PASS` (`100%` عبر جميع المستويات):**

| التزامن (`n`) | `LAN Admin index.html` | `LAN Assets Burst` | `Edge portal-auth GET` | `Edge verify-mac?action=revoked` | ذاكرة خادم LAN (`RSS`) |
| :---: | :--- | :--- | :--- | :--- | :---: |
| **10** | `200: 10` \| `31ms` \| `322.6 rps` \| `p50=26ms` \| `max=29ms` | `200: 10` \| `8ms` \| `1250 rps` \| `max=7ms` | `200: 10` \| `2309ms` \| `4.3 rps` \| `p50=1095ms` \| `max=2302ms` | `200: 10` \| `1053ms` \| `9.5 rps` \| `p50=910ms` \| `max=1053ms` | `80.5 MB` |
| **25** | `200: 25` \| `28ms` \| `892.9 rps` \| `p50=22ms` \| `max=26ms` | `200: 25` \| `12ms` \| `2083.3 rps` \| `max=11ms` | `200: 25` \| `1870ms` \| `13.4 rps` \| `p50=912ms` \| `max=1869ms` | `200: 25` \| `976ms` \| `25.6 rps` \| `p50=834ms` \| `max=976ms` | `88.7 MB` |
| **40** | `200: 40` \| `32ms` \| `1250 rps` \| `p50=24ms` \| `max=30ms` | `200: 40` \| `18ms` \| `2222.2 rps` \| `max=15ms` | `200: 40` \| `1109ms` \| `36.1 rps` \| `p50=837ms` \| `max=1104ms` | `200: 40` \| `1156ms` \| `34.6 rps` \| `p50=411ms` \| `max=1155ms` | `90.6 MB` |
| **60** | `200: 60` \| `35ms` \| `1714.3 rps` \| `p50=29ms` \| `max=32ms` | `200: 60` \| `24ms` \| `2500 rps` \| `max=21ms` | `200: 60` \| `1061ms` \| `56.6 rps` \| `p50=500ms` \| `max=1054ms` | `200: 60` \| `980ms` \| `61.2 rps` \| `p50=425ms` \| `max=976ms` | `99.1 MB` |
| **100** | **`200: 100` \| `63ms` \| `1587.3 rps` \| `p50=50ms` \| `p95=56ms` \| `max=59ms`** | **`200: 100` \| `34ms` \| `2941.2 rps` \| `p50=23ms` \| `max=31ms`** | **`200: 100` \| `1090ms` \| `91.7 rps` \| `p50=656ms` \| `max=1079ms`** | **`200: 100` \| `1080ms` \| `92.6 rps` \| `p50=525ms` \| `max=1075ms`** | `119.8 MB` |

---

## 8. تدقيق الأمان وقاعدة بيانات `Rawad Test` والمخزون الثابت (`RB-037`, `RB-038`)

- **تدقيق `Rawad Test` (`efqsmehqnhuzohzjztni`):**
  - **تفعيل RLS على الجداول الخمسة:** `admins`, `free_quotas`, `portal_settings`, `sessions`, `users` جميعها `relrowsecurity = true`.
  - **منع الوصول المباشر:** مصفوفة `ANON_AUTH_GRANTS = []`، وصفر صلاحيات تنفيذ للدوال أمام `PUBLIC` و`anon` و`authenticated`؛ ومحاولة استدعاء `get_cleanup_summary()` مباشرة عبر اتصال SQL قرائي رُفضت برمز `42501 permission denied`. كما أعادت نقاط `/rest/v1/*` الخمس رمز **`HTTP 401`** لمفتاح `anon`.
  - **الدوال المخزنة (`pg_proc`) وتتبع Migrations (`RB-042`):** وجود جميع الدوال الثماني المطلوبة في المخطط. وبفحص `pg_namespace` و`npx supabase migration list --linked` على `Rawad Test`، تبين غياب مخطط `supabase_migrations` وظهور الثلاثة ترحيلات محلياً فقط (`202611180001`, `202611180002`, `202611190001`, `remote=""`) لأن المخطط والترحيل طُبّقا مباشرة عبر CLI/`psql` وليس عبر `supabase db push`. وعند اختبار `npx supabase migration repair --status applied ... --linked` أوقف CLI التنفيذ بالحماية الآمنة (`HostedMutationConsentRequiredError` مطالباً بموافقة صريحة). **الطريقة الآمنة المعتمدة لمزامنة السجل دون إعادة تطبيق DDL أو حذف بيانات (بعد نسخة PG 17 ثلاثية):** تشغيل `npx supabase migration repair --status applied 202611180001 202611180002 202611190001 --remote` تفاعلياً ثم التحقق عبر `npx supabase migration list --remote` و`npx supabase db push --dry-run`.
  - **سلامة البيانات المحمية:** `admins = 2` (`hashim:site_owner`, `testo:general`)، `users = 2` (`test`, `hashim`)، وعدد الصفوف الاصطناعية المتبقية `{tmp_admins: 0, tmp_users: 0, tmp_quotas: 0, tmp_sessions: 0}`.
- **مخزون القيم الثابتة التي تستلزم الاستبدال/المراجعة قبل الإنتاج (بدون أسرار):**
  1. عنوان المشروع ومفتاح `anon` العام لبيئة الاختبار `efqsmehqnhuzohzjztni.supabase.co` داخل [admin/index.html](admin/index.html)، [hotspot/login.html](hotspot/login.html)، و[hotspot/status.html](hotspot/status.html).
  2. معرف UUID الثابت `'39c0a9e8-028d-4c04-a0e3-e46e21cef7d9'` في [supabase/functions/admin-api/index.ts](supabase/functions/admin-api/index.ts#L160) لحماية `site_owner` الأول (مدعوم ديناميكياً في السطر `170` بشرط `is_super_admin || role === 'site_owner'`).
  3. في الإنتاج، يجب حفظ متغيرات `ROUTER_SHARED_SECRET`، `ADMIN_TOKEN_SECRET`، و`SUPABASE_SERVICE_ROLE_KEY` كـ Edge Secrets منفصلة تماماً عن `Rawad Test`.

---

## 9. مصفوفة القبول النهائية ذات الـ 20 بنداً (`RB-039`) — التصنيف الموحّد الصارم

| # | البند | البيئة | التصنيف النهائي | الدليل والملاحظة المختصرة |
| :---: | :--- | :--- | :---: | :--- |
| 1 | واجهة بوابة العميل `portal_settings` + `login.html` / `status.html` | Edge + Win10 Lab | `PASS` | تحميل فوري في Edge للشعار والنص والتنسيق دون تحديث ميتا |
| 2 | الحصة المجانية `ALLOW:<sec>` وسياسة اليوم الحالي (`Asia/Baghdad`) | Edge + Win10 Lab | `PASS` | `29m48s` في `rawad-verified`، ورفض المحاولة بعد الاستنفاد بـ `403` |
| 3 | الحساب المحدود ونقل الجلسة بين عناوين `MAC` | Edge + Win10 Lab | `PASS` | `59m44s` في `rawad-verified` وسحب `MAC1` فور دخول `MAC2` |
| 4 | الحساب المفتوح `ALLOW:UNLIMITED` دون `timeout=` | Edge + Win10 Lab | `PASS` | إدراج `dynamic=no` بلا مؤقت وعرض `غير محدود` في `status.html` |
| 5 | السحب التلقائي بعد التعطيل/الحذف وإقرار `ACK` | Edge + CHR `15s` | `PASS` | إزالة `08:00:27:44:DC:6B` وإفراغ القائمة خلال `≤18s` وتسجيل `ACK` |
| 6 | اختبار `Fail-Closed` حي دون تفويض `portal-auth` | Win10 + CHR Lab | `PASS` | `win10-rb033-failclosed.png`: `GATE_HTTP=200 FC_INET=000` و`rawad-verified` فارغة |
| 7 | عزل جدار الحماية للضيوف وحجب الشبكات الداخلية وWAN `8088` | CHR Lab + Win10 | `PASS` | حظر `10.10.10.1` (`60B` input) و`10.10.20.5` (`60B` forward) و`WAN->8088` |
| 8 | استقرار DHCP / DNS / NAT والإقلاع البارد وإعادة تشغيل CHR | VirtualBox Lab | `PASS` | إقلاع بارد، تجديد DHCP `192.168.88.250`، عودة HotSpot والمجدول والحاوية `R` |
| 9 | استعادة أعطال قطع WAN وقطع شبكة العميل | VirtualBox Lab | `PASS` | فشل أثناء القطع وعودة `CHR_WAN_NOW=200` بعد `~8–10s` و`NIC_ON=200` |
| 10 | لوحة الإدارة: RBAC + تحسين `.powered-by` + التجاوب | Chrome + CHR Lab | `PASS` | `#94a3b8`, `10.5px`, `0.78`, `transparent`, `overflow=false`, `0` أخطاء Console |
| 11 | تحمّل دوال Supabase الثلاث حتى `n=100` طلب متزامن | Supabase Edge | `PASS` | `100/100 HTTP 200` (`portal-auth 91.7 rps`, `verify-mac 92.6 rps`, `0` أخطاء) |
| 12 | استضافة لوحة الإدارة عبر `CHR BusyBox httpd` عند `n=100` | `192.168.56.2:8088` | **`FAIL`** | `63/100 200` (`26 ECONNRESET`, `11 timeout`) وقبلها `87/100 200`؛ غير معتمدة للذروة |
| 13 | بديل الاستضافة المحلية الساكنة على LAN الشركة (`10–100`) | خادم LAN محلي | `PASS` | `100/100 HTTP 200` عبر المستويات الخمسة (`1587.3 rps`, `max=59ms` عند `n=100`) |
| 14 | قفل RLS وصلاحيات `anon`/`authenticated` و`RBAC` وتوقيع `HMAC` | `Rawad Test` | `PASS` | RLS `true` على الجداول الـ5، REST `401`، و`get_cleanup_summary` `42501` قرائياً |
| 15 | سلامة مخطط `Rawad Test` والـ 8 RPCs ونظافة الأساس | `Rawad Test` | `PASS` | `admins=2` (`hashim`, `testo`), `users=2` (`test`, `hashim`), `0` صفوف مؤقتة |
| 16 | فحص الانحدار الساكن `verify_system.mjs` ومسح الأسرار عبر Git | المستودع المحلي | `PASS` | اجتياز الفحص الساكن + صفر تسريب أسرار في الملفات المتتبعة |
| 17 | تدقيق السجلات السابقة المنقطعة (`RB-032`: مهلة/إلغاء/انقطاع `stdin`) | سجل الأتمتة | `CANCELLED` | سُجّلت بشفافية (`1079, 1141, 1290, 1335, 1350, 1357`) واستُبدلت بتشغيلات ناجحة |
| 18 | اختبارات PostgreSQL 17 داخل آخر تشغيل لـ `verify_system.mjs` | جهاز المطور | **`NOT TESTED`** (في آخر تشغيل) | طُبعت `SKIPPED: No local PostgreSQL test instance available` حالياً (أُنجزت في المرحلة 1 + `Rawad Test`) |
| 19 | تشغيل حاوية `BusyBox` على معمارية **`RB4011 ARM32 / ARMv5`** | غير متاح | **`BLOCKED`** | محظور لغياب Hyper-V/QEMU `ARM32` محلياً وبسبب قيود `512MB NAND`/`ARM32` |
| 20 | النشر الحصري على منفذ **`ether10`** في **RB4011 الإنتاجي الحقيقي** وسلامة **`ether1–ether9`** | عتاد الشركة الحقيقي | **`BLOCKED` / `NOT TESTED`** | لم يُلمس الراوتر الإنتاجي إطلاقاً؛ يُمنع النشر (`BLOCKED`) حتى مراجعة `/export` (IPv4+IPv6 DNS 53 و`place-before=0`) وتنفيذ اختبارات `ether1–ether9` وفق القسم `F` |

---

## 10. اختبار الأحمال الشامل للمسار الكامل (`RB-043` — Full-System E2E Load Test)

أُجري عبر السكربت الآلي `run_full_e2e_load.mjs` ضد مشروع `Rawad Test` لتمييز سعة كل طبقة على حدة وعدم الخلط بين استضافة الملفات الثابتة وقدرة المسار الكامل للمستخدمين:

### أ. جدول التمييز الصارم بين طبقات الاختبار الأربعة
| الطبقة المختبرة | ما تقيسه فعلياً | نتيجة ذروة `n=100` (أو الحد المقاس) | التصنيف |
| :--- | :--- | :--- | :---: |
| **1. خادم HTTP لملفات لوحة الإدارة (`admin/`)** | تقديم HTML/CSS/JS/الخطوط الثابتة فقط (دون منطق دخول أو DB) | `CHR BusyBox httpd`: **`FAIL`** (`63/100 200`, `26 ECONNRESET`, `11 timeout`)<br>خادم LAN الساكن المحلي: **`PASS`** (`100/100 200`, `1587.3 rps`, `max=59ms`) | `FAIL` (BusyBox) / `PASS` (LAN) |
| **2. استدعاء دوال Edge المفردة (`RB-034`)** | كل دالة بمفردها على التوازي (`portal-auth GET`, `verify-mac?action=revoked`) | `100/100 HTTP 200` (`portal-auth`: `91.7 rps`, `max=1079ms`؛ `verify-mac`: `92.6 rps`, `max=1075ms`) | `PASS` |
| **3. تدفق E2E الكامل المحاكى (`RB-043`)** | دورة المستخدم المتسلسلة الكاملة (`GET portal-auth` -> `POST free/login` -> `GET verify-mac` -> `POST session_status` -> `POST logout` -> `verify-mac?action=revoked` + دفعات `ACK` كل 10) | **حصة مجانية حتى `n=100`:** `100/100 E2E OK` (`32.93 rps`, `p50=2220ms`, `p95=2757ms`, `max=3033ms`) + `100/100 ACK` (`3846ms`)<br>**حساب مشترك بـ `PBKDF2` (`n=25`):** `25/25 E2E OK` (`8.86 rps`, `p50=2173ms`, `max=2820ms`) + `25/25 ACK` (`1449ms`) | `PASS` (في المختبر السحابي) |
| **4. عتاد `RB4011` الحقيقي (`/tool fetch` متزامن + Wi-Fi + DHCP/NAT)** | قدرة معالج `ARM32` والاتصالات الصادرة من RouterOS وعملاء Wi-Fi الفعليين عند `100` مستخدم متزامن | لم تُقَس على عتاد شركة رواد بعد | **`NOT TESTED`** (يتطلب قياساً ميدانياً) |

### ب. نتائج المستويات المتدرجة في التدفق الكامل (`rb_e2e_load_results.json` — التشغيل المعزول `task-1670`)

| التزامن (`n`) | نجاح المسار الكامل (5 خطوات) | إجمالي الزمن / الإنتاجية | `p50` | `p95` | `max` | مزامنة السحب + دفعات `ACK` (كل 10) |
| :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **10** (مجاني E2E) | **`10/10`** | `2556ms` \| `3.91 rps` | `2205ms` | `2555ms` | `2555ms` | `10/10` (`1` دفعة، `715ms`, `ok=true`) |
| **25** (مجاني E2E) | **`25/25`** | `2623ms` \| `9.53 rps` | `2057ms` | `2553ms` | `2617ms` | `25/25` (`3` دفعات، `1532ms`, `ok=true`) |
| **40** (مجاني E2E) | **`40/40`** | `2920ms` \| `13.7 rps` | `1989ms` | `2550ms` | `2914ms` | `40/40` (`4` دفعات، `1788ms`, `ok=true`) |
| **60** (مجاني E2E) | **`60/60`** | `2716ms` \| `22.09 rps` | `2277ms` | `2675ms` | `2707ms` | `60/60` (`6` دفعات، `2446ms`, `ok=true`) |
| **100** (مجاني E2E) | **`100/100`** (`0` أخطاء) | `3037ms` \| `32.93 rps` | `2220ms` | `2757ms` | `3033ms` | **`100/100`** (`10` دفعات، `3846ms`, `ok=true`) |
| **25** (`PBKDF2 Login E2E`) | **`25/25`** (`0` أخطاء) | `2821ms` \| `8.86 rps` | `2173ms` | `2707ms` | `2820ms` | **`25/25`** (`3` دفعات، `1449ms`, `ok=true`) |

- **تفصيل الخطوات الخمس عند `n=100` (مجاني E2E):** `step1_portalSettingsGet` (`100/100`, `p50=560ms`, `max=1162ms`), `step2_freeQuotaAuth` (`100/100`, `p50=386ms`, `max=907ms`), `step3_verifyMac` (`100/100`, `p50=374ms`, `max=840ms`), `step4_sessionStatus` (`100/100`, `p50=366ms`, `max=987ms`), `step5_logout` (`100/100`, `p50=362ms`, `max=946ms`).
- **ملاحظة التنافس المرصودة (`task-1647`, `task-1660`):** عند تشغيل `run_full_e2e_load.mjs` بالتوازي مع بقاء مجدول `rawad-sync-revocations` (كل `15s`) نشطاً على `Rawad-CHR-Lab` ضد نفس قاعدة `Rawad Test`، استبق المجدول وأرسل `ACK` لأقدم 10 جلسات فظهر `30/40` في الأولى و`ACK:0` في الدفعة #0 (`50/60`) في الثانية؛ وبعد إيقاف المجدول مؤقتاً أثناء `task-1670` (وإعادة تفعيله في `finally`) اجتازت جميع الدفعات **`100%`** — ما يثبت وجوب تخصيص مشروع Supabase مستقل لكل راوتر إنتاجي دون مشاركة نفس `ROUTER_SHARED_SECRET`.
- **التحقق بعد التنظيف:** استُعيد الأساس نظيفاً (`admins=2`, `users=2`, `rem_quotas=0`, `rem_sessions=0`, `rem_users=0`).

---

## 11. توضيح النطاق، اختبار سعة المصادقة (`10–500`)، تحسين التوسع، والتنظيف الآمن (`RB-045` — `RB-050`)

### أ. تصحيح نطاق المشروع الرسمي (`Scope Clarification`)
يقتصر **Rawad Captive Portal** على وظائف المصادقة والصلاحيات وإدارة الجلسات (`Portal Login`, `MAC Verification`, `Free/Limited/Unlimited Accounts`, `Session Status`, `Revocation/ACK Sync`, و`Admin RBAC UI`). جميع مهام قياس سرعة الإنترنت أو توزيع/تقييد `Bandwidth` أو `DPI`/البث تقع **خارج نطاق المشروع** ولم يُضَف لها أي كود أو اختبار.

### ب. تحسينات التوسع والاستقرار المُنفّذة والمُتحقق منها (`RB-046`)
1. **إعادة استخدام عميل Supabase في Edge Functions:** إنشاء دالة `getDb()` كـ singleton على مستوى العقدة المعزولة (isolate) داخل [supabase/functions/portal-auth/index.ts](supabase/functions/portal-auth/index.ts)، [supabase/functions/verify-mac/index.ts](supabase/functions/verify-mac/index.ts)، و[supabase/functions/admin-api/index.ts](supabase/functions/admin-api/index.ts) ونشرها على `Rawad Test` (`efqsmehqnhuzohzjztni`).
2. **فهارس جزئية في [supabase/schema.sql](supabase/schema.sql):** إضافة وتطبيق `idx_sessions_pending_revocations` (لتسريع `get_revoked_sessions`) و`idx_sessions_active_expires` (لتسريع كشف انتهاء الجلسات النشطة) مع تأكيد ظهورهما في `pg_indexes` على `Rawad Test`.

### ج. نتائج اختبار سعة المصادقة وإدارة الجلسات (`RB-045`: `10` حتى `500` متزامن — `rb045_capacity_results.json`)

قيس التدفق المتكامل لكل مستخدم متزامن (`POST free` -> `GET verify-mac` -> `POST session_status` -> `POST logout` -> `GET verify-mac?action=revoked` + دفعات `ACK` كل 10) في `Rawad Test` مع مجدول CHR متوقفاً مؤقتاً ثم مُعاد تفعيله في `finally`:

| التزامن (`n`) | النجاح / الفشل | `RPS` | `P50` | `P95` | `P99` | `max` | إجمالي الزمن | مزامنة السحب + `ACK` | `Runner RSS` / `CHR CPU` |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- | :---: |
| **10** | **`10/10`** (`0` فشل) | `2.35` | `3293ms` | `4242ms` | `4242ms` | `4242ms` | `4262ms` | `10/10` (`1` دفعة، `1291ms`, `ok=true`) | `76.6 MB` / `0%` |
| **25** | **`25/25`** (`0` فشل) | `7.27` | `2515ms` | `3236ms` | `3438ms` | `3438ms` | `3439ms` | `25/25` (`3` دفعات، `1510ms`, `ok=true`) | `82.1 MB` / `0%` |
| **40** | **`40/40`** (`0` فشل) | `10.99` | `2654ms` | `3208ms` | `3637ms` | `3637ms` | `3640ms` | `40/40` (`4` دفعات، `1811ms`, `ok=true`) | `91.8 MB` / `0%` |
| **60** | **`60/60`** (`0` فشل) | `22.04` | `2086ms` | `2668ms` | `2718ms` | `2718ms` | `2722ms` | `60/60` (`6` دفعات، `2507ms`, `ok=true`) | `105.4 MB` / `0%` |
| **100** | **`100/100`** (`0` فشل) | `36.79` | `2118ms` | `2640ms` | `2707ms` | `2714ms` | `2718ms` | `100/100` (`10` دفعات، `7289ms`, `ok=true`) | `125.0 MB` / `0%` |
| **150** | **`150/150`** (`0` فشل) | `38.97` | `2509ms` | `3083ms` | `3200ms` | `3847ms` | `3849ms` | `150/150` (`15` دفعة، `6968ms`, `ok=true`) | `141.9 MB` / `0%` |
| **200** | **`200/200`** (`0` فشل) | `50.10` | `2893ms` | `3427ms` | `3782ms` | `3986ms` | `3992ms` | `200/200` (`20` دفعة، `7983ms`, `ok=true`) | `158.0 MB` / `0%` |
| **300** | **`300/300`** (`0` فشل) | **`57.58`** | `4321ms` | `4765ms` | `4917ms` | `5204ms` | `5210ms` | **`300/300`** (`30` دفعة، `11887ms`, `ok=true`) | `82.4 MB` / `0%` |
| **500** | **`191/500`** (`309` فشل) | `49.28` | `10106ms` | `10125ms` | `10126ms` | `10128ms` | `10145ms` | `191/191` (`20` دفعة، `10190ms`, `ok=true`) | `175.8 MB` / `0%` |

- **أقصى مستوى اجتاز 100% فعلياً:** **`300` مستخدم متزامن** (`300/300` بصفر أخطاء، ارتفاع الإنتاجية إلى `57.58 rps`؛ كما تحسن أداء `n=100` بعد `RB-046` من `32.93 rps`/`3033ms max` إلى `36.79 rps`/`2714ms max`).
- **تحليل نقطة الاختناق عند `500` متزامن (`Fail-Closed` سليم):** جميع الـ `309` إخفاقات وقعت في الخطوة الأولى `step_freeAuth` خطأ شبكة `TypeError` عند `~10,106–10,128ms` (مهلة فتح `connectTimeout` الافتراضية البالغة 10 ثوانٍ عند فتح 500 اتصال TLS متزامن من نفس المصدر نحو بوابة Edge/Cloudflare). وبفضل منطق Fail-Closed لم تُنشأ أي جلسة جزئية أو مكسورة (`revAck=191/191`, `rem_sessions=0`).
- **اختبارات الحالات الحدّية والتسابق (`PASS`):**
  1. **تكرار الطلبات المتزامنة (20 طلب `free` في لحظة واحدة لنفس `MAC`):** `20/20 HTTP 200`، وبفحص SQL بقيت **جلسة نشطة واحدة بالضبط (`1`)** وسجل حصة واحد (`1`) بفضل القفل الاستشاري والفهرس الفريد `idx_sessions_one_active_mac`.
  2. **الحساب المنتهي والحصة المستنفدة:** رجعا **`HTTP 403`** في `portal-auth` و**`403 DENY:not_authorized`** في `verify-mac`.
  3. **حراس المصادقة:** `MAC` غير مسجل `403 DENY:not_authorized`، وسر خاطئ `401 DENY:unauthorized`.

### د. مراجعة استهلاك موارد MikroTik (`RB-047`)
- **قياسات `Rawad-CHR-Lab` (`x86_64`، `7.25.1`):** الذاكرة الحرة بقيت `267.8–268.4 MiB / 512.0 MiB` (`uptime 1h38m45s`, `cpu-load: 0%`), إجمالي قواعد `filter = 25` و`nat = 21`, حاوية BusyBox الاختبارية (`1300.0 KiB`)، والمجدول `rawad-sync-revocations` (بفاصل `15s` بالمختبر و`30s` في `deploy.rsc` عبر دفعات `ACK` حجم 10).
- **السقوف المعمارية في [routeros/deploy.rsc](routeros/deploy.rsc) لـ `ether10` فقط:** مجمع DHCP `192.168.20.10-192.168.20.250` (`241` عنواناً كحد أقصى للشبكة `/24`)، `shared-users=250`، 7 قواعد IPv4 + 2 IPv6 + قاعدة NAT واحدة، دون استضافة لوحة الإدارة على الراوتر الإنتاجي (`0` أثر على `512 MiB NAND`).
- **تنويه صريح:** أقصى عدد جلسات HotSpot متزامنة ومعدل `/tool fetch` على **`MikroTik RB4011 ARM32`** الحقيقي يبقى **`NOT TESTED`** دون اختبار ميداني على العتاد الفعلي.

### هـ. جرد التنظيف الآمن والتنظيم (`RB-048`, `RB-049`) — `45` ملفاً متتبعاً في Git
- **`KEEP` (`44` ملفاً أساسياً):** [README.md](README.md), [TASKS.md](TASKS.md), [PROGRESS.md](PROGRESS.md), [TEST-REPORT.md](TEST-REPORT.md), [PRODUCTION-READINESS.md](PRODUCTION-READINESS.md), [RB4011-COMPATIBILITY.md](RB4011-COMPATIBILITY.md), [LAB-SETUP.md](LAB-SETUP.md), [ROLLBACK.md](ROLLBACK.md), [DEPLOYMENT.md](DEPLOYMENT.md), [.gitignore](.gitignore), [.github/workflows/system-test.yml](.github/workflows/system-test.yml), ملفات `admin/` (6 ملفات), ملفات `hotspot/` (11 ملفاً), ملفات `routeros/` (4 ملفات), ملفات `supabase/` المتتبعة (11 ملفاً تشمل `schema.sql`, `config.toml`, `.gitignore`, 4 ملفات Functions, 3 ملفات Migrations, و1 ملف Rollback), و[tests/verify_system.mjs](tests/verify_system.mjs).
- **`ARCHIVE` (`1` ملف):** نقل `FIELD_TEST.md` القديم (الذي كان يشير إلى `postgres:16`) عبر `git mv` إلى [docs/archive/FIELD_TEST.md](docs/archive/FIELD_TEST.md) مع `0` مراجع مكسورة (`git grep -n "FIELD_TEST"`).
- **`DELETE` (`0` ملفات داخل المستودع):** لم يتطلب حذف أي ملف متتبع لأن جميع مخرجات الاختبار واللقطات معزولة خارج المستودع في مجلد `scratch/`، ولا توجد مجلدات فارغة (`0`). (مجلد `supabase/.temp/` متجاهل محلياً عبر `supabase/.gitignore` ولا يُرفع إلى Git).

### و. اختبارات الانحدار بعد التنظيف والتحسين (`RB-050`)
- **`node tests/verify_system.mjs`:** `ALL SYSTEM VERIFICATIONS PASSED` (تخطّى قسم PG المحلي صراحةً `SKIPPED: No local PostgreSQL test instance available`).
- **`run_stage5_tests.mjs` (ضد `Rawad Test` المحدّث):** **`7/7 PASS`** (`RB-017/A` الأدوار الثلاثة، `RB-018/RLS` قفل `401`، `RB-018/ROLES` صلاحيات ومنع `site_owner`، `RB-017/PS` تنقية ورفض `400`، `RB-016/FREE`، `RB-016/LIM`، `RB-016/UNLIM` + `ACK:3`).
- **فحص لوحة الإدارة الحية (`http://192.168.56.2:8088/`):** جميع الأصول الستة (`/`, `/style.css`, `/admin.js`, `/assets/logo.png`, خطا Cairo) عادت `HTTP 200` (`28520`, `23015`, `32382`, `122435`, `30712`, `33644` بايت).
- **فحص HotSpot CHR، Workflow، الأسرار، وDB:** خادم `hotspot1` وملفات `hotspot/` سليمة على CHR، ملف [.github/workflows/system-test.yml](.github/workflows/system-test.yml) سليم، فحص الأسرار أعاد `GREP_EXIT=1` (`0` تسريب)، وقاعدة `Rawad Test` نظيفة (`admins=2: hashim:site_owner, testo:general`, `users=2: hashim, test`, `rem_test_sessions=0`).
