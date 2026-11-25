# Rawad Captive Portal (MikroTik HotSpot + Supabase)

نظام Captive Portal لشركة رواد التقنيات على راوتر **MikroTik RB4011iGS+RM (RouterOS v7)**، بنطاق محصور في **`ether10` فقط**.

## النطاق الرسمي للمشروع (`Scope`)
يقتصر هذا المشروع على **مصادقة المستخدمين وإدارة صلاحيات الوصول عبر MikroTik HotSpot**: استقبال المستخدم، التحقق من الهوية و`MAC Address` وحالة الحساب، منح الصلاحية وإلغاؤها، فرض مدة الجلسة، مزامنة الإلغاءات (`Revocation` / `ACK`) مع Supabase، وتوفير لوحة إدارة لصلاحيات الحسابات والمديرين.  
**خارج النطاق تماماً:** إدارة سرعة الإنترنت أو توزيع/تقييد `Bandwidth` أو تحليل حركة البيانات (`DPI`/البث/التنزيلات)، إذ تتولاها البنية الشبكية ومزود الإنترنت.

## البنية المعتمدة
- **`hotspot/`**: واجهة Captive Portal مستضافة مباشرة داخل MikroTik HotSpot (خياران فقط: 30 دقيقة مجانية يومياً لكل MAC بتوقيت `Asia/Baghdad`، وتسجيل الدخول بحسابات المستخدمين).
- **`supabase/`**: قاعدة بيانات PostgreSQL (`schema.sql` والترحيلات و`rollbacks/`) وEdge Functions (`portal-auth`, `verify-mac`, `admin-api`) دون أي Backend دائم التشغيل أو VPS.
- **`admin/`**: لوحة إدارة ثابتة (`index.html`, `admin.js`, `style.css`) تتصل مباشرة بـ `admin-api` وتُستضاف إنتاجياً كملفات ساكنة داخل شبكة الموظفين الداخلية (`LAN`).
- **`routeros/`**: سكربتات RouterOS v7 (`preflight.rsc`, `deploy.rsc`, `verify.rsc`, `rollback.rsc`) لنشر وإدارة `ether10` فقط دون تعديلات عامة.
- **`tests/`**: اختبارات النظام الدائمة (`verify_system.mjs`).
- **`docs/archive/`**: أرشيف الوثائق التاريخية المستبدلة (مثل `FIELD_TEST.md`).

## الحالة الراهنة (`RB-062`)
- **النشر الإنتاجي على `RB4011` الحقيقي:** **`BLOCKED`** — عتاد `RB4011` الحقيقي لم يُختبر بعد (`NOT TESTED`) وبانتظار تدقيق `/export` الفعلي وفحوص `ether1–ether9` الميدانية.
- **بيئة Supabase Production (`stlrolkrqtbhkjztxudd` — `eu-west-1`):** جاهزة ومهيأة بالكامل (قاعدة البيانات، RLS/RPC، Edge Functions، والأسرار)، ومختبرة حيّاً عبر `CHR Lab` في القطع الفعلي (`30s`/`60s`) ومنع إعادة الدخول وقواعد منتصف الليل بتوقيت `Asia/Baghdad`.
- **السعة السحابية المعتمدة للمصادقة (`Rawad Test` — `RB-056` / `RB-057`):** **`400` مستخدم متزامن** (`3/3` جولات `100%`)، مع **هامش تشغيل مقترح `200–250` مستخدماً متزامناً**.

## فهرس الوثائق الأساسية
- [DEPLOYMENT.md](DEPLOYMENT.md) | [PRODUCTION-READINESS.md](PRODUCTION-READINESS.md) | [TEST-REPORT.md](TEST-REPORT.md) | [RB4011-COMPATIBILITY.md](RB4011-COMPATIBILITY.md)
- [LAB-SETUP.md](LAB-SETUP.md) | [ROLLBACK.md](ROLLBACK.md) | [TASKS.md](TASKS.md) | [PROGRESS.md](PROGRESS.md)
