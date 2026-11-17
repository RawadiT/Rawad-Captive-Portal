# Rawad Captive Portal (MikroTik HotSpot + Supabase)

نظام Captive Portal لشركة رواد التقنيات على راوتر **MikroTik RB4011iGS+RM (RouterOS v7)**، بنطاق محصور في **`ether10` فقط**.

## البنية المعتمدة
- **`hotspot/`**: واجهة Captive Portal مستضافة مباشرة داخل MikroTik HotSpot (خياران فقط: 30 دقيقة مجانية يومياً لكل MAC بتوقيت `Asia/Baghdad`، وتسجيل الدخول بحسابات المستخدمين).
- **`supabase/`**: قاعدة بيانات PostgreSQL (`schema.sql`) وEdge Functions (`portal-auth`, `verify-mac`, `admin-api`) دون أي Backend دائم التشغيل أو Vercel أو VPS.
- **`admin/`**: لوحة إدارة ثابتة (`index.html`, `admin.js`, `style.css`) تتصل مباشرة بـ `admin-api`.
- **`routeros/`**: سكربتات RouterOS v7 (`deploy.rsc`, `rollback.rsc`, `verify.rsc`) لنشر وإدارة `ether10` فقط.
- **`tests/`**: اختبارات النظام الدائمة (`verify_system.mjs`).
