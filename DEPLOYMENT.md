# DEPLOYMENT.md — دليل النشر (MikroTik HotSpot + Supabase)

> **حالة النشر الإنتاجي الآن (`RB-059` / `RB-060`):** **`BLOCKED`** — يُمنع البدء بالنشر على راوتر الشركة الحقيقي **RB4011** قبل استلام ومراجعة `/export` الفعلي، تدقيق عزل `ether10` و`IPv4 + IPv6 WAN DNS 53`، واجتياز اختبارات عدم التأثير على `ether1–ether9` (راجع [PRODUCTION-READINESS.md](PRODUCTION-READINESS.md)).  
> **النطاق الرسمي:** يقتصر النظام على المصادقة، فحص `MAC`/الصلاحيات، منح وإلغاء وصول HotSpot، مزامنة `Revocation`/`ACK`، ولوحة الإدارة فقط دون إدارة سرعة الإنترنت أو `Bandwidth`.

1. **بيئة الإنتاج المعتمدة (`RB-062`):**
   - **المشروع:** `Rawad Internet` (`Rawad Captive Portal`) — `Project Ref`: `stlrolkrqtbhkjztxudd` — المنطقة: `Europe (Ireland) / eu-west-1`.
   - **اتصال PostgreSQL المعتمد:** `Session Pooler IPv4` على `aws-1-eu-west-1.pooler.supabase.com:5432` (`postgres.stlrolkrqtbhkjztxudd`).
   - **ملاحظة البدء الأولي:** قاعدة Production (`stlrolkrqtbhkjztxudd`) مهيأة بالكامل (5 جداول، RLS، 8 RPCs، سجل الترحيلات، الأسرار الثلاثة، دوال `portal-auth`, `verify-mac`, `admin-api`، وحساب المدير الرئيسي `hashim` بصلاحية `site_owner` مُنشأ ومختبر في `RB-063`). لإضافة مدراء آخرين لاحقاً، استخدم لوحة الإدارة بحساب `hashim`.

2. **إعداد Supabase (لإعادة البناء من الصفر عند الحاجة):**
   - نفّذ [supabase/schema.sql](supabase/schema.sql) في مشروع Supabase (آمن لإعادة التطبيق دون حذف البيانات)، أو طبّق مجلد [supabase/migrations/](supabase/migrations/) عبر `npx supabase db push` على مشروع جديد.
   - إذا طُبّق المخطط مباشرة عبر `psql`/SQL، زامن سجل التتبع ميتاداتياً دون إعادة تطبيق التغييرات عبر: `npx supabase migration repair --status applied 202611180001 202611180002 202611190001 --remote`.
   - انشر Edge Functions الثلاث: `portal-auth`, `verify-mac`, `admin-api`.
   - اضبط الأسرار على Supabase (`ROUTER_SHARED_SECRET`, `ADMIN_TOKEN_SECRET`).
   - أضف حساب المدير الأول في `public.admins` بتوليد تجزئة `pbkdf2:<salt_hex>:<hash_hex>` (عبر دالة `hashPassword` في [supabase/functions/_shared/crypto.ts](supabase/functions/_shared/crypto.ts)) وإدراجها في `public.admins`.

2. **إعداد ملفات الواجهة والإدارة:**
   - حدّث `supabaseUrl` و`supabasePublishableKey` في [hotspot/login.html](hotspot/login.html) و[hotspot/status.html](hotspot/status.html)، وحدّث `supabaseUrl` و`supabaseAnonKey` في [admin/index.html](admin/index.html) (لا تضع `service_role` أو `ROUTER_SHARED_SECRET` أبداً في المتصفح).
   - ارفع محتويات `hotspot/` إلى مجلد `hotspot` داخل MikroTik.
   - استضف مجلد `admin/` كملفات ساكنة داخل **شبكة الموظفين الداخلية (`LAN`) فقط** أو افتح [admin/index.html](admin/index.html) محلياً من جهاز إدارة موثوق (بدون Vercel/VPS ودون تشغيل حاوية على RB4011).

3. **إعداد MikroTik (`ether10` فقط):**
   - خذ أولاً نسخاً احتياطية خارج الراوتر (`/export` و`/system backup save`).
   - شغّل الفحص القرائي [routeros/preflight.rsc](routeros/preflight.rsc) وتأكد من انعدام أي `CONFLICT` أو `ABORT_CONDITION` ومن ثبات `ether1–ether9`.
   - عدّل `:local supabaseHost` و`:local routerSecret` في [routeros/deploy.rsc](routeros/deploy.rsc). **ملاحظة حرجة:** لا يعدّل `deploy.rsc` إعدادات `/ip dns` أو `/system clock` أو `/system ntp client` العامة نهائياً، ويتوقف (`ABORT`) إذا كان `/ip dns allow-remote-requests=false` أو تعذّر إثبات حجب `WAN TCP/UDP 53`.
   - فعّل **`Safe Mode`** قبل التنفيذ، نفّذ `deploy.rsc`، ثم تحقق عبر [routeros/verify.rsc](routeros/verify.rsc) وفحوص عدم تأثر `ether1–ether9` قبل إغلاق `Safe Mode`.
   - للتراجع الجراحي الآمن (المحصور في موارد `ether10` دون مساس بالإعدادات العامة): نفّذ [routeros/rollback.rsc](routeros/rollback.rsc).

4. **ملاحظات أمنية وتشغيلية مهمة:**
   - **تعطيل المستخدم المتصل:** لأن الراوتر خلف NAT ولا يفتح منافذ إدارة، يقوم مجدول `rawad-sync-revocations` بسحب الجلسات المعطلة/المنتهية من `verify-mac?action=revoked` كل 30 ثانية (حد أقصى 30 ثانية لقطع جلسة مستخدم عُطّل أثناء اتصاله).
   - **تزوير MAC قبل البوابة:** `portal-auth` يستقبل `$(mac)` من المتصفح، لكن منح الإنترنت الفعلي يتم فقط بعد تحقق `on-login` في MikroTik عبر `$"mac-address"` الحقيقي أمام `verify-mac` باستخدام `ROUTER_SHARED_SECRET`.
   - **ملفات التراجع (`supabase/rollbacks/`):** تُحفظ ملفات `.down.sql` خارج مجلد `supabase/migrations/` لتفادي تعارض أرقام الإصدارات في سجل الترحيلات.

5. **النسخ الاحتياطي والاستعادة اليدوية الرسمية (PostgreSQL 17 وقيود الخطة المجانية):**
   - **تنبيه الخطة المجانية في Supabase:** خطة Supabase Free Plan لا توفر نسخاً احتياطية يومية تلقائية أو PITR، لذا يجب أخذ نسخة احتياطية يدوية ثلاثية قبل أي ترقية أو صيانة.
   - **متطلب توافق الإصدار:** استخدم أدوات PostgreSQL **17** (`pg_dump` و`pg_dumpall` و`psql` v17.x) المطابقة لإصدار قاعدة البيانات (`PostgreSQL 17.12`). لا تستخدم أدوات الإصدار 16 لتصدير قاعدة الإصدار 17.
   - **حماية كلمة المرور:** استخدم `%APPDATA%\postgresql\pgpass.conf` (على Windows) أو `~/.pgpass` (`chmod 600`) مع الخيار `-w`، ولا تضع كلمة المرور في السكربتات أو السجلات.
   - **الأوامر الثلاثية الرسمية (عبر Session Pooler منفذ `5432`):**
     - تصدير الأدوار: `pg_dumpall --roles-only --no-role-passwords -w -h <pooler-host> -p 5432 -U postgres.<ref> -l postgres -f backup_roles.sql`
     - تصدير المخطط العام: `pg_dump --schema=public --schema-only --no-owner -w -h <pooler-host> -p 5432 -U postgres.<ref> -d postgres -f backup_schema.sql`
     - تصدير البيانات: `pg_dump --schema=public --data-only -w -h <pooler-host> -p 5432 -U postgres.<ref> -d postgres -f backup_data.sql`
   - **ملاحظات الاستعادة على PostgreSQL 17 قياسي (خارج Supabase المستضاف):**
     - ابدأ بمخطط `public` نظيف وأنشئ امتداد `pgcrypto` في `extensions`.
     - يُصدر Supabase 17.12 سطراً خاصاً للعمود `revoked_at` بصيغة `ALTER TABLE ONLY public.sessions ALTER COLUMN revoked_at SET (pg_attver=...);`؛ احذف أسطر `SET (pg_attver=` عند الاستعادة الاختبارية على خادم PostgreSQL 17 قياسي غير معدل، وتجاهل أخطاء صلاحية `GRANT ... supabase_admin` الخاصة بالمنصة المستضافة في `backup_roles.sql`.
     - استعد البيانات عبر `psql -v ON_ERROR_STOP=1 -f backup_data.sql` وتحقق من تطابق أعداد الصفوف (`admins`, `users`, `free_quotas`, `sessions`, `portal_settings`).

6. **استضافة لوحة الإدارة داخل حاوية معزولة (نتائج مختبر CHR x86_64 وقيود الإنتاج على RB4011):**
   - **نتائج الاختبار الفعلي على `Rawad-CHR-Lab` (`RouterOS 7.25.1 x86_64`):**
     - الصورة المستخدمة: `library/busybox:musl` بتشغيل `httpd -f -p 8080 -h /www` ومجلد `admin/` مربوط بوضعية `mode=ro,noexec` (القراءة فقط ومنع التنفيذ) مع سقف ذاكرة `memory-high=32.0MiB`.
     - شبكة معزولة (`bridge-admin` + `veth-admin` `172.18.0.2/24`) مع قواعد جدار ناري (`action=drop`) تمنع ضيوف HotSpot وWAN من الوصول إلى واجهة الإدارة (تم التحقق بحظر عميل HotSpot مع تسجيل 9 حزم محظورة / 468 بايت، مقابل HTTP `200` لمسار الموظفين).
     - الاستهلاك المُقاس على المختبر: استهلاك ذاكرة الحاوية الفعلي `~360–460 KiB` (وفرق الذاكرة الكلي النظامي `~6.8 MiB`)، استهلاك القرص الإضافي الكلي (حزمة `container` + صورة `busybox` + ملفات `admin/`) `~3.0 MiB` (`free-hdd-space` من `67.8 MiB` إلى `64.8 MiB`)، حمل المعالج `0%`، وعدد قطاعات الكتابة `7696` منذ آخر إعادة تشغيل باردة.
   - **قيود الإنتاج الحاسمة (`RB4011iGS+RM`):**
     - **تشغيل الحاوية على `RB4011iGS+RM` بمعمارية `ARM32 / ARMv5` غير مختبر ولا يزال غير معتمد للإنتاج.** نجاح الحاوية على `CHR x86_64` لا يثبت توافق الصورة أو الأداء أو سلامة ذاكرة `NAND` الداخلية على `RB4011`. لا تنشر حزمة الحاويات على راوتر الإنتاج قبل اختبار العتاد الفعلي واستبعاد التخزين المتكرر على NAND.
