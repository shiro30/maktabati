function searchBooks() {

    const input = document.getElementById("searchInput");

    const search = input.value.trim();

    if (search === "") {
        return;
    }

    window.location.href =
        "pages/books.html?search=" + encodeURIComponent(search);
}