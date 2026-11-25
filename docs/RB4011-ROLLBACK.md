# خطة التراجع الطارئة لراوتر RB4011 (`RB-065`)

## متى يجب إيقاف التنفيذ فوراً وعدم الاستمرار؟
توقف فوراً ونفّذ التراجع إذا ظهر أي مما يلي:
1. أي خطأ أو تعارض في `preflight.rsc` (مثل وجود `ether10` داخل `bridge` الشركة أو تعارض `192.168.20.0/24`).
2. توقف `deploy.rsc` برسالة `ABORT` (مثل `allow-remote-requests=false` أو تعذر إثبات حجب `WAN DNS 53`).
3. أي بطء أو انقطاع في الإنترنت أو DNS أو DHCP أو الشبكة الداخلية على المنافذ `ether1–ether9`.
4. فشل الاتصال السحابي من الراوتر إلى `stlrolkrqtbhkjztxudd.supabase.co` (`code != 200`).

---

## خطوات الاستعادة الآمنة

### الحالة 1: ما زلت داخل `Safe Mode`
- **الإجراء الفوري:** اضغط **إغلاق نافذة WinBox/SSH** دون إطفاء `Safe Mode` (أو اسحب الكيبل الإداري ليقطع الاتصال إذا تعذر)، وسيتراجع RouterOS تلقائياً عن كل تعديل أُجري منذ تفعيل `Safe Mode`.

### الحالة 2: تم إغلاق `Safe Mode` وتحتاج إزالة النشر على `ether10`
1. نفّذ السكربت الجراحي المعتمد [routeros/rollback.rsc](../routeros/rollback.rsc):
   ```routeros
   /import file-name=rollback.rsc
   ```
   - يتحقق السكربت تلقائياً من `rawad-portal-anchor` وبصمة `rawad-portal-state`.
   - يفصل جلسات `rawad-guest-hotspot` النشطة، ويزيل موارد `ether10` التي أنشأها `deploy.rsc` فقط.
   - **لا يلمس** `ether1–ether9` ولا `/ip dns` ولا `/system clock` ولا `/system ntp client`.
2. تحقّق بعد التراجع عبر:
   ```routeros
   /import file-name=verify.rsc
   ```
   وتأكّد من عودة `ether1–ether9` إلى وضعها الطبيعي بالكامل.

### الحالة 3: تراجع كلي إلى النسخة الاحتياطية (في حال تضرر غير متوقع)
- استخدم ملف النسخة الاحتياطية المأخوذ قبل البدء (`rb4011-pre-rawad-backup.backup`) عبر:
  ```routeros
  /system backup load name=rb4011-pre-rawad-backup.backup
  ```
  *(سيعيد تشغيل الراوتر — يُستخدم فقط في نافذة الصيانة عند تعذر التراجع الجراحي عبر `rollback.rsc`).*
