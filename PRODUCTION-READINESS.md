# PRODUCTION-READINESS.md — التقرير النهائي لجاهزية الإنتاج وتصميم النشر على RB4011 (`ether10` حصراً)

يقدّم هذا التقرير تقييماً هندسياً دقيقاً لنسبة جاهزية نظام **Rawad Captive Portal** قبل تشغيله على راوتر **MikroTik RB4011iGS+RM** الفعلي في الشركة، مع تفصيل متطلبات العتاد (`RB-035`) وتصميم النشر الصارم المحصور في منفذ **`ether10` فقط** (`RB-036` الأقسام `A–F`).

> **قاعدة الفصل الصارمة والنطاق (`Scope`):** يقتصر النظام على **المصادقة، فحص `MAC`/الصلاحيات، منح وإلغاء وصول HotSpot، ومزامنة الجلسات ولوحة الإدارة** (لا إدارة للسرعة أو `Bandwidth`). وتخص قيود `ether10` و`ether1–ether9` الواردة أدناه **بيئة الشركة الحقيقية (Production RB4011) فقط**، ولا تنطبق على بيئة المحاكاة الاختبارية `Rawad-CHR-Lab` التي تُستخدم حراً لاختبار السيناريوهات.

---

## 1. الحالة الرسمية للجاهزية ونشر الإنتاج

> **حالة النشر الإنتاجي على شركة رواد (`RB4011`):** **`BLOCKED`** — **يُمنع النشر على الراوتر الإنتاجي حتى إثبات عزل الإعدادات العامة (ولا سيما `DNS` وIPv6 WAN)، مراجعة `/export` الفعلي، وتنفيذ اختبارات عدم التأثير على المنافذ `ether1–ether9`.**  
> **الجاهزية البرمجية والمخبرية (`CHR x86_64` + `Rawad Test`):** **`~90% إجمالاً`** (**`~98%`** للبرمجيات، PostgreSQL/Supabase، Edge Functions، البوابة، وخادم LAN الساكن؛ مقابل **`~10%`** وموانع `BLOCKED`/`NOT TESTED` عتادية وميدانية لم تُختبر بعد على `RB4011` الحقيقي).

### تفصيل المثبت مخبرياً مقابل المحظور وغير المختبر
- **مثبت في المحاكاة (`Rawad-CHR-Lab` + `RAWAD-WIN10-CLIENT` + `Rawad Test`):**
  - مخطط PostgreSQL 17 مع فهرسَي التوسع الجزئيّين (`idx_sessions_pending_revocations`, `idx_sessions_active_expires`) وRLS (`HTTP 401` لـ `anon`، `42501` للاستدعاء القرائي المباشر لـ RPCs)، دوال Edge Functions الثلاث المحسّنة بـ `getDb()`، وتدفق المصادقة المتكامل (`RB-045` & `RB-052`) حتى **`350` مستخدماً (أحادي العملية)** و**`400` مستخدماً (مولّد `5` عمليات معاير، `400/400`, `47.76 rps`, `p50=7502ms`, `p95=7606ms`, `p99=7631ms`, `0` أخطاء) مع اجتياز `500/500` في دفعة معزولة فقط (وتصنيف `500` كـ `INCONCLUSIVE/UNSTABLE FOR SLA` لظهور `UND_ERR_CONNECT_TIMEOUT` عند الضغط التتابعي، واعتماد هامش أمان **`200–250` مستخدماً متزامناً**) وصفر جلسات يتيمة/مكررة.
  - بوابة `hotspot/`، لوحة الإدارة `admin/` الساكنة على خادم LAN محلي (`RB-034`: `100/100 HTTP 200` حتى `n=100`، `1587.3 rps`، `max=59ms` — بخلاف `CHR BusyBox httpd` الذي فشل عند `n=100` بـ `63/100 200` ولا يُعتمد للإنتاج)، ومنطق RouterOS v7 (`ALLOW:<sec>`, `ALLOW:UNLIMITED`, `Fail-Closed` حي `GATE_HTTP=200 FC_INET=000`, السحب التلقائي خلال `≤18s`).
- **غير مختبر ويُبقي النشر الإنتاجي في حالة `BLOCKED` حتى استيفائه ميدانياً:**
  1. التنفيذ المادي على معمارية **`ARM32 / ARMv5`** وذاكرة **`NAND 512 MiB`**.
  2. تدقيق `/export` الفعلي لـ `RB4011` والتحقق من عدم عضوية **`ether10`** في جسر الشركة أو VLAN موظفين مع رقاقة **`RTL8367SB`** و`PoE-out`.
  3. **إثبات أمان `DNS` العام و`IPv4 + IPv6` WAN `TCP/UDP 53`**، أو تأكيد مسبقة تفعيل `allow-remote-requests=yes` بأمان في راوتر الشركة دون فتح Open Resolver ودون تغيير سلوك `ether1–ether9`.
  4. اختبار **`DHCP Option 114 (RFC 8910)`** فعلياً على هواتف iOS/Android حديثة وقياس قدرة `/tool fetch` المتزامنة وأقصى عدد مستخدمين فعلي على عتاد RB4011 (`241` عنواناً على `/24` و`shared-users=250` نظرياً في `deploy.rsc`).
  5. **تنفيذ اختبارات استمرار الإنترنت وDNS وDHCP على منافذ الشركة `ether1–ether9`** قبل النشر وأثناءه وبعده وعند التراجع.

---

## 2. مراجعة التوافق والعتاد (`RB-035`: `MikroTik RB4011iGS+RM`)

| المواصفة الحقيقية للراوتر | الحالة والأثر التصميمي |
| :--- | :--- |
| **Architecture: `ARM32 / ARMv5`** | أوامر RouterOS v7 النصية موحدة منطقياً مع `CHR x86_64`، **لكن تشغيل الحاويات `busybox:musl` على ARM32 محظور (`BLOCKED`) محلياً (غياب QEMU/Hyper-V) وممنوع اعتماده على RB4011** |
| **RAM: `1 GiB`** | كافية تماماً لتشغيل HotSpot وFirewall وNAT على `ether10` مع شبكة الشركة، بشرط إبقاء لوحة الإدارة خارج الراوتر |
| **NAND: `512 MiB`** | ذاكرة فلاش داخلية محدودة وحساسة للكتابة المتكررة؛ ملفات `hotspot/` (`~278 KB`) ساكنة، بينما تثبيت حاوية يهدد بامتلاء وتآكل NAND |
| **Switch Chip: `RTL8367SB` (مزدوجة)** | تربط `ether6–ether10` معاً؛ يجب عزل `ether10` بعناية دون تعطيل `hardware-offload` لمنافذ الموظفين `ether1–ether9` |
| **RouterOS `7.x`** | مطلوب RouterOS v7 لتشغيل تعبيرات `($res->"code")` في `/tool fetch` ودالة `hotspot=auth` وجدار الحماية وDHCP Option 114 |

### الفصل المعماري المعتمد (ما يعمل داخل الراوتر مقابل خارجه)
- **داخل `RB4011` (`ether10` فقط):** HotSpot Captive Portal UI (`hotspot/`)، `DHCP`/`NAT`/`Firewall` لـ `192.168.20.0/24`، Walled Garden مقيد بـ `server="rawad-guest-hotspot"` نحو مشروع Supabase الإنتاجي فقط، ومجدول `rawad-sync-revocations`.
- **خارج `RB4011` (Zero-VPS & Zero Router Container):**
  - قاعدة البيانات والمنطق السحابي والمصادقة: **Supabase (`PostgreSQL` + `Edge Functions`)** (مشروع مستقل واحد لكل راوتر لتجنب سباق سحب الجلسات `ACK`).
  - **لوحة الإدارة (`admin/` — `270.6 KB`):** تُستضاف **على حاسوب/خادم محلي داخل شبكة الموظفين في الشركة (Internal LAN Static Host)** بدلاً من Container على الراوتر (`RB-034`).

---

## 3. المراجعة النهائية للعزل الإنتاجي الصارم في `ether10` (`RB-036` + `RB-041`)

### A. حماية المنافذ الأخرى (`ether1` إلى `ether9`)
- **حظر تعديل الإعدادات العامة أو المشتركة:** تم تحديث [routeros/deploy.rsc](routeros/deploy.rsc) و[routeros/rollback.rsc](routeros/rollback.rsc) في `RB-041` **لإزالة جميع أوامر التعديل العامة نهائياً** (`/ip dns set`, `/system clock set`, `/system ntp client set`).
- **لا لمس لـ `ether1–ether9` أو `sfp-sfpplus1`:** لا تعديل على أي IP أو Gateway أو DHCP أو DNS موظفين أو VLAN/Bridge أو Switch Chip أو قواعد WAN/LAN القائمة.
- **عزل نطاقات HotSpot والضيف:** تم حصر مستخدم `rawad-gate` وقاعدة `walled-garden` بمعامل `server="rawad-guest-hotspot"`، وحصر مسح `on-logout` بتعليق `comment="rawad-guest-portal"` فقط، كي لا يتقاطعا إطلاقاً مع أي خدمات أخرى على الراوتر.

### B. تحليل الإعدادات العامة الثلاثة التي كانت في `deploy.rsc` (`RB-041`)

| الإعداد العام السابق | هل هو ضروري؟ | تأثيره على `ether1–ether9` والشبكة | القرار المعتمد في السكربت والبدائل الآمنة |
| :--- | :---: | :--- | :--- |
| `/ip dns set allow-remote-requests=yes` | **ضروري فقط** إذا كان ضيوف `ether10` سيستخدمون IP الراوتر `192.168.20.1` كخادم DNS | **يفتح مستمع DNS `TCP/UDP 53` على جميع عناوين وواجهات الراوتر غير المحمية في `input`**؛ لذا إن لم يكن هناك حجب صريح على WAN (IPv4 **وIPv6**) وعلى أي واجهة غير موثوقة يتحول الراوتر إلى Open DNS Resolver ويمس سياسة DNS على `ether1–ether9` | **حُذف التعديل من `deploy.rsc` و`rollback.rsc` نهائياً** واستُبدل **ببوابة توقف قرائية (`ABORT` إذا كانت `false`)** + حظر `input 53` على WAN IPv4 في `deploy.rsc` + فحص IPv6 `input` في `preflight.rsc`. **البديل الآمن إن كانت `false` في الشركة:** إما مراجعة Firewall (IPv4+IPv6) وتفعيلها بقرار مهندس الشبكة، أو تغيير `dns-server` في شبكة DHCP الخاصة بـ `ether10` إلى خادم DNS معزول/مسموح في Walled Garden بدلاً من DNS الراوتر |
| `/system clock set time-zone-name=Asia/Baghdad` | **غير ضروري** على الراوتر | يغيّر المنطقة الزمنية العامة لجميع سجلات وتوقيتات ومجدولات الشركة | **حُذف نهائياً** من `deploy.rsc` و`rollback.rsc` (حساب اليوم الحالي بتوقيت `Asia/Baghdad` يتم داخل PostgreSQL في Supabase، ولا يحتاج تغيير توقيت الراوتر) |
| `/system ntp client set enabled=yes` | **غير ضروري** تفعيله تلقائياً من السكربت | يفعّل عميلاً عاماً قد يتعارض مع خوادم وقت داخلية أو سياسة المزامنة للشركة | **حُذف نهائياً** من `deploy.rsc` و`rollback.rsc` واكتُفي بقراءته في `preflight.rsc`؛ يلزم فقط أن تكون ساعة UTC مضبوطة يدوياً/مسبقاً لنجاح TLS نحو Supabase |

> **تنبيه معماري حاسم:** مجرد استخدام النظام الجديد لخدمة DNS أو ترتيب قواعد `place-before=0` في سلسلة `forward`/`input` لا يعني انعزالها ما لم يُراجَع `/export` الكامل لـ `RB4011` للتحقق من عدم وجود قواعد متقدمة على `ether1–ether9` أو واجهة `IPv6 WAN`؛ ولذلك يبقى النشر الإنتاجي بحالة **`BLOCKED`** حتى إتمام هذا التدقيق الميداني.

### C. الفحص الإلزامي قبل النشر (9 خطوات قراءة فقط على `RB4011` الحقيقي)
نفّذ [routeros/preflight.rsc](routeros/preflight.rsc) (سكربت قراءة فقط لا يعدّل أي إعداد) مع مراجعة `/export` الكامل لـ `RB4011` للتحقق من:
1. الحصول على `/export` كامل لـ `RB4011` وحفظه خارج الراوتر مع نسخة ثنائية `/system backup save`.
2. فحص عضوية المنافذ في `/interface bridge port` والتأكد أن `ether10` غير مضاف لأي جسر في الشركة.
3. فحص `/interface vlan` وخصائص `RTL8367SB` و`PoE-out` على `ether10`.
4. فحص `/ip address` و`/ip dhcp-server` و`/ip route` لضمان عدم وجود `192.168.20.0/24` أو تعارض مسارات.
5. فحص `/ip hotspot print where interface!="ether10"` للتأكد من عدم وجود خوادم HotSpot متعارضة على المنافذ الأخرى.
6. فحص `/ip firewall filter`, `/ip firewall nat`, `/ip firewall mangle`, و`/ipv6 firewall filter` حول `ether10`.
7. فحص `/ip dns get allow-remote-requests` + قواعد `input` على **IPv4 وIPv6 WAN** لمنفذ `53` (سيتوقف `deploy.rsc` فورياً إن كانت `false` أو وُجد تجاوز لـ IPv4 Port `53` على WAN).
8. فحص `/system clock print` و`/system ntp client print` لضمان صحة وقت UTC للتحقق من شهادة TLS لـ Supabase.
9. تحديد الوضع المادي لـ `ether10` وإثبات إمكانية عزله دون أي تعديل مشترك على `ether1–ether9`.

### D. شروط التوقف الحتمية (`Stop Conditions`)
يُمنع منعاً باتاً تنفيذ [routeros/deploy.rsc](routeros/deploy.rsc) على `RB4011` إذا ظهر أي من التالي:
1. عدم توفر نسخة احتياطية كاملة (`/export` + `.backup` ثنائي + نسخة PG 17 ثلاثية لقاعدة Supabase الإنتاجية).
2. كون `/ip dns allow-remote-requests=false` في الشركة دون حسم بديل DNS آمن، أو وجود قبول غير محمي على `TCP/UDP 53` في `IPv4` أو `IPv6` WAN.
3. وجود `ether10` داخل Bridge/VLAN مشترك مع `ether1–ether9` بحيث يتطلب فصله تغييراً يمس الموظفين.
4. تعذر التنبؤ الدقيق بتأثير أي قاعدة (بما فيها قواعد `place-before=0`) على حركة `ether1–ether9` أو WAN.
5. وجود تعارض في IP (`192.168.20.x`) أو DHCP أو HotSpot أو أسماء `rawad-*` مسبقة.
6. عدم التحقق من مزامنة `supabase_migrations.schema_migrations` قبل نشر أي ترحيل لاحق.

### E. خطة التراجع الجراحية في الإنتاج
- استخدام [routeros/rollback.rsc](routeros/rollback.rsc) حصراً، المعتمد على التحقق الرقمي (`rawad-portal-state` + `rawad-portal-anchor`) لفصل جلسات `rawad-guest-hotspot` النشطة وإزالة موارد `ether10` التي أنشأها النشر فقط **دون أي مساس بإعدادات `DNS` أو `Clock` أو `NTP` العامة**.
- **ممنوع منعاً باتاً** استخدام `remove [find]` دون قيد أو `system reset-configuration`. التفاصيل الكاملة في [ROLLBACK.md](ROLLBACK.md).

### F. خطة اختبار إثبات عدم التأثير على `ether1–ether9` (شرط إلزامي لرفع حالة `BLOCKED`)
> **تنويه صريح:** لا يُعتبر شرط `ether10` محققاً بالكامل ولا يُسمح بالتشغيل الدائم في الشركة إلا بعد تنفيذ هذه الاختبارات ميدانياً على راوتر `RB4011` باستخدام حاسوب موظفين على `ether1–ether9` مع هاتف/جهاز ضيف على `ether10`:
1. **قبل النشر (على `ether1–ether9`):** قياس استمرارية `ping` (`0% loss`), نجاح `DNS/HTTP/HTTPS`, ونجاح `DHCP renew`.
2. **أثناء وبعد تنفيذ `deploy.rsc` على `ether10`:** التحقق من `0%` انقطاع على `ether1–ether9`، إعادة اختبار `DNS/HTTP/HTTPS` و`DHCP renew`، والتحقق من حاسوب `ether10` أنه محجوب كلياً عن `ether1–ether9` وواجهة الإدارة وDNS الخارجي المباشر، وفحص `IPv4+IPv6 WAN 53`.
3. **عند اختبار التراجع (`rollback.rsc`):** التحقق من استمرار الإنترنت والـ DHCP والـ DNS على `ether1–ether9` دون أي انقطاع أو تغيّر في الإعدادات العامة، مع زوال موارد `ether10` فقط.

---

## 4. خطة التنفيذ الميداني لاحقاً ومزامنة Supabase Migrations (`RB-042`)
1. مراجعة القيم الثابتة واستبدالها للإنتاج (`RB-038`): تحديث `supabaseUrl` و`supabasePublishableKey` في [hotspot/login.html](hotspot/login.html), [hotspot/status.html](hotspot/status.html), [admin/index.html](admin/index.html)، مراجعة المعرف الثابت في [supabase/functions/admin-api/index.ts](supabase/functions/admin-api/index.ts#L160)، وإنشاء أسرار إنتاجية جديدة (`ROUTER_SHARED_SECRET`, `ADMIN_TOKEN_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`).
2. **مزامنة سجل Migrations بأمان دون إعادة تنفيذ DDL/DML أو حذف بيانات:** تطبيق [supabase/schema.sql](supabase/schema.sql) (أو استخدام `supabase db push` من الصفر على مشروع إنتاج فارغ)؛ وإذا طُبّق المخطط مباشرة بـ `psql` (كما حدث في `Rawad Test` حيث ظهر عدم وجود مخطط `supabase_migrations` وظهور `remote=""` في `supabase migration list --linked`)، تُسجّل الإصدارات المطبّقة ميتاداتياً فقط بعد أخذ نسخة PG 17 ثلاثية عبر:
   ```powershell
   npx supabase migration repair --status applied 202611180001 202611180002 202611190001 --remote
   npx supabase migration list --remote
   npx supabase db push --dry-run
   ```
3. نشر Edge Functions الثلاث بأسرار الإنتاج، واستضافة `admin/` ساكناً داخل LAN الموظفين فقط (بدون حاوية RB4011).
4. تنفيذ [routeros/preflight.rsc](routeros/preflight.rsc) -> مراجعة `/export` و`[B]` و`[C]` و`[D]` وخط الأساس `[F]` -> رفع `hotspot/` -> تنفيذ [routeros/deploy.rsc](routeros/deploy.rsc) و[routeros/verify.rsc](routeros/verify.rsc) -> إتمام اختبارات `ether10` و`ether1–ether9` لرفع حالة `BLOCKED`.
