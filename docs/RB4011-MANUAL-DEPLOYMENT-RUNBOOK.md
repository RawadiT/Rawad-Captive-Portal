# دليل النشر اليدوي على MikroTik RB4011iGS+RM (`RB-065`)

> **حالة النشر الميداني الحالية:** **`BLOCKED`** — يُمنع تنفيذ أي أمر تعديل على راوتر الشركة الحقيقي **RB4011iGS+RM** قبل سحب `/export` الفعلي وتنفيذ فحوص القراءة فقط (`Preflight`) وحسم الإعدادات غير المعروفة أدناه.  
> **بيئة الإنتاج السحابية المعتمدة (`Supabase`):** `Rawad Captive Portal` (`stlrolkrqtbhkjztxudd` — `Europe (Ireland) / eu-west-1` — `https://stlrolkrqtbhkjztxudd.supabase.co`).

---

## أ. معلومات الجهاز ومتطلبات التوافق (`RB4011iGS+RM`)

| المواصفة / المتطلب | القيمة في `RB4011iGS+RM` | الأثر والتوافق مع النظام |
| :--- | :--- | :--- |
| **المعمارية والمعالج** | `ARM 32-bit` (`Annapurna Labs AL21400` رباعي النواة `1.4 GHz`) | جميع سكربتات [routeros/](../routeros/) (`preflight.rsc`, `deploy.rsc`, `verify.rsc`, `rollback.rsc`) هي أوامر RouterOS v7 أصلية متوافقة معمارياً، **لكنها لم تُختبر بعد على عتاد ARM32 الفعلي**. |
| **الذاكرة (`RAM`) والتخزين (`NAND`)** | `1 GiB RAM` / `512 MiB NAND` داخلية (دون منفذ USB/NVMe) | مجلد [hotspot/](../hotspot/) (`11` ملفاً، حجمه نحو `~275 KiB`) خفيف جداً وملائم لـ NAND. **يُمنع تماماً** تشغيل حاوية `container` (`busybox:musl`) على RB4011 لتجنب تآكل NAND ومخاطر ARM32؛ وتُستضاف لوحة الإدارة [admin/](../admin/) (`~264 KiB`) ساكناً على **كمبيوتر الشركة داخل LAN فقط**. |
| **النظام والحزم المطلوبة** | `RouterOS v7.x` + حزمة `routeros` + حزمة `hotspot` مفعّلة | مطلوب دعم TLS لجلب `https://stlrolkrqtbhkjztxudd.supabase.co/functions/v1/verify-mac` وساعة نظام UTC دقيقة. |
| **معمارية المنافذ والشرائح** | `ether1–ether5` على `RTL8367SB #1`، و`ether6–ether10` على `RTL8367SB #2`، مع `PoE-out` على `ether10` | يجب عزل `ether10` تماماً عن `bridge` الشركة وعن `ether1–ether9`؛ وفحص هل يوجد جهاز `AP` يعتمد على `PoE-out` في `ether10` قبل أي تعديل. |

### الفروقات الجوهرية بين مختبر `CHR x86_64` وراوتر الإنتاج `RB4011`
1. **المعمارية:** اختُبر النظام على `CHR x86_64` (`RouterOS 7.25.1`) وليس على `ARM32`.
2. **الحاويات:** `Rawad-CHR-Lab` يشغّل `admin/` داخل حاوية `busybox:musl`؛ أما في الشركة فلوحة الإدارة تعمل **محلياً من كمبيوتر الشركة** (`admin/index.html`).
3. **بوابة الضيوف:** المختبر يستخدم `bridge` (`ether2`, `192.168.88.0/24`, `hotspot.rawad.test`)؛ أما الإنتاج فمحصور في **`ether10`** (`192.168.20.0/24` مقترح في `deploy.rsc` بشرط التحقق من عدم تعارضه).
4. **شبكة الشركة الحية:** `ether1–ether9` و`sfp-sfpplus1` تحمل حركة موظفين وWAN وربما VLANs/FastTrack/IPv6 غير موجودة في المختبر.

---

## ب. فحص ما قبل النشر (أوامر قراءة فقط)

نفّذ الملف المرفق [RB4011-PREFLIGHT-COMMANDS.rsc](RB4011-PREFLIGHT-COMMANDS.rsc) (أو انسخ أوامره يدوياً من WinBox Terminal) واحفظ المخرجات و`/export`:

| البند المفحوص | الأمر | ما الذي تبحث عنه؟ | النتيجة المقبولة | خطر يمنع النشر (`STOP`) |
| :--- | :--- | :--- | :--- | :--- |
| **الإصدار والمعمارية والموارد** | `/system resource print` و`/system package print` | `architecture-name=arm`، `RouterOS v7.x`، مساحة `free-hdd-space` و`free-memory`، وجود حزمة `hotspot` | `v7.x` مستقر، `hotspot` موجودة، قرص حر `> 20 MiB` | عدم وجود `hotspot` أو امتلاء `NAND` أو إصدار `v6` |
| **حالة `ether10` والـ `PoE-out`** | `/interface ethernet print where name="ether10"` و`/interface ethernet poe print` | هل `ether10` متصل؟ وهل يغذي Access Point عبر `PoE`؟ | وضوح توصيل `ether10` وخطة `PoE` | قطع تغذية غير مقصود عن جهاز شبكة قائم |
| **عضوية `Bridge` و`VLAN` و`Switch`** | `/interface bridge port print` و`/interface vlan print` و`/interface ethernet switch port print` | هل `ether10` عضو في `bridge` الشركة أو يشارك `VLAN` أو `hardware-offload` مع `ether6–ether9`؟ | `ether10` غير موجود في أي `bridge` أو `VLAN` للموظفين | `ether10` داخل `bridge` الموظفين (يتطلب مراجعة وعزلاً يدوياً أولاً) |
| **عناوين IP والشبكات والمسارات** | `/ip address print` و`/ip route print` و`/ip pool print` | هل الشبكة `192.168.20.0/24` مستخدمة؟ وما هي واجهة `WAN` الفعلية؟ | خلو `192.168.20.0/24` من أي تعارض ووضوح واجهة `WAN` | وجود `192.168.20.x` أو تداخل VPN/Routes |
| **خادم DHCP وHotSpot الحالي** | `/ip dhcp-server print` و`/ip hotspot print` | هل يوجد `HotSpot` أو `DHCP` على `ether10` أو على منافذ أخرى؟ | عدم وجود خادم HotSpot متداخل مع `ether10` | تعارض أسماء أو خادم HotSpot قائم على `ether10` |
| **DNS وFirewall وNAT (IPv4 + IPv6)** | `/ip dns print` و`/ip firewall filter print` و`/ip firewall nat print` و`/ipv6 firewall filter print` | قيمة `allow-remote-requests`، ترتيب قواعد `fasttrack-connection`، وحجب المنفذ `53` على WAN (IPv4 وIPv6) | `allow-remote-requests=yes` مع حجب صريح لـ `WAN TCP/UDP 53`، وفهم أثر `place-before=0` | `allow-remote-requests=no` (سيتوقف `deploy.rsc`) أو DNS مفتوح على WAN |
| **الوقت والشهادات والخدمات والمجدولات** | `/system clock print`، `/system ntp client print`، `/certificate print`، `/ip service print`، `/system scheduler print` | دقة ساعة `UTC` لنجاح TLS نحو Supabase، وطرق الوصول الإداري المتاحة (`winbox`/`ssh`) | ساعة `UTC` دقيقة، وسيلة إدارة بديلة شغالة | ساعة خاطئة (تفشل HTTPS TLS نحو Supabase) |

### قيم لا يمكن حسمها دون `/export` الحقيقي (يمنع التخمين)
1. الشبكة الفرعية الفعلية المخصصة لـ `ether10` (هل `192.168.20.0/24` متاحة أم يلزم تعديلها في `deploy.rsc`؟).
2. هل `ether10` داخل `bridge` أو `VLAN` أو يغذي جهازاً عبر `PoE-out`؟
3. اسم/قائمة واجهات `WAN` الفعلية وهل يوجد حجب `TCP/UDP 53` على `WAN` في IPv4 **و**IPv6.
4. حالة `/ip dns allow-remote-requests` الحالية (`true` أم `false`).
5. ترتيب قواعد Firewall الحالية (`fasttrack-connection`, `input`, `forward`) وتأثير إدراج قواعد `ether10` بـ `place-before=0`.

---

## ج. خطة النشر اليدوي المرتّبة (بعد إزالة جميع موانع القسم ب)

1. **النسخ الاحتياطي الإلزامي خارج الراوتر:**
   - نفّذ: `/export show-sensitive file=rb4011-pre-rawad-backup` و`/system backup save name=rb4011-pre-rawad-backup` وانقل الملفين إلى كمبيوتر الشركة فوراً.
2. **تأكيد الوصول الإداري البديل:**
   - تأكد من اتصالك عبر منفذ من `ether1–ether9` (عبر WinBox/SSH) وليس عبر `ether10`، وأن لديك طريقة وصول احتياطية (MAC-WinBox أو منفذ إدارة).
3. **تجهيز القيم على كمبيوتر الشركة (قبل الرفع):**
   - في نسخة محلية من [routeros/deploy.rsc](../routeros/deploy.rsc): تأكد أن `:local supabaseHost "stlrolkrqtbhkjztxudd.supabase.co"`، وضع في `:local routerSecret` قيمة `ROUTER_SHARED_SECRET` الإنتاجية الفعلية (المضبوطة في Supabase Secrets، دون حفظ السر في Git).
   - تأكد أن `:local guestIf "ether10"` وأن `:local guestGw` و`:local guestNet` لا تتعارض مع `/export` الحقيقي.
4. **تفعيل `Safe Mode`:**
   - اضغط `Ctrl+X` في Terminal (أو زر **Safe Mode** في WinBox) وتأكد من ظهور `<SAFE>` قبل أي تعديل.
5. **تشغيل الفحص التحضيري المحدّث:**
   - ارفع وشغّل [routeros/preflight.rsc](../routeros/preflight.rsc): `/import file-name=preflight.rsc`. توقف فوراً عند أي `CONFLICT` أو `ABORT_CONDITION`.
6. **رفع ملفات `hotspot/` والتحقق منها:**
   - انقل محتويات مجلد [hotspot/](../hotspot/) كاملاً (`login.html`, `status.html`, `alogin.html`, `logout.html`, `error.html`, `md5.js`, `assets/portal.js`, `assets/style.css`, `assets/logo.png`, `assets/fonts/cairo-arabic.woff2`, `assets/fonts/cairo-latin.woff2`) إلى مجلد `hotspot/` داخل RB4011 عبر WinBox Files أو `scp`.
   - تأكد عبر `/file print where name~"hotspot/"` من وجود الملفات الـ `11` وأحجامها.
7. **تنفيذ إعداد `ether10` والربط مع Supabase:**
   - نفّذ: `/import file-name=deploy.rsc`.
   - راقب ظهور `=== DEPLOYMENT COMPLETE (ether10 ONLY) ===` دون أخطاء.
8. **التحقق الأولي قبل إغلاق `Safe Mode`:**
   - نفّذ: `/import file-name=verify.rsc`.
   - تحقّق من جلب HTTPS من الراوتر إلى Production (`code=200`).
9. **اختبار لوحة الإدارة من كمبيوتر الشركة (`LAN`):**
   - افتح [admin/index.html](../admin/index.html) محلياً (أو عبر خادم ويب ساكن داخلي في LAN الموظفين فقط).
   - سجّل الدخول بحساب `hashim`، وأنشئ مستخدماً اختبارياً مؤقتاً (مثلاً بدقيقة واحدة)، وتأكد من ظهوره في `stlrolkrqtbhkjztxudd`.
10. **اختبار `Captive Portal` من جهاز عميل على `ether10`:**
    - وصّل جهاز عميل بمنفذ `ether10` (أو AP متصل به)، وتحقق من DHCP، ظهور البوابة تلقائياً، دخول المستخدم الاختباري، عمل الإنترنت، انعزال `ether1–ether9` (`ping` للشبكة الداخلية مرفوض)، ثم تعطيل المستخدم من لوحة الإدارة والتحقق من القطع التلقائي خلال `≤ 30s`، ثم حذف المستخدم الاختباري.
11. **التحقق من عدم تأثر `ether1–ether9` ثم إغلاق `Safe Mode`:**
    - تأكد على حاسوب موظفين متصل بـ `ether1–ether9` من استمرار الإنترنت، DNS، DHCP، والوصول الداخلي دون انقطاع. عند التأكد فقط أغلق `Safe Mode` (`Ctrl+X`).

---

## د. خطة التراجع السريعة (`Rollback`)

- **أثناء التفعيل (قبل إغلاق `Safe Mode`):** أغلق جلسة WinBox/Terminal أو أسقط `Safe Mode` لإلغاء جميع التغييرات تلقائياً فوراً.
- **بعد إغلاق `Safe Mode`:** شغّل `/import file-name=rollback.rsc` ([routeros/rollback.rsc](../routeros/rollback.rsc)) الذي يزيل موارد `rawad-guest-portal` على `ether10` فقط بعد التحقق من بصمة `rawad-portal-state`، دون مساس بـ `DNS`/`Clock`/`NTP` أو `ether1–ether9`. (التفاصيل في [RB4011-ROLLBACK.md](RB4011-ROLLBACK.md)).

---

## هـ. اختبارات ما بعد النشر (إلزامية)

- حصول عميل `ether10` على IP وGateway وDNS صحيح عبر DHCP.
- ظهور صفحة `Captive Portal` تلقائياً وتحميل CSS/JS/الخطوط/الشعار (`HTTP 200`).
- تسجيل دخول مستخدم محدود، منح الإنترنت، وظهور `rawad-verified` + `HotSpot Active`.
- انتهاء المدة / الإلغاء من لوحة الإدارة (`hashim`) -> القطع الفعلي -> `ACK` في Supabase.
- منع إعادة استخدام الحصة المجانية المستنفدة قبل منتصف الليل (`Asia/Baghdad`).
- إعادة تشغيل الراوتر (في نافذة صيانة) والتحقق من عودة الخدمة تلقائياً وبقاء `ether1–ether9` سليمة 100%.

---

## مصفوفة المخاطر والتصنيف الرسمي (`RB-065`)

| المتطلب / المكون | التصنيف الرسمي | التوضيح |
| :--- | :--- | :--- |
| قاعدة بيانات Production `stlrolkrqtbhkjztxudd` (`5` جداول، `RLS`, `8` RPCs) | **`VERIFIED`** | مفحوصة ومطبقة ومتطابقة مع `schema.sql`، مع `hashim` (`site_owner`) |
| دوال Edge Functions (`portal-auth`, `verify-mac`, `admin-api`) والأسرار | **`VERIFIED`** | منشورة `ACTIVE` ومختبرة في `RB-062`–`RB-064` |
| ملفات [admin/](../admin/) و[hotspot/](../hotspot/) في GitHub | **`VERIFIED`** | تشير جميعها إلى `stlrolkrqtbhkjztxudd` ومطابقة للنسخة المختبرة |
| اختبارات `30s`/`60s`، القطع الفعلي، `ACK`، بغداد `00:00`، والإلغاء عبر `CHR` + `Win10` | **`VERIFIED`** | مثبتة عملياً في مختبر `CHR x86_64` فقط |
| خلو `ether10` من `Bridge`/`VLAN`/`PoE` وتوفر `192.168.20.0/24` | **`BLOCKED — يحتاج إعدادات RB4011 الفعلية`** | لا يُحسم إلا عبر `/export` الحقيقي |
| حالة `/ip dns allow-remote-requests` وحجب `WAN 53` (IPv4 + IPv6) | **`BLOCKED — يحتاج إعدادات RB4011 الفعلية`** | بوابة `deploy.rsc` تتوقف (`ABORT`) إذا كان `false` |
| ترتيب قواعد `Firewall` (`place-before=0` vs `fasttrack`) وعدم تأثر `ether1–ether9` | **`BLOCKED — يحتاج إعدادات RB4011 الفعلية`** | يتطلب مراجعة `/export` واختبار استمرار `ether1–ether9` |
| أداء `ARM32` الفعلي، `NAND`، `DHCP Option 114`، ودقة ساعة UTC على العتاد | **`NOT TESTED`** | لم تُنفّذ على راوتر `RB4011` المادي بعد |
| تشغيل حاوية `busybox:musl` (`admin/`) أو نطاق عام / `DDNS` | **`NOT APPLICABLE`** | مستبعد عمداً من الإنتاج (اللوحة تُفتح محلياً من كمبيوتر الشركة داخل LAN) |
