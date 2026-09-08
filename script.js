// =====================================================
// مكتبة ثانوية مصاص رابح
// الإعدادات العامة والشعار
// =====================================================


// =====================================================
// إضافة شعار المكتبة تلقائيا إلى الصفحات
// =====================================================

function addLibraryLogoToAllPages() {

    // مسار الشعار على الموقع
    const logoPath = "/favicon.png";

    // إذا كان هناك شعار موجود بالفعل فلا نضيف واحدا آخر
    const existingLogo = document.querySelector(
        ".logo-icon img"
    );

    if (existingLogo) {
        return;
    }


    // البحث عن منطقة الشعار في الهيدر
    const logoContainer =
        document.querySelector("header .logo") ||
        document.querySelector(".navbar .logo") ||
        document.querySelector(".header .logo");


    // إذا وجدنا منطقة الشعار
    if (logoContainer) {

        const logoIcon =
            document.createElement("div");

        logoIcon.className =
            "logo-icon";


        const logoImage =
            document.createElement("img");

        logoImage.src =
            logoPath;

        logoImage.alt =
            "شعار مكتبة ثانوية مصاص رابح";


        logoIcon.appendChild(
            logoImage
        );


        logoContainer.prepend(
            logoIcon
        );
    }


    // =================================================
    // تنسيق الشعار
    // =================================================

    if (!document.getElementById("maktabati-logo-style")) {

        const style =
            document.createElement("style");

        style.id =
            "maktabati-logo-style";

        style.textContent = `

            .logo-icon {
                width: 58px;
                height: 58px;
                min-width: 58px;
                border-radius: 50%;
                overflow: hidden;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                background: white;
            }

            .logo-icon img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                display: block;
            }

            @media (max-width: 900px) {

                .logo-icon {
                    width: 50px;
                    height: 50px;
                    min-width: 50px;
                }

            }

        `;

        document.head.appendChild(
            style
        );
    }
}


// =====================================================
// البحث عن الكتب
// =====================================================

function searchBooks() {

    const input =
        document.getElementById(
            "searchInput"
        );

    if (!input) {
        return;
    }

    const search =
        input.value.trim();

    if (search === "") {
        return;
    }

    window.location.href =
        "pages/books.html?search=" +
        encodeURIComponent(search);
}


// =====================================================
// تشغيل الشعار بعد تحميل الصفحة
// =====================================================

document.addEventListener(
    "DOMContentLoaded",
    function () {

        addLibraryLogoToAllPages();

    }
);