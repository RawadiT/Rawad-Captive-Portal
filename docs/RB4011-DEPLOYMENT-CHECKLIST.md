# قائمة التحقق المختصرة للنشر اليدوي على RB4011 (`RB-065`)

> **ممنوع الانتقال للخطوة التالية إذا ظهر أي `CONFLICT` أو `ABORT` أو توقف في `ether1–ether9`.**

## 1. قبل النشر (كمبيوتر الشركة + قراءة الراوتر)
- [ ] التحقق من آخر نسخة في Git (`main` / `89f1d8a` وما بعده) وعدم وجود مراجع قديمة.
- [ ] الاتصال الإداري بالراوتر عبر منفذ موثوق في `ether1–ether9` (وليس `ether10`).
- [ ] تشغيل [RB4011-PREFLIGHT-COMMANDS.rsc](RB4011-PREFLIGHT-COMMANDS.rsc) + حفظ `/export show-sensitive file=rb4011-pre-rawad-backup` و`/system backup save name=rb4011-pre-rawad-backup` خارج الراوتر.
- [ ] التحقق من خلو `ether10` من `bridge`/`VLAN` ومراجعة `PoE-out`، وخلو `192.168.20.0/24` من أي تعارض.
- [ ] التحقق من `/ip dns allow-remote-requests=yes` مع حجب `WAN TCP/UDP 53` (IPv4 + IPv6)، ودقة ساعة `UTC`.
- [ ] تجهيز نسخة محلية من [routeros/deploy.rsc](../routeros/deploy.rsc) وتعبئة `:local routerSecret` بقيمة `ROUTER_SHARED_SECRET` الإنتاجية فقط (مع بقاء `:local supabaseHost "stlrolkrqtbhkjztxudd.supabase.co"`).

## 2. التنفيذ في `Safe Mode`
- [ ] تفعيل **`Safe Mode`** (`Ctrl+X` في Terminal أو زر Safe Mode في WinBox).
- [ ] رفع وتشغيل `routeros/preflight.rsc` والتأكد من غياب أي `CONFLICT` أو `ABORT_CONDITION`.
- [ ] رفع جميع ملفات [hotspot/](../hotspot/) (`11` ملفاً) إلى مجلد `hotspot/` في الراوتر.
- [ ] تشغيل `/import file-name=deploy.rsc` والتحقق من `=== DEPLOYMENT COMPLETE (ether10 ONLY) ===`.
- [ ] تشغيل `/import file-name=verify.rsc` والتحقق من نجاح `/tool fetch` نحو `stlrolkrqtbhkjztxudd.supabase.co` (`code=200`).

## 3. اختبارات ما بعد النشر (قبل إغلاق `Safe Mode`)
- [ ] **كمبيوتر الشركة (`LAN`):** فتح [admin/index.html](../admin/index.html) والدخول بحساب `hashim`، وإنشاء مستخدم اختباري مؤقت (1 دقيقة).
- [ ] **جهاز عميل على `ether10`:** استلام DHCP، ظهور البوابة تلقائياً، تحميل الأصول (`200`)، الدخول بالمستخدم الاختباري، عمل الإنترنت، وحجب الوصول إلى شبكة الموظفين `ether1–ether9`.
- [ ] **القطع والإلغاء:** انتهاء الدقيقة أو تعطيل المستخدم من لوحة الإدارة -> انقطاع الإنترنت فعلياً + `ACK` -> حذف المستخدم الاختباري.
- [ ] **حماية شبكة الشركة:** التحقق على جهاز متصل بـ `ether1–ether9` من استمرار الإنترنت، DNS، DHCP، والوصول الداخلي دون أي تأثر (`0%` فقدان).
- [ ] عند نجاح كل ما سبق فقط: إغلاق **`Safe Mode`**.
