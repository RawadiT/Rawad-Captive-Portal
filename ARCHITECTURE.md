# ARCHITECTURE.md — المعمارية التقنية للنظام

## 1. نظرة عامة
نظام Captive Portal متكامل لشبكة Wi-Fi المفتوحة للزبائن في **روتانا - شركة رواد التقنيات**، يعمل محلياً بالكامل (بدون أي اشتراكات أو خدمات سحابية خارجية) مع راوتر **MikroTik RB4011iGS+RM (RouterOS 7.x)**.

```
[جهاز الزبون]
     │  (Wi-Fi عبر Access Point / Bridge يمرر MAC الحقيقي)
     ▼
[MikroTik RB4011iGS+RM — ether10 (192.168.20.1/24)]
     ├── Default Deny: منع الإنترنت والـ DNS الخارجي وIPv6 وشبكة الموظفين (ether9) ولوحة الإدارة
     ├── HotSpot + Walled Garden: يسمح فقط بـ DNS المحلي وخادم Captive Portal
     │
     ▼ (HTTPS REST API / API-SSL بحساب rawad-api محدود الصلاحيات)
[Backend Server — Node.js + TypeScript]
     ├── Quota Manager (توقيت Asia/Baghdad، 30 دقيقة مجانية/يوم، رصيد تراكمي)
     ├── Session Monitor (مزامنة كل 5 ثوانٍ، قطع تلقائي عند الانتهاء، SSE)
     ├── Auth & RBAC (تشفير scrypt، صلاحيات المدير الرئيسي والعادي)
     ├── Audit Logs (سجلات غير قابلة للتعديل أو الحذف)
     └── SQLite (تخزين دائم + WAL + نسخ احتياطي)
```

---

## 2. مبدأ Default Deny (المنع الافتراضي)
1. أي جهاز يتصل بشبكة الضيوف يبدأ بدون أي صلاحية للوصول إلى الإنترنت.
2. لا يتحكم Frontend في صلاحية الإنترنت؛ بل يفرضها **MikroTik HotSpot + Firewall** فعلياً.
3. في حال تعطل أو توقف Backend، لا يحصل أي جهاز غير مصادق عليه على الإنترنت.
4. تُمنع المسارات البديلة:
   - الوصول المباشر إلى IP عام قبل المصادقة.
   - تجاوز DNS عبر توجيه/منع TCP/UDP 53 لغير DNS الراوتر.
   - IPv6 محظور على واجهة الضيوف لمنع التسرب.
   - عزل تام عن شبكة الموظفين (`ether9`) وعن لوحة الإدارة وإدارة MikroTik.

---

## 3. مكونات النظام

### أ. قاعدة البيانات (`database/`)
- **SQLite** (عبر `node:sqlite` المدمج في Node.js 24 لضمان الاستقرار دون اعتماديات C++ خارجية).
- وضع `WAL` (Write-Ahead Logging) + `foreign_keys = ON`.
- الجداول:
  - `admins`: حسابات المدراء (`super_admin`, `admin`).
  - `users`: حسابات الزبائن (`quota_seconds` محدد أو `NULL` للمفتوح، `used_seconds` التراكمي، `status`).
  - `free_quotas`: مفتاح فريد `(mac_address, baghdad_date)` يضمن حصة واحدة (1800 ثانية) كل يوم تقويمي بتوقيت `Asia/Baghdad`.
  - `sessions`: تتبع الجلسات الفعلية (`free` / `user`) والوقت المستهلك وتاريخ الانتهاء.
  - `audit_logs`: سجل تدقيق محمي بـ SQLite Triggers تمنع `UPDATE` و`DELETE`.

### ب. الخادم الخلفي (`backend/`)
- **MikroTik Adapter Pattern**:
  - `MikroTikAdapter` واجهة موحدة.
  - `RouterOSRestClient`: اتصال فعلي عبر HTTPS REST API في RouterOS 7.x.
  - `MockMikroTikAdapter`: محاكاة كاملة في الذاكرة للاختبار المحلي دون راوتر.
- **منع التكرار والسباق (Concurrency Control)**:
  - قفل (In-memory mutex per MAC/User) + معاملة SQLite ذرية (`BEGIN IMMEDIATE`) لمنع الطلبات المتزامنة من منح حصتين.
  - إذا فشل الراوتر في إنشاء الجلسة، تُلغى المعاملة ولا تُسجل الحصة كمستخدمة.
- **منطق منتصف الليل (00:00 Asia/Baghdad)**:
  - الجلسة التي بدأت قبل منتصف الليل تستمر وفق مدتها الأصلية (30 دقيقة) ولا تُمدد ولا تُقطع لمجرد دخول اليوم الجديد، ويصبح استحقاق اليوم الجديد متاحاً بعد انتهائها.

### ج. الواجهات (`frontend/`)
- **بوابة الزبائن (`frontend/guest-portal/`)**: Next.js (RTL، Cairo محلي، الشعار الرسمي، خلفية أيقونات تقنية خفيفة، خياران فقط في الدخول، عداد دائري سلس متزامن مع الخادم).
- **لوحة الإدارة (`frontend/admin-dashboard/`)**: Next.js منفصل تماماً عن بوابة الزبائن، تحديث لحظي كل 2–3 ثوانٍ عبر SSE مع Polling احتياطي.

### د. ملفات HotSpot (`hotspot/`) وRouterOS (`routeros/`)
- `hotspot/`: صفحات HotSpot محلية (`login.html`, `status.html`, `logout.html`, `error.html`, `api.json` لمعيار RFC 7710).
- `routeros/`: سكربتات `preflight.rsc`, `deploy.rsc`, `verify.rsc`, `rollback.rsc` متوافقة مع RouterOS 7.x.
