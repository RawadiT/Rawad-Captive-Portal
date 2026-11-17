# مراجعة التوافق النهائي للـ TLS وCAPPORT (RFC 8908 / RFC 8910)

## 1. سبب اعتماد نطاق حقيقي وشهادة عامة موثوقة
- أنظمة تشغيل الهواتف (iOS، Android، Windows، macOS) لا تثق تلقائياً بشهادة صادرة من CA داخلي خاص، ولا يجوز اشتراط تثبيت شهادة CA يدوياً على هواتف الزبائن.
- وفق معيار **RFC 8908**، إذا فشل التحقق من سلسلة الثقة لشهادة عنوان CAPPORT، يرفض نظام التشغيل استجابة CAPPORT بصمت أو يظهر تحذيراً أمنياً.
- لذلك تم اعتماد **نطاق حقيقي مملوك للشركة** (مثل `wifi.<company-domain>`) مع **شهادة TLS عامة موثوقة** (Let's Encrypt مجاناً عبر تحدي **DNS-01**) دون الحاجة لفتح الخادم المحلي على الإنترنت العام.

---

## 2. البنية المعتمدة: Split-Horizon DNS + Local Hosting
1. **الاستضافة محلية بالكامل:** يعمل Backend وGuest Portal وAdmin Dashboard وSQLite على الخادم المحلي داخل الشركة فقط.
2. **Split-Horizon DNS على MikroTik:**
   - في الإنترنت العام: النطاق `wifi.<company-domain>` لا يشير إلى عنوان خاص ولا يعرّض خدمات الشركة.
   - داخل الشركة (عبر `/ip dns static` في `deploy.rsc`): يوجّه MikroTik النطاق `wifi.<company-domain>` مباشرة إلى العنوان المحلي للخادم (`$backendServerIp`).
3. **DHCP Option 114 (RFC 8910):**
   - يوزّع MikroTik عنوان **API فقط**: `https://wifi.<company-domain>/api/guest/capport` (وليس رابط صفحة تسجيل الدخول).
   - يعيد الخادم استجابة `application/captive+json` ديناميكية (`captive: true` قبل المصادقة، و`captive: false` + `seconds-remaining` بعدها) بناءً على مطابقة IP العميل في HotSpot Host Table (حتى لو تغيّر IP الجهاز مع بقاء MAC نفسه).

---

## 3. إزالة OCSP ومعالجة CRL (تحديث Let's Encrypt 2025)
- **إيقاف OCSP في Let's Encrypt:** أوقفت Let's Encrypt خدمة OCSP نهائياً في 2025 وتعتمد الآن على **CRL (Certificate Revocation Lists)**.
- لذلك تمت إزالة `ssl_stapling` و`ssl_stapling_verify` من [nginx.conf](file:///c:/Users/Hashim/Desktop/Captive%20Portal%20Rawad%20Tech/deployment/nginx/nginx.conf)، وتقديم `fullchain.pem` كاملة.
- **التعامل مع CRL قبل المصادقة:**
  - بعد إصدار شهادة الإنتاج الفعلية للنطاق الحقيقي، يجب فحص امتداد `CRL Distribution Points` عبر:
    ```bash
    openssl x509 -in deployment/tls/certs/fullchain.pem -noout -text | grep -A 5 "CRL Distribution Points"
    ```
  - إذا تطلبت أنظمة التشغيل الصارمة الوصول إلى عنوان CRL قبل المصادقة، يُسمح **فقط** بعناوين CRL المستخرجة (مثل `*.c.lencr.org` عبر المنفذ `80`) داخل Walled Garden في `deploy.rsc` دون فتح الإنترنت العام.
  - **شفافية التحقق:** لا يمكن الجزم بسلوك فحص CRL على هواتف الزبائن قبل إصدار الشهادة الفعلية للنطاق الحقيقي واختبارها على أجهزة فعلية.

---

## 4. تجديد شهادة DNS-01 وإعادة تحميل Nginx
- يوفر [renew-cert.sh](file:///c:/Users/Hashim/Desktop/Captive%20Portal%20Rawad%20Tech/deployment/tls/renew-cert.sh) مسارين مع حماية ذرية للشهادة الحالية:
  1. **تجديد آلي بالكامل (Cron):** عبر `acme.sh` ومزود DNS API مع حفظ مفاتيح DNS API في `deployment/tls/.dns-credentials.env` بصلاحيات `chmod 600` وتثبيت الجدولة اليومية عبر `./deployment/tls/renew-cert.sh --install-cron`.
  2. **تجديد يدوي (إذا لم يدعم مزود DNS واجهة API):** تحديث سجل `_acme-challenge` TXT يدوياً كل 60–90 يوماً عبر `certbot certonly --manual --preferred-challenges dns` ثم نسخ `fullchain.pem` و`privkey.pem` وتشغيل `./deployment/tls/renew-cert.sh`.
- **إعادة تحميل Nginx دون توقف وبأمان:** يتم التحقق أولاً من الشهادة ومطابقة المفتاح في مجلد مؤقت (`.staging`) ثم `docker exec rawad-tls-proxy nginx -t && docker exec rawad-tls-proxy nginx -s reload`؛ وإذا فشل أي فحص تُحفظ الشهادة القديمة دون إعادة تحميل Nginx.

---

## 5. بديل HotSpot التقليدي والتمييز بين الشهادات
- **بديل HotSpot:** تبقى صفحات `hotspot/login.html` و`status.html` و`logout.html` و`error.html` مفعلة للأجهزة التي لا تدعم RFC 8908.
- **شهادة Nginx (`fullchain.pem`):** شهادة عامة موثوقة من Let's Encrypt لهواتف الزبائن.
- **شهادة MikroTik `www-ssl` (`rawad-ca.crt` / `mikrotik.crt`):** شهادة داخلية خاصة بالاتصال بين الخادم والراوتر فقط (`192.168.10.1:443`) مع تفعيل `MIKROTIK_TLS_VERIFY=true` والتحقق عبر `MIKROTIK_CA_CERT_PATH`.

---

## 6. المتطلبات الخارجية والتكاليف
- **شهادة Let's Encrypt:** مجانية (`$0`).
- **اسم النطاق:** مجاني (`$0`) إذا كان لدى الشركة نطاق مسجل مسبقاً بإضافة نطاق فرعي، أو بتكلفة تسجيل سنوية قياسية إذا لم يكن لديها نطاق.
- **الاعتماد الخارجي الوحيد:** تجديد الشهادة كل 60–90 يوماً عبر DNS-01.

