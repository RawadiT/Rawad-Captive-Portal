# ROLLBACK.md — دليل التراجع الآمن واستعادة الطوارئ (Rawad Captive Portal)

يوثّق هذا الملف إجراءات التراجع الآمنة والمفصّلة لكل طبقة من طبقات النظام دون الإضرار ببيانات العملاء أو بإعدادات الشبكة العاملة.

---

## 1. التراجع على راوتر الإنتاج (`MikroTik RB4011` — `ether10` فقط)

تم تصميم [routeros/rollback.rsc](routeros/rollback.rsc) للتراجع الآمن المحصور في `ether10` وما أنشأته عملية النشر فقط اعتماداً على السكربت المرجعي المحفوظ أثناء النشر الأولي (`rawad-portal-state` و`rawad-portal-anchor`).

### خطوات التنفيذ
1. تحقق من سلامة وحضور السكربت المرجعي قبل التراجع:
   ```routeros
   /system script print where name~"rawad-portal-"
   ```
2. نفّذ سكربت التراجع:
   ```routeros
   /import file-name=rollback.rsc
   ```
3. ماذا يفعل `rollback.rsc` بأمان:
   - يتحقق عبر هاشَي سلامة (`rawadStateH1`, `rawadStateH2`, `rawadStateBodyLen`) مقارنةً بـ `rawad-portal-anchor` من عدم العبث بملف الحالة.
   - يفصل الجلسات النشطة المحصورة في `server="rawad-guest-hotspot"` ويزيل عناصر قائمة `rawad-verified` ذات التعليق `rawad-guest-portal` فقط.
   - يحذف فقط الموارد التي أنشأها النشر (`rawadCreated*=true`): المجدول `rawad-sync-revocations`، قواعد NAT/Firewall/IPv6 الخاصة بـ `ether10`، جدار الحماية الـ Walled Garden `rawad-guest-portal-allow-supabase`، خادم HotSpot `rawad-guest-hotspot` وبروفايلاته والمستخدم `rawad-gate`، خادم واختيار وشبكة ومجمّع DHCP، وعنوان `192.168.20.1/24` على `ether10`.
   - يستعيد القيم السابقة لـ `allow-remote-requests` والمنطقة الزمنية (`timezone`) وتفعيل عميل `NTP` **فقط إذا كانت مسجلة قبل النشر**.
   - يحذف `rawad-portal-state` و`rawad-portal-anchor` والمتغيرات العمومية الخاصة بالجلسة.
   - **يحذف فقط ملف الحالة دون المساس بمنافذ `ether1`–`ether9` أو جسور الشركة أو قواعد WAN/LAN الحالية.**
4. التحقق بعد التراجع:
   ```routeros
   /import file-name=verify.rsc
   ```
   يجب ألا يُرجع أي موارد نشطة باسم `rawad-guest-*` أو `rawad-verified-prof`.

---

## 2. التراجع في مختبر المحاكاة (`Rawad-CHR-Lab`)

### أ. التراجع عن محاكاة الشبكات والأقسام الإضافية (`Stage 2 — rawad-rb4011-sim`)
إذا أردت إزالة محاكاة الشبكات والأقسام متعددة VLANs فقط مع الإبقاء على HotSpot وحاوية لوحة الإدارة:
```routeros
/ip firewall filter remove [find where comment~"rawad-rb4011-sim"]
/ip dhcp-server remove [find where comment="rawad-rb4011-sim"]
/ip dhcp-server network remove [find where comment="rawad-rb4011-sim"]
/ip pool remove [find where name~"^rawad-sim-"]
/interface list member remove [find where comment="rawad-rb4011-sim"]
/ip address remove [find where comment="rawad-rb4011-sim"]
/interface vlan remove [find where comment="rawad-rb4011-sim"]
/interface bridge remove [find where name="br-corp-sim"]
```

### ب. التراجع عن وصول لوحة الإدارة المزدوج على Host-Only / Win10 Lab
```routeros
/ip firewall filter remove [find where comment~"rawad-admin-allow-win10-lab|rawad-admin-block-hostonly-other"]
/ip firewall nat remove [find where comment~"rawad-admin-hostonly-staff|rawad-admin-win10-lab"]
/ip address remove [find where comment="rawad-admin-hostonly"]
```

### ج. إيقاف أو إزالة حاوية لوحة الإدارة على CHR Lab
```routeros
/container stop [find where comment="rawad-admin-container"]
# للإزالة الكاملة من CHR عند الحاجة:
/container remove [find where comment="rawad-admin-container"]
/container mounts remove [find where comment="rawad-admin-container"]
/interface bridge port remove [find where comment="rawad-admin-container"]
/interface veth remove [find where name="veth-admin"]
/ip address remove [find where comment="rawad-admin-container"]
/interface bridge remove [find where name="bridge-admin"]
/ip firewall filter remove [find where comment~"rawad-admin-"]
/ip firewall nat remove [find where comment~"rawad-admin-"]
```

---

## 3. التراجع عن ترحيل قاعدة البيانات (`Supabase / PostgreSQL 17`)

### أ. التراجع عبر سكربت Down الخارجي الآمن
ملف التراجع محفوظ عمداً **خارج** `supabase/migrations/` لتفادي تضارب أرقام الترحيلات في سجل Supabase CLI:
- المسار: [supabase/rollbacks/202611190001_portal_settings_and_unlimited.down.sql](supabase/rollbacks/202611190001_portal_settings_and_unlimited.down.sql)

ماذا يفعل هذا السكربت قبل إسقاط الحقول:
1. يحذف دالتي التنظيف `get_cleanup_summary` و`cleanup_operational_data`.
2. يستعيد الدوال الأصلية قبل المرحلة الأولى (`request_free_quota`, `authorize_user_login`, `verify_mac_authorization`, `get_revoked_sessions`).
3. يضبط `sessions.expires_at` لأي جلسات مفتوحة كانت بدون تاريخ انتهاء وإلغاء الجلسات المفتوحة النشطة بأمان قبل إعادة قيد `NOT NULL`.
4. يعيد `users.duration_minutes` لقيم غير فارغة (> 0) ثم يحذف العمود `users.is_unlimited`.
5. يحذف الجدول `public.portal_settings`.

> **تنبيه مهم:** قبل تطبيق التراجع على أي بيئة، تأكد من استخدام أدوات **PostgreSQL 17** واستخدام ملف `%APPDATA%\postgresql\pgpass.conf` (أو `~/.pgpass`) مع الخيار `-w`، وخذ نسخة احتياطية ثلاثية أولاً كما في [DEPLOYMENT.md](DEPLOYMENT.md).

### ب. الاستعادة الكاملة من النسخ الاحتياطية الثلاثية (PG 17)
في حال فشل التراجع البرمجي أو الحاجة لاستعادة لقطة زمنية كاملة:
1. على قاعدة نظيفة (PostgreSQL 17.x) مع `pgcrypto` في `extensions`:
2. مرّر الأدوار من `backup_roles.sql` (تُتجاهل أخطاء `supabase_admin` الخاصة بالمنصة المستضافة على PG قياسي محلي).
3. استعد المخطط من `backup_schema.sql` (على PG محلي قياسي غير Supabase يُزال أي سطر `SET (pg_attver=...);` المتعلق بعمود `revoked_at`).
4. استعد البيانات الفعليّة:
   ```powershell
   psql -w -v ON_ERROR_STOP=1 -h <host> -p 5432 -U postgres.<ref> -d postgres -f backup_data.sql
   ```
5. تحقق من تطابق أعداد الصفوف في `admins` و`users` و`free_quotas` و`sessions` و`portal_settings`.

---

## 4. التراجع عن Edge Functions وملفات البوابة/الإدارة

- **Edge Functions:** دوال المشروع مصدرُها في Git ([supabase/functions/](supabase/functions/)). للتراجع إلى إصدار سابق معروف (مثل commit سابق تم التحقق منه):
  ```powershell
  git checkout <verified-commit-sha> -- supabase/functions/
  npx supabase functions deploy admin-api --project-ref <project_ref> --no-verify-jwt
  npx supabase functions deploy portal-auth --project-ref <project_ref> --no-verify-jwt
  npx supabase functions deploy verify-mac --project-ref <project_ref> --no-verify-jwt
  ```
- **بوابة HotSpot وملفات الإدارة:** ملفات `hotspot/` و`admin/` ساكنة بالكامل ولا تملك حالة قاعدة بيانات خاصة بها؛ استعادة أي commit سابق عبر `git checkout` ثم إعادة رفع `hotspot/` إلى الراوتر وإعادة نشر `admin/` على خادم الشبكة الداخلية يكفي للتراجع الفوري.

---

## 5. حالة الاختبار الفعلي لإجراءات التراجع
- **تراجع قاعدة البيانات (`202611190001...down.sql`) والاستعادة الثلاثية PG 17:** مُختبر ومُثبت فعلياً في المرحلة 1 على PostgreSQL 17 المحلي المنسوخ من `Rawad Test`.
- **تراجع `CHR Lab`:** موثّق ومختبر بتسلسلات RouterOS 7.25.1 دون المساس ببنية المختبر الرئيسية.
- **تراجع `routeros/rollback.rsc` على RB4011:** تم التحقق من بنائه ومنطقه ومطابقته الساكنة في `verify_system.mjs`، لكن تنفيذه الفعلي على عتاد **RB4011 حقيقي** غير مختبر حتى توفر الجهاز في الشركة.
