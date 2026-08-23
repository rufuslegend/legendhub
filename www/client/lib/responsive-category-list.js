function initializeResponsiveCategoryLists(root = document) {
    for (const categoryList of root.querySelectorAll("[data-category-list]")) {
        const open = root.querySelector(
            `[data-category-list-open][aria-controls="${categoryList.id}"]`
        );
        const close = categoryList.querySelector("[data-category-list-close]");
        let restoreFocusTo;

        if (!open || !close)
            continue;

        function closeCategoryList() {
            if (!categoryList.classList.contains("active"))
                return;

            categoryList.classList.remove("active");
            document.body.classList.remove("modal-open");
            open.setAttribute("aria-expanded", "false");
            if (restoreFocusTo && restoreFocusTo.isConnected)
                restoreFocusTo.focus();
        }

        function openCategoryList() {
            restoreFocusTo = document.activeElement;
            categoryList.classList.add("active");
            document.body.classList.add("modal-open");
            open.setAttribute("aria-expanded", "true");
        }

        open.addEventListener("click", openCategoryList);
        close.addEventListener("click", closeCategoryList);
        categoryList.addEventListener("click", function(event) {
            if (event.target === categoryList)
                closeCategoryList();
        });
        document.addEventListener("keydown", function(event) {
            if (event.key === "Escape")
                closeCategoryList();
        });
    }
}

export {initializeResponsiveCategoryLists};
