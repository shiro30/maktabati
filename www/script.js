// =====================================================
// مكتبة ثانوية مصاص رابح
// الإعدادات العامة
// =====================================================


// =====================================================
// البحث عن الكتب
// =====================================================

function searchBooks() {

    const input =
        document.getElementById("searchInput");

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