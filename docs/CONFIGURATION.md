# دليل الإعداد والتكوين — نظام Captive Portal

## متغيرات البيئة (`deployment/.env`)

| المتغير | الوصف | القيمة الافتراضية / المقترحة |
|---|---|---|
| `PORT` | منفذ خادم Backend | `4000` |
| `TOKEN_SECRET` | مفتاح توقيع جلسات المدراء (HMAC-SHA256) | سلسلة عشوائية طويلة (64 حرفاً) |
| `MIKROTIK_MODE` | وضع الاتصال بالراوتر (`mock` للاختبار، `rest` للإنتاج) | `mock` محلياً / `rest` في الشركة |
| `MIKROTIK_HOST` | عنوان IP للراوتر | `192.168.20.1` |
| `MIKROTIK_REST_PORT` | منفذ خدمة `www-ssl` على RouterOS | `443` |
| `MIKROTIK_API_USER` | حساب API محدود الصلاحيات | `rawad-api` |
| `MIKROTIK_API_PASSWORD` | كلمة مرور حساب API | تُضبط عند النشر |
| `MIKROTIK_TLS_VERIFY` | التحقق من شهادة TLS (`true` مع شهادة موثوقة) | `false` أو `true` |
| `FREE_QUOTA_SECONDS` | مدة الباقة المجانية بالثواني | `1800` (30 دقيقة) |
| `SESSION_SYNC_INTERVAL_MS` | فترة مزامنة الجلسات | `5000` |
| `GUEST_PORTAL_ORIGIN` | رابط بوابة الزبائن | `http://192.168.20.2:3000` |
| `ADMIN_DASHBOARD_ORIGIN` | رابط لوحة الإدارة | `http://localhost:3001` |
| `DEFAULT_SUPER_ADMIN_USER` | اسم المدير الرئيسي الأولي | `superadmin` |
| `DEFAULT_SUPER_ADMIN_PASSWORD` | كلمة مرور المدير الرئيسي الأولية | يُنصح بتغييرها فوراً |

## ملاحظة حول الموارد المحلية
جميع الخطوط (`Cairo`) والشعار الرسمي (`logo.png`) مخزنة محلياً داخل `frontend/*/public` و`hotspot/assets` لضمان عدم اعتماد البوابة على الإنترنت الخارجي إطلاقاً.
