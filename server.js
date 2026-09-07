const express = require("express");
const path = require("path");

const app = express();

const PORT = 3000;


// السماح للخادم بعرض ملفات الموقع
app.use(express.static(__dirname));


// الصفحة الرئيسية
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});


// تشغيل الخادم
app.listen(PORT, () => {
    console.log(`مكتبة الثانوية تعمل على http://localhost:${PORT}`);
});