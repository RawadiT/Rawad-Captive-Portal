# DEPLOYMENT.md — دليل النشر (MikroTik HotSpot + Supabase)

1. **إعداد Supabase:**
   - نفّذ [supabase/schema.sql](supabase/schema.sql) في مشروع Supabase (آمن لإعادة التطبيق دون حذف البيانات).
   - انشر Edge Functions الثلاث: `portal-auth`, `verify-mac`, `admin-api`.
   - اضبط الأسرار على Supabase (`ROUTER_SHARED_SECRET`, `ADMIN_TOKEN_SECRET`).
   - أضف حساب المدير الأول في `public.admins` بتوليد تجزئة `pbkdf2:<salt_hex>:<hash_hex>` (عبر دالة `hashPassword` في `_shared/crypto.ts`) وإدراجها في `public.admins`.

2. **إعداد ملفات الواجهة والإدارة:**
   - حدّث `supabaseUrl` و`supabaseAnonKey` في [hotspot/login.html](hotspot/login.html) و[admin/index.html](admin/index.html) (لا تضع `service_role` أو `ROUTER_SHARED_SECRET` أبداً في المتصفح).
   - ارفع محتويات `hotspot/` إلى مجلد `hotspot` داخل MikroTik.
   - افتح [admin/index.html](admin/index.html) محلياً أو استضف مجلد `admin/` كملفات ثابتة (بدون Vercel/VPS).

3. **إعداد MikroTik (`ether10` فقط):**
   - عدّل `:local supabaseHost` و`:local routerSecret` في [routeros/deploy.rsc](routeros/deploy.rsc).
   - نفّذ `deploy.rsc`، ثم تحقق عبر [routeros/verify.rsc](routeros/verify.rsc).
   - للتراجع الآمن: نفّذ [routeros/rollback.rsc](routeros/rollback.rsc).

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
