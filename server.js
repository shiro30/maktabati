const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;


// السماح بعرض ملفات الموقع
app.use(express.static(__dirname));


// الصفحة الرئيسية
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});


// تشغيل الخادم
app.listen(PORT, "0.0.0.0", () => {
    console.log(`مكتبة الثانوية تعمل على المنفذ ${PORT}`);
});