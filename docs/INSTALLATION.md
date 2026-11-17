# دليل التثبيت والتشغيل — نظام Captive Portal (روتانا - شركة رواد التقنيات)

## 1. المتطلبات المادية والتشغيلية
- **جهاز التوجيه:** MikroTik RB4011iGS+RM بنظام RouterOS 7.x.
- **نقطة الوصول (Access Point):** راوتر Wi-Fi مستقل متصل بمنفذ `ether10` ويعمل حصرياً بوضع **Access Point / Bridge** (بدون WAN أو DHCP أو NAT مستقل) مع تمرير عناوين MAC الحقيقية.
- **خادم النظام المحلي (Host Machine):** حاسوب أو خادم محلي يعمل باستمرار داخل الشركة (Windows أو Linux)، يحتوي على:
  - Node.js 22+ أو Docker + Docker Compose.
  - عنوان IP ثابت (مثال مقترح: `192.168.20.2` أو ضمن شبكة الإدارة المسموح بالوصول إليها وفق Walled Garden).

## 2. التثبيت المباشر (Windows / Linux)
### على Windows (PowerShell):
```powershell
.\deployment\install\install-windows.ps1
```
### على Linux:
```bash
chmod +x deployment/install/install-linux.sh
./deployment/install/install-linux.sh
```

## 3. التشغيل عبر Docker Compose
1. انسخ ملف البيئة:
   ```bash
   cp deployment/.env.example deployment/.env
   ```
2. عدّل القيم الحساسة في `deployment/.env` (مثل `TOKEN_SECRET`, `MIKROTIK_API_PASSWORD`, `DEFAULT_SUPER_ADMIN_PASSWORD`).
3. شغّل الحاويات:
   ```bash
   cd deployment
   docker compose up -d --build
   ```

## 4. النسخ الاحتياطي والاستعادة لقاعدة البيانات
- إنشاء نسخة احتياطية:
  ```bash
  node database/backup/backup.mjs
  ```
- استعادة نسخة احتياطية:
  ```bash
  node database/backup/restore.mjs database/backup/snapshots/<snapshot-file>.db
  ```
