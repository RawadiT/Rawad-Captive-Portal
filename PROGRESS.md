# PROGRESS.md — Rawad Captive Portal

**Branch:** `field-test-preparation`  
**Status:** Strict HTTP 200 Fetch Validation Complete; Verified in GitHub Actions PG 16

## Changes Completed
- **`routeros/deploy.rsc`:** Replaced `[:typeof (...->"code")] = "nothing" || ...` with strict `[:typeof [:tonum (...->"code")]] = "num" && [:tonum (...->"code")] = 200` on all 4 `/tool fetch` paths.
- **`tests/verify_system.mjs`:** Updated `parseAck()` to reject missing `code`, `code: null`, non-200 HTTP codes, `status != 'finished'`, and malformed/out-of-range ACK counts, and verified all 4 fetch paths in `deploy.rsc`.

## Not Tested Locally
- Live MikroTik RB4011 (`ether10`) & Live Supabase Deno Edge Function deployment (`NOT PERFORMED`).


## Admin Dashboard Update — 2026-11-18
- Added a three-tier role model: immutable `site_owner`, `general`, and `subordinate`.
- The site owner alone can create, edit, promote/demote, and delete subordinate/general manager accounts. The fixed site-owner account ID is protected by the API.
- All admin roles can list, create, disable, and permanently delete internet accounts. Only site owner/general managers can edit internet-account details and view free-quota records.
- Added manager role selection to the UI, role-aware navigation/actions, the existing company logo, ambient background motion, button transitions, and success/error feedback.
- Backend migration and end-to-end role regression tests are pending application to the Rawad Test project. No production deployment or MikroTik changes performed.


## Isolated CHR + Rawad Test integration — 2026-11-18

- Confirmed the user has an existing Rawad Test Supabase project available.
- Reviewed the current admin API, schema, portal files, and RouterOS deployment scripts on `field-test-preparation`.
- Identified a functional gap: current admin API writes internet accounts to Supabase tables and revokes database sessions, but does not itself create/update/delete the corresponding MikroTik User Manager users. A database delete therefore cannot yet be treated as a verified router-side delete.
- The existing `routeros/deploy.rsc` is scoped to production `ether10` / `192.168.20.0/24`; it is not suitable for the isolated CHR lab (`bridge` / `192.168.88.0/24`) and must not be executed there unchanged.
- No Supabase deployment, RouterOS configuration change, file upload to CHR, or production change has been performed in this step.
- Next: configure and deploy against Rawad Test using local environment credentials, then implement and verify the CHR-specific integration before declaring CRUD operations complete.

## Phase 1 Database Migration & Verification — 2026-11-19
- Downloaded PostgreSQL 17.9 Windows x64 portable binaries into `scratch/pg17/` (no Windows install/service/system PATH modification; local PG 16 untouched).
- Captured official 3-file PG 17 backup (`backup_roles.sql`, `backup_schema.sql`, `backup_data.sql` + `backup_schema_full.sql`) from `Rawad Test` (`efqsmehqnhuzohzjztni`, PG 17.12) via Session Pooler + `pgpass.conf`, and verified restore (`admins=2`, `users=1`, `free_quotas=2`, `sessions=10`) into ephemeral local PG 17 (`127.0.0.1:55432`, documenting `SET (pg_attver=...)` and cluster-role notes for vanilla PG 17).
- Added `supabase/migrations/202611190001_portal_settings_and_unlimited.sql`, external `supabase/rollbacks/202611190001_portal_settings_and_unlimited.down.sql`, and synced `supabase/schema.sql`.
- Verified migration UP -> rollback DOWN (`true|0|NO`) -> re-UP -> `tests/verify_system.mjs` (`POSTGRESQL 17 SCHEMA & EDGE-FUNCTION RPC TESTS PASSED`) on local PG 17.
- Applied migration to `Rawad Test` (`efqsmehqnhuzohzjztni`) and verified `admins` (`hashim`, `testo`), existing `users` (`1`), `portal_settings` UTF-8 Arabic default row, and `get_cleanup_summary()` read-only output.

## Phase 2 Edge Functions Deployment & Live HTTP Verification — 2026-11-19
- Added signed domain-separated `portal_status` tokens in `supabase/functions/_shared/crypto.ts`.
- Extended `supabase/functions/admin-api/index.ts` for unlimited accounts (`is_unlimited`), `GET/PUT /portal-settings` (`site_owner` & `general`, rejecting `javascript:`/`data:` schemes and invalid phones), and `GET /cleanup/summary` + `POST /cleanup/execute` (strictly `site_owner` ONLY, returning HTTP `403` to `general` and `subordinate`).
- Extended `supabase/functions/portal-auth/index.ts` (`GET`/`POST portal_settings`, `session_status` authenticated with HMAC `status_token`, and unlimited user login responses) and `supabase/functions/verify-mac/index.ts` (`ALLOW:UNLIMITED`).
- Deployed all 3 functions to `Rawad Test` (`efqsmehqnhuzohzjztni`) and passed live HTTP tests across role guards, `portal_settings` round-trip, unlimited account login/status/disable revocation, with temporary test accounts cleaned up afterwards.

## Phase 3 Unified Light Daytime Admin Dashboard — 2026-11-19
- Bundled self-contained `admin/assets/logo.png` and `admin/assets/fonts/cairo-{arabic,latin}.woff2` (zero external CDNs).
- Redesigned `admin/index.html`, `admin/style.css`, and `admin/admin.js` in the unified light daytime Captive Portal aesthetic with `Powered BY Hashim Hasanen` footer, unlimited account toggle (`is_unlimited`), `Portal Settings` with live safe preview, and `site_owner`-only `Database Cleanup` panel.
- Verified in Chromium (`chrome-devtools-mcp`) across Desktop (`1440x900`), Tablet (`820x1180`), and Mobile (`390x844`): 0 console errors, all local assets HTTP 200, Cairo RTL active, zero horizontal overflow, live preview & cleanup summary verified, temporary `__tmp_ui_owner` removed afterwards.

## Phase 4 CHR Lab Integration & Unified Customer Portal — 2026-11-19
- Updated `routeros/deploy.rsc` (`on-login` handles `ALLOW:UNLIMITED` without `timeout=` and `ALLOW:<seconds>` with `timeout=`; all 4 strict HTTP 200 fetch checks intact).
- Exported pre-change CHR config backup (`scratch/chr-backup-before-phase4.rsc`), set generated 32-byte hex `ROUTER_SHARED_SECRET` on `Rawad Test`, verified CHR native HTTPS fetch (`code=200`), and applied CHR lab `rawad-verified-prof`, `rawad-sync-revocations` (15s), `hsprof1` (`http-chap,http-pap`), and fail-closed `rawad-lab-block-unverified` rule.
- Updated `hotspot/login.html`, `hotspot/status.html`, `hotspot/assets/portal.js`, and `hotspot/assets/style.css` (removed `<meta http-equiv="refresh">`, added `portal_settings` live branding, `status_token` sessionStorage + `session_status` polling, unlimited status display `الإنترنت متاح دون حد زمني`, validated social/`tel:` channels, and `Powered BY Hashim Hasanen`), uploaded via SCP to `Rawad-CHR-Lab`.
- Executed live E2E verification on `RAWAD-WIN10-CLIENT` (`192.168.88.250`, MAC `08:00:27:44:DC:6B`): verified limited account `timeout=59m54s` and `F5` timer continuity, social/phone rendering, unlimited account (`dynamic=no`, no `timeout=`) + `غير محدود` UI, and automatic CHR disconnect + `revocation_ack_at` acknowledgment after account disable; cleaned temporary test users/sessions and restored default `portal_settings`.

## Phase 5 Isolated Static Admin Container (CHR x86_64 Lab) & Backup Docs — 2026-11-19
- Installed `container-7.25.1.npk` on `Rawad-CHR-Lab` (`x86_64`), enabled `device-mode container=yes` with cold VirtualBox power-cycle, and verified `container: yes`.
- Configured `bridge-admin`/`veth-admin` (`172.18.0.2/24`), uploaded self-contained `admin/` to `/admin-www` mounted `mode=ro,noexec`, configured `memory-high=32.0MiB`, pulled `library/busybox:musl` running `httpd -f -p 8080 -h /www`, and verified staff HTTP `200` on all 6 assets with 0 console errors.
- Verified HotSpot firewall isolation: `rawad-admin-block-guests` (`chain=forward in-interface=bridge dst-address=172.18.0.0/24 action=drop`) blocked authenticated guest traffic from `RAWAD-WIN10-CLIENT` (`9 packets / 468 bytes` dropped).
- Recorded real lab metrics (pre `67.8MiB` HDD / `282.3MiB` free RAM -> post `64.8MiB` HDD / `274.9MiB` free RAM, container RAM `360–460KiB`, CPU `0%`, `write-sect-since-reboot=7696`) and documented in `DEPLOYMENT.md` alongside the official PG 17 3-file manual backup/restore guide and explicit warning that `RB4011 (ARM32/ARMv5)` container hosting remains unverified and not approved for production.


## استعادة الوصول المزدوج للوحة الإدارة في مختبر CHR — 2026-11-20
- **السبب الجذري المُثبت:**
  1. خادم BusyBox `httpd` داخل الحاوية يستمع على `172.18.0.2:8080` وليس `8088`.
  2. قاعدة NAT `rawad-admin-lab-staff` كانت محصورة في `in-interface=ether1 src-address=10.0.2.2` (لتوجيه VirtualBox NAT فقط إلى `127.0.0.1:8088` على Windows 11).
  3. منفذ `ether3` (Adapter 3 Host-Only المضاف حديثاً) لم يكن يحمل عنوان IP في `192.168.56.0/24`، ولم تكن هناك قاعدة NAT له.
  4. جهاز Windows 10 VM (`192.168.88.250`) على `bridge` كان محجوباً عن `172.18.0.0/24` بقاعدة `rawad-admin-block-guests`.
- **أوامر RouterOS المُضافة على `Rawad-CHR-Lab` (دون فتح WAN ودون المساس بـ HotSpot أو الإنتاج):**
  - `/ip address add address=192.168.56.2/24 interface=ether3 comment="rawad-admin-hostonly"`
  - `/ip firewall nat add chain=dstnat in-interface=ether3 src-address=192.168.56.1 dst-address=192.168.56.2 protocol=tcp dst-port=8088 action=dst-nat to-addresses=172.18.0.2 to-ports=8080 comment="rawad-admin-hostonly-staff"`
  - `/ip firewall nat add chain=dstnat in-interface=bridge src-address=192.168.88.250 dst-address=192.168.88.1 protocol=tcp dst-port=8088 action=dst-nat to-addresses=172.18.0.2 to-ports=8080 comment="rawad-admin-win10-lab"`
  - `/ip firewall filter add chain=forward in-interface=bridge src-address=192.168.88.250 dst-address=172.18.0.2 protocol=tcp dst-port=8080 action=accept place-before=0 comment="rawad-admin-allow-win10-lab-out"`
  - `/ip firewall filter add chain=forward in-interface=bridge-admin src-address=172.18.0.2 dst-address=192.168.88.250 protocol=tcp src-port=8080 action=accept place-before=0 comment="rawad-admin-allow-win10-lab-in"`
  - `/ip firewall filter add chain=forward in-interface=ether3 src-address=!192.168.56.1 dst-address=172.18.0.0/24 action=drop comment="rawad-admin-block-hostonly-other"`
- **عناوين الوصول النهائية الثابتة:**
  - **Windows 11 Host:** `http://192.168.56.2:8088/` (عبر Host-Only `ether3`)، وكذلك `http://127.0.0.1:8088/` (عبر VirtualBox NAT loopback).
  - **Windows 10 VM (`192.168.88.250`):** `http://192.168.88.1:8088/` (محصور بـ `192.168.88.250` فقط).
- **نتائج الاختبار والتحقق (بما فيها ما بعد إعادة تشغيل CHR):**
  - استجابة `HTTP 200` (`28520` بايت) وتحميل كامل ملفات `style.css` و`admin.js` و`logo.png` وخطوط `cairo-{arabic,latin}.woff2` بصفر أخطاء Console من Windows 11 وWindows 10 VM.
  - إعادة تشغيل CHR: عادت الحاوية تلقائياً (`R - RUNNING`)، واستمر عمل `http://192.168.56.2:8088/` و`http://127.0.0.1:8088/` و`http://192.168.88.1:8088/` وبوابة `http://hotspot.rawad.test/login` و`portal-auth` (`HTTP 200`)، مع بقاء الحجب قائماً لـ WAN ولباقي ضيوف HotSpot.
- **التراجع الآمن عن هذا الإصلاح على CHR:**
  - `/ip firewall filter remove [find where comment~"rawad-admin-allow-win10-lab|rawad-admin-block-hostonly-other"]`
  - `/ip firewall nat remove [find where comment~"rawad-admin-hostonly-staff|rawad-admin-win10-lab"]`
  - `/ip address remove [find where comment="rawad-admin-hostonly"]`

---

## تنفيذ المهمة الشاملة لمحاكاة RB4011 وجاهزية الإنتاج — 2026-11-21

### المرحلة 0 و1 (`RB-001` — `RB-004`): تهيئة نظام المهام والتدقيق الأساسي الشامل
- **`RB-001` (PASSED):** تم اعتماد لوحة المهام المنظمة في [TASKS.md](TASKS.md) (`RB-001`..`RB-030` + `FINAL-ACCEPTANCE-TEST`).
- **`RB-002` (PASSED):** تدقيق بيئة VirtualBox و`Rawad-CHR-Lab`:
  - حالة `Rawad-CHR-Lab`: `running` (`RouterOS 7.25.1 x86_64`, RAM حرة `274.8MiB / 512.0MiB`, قرص حر `64.8MiB / 89.2MiB`, قطاعات الكتابة `736`).
  - حاوية لوحة الإدارة (`busybox:musl`، رقم `0`): `R - RUNNING` (`memory-high=32.0MiB`, استهلاك فعلي `668.0KiB`, منفذ `8080` داخل `veth-admin` `172.18.0.2`).
  - الوصول الإداري شغّال بنجاح (`HTTP 200`, `25015 bytes`) عبر `http://192.168.56.2:8088/` وعبر `http://127.0.0.1:8088/`، وSSH مستجيب على `admin@192.168.56.2:22` و`admin@127.0.0.1:2222`.
  - حالة `RAWAD-WIN10-CLIENT`: `running` على الشبكة الداخلية `RAWAD-LAB`، وتم التقاط لقطة شاشة تؤكد ظهور أيقونة الشبكة مقيدة بـ HotSpot قبل تسجيل الدخول.
- **`RB-003` (PASSED):** تدقيق `Rawad Test` (`efqsmehqnhuzohzjztni`, PostgreSQL `17.12`) والمستودع:
  - دوال Edge Functions الثلاث (`admin-api` v14، `portal-auth` v10، `verify-mac` v10) بحالة `ACTIVE` (`portal-auth GET -> 200`، و`verify-mac` / `admin-api` بدون أسرار ترجع `401`).
  - بيانات الأساس المحمية في `Rawad Test`: `admins=2` (`hashim:site_owner`, `testo:general`)، `users=2` (`test`, `hashim`)، `free_quotas=2`، `sessions=11`، `portal_settings=1`، `Main` و`field-test-preparation` نظيفان على `6f7bc8c` و`verify_system.mjs` ناجح في الفحوص الساكنة.
- **`RB-004` (PASSED):** الثغرات والملاحظات المرصودة للمعالجة والاختبار في المراحل التالية:
  1. محاكاة `ARM32` عبر `WSL2`/`QEMU`/Docker Desktop غير متاحة محلياً (`HCS_E_HYPERV_NOT_INSTALLED` وVirtualization/Hyper-V غير مفعّل)، لذا يُصنَّف تشغيل الحاوية على `RB4011` رسمياً كغير مختبر على العتاد الفعلي.
  2. رُصد تفاوت مهم بين `Rawad-CHR-Lab` (حيث `rawad-lab-block-unverified` يتضمن `hotspot=auth` وأسفل قاعدة `hs-unauth`) وبين `routeros/deploy.rsc` السطر `290` (حيث `cUnverified` يستخدم `place-before=0` دون `hotspot=auth`) — يتطلب اختباراً تجريبياً دقيقاً في `RB-010` للتأكد مما إذا كان يحجب Walled Garden قبل الدخول!
  3. رُصد في `routeros/preflight.rsc` السطر `29` فحص أسماء قديمة (`rawad-api`, `rawad-api-group`) بدلاً من الأسماء الفعلية (`rawad-verified-prof`, `rawad-gate`, `rawad-sync-revocations`).
  4. رُصد في `admin/admin.js` السطر `118-120` إظهار أزرار التعطيل والحذف لـ `subordinate` رغم حظرها بالخلفية بـ `HTTP 403` في `admin-api/index.ts`.
  5. رُصد مدخل ثابت متبقٍّ في قائمة `rawad-verified` على CHR (`192.168.88.250`) وإعداد `use-radius=yes` على `hsprof1` مع مستخدم اختبار قديم في `/user-manager` (`lab30-test`)؛ يجب توثيقه وتنظيف السجل الثابت المتبقي أثناء تهيئة المختبر النظيفة.

### المراحل 2 و3 و4 (`RB-005` — `RB-015`): توسيع مختبر RB4011 ومصفوفة التوافق وتقييم ARM32
- **`RB-005` — `RB-008` (PASSED):** تم توسيع `Rawad-CHR-Lab` بنسخة احتياطية مسبقة (`chr-backup-before-stage2.rsc`) لإضافة محاكاة 4 شبكات/VLANs داخلية (`br-corp-sim`، `vlan10-mgmt`, `vlan20-staff`, `vlan30-floor1`, `vlan40-floor2`) مع DHCP وعزل كامل لضيوف `bridge` عن `10.0.0.0/8` و`192.168.0.0/16` وحظر DNS port 53 على `ether1` (WAN).
  - تم التحقق الفعلي من حظر ping ضيوف HotSpot للشبكات الداخلية (`1 packet/60B` محظورة في `input` و`3 packets/180B` محظورة في `forward`) مع بقاء الوصول الإداري لـ Win11 (`192.168.56.2:8088`, `127.0.0.1:8088` HTTP `200`) وWin10 Lab (`192.168.88.1:8088` HTTP `200`) وبوابة HotSpot (`HTTP 200`).
  - اختبار قطع/استعادة WAN (`RB-007`): قطع `ether1` أسقط جلب CHR من Supabase وبقي Admin UI عبر Host-Only يعمل (`HTTP 200`)، وبعد إعادة الوصل استعاد CHR الاتصال (`HTTP 200`).
  - توثيق الشبكة الكامل في [LAB-SETUP.md](LAB-SETUP.md).
- **`RB-009` — `RB-012` (PASSED):** تدقيق سطر بسطر لسكربتات RouterOS وتأكيد سلوك `Walled Garden` HTTPS قبل المصادقة (`WG_NO_REVOKE=200` مقابل خطأ `SChannel 0x80092013` في `curl.exe` الصارم لفحص CRL خارج Walled Garden)، وإثبات الحاجة لإضافة `hotspot=auth` لقاعدة `cUnverified` وعدم موثوقية `place-before=0` دون `print`، وتأليف [RB4011-COMPATIBILITY.md](RB4011-COMPATIBILITY.md) و[ROLLBACK.md](ROLLBACK.md).
- **`RB-013` — `RB-015` (PASSED):** إثبات حجم `admin/` (`270,596 bytes`) وقياس استهلاك حاوية CHR `x86_64` (`668 KiB` RAM، `~3 MiB` قرص) والتصريح الواضح بأن تشغيل الحاوية على `RB4011 ARM32` **غير متحقق وغير معتمد للإنتاج** مع اعتماد بديل الاستضافة المحلية الساكنة على LAN الشركة (Zero-VPS).

### المراحل 5 و6 و7 (`RB-016` — `RB-026`): الاختبارات الشاملة والأمن والأعطال والأحمال وإصلاح الثغرات
- **`RB-016` — `RB-021` (PASSED):**
  - اجتياز 7/7 اختبارات API وأمان حية على `Rawad Test` (`run_stage5_tests.mjs`): دخول الأدوار الثلاثة، قفل RLS على الجداول الخمسة (`HTTP 401`)، تسلسل الصلاحيات (`403` لغير المصرح لهم وحماية `site_owner`)، تنقية `portal_settings`، الحصة المجانية، الحساب المحدود ونقله بين الأجهزة، والحساب المفتوح `ALLOW:UNLIMITED` مع إقرار السحب `ACK`.
  - اختبار حي كامل على `RAWAD-WIN10-CLIENT` + `Rawad-CHR-Lab`: تسجيل الحصة المجانية (`29m49s` في `rawad-verified`)، الحساب المحدود (`59m43s` + إنترنت `200` + حجب `10.10.20.5`)، الحساب المفتوح (دون `timeout`)، وفصله التلقائي خلال ≤18 ثانية بعد التعطيل مع مسح الجلسات التجريبية واستعادة الأساس (`admins=2`, `users=2`).
  - اختبار واجهة الإدارة (`192.168.56.2:8088/`) عبر Chromium (`1440x900` و`390x844`): جميع الأصول الستة المحلية `HTTP 200`، خط `Cairo` وRTL دون overflow وصفر أخطاء Console.
  - اختبارات استعادة الأعطال الخمسة: إيقاف/تشغيل الحاوية (`DOWN -> HTTP 200`)، قطع/وصل شبكة العميل Win10 (`000 -> 200`)، وإعادة تشغيل CHR مع عودة الحاوية (`R - RUNNING`) وHotSpot والمجدول تلقائياً.
- **`RB-022` — `RB-024` (PASSED):** اختبار أحمال متدرج (`10, 25, 40, 60, 100` طلب متزامن): حققت Edge Functions `100% HTTP 200` حتى `100` طلب متزامن (`52.5–94.3 rps` في الذروة)، بينما ظهر عنق زجاجة متوقع في `BusyBox httpd` أحادي العملية على CHR عند `n=100` (`87/100 HTTP 200`, `13 ERR`) مع تعافٍ فوري بعدها وتنظيف كامل البيانات الاصطناعية.
- **`RB-025` — `RB-026` (PASSED):**
  - إضافة `hotspot=auth` لقاعدة `cUnverified` في [routeros/deploy.rsc](routeros/deploy.rsc).
  - تحديث [routeros/preflight.rsc](routeros/preflight.rsc) لفحص `rawad-verified-prof`, `rawad-gate`, `rawad-sync-revocations`.
  - إخفاء أزرار التعطيل والحذف نهائياً عن `subordinate` في [admin/admin.js](admin/admin.js) لمطابقة سياسة `admin-api` (`HTTP 403`) مع تحديث النسخة في حاوية CHR (`32382 bytes HTTP 200`).
  - توسيع [tests/verify_system.mjs](tests/verify_system.mjs) واجتياز كافة فحوص الانحدار والأمان.

### المرحلتان 8 و9 (`RB-027` — `RB-030` + `FINAL-ACCEPTANCE-TEST`): القبول النهائي البارد والجاهزية والإغلاق
- **`FINAL-ACCEPTANCE-TEST` (PASSED — 17/17):** بعد إيقاف بارد كامل لـ `Rawad-CHR-Lab` و`RAWAD-WIN10-CLIENT` وإقلاعهما من الصفر، عادت الحاوية (`668.0KiB`, `R - RUNNING`) وHotSpot والمجدول تلقائياً، وفتحت Edge في Win10 البوابة محملةً إعدادات Supabase الحية، واجتازت أنواع الحسابات الثلاثة (`Free 29m48s`, `Limited 59m44s`, `Unlimited` دون timeout) والفصل التلقائي بعد التعطيل وعزل الجدار الناري وقطع/استعادة WAN وإعادة تشغيل الحاوية، مع نظافة `Rawad Test` (`admins=2: hashim, testo`, `users=2: test, hashim`) واجتياز `tests/verify_system.mjs`.
- **التوثيق النهائي الكامل (`RB-027` — `RB-028`):** إصدار [TEST-REPORT.md](TEST-REPORT.md) و[PRODUCTION-READINESS.md](PRODUCTION-READINESS.md) متكاملَين مع [TASKS.md](TASKS.md), [RB4011-COMPATIBILITY.md](RB4011-COMPATIBILITY.md), [LAB-SETUP.md](LAB-SETUP.md), و[ROLLBACK.md](ROLLBACK.md).
- **الحسم والتزامن (`RB-029` — `RB-030`):** مراجعة `git status`/`git diff` ومسح الأسرار ودفع الفروع `main` و`field-test-preparation` دون `--force` مع مطابقة SHA-1.

---

## جولة التحقق النهائية والأداء والتوافق الحصري مع `ether10` (`RB-031` — `RB-040`) — 2026-11-21

- **`RB-031` (`PASS`):** تحسين تنسيق التوقيع `.powered-by` و`.powered-by:hover` في [admin/style.css](admin/style.css) (`#94a3b8`، `10.5px`، وزن `500`، شفافية `0.78`، خلفية شفافة دون إطار)، ومزامنته مع حاوية CHR (`HTTP 200`, `23015 bytes`)، والتحقق منه في `chrome-devtools-mcp` (`Desktop 1440×900` و`Mobile 390×844`، `overflow=false`، `0` أخطاء Console).
- **`RB-032` (`PASS` للتدقيق):** مراجعة شفافة لجميع السجلات غير النظيفة (`task-1079, 1141, 1171, 1250, 1290, 1335, 1350, 1357, 1367, 1436`) وتوثيقها وفق التصنيف الخماسي الصارم (`PASS | FAIL | BLOCKED | NOT TESTED | CANCELLED`) في [TEST-REPORT.md](TEST-REPORT.md).
- **`RB-033` (`PASS` في المختبر):** إثبات سلوك `Fail-Closed` حيّاً على `RAWAD-WIN10-CLIENT` عند محاولة الدخول المباشر بـ `rawad-gate` دون تفويض مسبق من `portal-auth` (`GATE_HTTP=200`, `FC_INET=000`، وبقاء `rawad-verified` فارغة في CHR)، مع توثيق قياسات DHCP وDNS (`cache-used: 62KiB`) وNAT (`437` حزمة).
- **`RB-034` (`FAIL` لـ BusyBox عند `n=100` / `PASS` لبديل الاستضافة الساكنة على LAN):** تشخيص فشل `BusyBox httpd` على CHR عند `n=100` (`63 HTTP 200`, `26 ECONNRESET`, `11 UND_ERR_CONNECT_TIMEOUT`) وإثبات صمود بديل الاستضافة الساكنة على LAN بنسبة `100/100 HTTP 200` عبر المستويات `10–100` (`1587.3 rps`, `max=59ms`) إلى جانب دوال Supabase الثلاث (`91.7–92.6 rps`, `0` أخطاء) وحفظ النتائج في `rb034_load_results.json`.
- **`RB-035` و`RB-036` (`PASS` للتصميم والتوثيق؛ العتاد الحقيقي `NOT TESTED`):**
  - توسيع الفحص القرائي فقط في [routeros/preflight.rsc](routeros/preflight.rsc) ليشمل `/interface vlan`, `/ip firewall nat`, `/ip firewall mangle` المرتبطة بـ `ether10`.
  - إعداد تصميم النشر الحصري لمنفذ `ether10` (`Subsections A–F`: حماية `ether1–ether9`, عزل `ether10`, تحليل الإعدادات المشتركة الثلاثة `allow-remote-requests`, `Asia/Baghdad`, `ntp client`, فحص التجهيز بـ 8 خطوات، شروط التوقف الـ6، قواعد التراجع الجراحي دون مسح قواعد الشبكة، وخطة التحقق قبل/بعد على `ether1–ether9`) وتحديث [PRODUCTION-READINESS.md](PRODUCTION-READINESS.md), [RB4011-COMPATIBILITY.md](RB4011-COMPATIBILITY.md), [LAB-SETUP.md](LAB-SETUP.md), و[ROLLBACK.md](ROLLBACK.md).
- **`RB-037` و`RB-038` (`PASS`):** تدقيق `Rawad Test` (`efqsmehqnhuzohzjztni`): RLS مفعّل (`true`) على الجداول الخمسة، REST يرجع `401` لـ `anon`، صفر صلاحيات للدوال الثماني لـ `anon/authenticated/PUBLIC` (`42501` عند الاستدعاء القرائي المباشر لـ `get_cleanup_summary`)، حفظ كامل بيانات الأساس (`admins=2: hashim, testo`, `users=2: test, hashim`, `0` صفوف اصطناعية)، وتوثيق المخزون الثابت الواجب تبديله للإنتاج (`efqsmehqnhuzohzjztni` ومعرف `39c0a9e8-028d-4c04-a0e3-e46e21cef7d9` المحصّن في `admin-api`).
- **`RB-039` و`RB-040` (`PASS`):** إقرار مصفوفة القبول النهائية ذات الـ 20 بنداً، وتحديث الملفات السبعة، واجتياز `verify_system.mjs` (الفحص الساكن مع تخطّي PG المحلي الصريح) وفحص الأسرار، ومزامنة ودفع `main` و`field-test-preparation` دون `--force`.

---

## المراجعة النهائية: عزل الإنتاج الصارم ومزامنة Migrations واختبار الأحمال الشامل (`RB-041` — `RB-044`) — 2026-11-21

- **`RB-041` (`PASS` للسكربتات / `BLOCKED` للنشر على عتاد RB4011 حتى التحقق الميداني):**
  - إزالة جميع التعديلات العامة (`/ip dns set`, `/system clock set`, `/system ntp client set`) من [routeros/deploy.rsc](routeros/deploy.rsc) و[routeros/rollback.rsc](routeros/rollback.rsc) بالكامل.
  - إضافة بوابة إيقاف قرائية صارمة (`allow-remote-requests != true -> ABORT`) في `deploy.rsc` مع إبقاء حظر `WAN TCP/UDP 53`، وتقييد مستخدم `rawad-gate` و`walled-garden` بـ `server="rawad-guest-hotspot"` وتعليق `onLogoutSrc` بـ `comment="rawad-guest-portal"`.
  - توسيع [routeros/preflight.rsc](routeros/preflight.rsc) لفحص خوادم HotSpot على غير `ether10` وطباعة `/ipv6 firewall filter input` وتنبيه الساعة، وتوسيع [routeros/verify.rsc](routeros/verify.rsc) و[tests/verify_system.mjs](tests/verify_system.mjs) بتأكيدات دائمة ضد أي تعديل عام (`ALL SYSTEM VERIFICATIONS PASSED`).
- **`RB-042` (`PASS`):** فحص `pg_namespace` و`supabase migration list --linked` على `Rawad Test` (عدم وجود `supabase_migrations` وظهور الثلاثة إصدارات `202611180001`, `202611180002`, `202611190001` محلياً مع `remote=""`) وتوثيق طريقة المزامنة الميتاداتية الآمنة (`migration repair --status applied ... --remote`) دون تجاوز حماية `HostedMutationConsentRequiredError`.
- **`RB-043` (`PASS` للتدفق السحابي على `Rawad Test`؛ `/tool fetch` على RB4011 `NOT TESTED`):**
  - في التشغيل الأولي المتزامن (`task-1647`, `task-1660`) تسبب مجدول `rawad-sync-revocations` النشط كل `15s` على `Rawad-CHR-Lab` في سباق سحب لأقدم `10` جلسات قبل `ACK` الاختبار (ما أثبت عملياً وجوب تخصيص مشروع Supabase واحد لكل راوتر).
  - بالتشغيل المعزول (`task-1670` — إيقاف المجدول مؤقتاً ثم إعادة تفعيله) اجتازت جميع المستويات **`100% E2E`**: الحصة المجانية عبر `10, 25, 40, 60, 100` مستخدم متزامن (`GET portal-auth` -> `POST free` -> `verify-mac` -> `session_status` -> `logout` -> `revoked` + `ACK` دفعات من `10`) عند `n=100`: `100/100 E2E OK` (`32.93 rps`, `p50=2220ms`, `p95=2757ms`, `max=3033ms`) + `100/100 ACK` في `3846ms`، بالإضافة إلى `25/25` تسجيل دخول متزامن بـ `PBKDF2` (`p50=2173ms`, `max=2820ms`, `revAck=25/25`).
  - نظافة كاملة بعد التشغيل: `admins=2`, `users=2`, `rem_quotas=0`, `rem_sessions=0`, `rem_users=0`.
- **`RB-044` (`PASS`):** تحديث جميع التقارير ([PRODUCTION-READINESS.md](PRODUCTION-READINESS.md), [TEST-REPORT.md](TEST-REPORT.md), [RB4011-COMPATIBILITY.md](RB4011-COMPATIBILITY.md), [ROLLBACK.md](ROLLBACK.md), [TASKS.md](TASKS.md), [PROGRESS.md](PROGRESS.md)) وتثبيت حالة النشر الإنتاجي رسمياً كـ **`BLOCKED`** حتى إثبات متطلبات `RB4011` الميدانية.

---

## تصحيح النطاق، اختبار سعة المصادقة (`10–500`)، تحسين التوسع، والتنظيف الآمن (`RB-045` — `RB-051`) — 2026-11-21

- **تصحيح النطاق (`Scope`):** تثبيت أن المشروع يقتصر على مصادقة المستخدمين، فحص `MAC Address` وحالة الحساب، منح وإلغاء صلاحية HotSpot، مزامنة `Revocation`/`ACK`، ولوحة الإدارة — دون أي وظائف لإدارة سرعة الإنترنت أو Bandwidth/DPI.
- **`RB-046` (`PASS`):**
  - استبدال `createClient(...)` المتكرر داخل كل طلب في [portal-auth/index.ts](supabase/functions/portal-auth/index.ts) و[verify-mac/index.ts](supabase/functions/verify-mac/index.ts) و[admin-api/index.ts](supabase/functions/admin-api/index.ts) بدالة `getDb()` أحادية على مستوى الـ isolate، ونشرها جميعاً على `Rawad Test`.
  - إضافة فهرسَي الأداء الجزئيّين `idx_sessions_pending_revocations` و`idx_sessions_active_expires` في [supabase/schema.sql](supabase/schema.sql) وتطبيقها على `Rawad Test` مع التحقق عبر `pg_indexes`.
- **`RB-045` (`PASS` حتى `300` متزامن؛ التشبع عند `500`؛ عتاد RB4011 `NOT TESTED`):**
  - اجتاز تدفق المصادقة الكامل 100% من `10` حتى **`300` مستخدم متزامن** (`300/300` E2E، `57.58 rps`, `p50=4321ms`, `p95=4765ms`, `p99=4917ms`, `max=5204ms`, `revAck=300/300` خلال `11887ms`).
  - عند **`500` مستخدم متزامن** وصلت بوابة الاتصال إلى نقطة تشبع: نجح `191/500` (مع `191/191 ACK`) وأخفقت `309` طلبات بسبب `TypeError` (انتهاء مهلة فتح 500 اتصال TLS متزامن عند `~10,106ms`) مع بقاء النظام `Fail-Closed` دون جلسات معلقة.
  - اجتياز `20` طلباً مكرراً لنفس MAC (جلسة نشطة واحدة بالضبط في DB)، ورفض الحساب المنتهي والحصة المستنفدة (`403`) و`MAC` غير المصرح (`403`) والسر الخاطئ (`401`).
- **`RB-047` (`PASS` للمحاكاة / RB4011 `NOT TESTED`):** قياس CHR الفعلي (`cpu-load: 0%`, `free-memory: 267.8–268.4MiB / 512.0MiB`, `25` قاعدة Filter, `21` قاعدة NAT, حاوية `1300.0KiB`) وتوثيق حدود `deploy.rsc` (`241` عنوان DHCP و`shared-users=250`).
- **`RB-048` و`RB-049` (`PASS`):** جرد جميع الملفات الـ`45` المتتبعة (`44 KEEP`، أرشفة `FIELD_TEST.md` -> [docs/archive/FIELD_TEST.md](docs/archive/FIELD_TEST.md) عبر `git mv` بعد إثبات `0` مراجع، و`0 DELETE` لملفات المستودع لبقاء ملفات `scratch/` معزولة خارجه)، وتحديث [README.md](README.md) بالنطاق الصحيح، و`0` مجلدات فارغة.
- **`RB-050` و`RB-051` (`PASS`):** اجتياز كامل اختبارات ما بعد التنظيف (`verify_system.mjs` الساكن، `run_stage5_tests.mjs` `7/7`، `6/6` أصول لوحة الإدارة `HTTP 200`، `hotspot/` و`hotspot1` على CHR، `GREP_EXIT=1`، ونظافة DB `admins=2, users=2, rem=0`).

---

## التحقيق النهائي في سعة `350–500`، تحديد السعة المثبتة، ونظافة المستودع (`RB-052` — `RB-055`) — 2026-11-21

- **`RB-052` (`PASS` للتحقيق المعملي / تصنيف `n=500`: `INCONCLUSIVE / UNSTABLE FOR SLA`):**
  - **معايرة أداة الاختبار على `127.0.0.1`:** عملية واحدة لـ `500` طلب فوري حققت `232/500` فقط (`268 ECONNREFUSED` خلال `204ms`) مما يثبت اختناق TCP/Undici في العملية الواحدة، بينما `5` عمليات مستقلة (`5×100`) حققت **`500/500` بصفر أخطاء** في `242ms`.
  - **ضد `Rawad Test` (عملية واحدة `350–500`):** `350/350` (`0` أخطاء، `p99=7837ms`, `revAck=350/350`), ثم بدأت `UND_ERR_CONNECT_TIMEOUT` (مهلة اتصال `10,000ms` في `step_freeAuth`) عند `400` (`342/400`: `58` timeout) و`450` (`385/450`: `65` timeout) و`500` (`377/500`: `123` timeout).
  - **ضد `Rawad Test` (`5` عمليات مستقلة `350–500`):** `350` (`350/350`), **`400` (`400/400`، `47.76 rps`، `p50=7502ms`, `p95=7606ms`, `p99=7631ms`, `revAck=400/400`)**؛ بينما عند تشغيل `450` متتالياً (`task-1787`) ظهرت `98` مهلة `UND_ERR_CONNECT_TIMEOUT` في `step_freeAuth` (`352/450`) وفشل سحب `revoked` في ذيل `MULTI_500` بمهلة `10,000ms` إلى `Cloudflare 172.64.149.246:443`. وبإعادة `MULTI_500` معزولاً (`task-1802`) اجتاز **`500/500` كاملاً** (`47.58 rps`, `p50=10268ms`, `p99=10389ms`, `revAck=500/500` بـ `50` دفعة، `0` deadlocks/rollbacks).
  - تحققت سلامة قاعدة البيانات في كل مستوى (`duplicateActive=0`, `remainingActiveBeforeDelete=0`, `orphan=0`).
- **`RB-053` (`PASS`):** تثبيت السعة المضمونة المتكررة بـ 100% عند **`350` (أحادي العملية)** و**`400` (متعدد العمليات المعاير)**، مع تحديد بداية الأخطاء، زمن `P50/P95/P99`، استهلاك PostgreSQL (`cacheHitPctDelta=100%`, `deadlocksDelta=0`, `numbackends=17`)، وهامش أمان تشغيلي **`200–250` مستخدماً متزامناً** (بينما سعة عتاد `RB4011` تبقى `NOT TESTED` وبدء النشر `BLOCKED`).
- **`RB-054` و`RB-055` (`PASS`):** إثبات سلامة جميع أصول HTML/CSS، تطابق SHA-256 المقصود فقط لملفات العلامة التجارية في `admin/` و`hotspot/`، بقاء `supabase/.temp/` متجاهلاً فقط و`scratch/` خارج المستودع دون حذف مخرجاته أو نسخه الاحتياطية، ثم اجتياز بوابة التحقق النهائية ودفع التعديلات.

---

## تأكيد التكرارية واعتماد السعة السحابية النهائية (`RB-056` — `RB-058`) — 2026-11-21

- **`RB-056` (`PASS` للتنفيذ المخبري عبر 15 جولة مستقلة):**
  - تنفيذ `3` جولات مستقلة لكل مستوى (`300, 350, 400, 450, 500`) باستخدام المولّد متعدد العمليات (`5` عمليات مستقلة) على `Rawad Test` دون تغيير المهلات ومع إيقاف مجدول CHR مؤقتاً وتنظيف البيانات بين الجولات:
    - **`300`:** `3/3` (`100%` في كل جولة، `0` أخطاء، `P50: 5051–7716ms`, `P99: 5428–8585ms`, `ACK: 300/300`).
    - **`350`:** `3/3` (`100%` في كل جولة، `0` أخطاء، `P50: 3744–8402ms`, `P99: 5598–8675ms`, `ACK: 350/350`).
    - **`400`:** `3/3` (`100%` في كل جولة، `0` أخطاء، `P50: 8470–35025ms`, `P99: 8607–35661ms`, `ACK: 400/400`؛ مع رصد تضخم زمن الاستجابة في الجولتين R2/R3).
    - **`450`:** `0/3` (`448/450`, `431/450`, `408/450` — إخفاقات `UND_ERR_CONNECT_TIMEOUT` في `step_freeAuth`: `2`, `19`, `42`، وصفر `429`/`5xx`).
    - **`500`:** `0/3` (`427/500`, `397/500`, `427/500` — إخفاقات `UND_ERR_CONNECT_TIMEOUT` في `step_freeAuth`: `73`, `103`, `73`، وصفر `429`/`5xx`).
  - تحقّق `dup=0`, `remainingActiveBeforeDelete=0`, `orphan=0` في جميع الجولات الـ15، وبقي الأساس نظيفاً (`admins=2`, `users=2`, `rem=0`).
- **`RB-057` و`RB-058` (`PASS` للتوثيق والاعتماد):** اعتماد **`400` مستخدماً متزامناً** كـ **سعة سحابية مختبرة ومعتمدة (`3/3`)**، وتثبيت **`200–250`** كـ **سعة تشغيلية مقترحة آمنة**، والتصريح أن سعة **`RB4011` الحقيقي ما زالت `NOT TESTED`** (ونشر الإنتاج **`BLOCKED`**)، مع تحديث [TASKS.md](TASKS.md), [PROGRESS.md](PROGRESS.md), [TEST-REPORT.md](TEST-REPORT.md), و[PRODUCTION-READINESS.md](PRODUCTION-READINESS.md).

---

## تدقيق الجاهزية الميدانية القرائي لراوتر RB4011 الحقيقي (`RB-059`) — 2026-11-21

- **`RB-059` (`PASS` للتدقيق والخطط / النشر الفعلي يبقى `BLOCKED` و`NOT TESTED` عتادياً):**
  - التحقق من استقرار Git (`31b6cea` على `main` و`field-test-preparation`, Working Tree نظيف) ومن عدم وجود `/export` فعلي لـ `RB4011` داخل المستودع أو `scratch/`.
  - توثيق حزمة أوامر RouterOS v7 القرائية فقط (`Read-Only`) لجرد الواجهات و`Bridge`/`VLAN`/`RTL8367SB`/`PoE-out` و`DHCP`/`DNS`/`Firewall` (IPv4+IPv6)/`HotSpot`/`Routes`/`Clock`/`NTP`/`/export` دون أي تعديل على الراوتر أو Supabase Production.
  - تحليل الاعتماديات المشتركة (`DNS`, ترتيب `place-before=0`, `RTL8367SB`, تداخل `192.168.20.0/24`/NAT, دقة ساعة UTC) وتوثيق خطة نافذة الصيانة المستقبلية غير المنفذة باستخدام النسخ الاحتياطي المزدوج و**`Safe Mode`** والتراجع الجراحي عبر [routeros/rollback.rsc](routeros/rollback.rsc) في [PRODUCTION-READINESS.md](PRODUCTION-READINESS.md).
- **`RB-060` (`PASS` للمراجعة والمزامنة / النشر الإنتاجي يبقى `BLOCKED`):**
  - تدقيق كامل المستودع (`45` ملفاً متتبعاً في Git، `0` محذوفات، `1` ملف مؤرشف مسبقاً في [docs/archive/FIELD_TEST.md](docs/archive/FIELD_TEST.md)، وتجاهل `supabase/.temp/` فقط) والتحقق من تطابق الفرعين `main` و`field-test-preparation` محلياً وعلى `origin`.
  - تحديث [DEPLOYMENT.md](DEPLOYMENT.md) و[README.md](README.md) لعكس حالة الإنتاج `BLOCKED`، خطوات `preflight.rsc` و`Safe Mode`، استضافة `admin/` داخل LAN، السعة السحابية المعتمدة (`400` / هامش `200–250`)، وفهرس الوثائق، ثم فحص الروابط و`verify_system.mjs` والأسرار والرفع دون `--force`.

---

## توحيد تذييل بوابة الزبون واستعادة `/admin/login` بعد إعادة التشغيل (`RB-061`) — 2026-11-25

- **السبب الجذري المُثبت للمشكلتين:**
  1. **تباين `Powered BY Hashim Hasanen` في صفحة الزبون:** تعديل `RB-031` حدّث الفئة `.powered-by` في [admin/style.css](admin/style.css) فقط، بينما بقيت الفئة `.rawad-powered-by` في [hotspot/assets/style.css](hotspot/assets/style.css) (المستخدمة في [hotspot/login.html](hotspot/login.html) و[hotspot/status.html](hotspot/status.html)) بالنمط الأزرق البارز القديم (`color: #1d4ed8`, `11px`, `font-weight: 700`, `background: rgba(239, 246, 255, 0.92)`, `border-radius: 999px`)، والنسخة المرفوعة على CHR كانت بتاريخ `2026-11-19`.
  2. **ظهور صفحة معطوبة عند فتح `http://hotspot.rawad.test/admin/login` بعد إعادة التشغيل:**
     - أُثبت من فحص VirtualBox وEdge و`curl` داخل `RAWAD-WIN10-CLIENT` أن حاوية الإدارة `rawad-admin-container` (`busybox:musl`) كانت سليمة وتعمل تلقائياً (`R - RUNNING`) على المنفذ `8088` بنفس ملفات [admin/](admin/) المحدثة، ولا توجد خوادم قديمة أو إدخالات `hosts` داخل الضيف أو المضيف.
     - السبب الفعلي كان مزدوجاً: أولاً، كان محول الشبكة في `RAWAD-WIN10-CLIENT` محفوظاً بحالة `cableconnected1="off"` (`Media disconnected`)؛ وثانياً، عند فتح `http://hotspot.rawad.test/admin/login` على المنفذ `80` يعترض خادم MikroTik HotSpot (`64873`) أي مسار ينتهي بـ `/login` ويعرض [hotspot/login.html](hotspot/login.html) خاماً مع عنوان المتصفح `/admin/login`، فتُطلب الأصول النسبية تحت `/admin/assets/style.css` وتفشل، فتظهر أيقونات الـ SVG من غير تنسيق (بشكل يشبه صفحة قديمة أو معطوبة). كما أن BusyBox على `:8088` كان يُرجع `404` للمسار `/admin/login`.
- **الإصلاحات المنفذة (مع الإبقاء على `chr-backup-before-rb061.rsc` خارج المستودع دون المساس بالإنتاج):**
  - توحيد `.rawad-powered-by` في [hotspot/assets/style.css](hotspot/assets/style.css) لتطابق تماماً لوحة التحكم (`#94a3b8`، `10.5px`، `font-weight: 500`، `opacity: 0.78`، `background: transparent`، `border: none`، `padding: 0`، hover `0.95`).
  - إضافة `?v=20261125` لرابط `assets/style.css` في [hotspot/login.html](hotspot/login.html) و[hotspot/status.html](hotspot/status.html) لكسر الكاش، وإضافة توجيه مختبري محصور بنطاق `hotspot.rawad.test` ومسار `/admin` في [hotspot/login.html](hotspot/login.html) يحوّل تلقائياً إلى `http://hotspot.rawad.test:8088/` دون أي تأثير على بوابة `/login` أو `ether10` الإنتاجي أو حجب الضيوف (`rawad-admin-block-guests`).
  - رفع الملفات المحدثة إلى `/hotspot/` في `Rawad-CHR-Lab` وإضافة `/admin-www/admin/login/index.html` على الحاوية لتحويل `:8088/admin/login` إلى `/` (`302 -> 200 -> /`).
  - تثبيت `VBoxManage modifyvm "RAWAD-WIN10-CLIENT" --cableconnected1 on` أثناء الإيقاف لضمان الاتصال التلقائي بعد كل إقلاع.
- **النتيجة (`PASS`):** تحققت مطابقة الـ CSS الحاسوبية والمرئية في المتصفح وعمل تسجيل الدخول الإداري (`HTTP 200`)، كما ثبت استمرار كلا الإصلاحين تلقائياً بعد إيقاف بارد كامل وإعادة تشغيل `Rawad-CHR-Lab` و`RAWAD-WIN10-CLIENT`.

---

## تجهيز Supabase Production والاختبارات الحية للانتهاء والقطع ومنتصف الليل (`RB-062`) — 2026-11-25

- **تجهيز مشروع Production (`stlrolkrqtbhkjztxudd` — `Europe (Ireland)` / `eu-west-1`):**
  - استخراج ومقارنة بنية `Rawad Test` (`efqsmehqnhuzohzjztni`) مع [supabase/schema.sql](supabase/schema.sql) وتأكيد أن الترحيلات السابقة كانت تعديلات فوق المخطط الأساسي؛ لذا تم تنفيذ فحص Dry Run (`BEGIN; ... ROLLBACK;`) ثم تطبيق [supabase/schema.sql](supabase/schema.sql) بالكامل عبر Session Pooler IPv4 (`aws-1-eu-west-1.pooler.supabase.com:5432`، `PostgreSQL 17.12`)، ومزامنة سجل `supabase migration repair --status applied 202611180001 202611180002 202611190001`، وإثبات تطابق 100% في الامتدادات والجداول والأعمدة والقيود والفهارس والـ RLS والدوال والصلاحيات مع `Rawad Test` (مع إبقاء `Rawad Test` سليماً دون تعديل).
  - توليد 3 أسرار إنتاجية جديدة مستقلة (`ADMIN_TOKEN_SECRET`, `PORTAL_STATUS_SECRET`, `ROUTER_SHARED_SECRET`) دون كشف قيمها، ونشر الدوال الثلاث (`portal-auth`, `verify-mac`, `admin-api` بـ `--no-verify-jwt`) بحالة `ACTIVE`.
- **تحديث إعدادات التطبيق والمختبر إلى Production:**
  - تحديث `supabaseUrl` وPublishable Key (`stlrolkrqtbhkjztxudd`) في [admin/index.html](admin/index.html)، [hotspot/login.html](hotspot/login.html)، و[hotspot/status.html](hotspot/status.html)، وتحديث `supabaseHost` في [routeros/deploy.rsc](routeros/deploy.rsc) (مع بقاء `routerSecret` كقيمة نائبة آمنة وبقاء النشر على `RB4011` الحقيقي `BLOCKED`).
  - تحديث `Rawad-CHR-Lab` (`walled-garden`, `rawad-verified-prof`, `rawad-sync-revocations`, `/admin-www/index.html`, `/hotspot/{login,status}.html`) وإثبات جلب HTTPS `CODE=200`.
- **نتائج الاختبارات الحية والأمنية (`PASS` بالكامل مع تنظيف تام بعد الانتهاء):**
  - **Test A (`30` ثانية) وTest B (`60` ثانية) والقطع الفعلي:** فتح الإنترنت الفعلي لـ `RAWAD-WIN10-CLIENT` (`https://example.com -> HTTP 200`)، وبعد انتهاء المدة سُحبت الجلسة وتلقى CHR الإلغاء ونفّذ `ACK` (`9.70s` للـ 30ث و`6.95s` للـ 60ث)، وأُزيل الإدراج من `rawad-verified` و`/ip hotspot active` وانقطع الإنترنت فعلياً (`HTTP 302` من HotSpot).
  - **Test C (منع إعادة الدخول):** رُفضت محاولات إعادة الدخول بالـ 30ث والـ 60ث بـ `HTTP 403`، وبقي `total_sessions=2, active_sessions=0, pending_acks=0`.
  - **Test D & E (`Asia/Baghdad` منتصف الليل):** التحقق عبر `request_free_quota` بتوقيت بغداد: منع إعادة الاستخدام قبل `00:00+03:00` (`23:59:50+03:00` -> `allowed=false`) والسماح بجلسة جديدة عند `2026-11-26 00:00:05+03:00` (حتى مع بقاء UTC في 25 نوفمبر) دون إعادة تفعيل الجلسة القديمة.
  - **اختبارات الأمان:** إثبات قفل `RLS` و`RPC` لـ `anon`، ورفض `JWT` المزور و`subordinate`/`general` (`403`)، ورفض الحساب المعطّل (`403`)، وحماية `verify-mac` (`401`/`400`/`403`) و`HMAC` (`403` لـ MAC آخر أو رمز معدّل).
  - **التنظيف النهائي:** حذف جميع حسابات وجلسات وحصص الاختبار المؤقتة (`admins=0, users=0, free_quotas=0, sessions=0, portal_settings=1`).

---

## الاعتماد النهائي لبيئة الإنتاج وتهيئة حساب المدير الرئيسي والاختبار الكامل (`RB-063`) — 2026-11-25

- **ملاحظة المرجع:** مشروع `Rawad Test` (`efqsmehqnhuzohzjztni`) حُذف نهائياً؛ وقد أكد الفحص عدم بقاء أي مراجع تشغيلية له في `admin/` أو `hotspot/` أو `routeros/` أو `supabase/` أو `tests/` (`RUNTIME_OLD_REF_EXIT=1`)، والمشروع الوحيد المعتمد الآن هو Production `stlrolkrqtbhkjztxudd` (`eu-west-1`).
- **تهيئة المدير الرئيسي `hashim` والتحقق من لوحة الإدارة (`PASS`):**
  - إنشاء حساب `hashim` في `public.admins` بتجزئة PBKDF2-SHA256 (`100,000` دورة) وبأعلى صلاحية (`is_super_admin=true, role='site_owner'`) دون إنشاء حساب مكرر ودون كشف كلمة المرور.
  - اختبار تسجيل الدخول الفعلي عبر واجهة لوحة الإدارة (`http://192.168.56.2:8088/` ضد `stlrolkrqtbhkjztxudd`: `POST /admin-api/login [200]`، `GET /admin-api/users [200]`، ظهور جميع الأقسام السبعة لـ `مدير الموقع`، صفر أخطاء Console، وتسجيل خروج سليم).
  - اختبار دورة CRUD للمستخدمين وحدود الصلاحيات الخلفية (`RBAC`) للأدوار الثلاثة (`site_owner`, `general`, `subordinate`) مع رفض `403` لتجاوز الصلاحيات ومنع حذف `site_owner`.
- **نتائج الاختبار الفعلي الشامل على `Rawad-CHR-Lab` و`RAWAD-WIN10-CLIENT` (`PASS`):**
  - **`8.1` بوابة Captive Portal:** تحويل تلقائي عبر DHCP/Gateway/DNS (`192.168.88.1`)، تحميل كافة الأصول السبعة بـ `HTTP 200`، ربط الإنتاج دون مراجع قديمة، وبقاء تذييل `Powered BY Hashim Hasanen` سليماً.
  - **`8.2` و`8.3` اختبار `30` ثانية و`60` ثانية:** دخول ناجح وإنترنت فعلي (`https://example.com -> 200`)، ثم انتهاء وقطع فعلي (`302`) وإتمام `ACK` بتأخير **`9.32s`** (للـ 30ث) و**`9.05s`** (للـ 60ث).
  - **`8.4` و`8.5` منع إعادة الدخول ومنتصف الليل (`Asia/Baghdad`):** رفض إعادة الدخول بـ `403`، ومنع الحصة المستنفدة قبل `00:00+03:00` مقابل منح جلسة جديدة مستقلة بعد منتصف الليل.
  - **`8.6` إلغاء الجلسة من لوحة الإدارة (`Revocation -> CHR -> ACK`):** تعطيل مستخدم متصل عبر `admin-api` (`hashim`) أدى إلى إزالة `rawad-verified` و`/ip hotspot active` وقطع الإنترنت (`302`) وإتمام `ACK` خلال **`1.11s`** بصفر جلسات يتيمة أو مكررة.
  - **`8.7` إعادة التشغيل الباردة (`Cold Reboot`):** إيقاف بارد كامل لـ CHR وWin10 VM ثم تشغيلهما: عاد `DHCP` (`192.168.88.250`) و`hotspot1` و`rawad-admin-container` (`0 R`) و`rawad-sync-revocations` والاتصال بـ Production تلقائياً.
  - **الأمن والتنظيف:** اجتياز اختبارات الأمان (`JWT`/`HMAC`/`MAC`/`RLS`/`RBAC`)، وتنظيف جميع البيانات المؤقتة مع بقاء `hashim` (`site_owner`) فقط (`admins=1, users=0, free_quotas=0, sessions=0, portal_settings=1`). النشر على `RB4011` الحقيقي يبقى `BLOCKED`.
