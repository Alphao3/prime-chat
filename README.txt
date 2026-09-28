# Prime Chat Online

هذه نسخة أونلاين من Prime Chat بدون Firebase.

## الملفات
- index.html
- server.js
- package.json

## قبل التشغيل
أنشئ قاعدة MongoDB Atlas، ثم أضف متغيري البيئة:
- MONGO_URI = رابط اتصال MongoDB
- JWT_SECRET = كلمة سر طويلة عشوائية

## الاستضافة
ارفع المشروع إلى GitHub ثم اربطه بخدمة تستضيف Node.js مثل Render.
Build Command:
npm install

Start Command:
npm start

لا تضع MONGO_URI أو JWT_SECRET داخل index.html أو GitHub.
