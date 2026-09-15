# إعداد الإشعارات الحقيقية FCM في «مكتبتي»

هذه الإضافة تحافظ على جرس الإشعارات الداخلي الموجود في المشروع، وتضيف Push حقيقيا على Android عبر Firebase Cloud Messaging (FCM).

## 1) Firebase

أنشئ/استخدم Firebase Project ثم أضف تطبيق Android بالمعرّف:

`dz.maktabati.app`

نزّل ملف `google-services.json` وضعه في:

`android/app/google-services.json`

> لا تضع هذا الملف في Git أو في ZIP عام؛ فهو إعداد خاص بالمشروع.

## 2) حزمة Capacitor

من مجلد المشروع شغّل:

```bash
npm install
npx cap sync android
```

حزمة Push موجودة في `package.json` باسم `@capacitor/push-notifications`.

## 3) صلاحيات الإشعارات

عند أول تشغيل لتطبيق Android سيطلب التطبيق إذن الإشعارات. يجب السماح به حتى تظهر الإشعارات في شريط الإشعارات وشاشة القفل.

## 4) إعداد الخادم Render

في Environment Variables أضف:

`FIREBASE_SERVICE_ACCOUNT_JSON`

وقيمته هي محتوى JSON لحساب خدمة Firebase الذي يملك صلاحية إرسال FCM.

مثال البنية فقط:

```json
{"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\\n...","client_email":"..."}
```

لا تضع المفتاح الحقيقي داخل ملفات المشروع أو GitHub.

## 5) التشغيل

بعد تثبيت التطبيق مرة واحدة وتسجيل دخول الطالب والسماح بالإشعارات، يسجل التطبيق جهازه تلقائيا لدى الخادم. بعد ذلك:

- إضافة كتاب ترسل Push للطلاب.
- الملاحظة/الواجب الموجّه لشعبة وسنة يرسل Push للطلاب المطابقين.
- الضغط على الإشعار يفتح الرابط المرتبط به.
- جرس الإشعارات الداخلي يبقى يعمل كما هو.

## ملاحظة مهمة

FCM يحتاج إعداد Firebase مرة واحدة فقط. ملفات Firebase السرية غير مرفقة في هذه النسخة لحماية المشروع.
