# PRODUCTION-READINESS.md — التقرير النهائي لجاهزية الإنتاج وتصميم النشر على RB4011 (`ether10` حصراً)

يقدّم هذا التقرير تقييماً هندسياً دقيقاً لنسبة جاهزية نظام **Rawad Captive Portal** قبل تشغيله على راوتر **MikroTik RB4011iGS+RM** الفعلي في الشركة، مع تفصيل متطلبات العتاد (`RB-035`) وتصميم النشر الصارم المحصور في منفذ **`ether10` فقط** (`RB-036` الأقسام `A–F`).

> **قاعدة الفصل الصارمة:** قيود `ether10` و`ether1–ether9` الواردة أدناه تخص **بيئة الشركة الحقيقية (Production RB4011) فقط**، ولا تنطبق على بيئة المحاكاة الاختبارية `Rawad-CHR-Lab` التي تُستخدم حراً لاختبار السيناريوهات.

---

## 1. نسبة الجاهزية الإجمالية التقديرية

> **التقدير الصادق للجاهزية:** **~90% إجمالاً** (**~98%** للبرمجيات، PostgreSQL/Supabase، Edge Functions، البوابة، ولوحة الإدارة مع الاستضافة المحلية في LAN).

### تفصيل الجاهز مقابل غير المختبر
- **جاهز ومُثبت بأدلة المختبر و`Rawad Test`:** مخطط PostgreSQL 17 وRLS، دوال Edge Functions الثلاث (اجتياز 100 طلب متزامن بـ 0% أخطاء)، بوابة `hotspot/`، لوحة الإدارة الساكنة `admin/` (تعديل `.powered-by` في `RB-031` + اجتياز خادم LAN الساكن 10–100 طلب متزامن)، منطق RouterOS v7 (`on-login`، `ALLOW:UNLIMITED`، Fail-Closed، السحب التلقائي خلال ≤18ث)، وإصلاحات المرحلة 7 (`hotspot=auth` لـ `cUnverified`، `preflight.rsc`، `admin.js`).
- **غير مختبر ويحتاج `RB4011iGS+RM` الحقيقي (`~10%` المتبقية):**
  1. التنفيذ المادي على معمارية **`ARM32 / ARMv5`** وذاكرة **`NAND 512 MiB`**.
  2. فحص وتكوين منفذ **`ether10`** الفيزيائي ورقاقة التبديل **`RTL8367SB`** وفصل الجسر و`PoE-out` على لوحة الشركة.
  3. اختبار **`DHCP Option 114 (RFC 8910)`** فعلياً على هواتف iOS/Android حديثة عبر Wi-Fi الشركة.
  4. اختبار مزامنة **`NTP`** وتجاوز منفذ WAN الفعلي لشركة رواد مع بوابة إثبات حظر DNS port `53`.
  5. **اختبارات عدم التأثير على منافذ الشركة `ether1–ether9`** قبل وبعد النشر وعند التراجع.

---

## 2. مراجعة التوافق والعتاد (`RB-035`: `MikroTik RB4011iGS+RM`)

| المواصفة الحقيقية للراوتر | الحالة والأثر التصميمي |
| :--- | :--- |
| **Architecture: `ARM32 / ARMv5`** | أوامر RouterOS v7 النصية موحدة منطقياً مع `CHR x86_64`، **لكن تشغيل الحاويات `busybox:musl` على ARM32 غير مختبر محلياً (عدم توفر QEMU/Hyper-V) وممنوع اعتماده على RB4011 دون اختبار عتادي مستقل** |
| **RAM: `1 GiB`** | كافية تماماً لتشغيل HotSpot وFirewall وNAT على `ether10` مع شبكة الشركة، بشرط إبقاء لوحة الإدارة خارج الراوتر |
| **NAND: `512 MiB`** | ذاكرة فلاش داخلية محدودة وحساسة للكتابة المتكررة؛ ملفات `hotspot/` (`~278 KB`) ساكنة ولا تستهلك كتابات متكررة، بينما تثبيت حاوية أو سجلاتها يستهلك قطاعات NAND ويعرّض الراوتر لخطر الامتلاء/التآكل |
| **Switch Chip: `RTL8367SB` (مزدوجة)** | تربط `ether6–ether10` معاً؛ إذا كان `ether10` ضمن `bridge` واحد مع `ether6–ether9` على شريحة التبديل فيجب عزله بعناية ودون تعطيل `hardware-offload` لمنافذ الموظفين `ether1–ether9` |
| **RouterOS `7.x`** | مطلوب RouterOS v7 لتشغيل تعبيرات `($res->"code")` في `/tool fetch` ودالة `hotspot=auth` وجدار الحماية وDHCP Option 114 |

### الفصل المعماري المعتمد (ما يعمل داخل الراوتر مقابل خارجه)
- **داخل `RB4011` (`ether10` فقط):** HotSpot Captive Portal UI (`hotspot/`)، `DHCP`/`NAT`/`Firewall` لـ `192.168.20.0/24`، Walled Garden نحو مشروع Supabase الإنتاجي فقط، ومجدول `rawad-sync-revocations`.
- **خارج `RB4011` (Zero-VPS & Zero Router Container):**
  - قاعدة البيانات والمنطق السحابي والمصادقة: **Supabase (`PostgreSQL` + `Edge Functions`)**.
  - **لوحة الإدارة (`admin/` — `270.6 KB`):** تُستضاف **على حاسوب/خادم محلي داخل شبكة الموظفين في الشركة (Internal LAN Static Host)** بدلاً من تحميل RB4011 تشغيل Web Server داخل Container (`RB-034`).

---

## 3. تصميم النشر في الشركة وفق شرط `ether10` حصراً (`RB-036`: البنود `A–F`)

### A. حماية المنافذ الأخرى (`ether1` إلى `ether9`)
- **عدم لمس `ether1–ether9` إطلاقاً:** لا تعديل على أي عنوان IP، بوابة Gateway، خادم/مسبح DHCP، خادم DNS الخاص بالموظفين، إعدادات VLAN/Bridge، تفريغ عتاد Switch Chip (`RTL8367SB`)، قواعد Firewall/NAT/Mangle/Routing الحالية، أو واجهة WAN الخاصة بالشركة.
- تبقى حركة مرور جميع أجهزة وموظفي الشركة المتصلين بمنافذ `ether1–ether9` و`sfp-sfpplus1` معزولة كلياً عن خدمة الضيوف الجديدة.

### B. تخصيص `ether10` ونطاق النظام الجديد (وتحليل الإعدادات المشتركة)
- يُحصر النشر في واجهة **`ether10`** فقط: IP `192.168.20.1/24`، DHCP Pool/Network/Server (`rawad-guest-*`)، Walled Garden (نطاق مشروع Supabase فقط)، HotSpot (`rawad-guest-hotspot`)، Firewall (`in-interface=ether10`) لمنع أي اتصال من الضيوف بـ `10.0.0.0/8` و`172.16.0.0/12` و`192.168.0.0/16` ومنافذ إدارة الراوتر وIPv6، وNAT محصور بـ `src-address=192.168.20.0/24 dst-address=!192.168.0.0/16`.
- **شفافية الإعدادات العامة الثلاثة في [routeros/deploy.rsc](routeros/deploy.rsc) وتأثيرها:**
  1. `/ip dns set allow-remote-requests=yes`: إعداد على مستوى الراوتر ليخدم استعلامات DNS لضيوف `ether10`. **مخاطره المحتملة:** لو لم يكن WAN محجوباً على المنفذ `53` لأصبح الراوتر Open Resolver. لذلك يفرض `deploy.rsc` بوابة فحص صارمة (`[1/9]`) توقف النشر فوراً (`ABORT`) إذا لم يثبت حظر TCP/UDP `53` على جميع واجهات `WAN`. وإذا كانت `ether1–ether9` تستخدم DNS خارجياً عبر DHCP فهي غير متأثرة، وإن استخدمت DNS من غير موجه الشركة يجب التحقق منه قبل التفعيل.
  2. `/system clock set time-zone-name=Asia/Baghdad`: ضبط المنطقة الزمنية للنظام.
  3. `/system ntp client set enabled=yes`: تفعيل عميل NTP لضمان دقة توقيت الراوتر. (تحفظ السكربتات القيم السابقة الثلاث في `rawad-portal-state` لاستعادتها عند التراجع).

### C. الفحص الإلزامي قبل النشر (8 خطوات على `RB4011` الحقيقي قبل أي تنفيذ)
نفّذ [routeros/preflight.rsc](routeros/preflight.rsc) (سكربت قراءة فقط) مع مراجعة `/export` الكامل لـ RB4011 للتحقق من:
1. الحصول على `/export` كامل لإعدادات `RB4011` الحقيقية وحفظه خارج الراوتر مع نسخة ثنائية `/system backup save`.
2. فحص عضوية المنافذ في `/interface bridge port` والتأكد أن `ether10` غير مضاف لجسر الشركة.
3. فحص `/interface vlan` وخصائص `Switch Chip` (`RTL8367SB`) و`PoE-out` على `ether10`.
4. فحص `/ip address` و`/ip dhcp-server` و`/ip route` لضمان عدم وجود `192.168.20.0/24` أو تعارض مسارات.
5. فحص `/ip firewall filter`, `/ip firewall nat`, `/ip firewall mangle`, و`/ipv6 firewall filter` حول `ether10` وقواعد WAN.
6. فحص إعدادات `WAN` و`DNS` وإثبات حظر `TCP/UDP 53` من WAN.
7. تحديد الوضع المادي الحالي لـ `ether10` (هل الكابل موصول بـ AP ضيوف مستقل؟ هل يغذي `PoE`؟).
8. إثبات إمكانية عزل `ether10` دون أي تعديل مشترك يمس `ether1–ether9`.
> **قاعدة إيقاف إلزامية:** إذا كان `ether10` حالياً جزءاً من جسر مشترك أو VLAN موظفين بحيث يتطلب فصله إعادة ترقيم أو تغييراً قد يقطع `ether1–ether9`، **يُوقف النشر فوراً** ويُصمم بديل ميداني (مثل استخدام منفذ/VLAN معزول مخصص بالاتفاق مع مهندس الشبكة) قبل التنفيذ.

### D. شروط التوقف الحتمية (`Stop Conditions`)
يُمنع منعاً باتاً تنفيذ `deploy.rsc` على RB4011 إذا ظهر أي من التالي:
1. عدم توفر نسخة احتياطية كاملة (`/export` + `.backup` ثنائي + نسخة PG 17 ثلاثية لقاعدة Supabase الإنتاجية).
2. تعذر التنبؤ الدقيق بتأثير أي أمر على `ether1–ether9` أو WAN.
3. الحاجة إلى تعديل إعداد مشترك غير مأمون (مثل قواعد Firewall/NAT عامة أو إزالة `bridge` رئيسي).
4. وجود تعارض في IP (`192.168.20.x`) أو DHCP أو Bridge أو VLAN أو أسماء `rawad-*` مسبقة.
5. عدم جاهزية خطة التراجع الدقيقة أو فشل `preflight.rsc`.
6. تعذر إثبات عزل `ether10` عن `ether1–ether9` وعن Open-Resolver Port `53`.

### E. خطة التراجع الجراحية في الإنتاج
- استخدام [routeros/rollback.rsc](routeros/rollback.rsc) حصراً، حيث يعتمد على `rawad-portal-state` و`rawad-portal-anchor` لإزالة العناصر ذات التعليق/الاسم `rawad-guest-*` و`ether10` التي أنشأها النشر فقط.
- **ممنوع منعاً باتاً** استخدام أي أوامر مسح عامة (`remove [find]` دون قيد) أو `system reset-configuration` أو استعادة `.backup` شاملة بعد تغييرات غير مدروسة بطريقة تؤثر على `ether1–ether9` (ولا تُستخدم الاستعادة الشاملة إلا في طوارئ العتاد الكارثية وبموافقة مسؤول الشبكة). التفاصيل الكاملة في [ROLLBACK.md](ROLLBACK.md).

### F. خطة اختبار إثبات عدم التأثير على المنافذ `ether1–ether9` (للتنفيذ الميداني بالشركة)
> **تنويه صريح:** لا يمكن إثبات عدم التأثير على شبكة الشركة الحقيقية عبر محاكاة CHR وحدها؛ تُنفذ هذه الخطة ميدانياً على راوتر RB4011 في الشركة باستخدام حاسوب اختبار متصل على `ether1–ether9` بالتوازي مع هاتف اختبار على `ether10`:
1. **قياس خط الأساس قبل النشر (على منفذ من `ether1–ether9`):**
   - استمرار `ping` مراقبة (`0% loss` نحو البوابة والإنترنت).
   - نجاح `DNS`, `HTTP`, `HTTPS`.
   - نجاح تجديد `DHCP lease` (`ipconfig /renew`) وبقاء عنوان الموظفين والـ Gateway وRouting سليماً.
2. **أثناء وبعد تنفيذ `deploy.rsc` على `ether10`:**
   - مراقبة عدم انقطاع الحزم أو الجلسات النشطة على حاسوب `ether1–ether9`.
   - إعادة فحص الإنترنت، DNS/HTTP/HTTPS، وتجديد DHCP على `ether1–ether9`.
   - التحقق من حاسوب `ether10` (الضيف) أنه محجوب تماماً عن الوصول لأي عنوان داخل `ether1–ether9`.
3. **عند اختبار التراجع (`rollback.rsc`):**
   - تنفيذ `rollback.rsc` ومراقبة استمرار الإنترنت والـ DHCP والـ DNS على `ether1–ether9` دون أي تأثر، وزوال خدمات HotSpot على `ether10` فقط.

---

## 4. خطة التنفيذ الميداني لاحقاً (عند توفر RB4011 ومشروع Supabase الإنتاجي)
1. مراجعة قائمة القيم الثابتة التي يجب تبديلها نحو الإنتاج (مرصودة في `RB-038`): تحديث `supabaseUrl` و`supabasePublishableKey` في [hotspot/login.html](hotspot/login.html) و[hotspot/status.html](hotspot/status.html) و[admin/index.html](admin/index.html)، ومراجعة حارس المعرف الثابت في [supabase/functions/admin-api/index.ts](supabase/functions/admin-api/index.ts#L160) (الذي يُكمله تحقق الدور الديناميكي بالسطر `170`).
2. تطبيق [supabase/schema.sql](supabase/schema.sql) أو الترحيلات على مشروع Supabase الإنتاجي (بعد نسخة PG 17 ثلاثية)، نشر Edge Functions الثلاث بأسرار إنتاج جديدة (`ROUTER_SHARED_SECRET`, `ADMIN_TOKEN_SECRET`)، وإنشاء حساب `site_owner` الإنتاجي.
3. استضافة `admin/` ساكناً على حاسوب/خادم LAN للموظفين فقط (بدون حاوية RB4011).
4. تنفيذ [routeros/preflight.rsc](routeros/preflight.rsc) على RB4011 -> التحقق من البنود `[C]` و`[D]` وقياس خط الأساس `[F]` -> رفع `hotspot/` -> تنفيذ [routeros/deploy.rsc](routeros/deploy.rsc) -> التحقق عبر [routeros/verify.rsc](routeros/verify.rsc) + اختبار `ether10` و`ether1–ether9` وفق `[F]`.
