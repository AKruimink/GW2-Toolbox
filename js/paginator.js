export class Paginator {
    /**
     * @typedef {Object} PaginatorOptions
     * @property {HTMLElement} container Element in which to render the paginator.
     * @property {PaginatorColumn[]} columns Column definitions.
     * @property {number[]} [pageSizes] Allowed page sizes, include -1 for "All".
     * @property {number} [defaultPageSize] Initial page size (must exist in pageSizes).
     * @property {(row:any) => (string|undefined|null|false)} [rowClassFn] Adds a CSS class per row.
     * @property {(row:any) => string} [detailFormatter] Returns HTML string for an expanded detail row.
     * @property {boolean} [detailsEnabled=true] Enables/disables detail toggles.
     * @property {string|null} [searchProperty] Optional property to search before visible columns.
     */

    /**
     * Constructs a new Paginator instance.
     * @param {PaginatorOptions} options
     */
    constructor(options) {
        this.container = options.container;
        this.columns = options.columns || [];
        this.pageSizes = options.pageSizes || [10, 25, 50, 100, 500, 1000, -1];

        this.rowClassFn = options.rowClassFn || null;
        this.detailFormatter = options.detailFormatter || null;
        this.detailsEnabled = options.detailsEnabled !== undefined ? options.detailsEnabled : true;
        this.searchProperty = options.searchProperty || null;

        this.currentPageSize =
            options.defaultPageSize && this.pageSizes.includes(options.defaultPageSize)
                ? options.defaultPageSize
                : this.pageSizes[0];

        this.currentPage = 1;
        this.data = [];

        this.searchQuery = "";
        this.sortColumn = null;
        this.sortAsc = true;

        // Used for info text: “filtered from X total entries”
        this.originalTotalCount = 0;

        // Pagination button rendering (recalculated on each render)
        this.maxPageButtons = 10;

        this.headerCells = [];
        this.elements = {
            pageSizeSelect: null,
            searchInput: null,
            table: null,
            tbody: null,
            info: null,
            pageNumbers: null,
            prevBtn: null,
            nextBtn: null,
            footer: null,
        };

        this.setup();
    }

    /**
     * Replaces the current dataset and re-renders from page one.
     * Optionally accepts the original (pre-filter) total count for info text.
     * @param {Array} data
     * @param {number} [originalTotalCount]
     * @returns {void}
     */
    setData(data, originalTotalCount) {
        this.data = Array.isArray(data) ? data.slice() : [];
        this.originalTotalCount = typeof originalTotalCount === "number" ? originalTotalCount : this.data.length;

        this.currentPage = 1;
        this.render();
    }

    /**
     * Destroys the paginator by clearing the container.
     * After destruction the instance should not be used again.
     * @returns {void}
     */
    destroy() {
        this.container.innerHTML = "";
    }

    /**
     * Calculates the total number of pages based on the current
     * page size and dataset length. When page size is -1 (All) this returns 1.
     * NOTE: This intentionally uses the unfiltered dataset length (same as before).
     * @returns {number}
     */
    getTotalPages() {
        if (this.currentPageSize === -1) return 1;
        return Math.max(1, Math.ceil(this.data.length / this.currentPageSize));
    }

    /**
     * Renders the table body, info text, and pagination controls.
     * @returns {void}
     */
    render() {
        const filteredData = this.getFilteredData();
        const sortedData = this.getSortedData(filteredData);

        const total = sortedData.length;
        const totalPages =
            this.currentPageSize === -1
                ? 1
                : Math.max(1, Math.ceil(total / this.currentPageSize));

        if (this.currentPage > totalPages) {
            this.currentPage = totalPages;
        }

        const { startIndex, endIndex } = this.getVisibleRange(total);
        const visible = sortedData.slice(startIndex, endIndex);

        this.renderRows(visible);
        this.updateInfoText({ total, startIndex, endIndex });
        this.recalculateMaxPageButtons(totalPages);
        this.renderPaginationNumbers(totalPages);
        this.updatePrevNextDisabled(totalPages);
        this.updateSortIndicators();

        this.attachDetailHandlers(visible);
    }

    /**
     * Builds the static DOM structure and attaches base event listeners.
     * @returns {void}
     */
    setup() {
        this.container.innerHTML = "";
        this.headerCells = [];

        const controlsDiv = this.buildControls();
        const table = this.buildTable();
        const footer = this.buildFooter();

        this.container.appendChild(controlsDiv);
        this.container.appendChild(table);
        this.container.appendChild(footer);

        this.bindBaseEvents();
    }

    /**
     * Creates the top control bar (page size selector + search input).
     * @returns {HTMLDivElement}
     */
    buildControls() {
        const controlsDiv = document.createElement("div");
        controlsDiv.classList.add("paginator-controls");

        // Page size selector
        const sizeLabel = document.createElement("label");
        sizeLabel.textContent = "Show ";

        const select = document.createElement("select");
        select.classList.add("page-size-selector");

        this.pageSizes.forEach((size) => {
            const opt = document.createElement("option");
            opt.value = size;
            opt.textContent = size === -1 ? "All" : String(size);
            if (size === this.currentPageSize) opt.selected = true;
            select.appendChild(opt);
        });

        sizeLabel.appendChild(select);
        sizeLabel.appendChild(document.createTextNode(" entries"));
        controlsDiv.appendChild(sizeLabel);

        // Search input
        const searchInput = document.createElement("input");
        searchInput.type = "text";
        searchInput.classList.add("paginator-search");
        searchInput.placeholder = "Search…";
        controlsDiv.appendChild(searchInput);

        this.elements.pageSizeSelect = select;
        this.elements.searchInput = searchInput;

        return controlsDiv;
    }

    /**
     * Creates the table skeleton (<table><thead>..<tbody>..).
     * @returns {HTMLTableElement}
     */
    buildTable() {
        const table = document.createElement("table");
        table.classList.add("paginator-table");

        const thead = document.createElement("thead");
        const headerRow = document.createElement("tr");

        this.columns.forEach((col) => {
            const th = document.createElement("th");
            th.textContent = col.title || "";

            if (col.width) {
                th.style.width = col.width;
            }

            if (col.sortable !== false && col.data !== null && col.data !== undefined) {
                th.classList.add("sortable");
            }

            this.headerCells.push(th);
            headerRow.appendChild(th);
        });

        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        table.appendChild(tbody);

        this.elements.table = table;
        this.elements.tbody = tbody;

        return table;
    }

    /**
     * Creates the bottom footer (info text + pagination controls).
     * @returns {HTMLDivElement}
     */
    buildFooter() {
        const infoEl = document.createElement("div");
        infoEl.classList.add("paginator-info");

        const paginationDiv = document.createElement("div");
        paginationDiv.classList.add("paginator-pagination");

        const prevBtn = document.createElement("button");
        prevBtn.classList.add("page-prev");
        prevBtn.textContent = "Previous";

        const pageNumbersSpan = document.createElement("span");
        pageNumbersSpan.classList.add("page-numbers");

        const nextBtn = document.createElement("button");
        nextBtn.classList.add("page-next");
        nextBtn.textContent = "Next";

        paginationDiv.appendChild(prevBtn);
        paginationDiv.appendChild(pageNumbersSpan);
        paginationDiv.appendChild(nextBtn);

        const footerDiv = document.createElement("div");
        footerDiv.classList.add("paginator-footer");
        footerDiv.appendChild(infoEl);
        footerDiv.appendChild(paginationDiv);

        this.elements.info = infoEl;
        this.elements.pageNumbers = pageNumbersSpan;
        this.elements.prevBtn = prevBtn;
        this.elements.nextBtn = nextBtn;
        this.elements.footer = footerDiv;

        return footerDiv;
    }

    /**
     * Attaches event listeners that do not depend on dynamic row rendering.
     * @returns {void}
     */
    bindBaseEvents() {
        const { pageSizeSelect, searchInput, prevBtn, nextBtn } = this.elements;

        if (pageSizeSelect) {
            pageSizeSelect.addEventListener("change", () => {
                const size = Number(pageSizeSelect.value);
                this.currentPageSize = size;
                this.currentPage = 1;
                this.render();
            });
        }

        if (searchInput) {
            searchInput.addEventListener("input", () => {
                this.searchQuery = searchInput.value;
                this.currentPage = 1;
                this.render();
            });
        }

        // Sorting: attach click handlers to header cells based on column definitions
        this.headerCells.forEach((th, index) => {
            const col = this.columns[index];
            if (col.sortable !== false && col.data !== null && col.data !== undefined) {
                th.addEventListener("click", () => {
                    if (this.sortColumn === col.data) {
                        this.sortAsc = !this.sortAsc;
                    } else {
                        this.sortColumn = col.data;
                        this.sortAsc = true;
                    }
                    this.currentPage = 1;
                    this.render();
                });
            }
        });

        if (prevBtn) {
            prevBtn.addEventListener("click", () => {
                if (this.currentPage > 1) {
                    this.currentPage--;
                    this.render();
                }
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener("click", () => {
                const totalPages = this.getTotalPages(); // intentionally unfiltered
                if (this.currentPage < totalPages) {
                    this.currentPage++;
                    this.render();
                }
            });
        }
    }

    /**
     * Filters the dataset based on the active search query.
     * Matching is case-insensitive and searches:
     * 1) searchProperty (when provided), then
     * 2) visible columns that have a data key.
     * @returns {Array}
     */
    getFilteredData() {
        const query = (this.searchQuery || "").toLowerCase();
        if (!query) return this.data;

        return this.data.filter((row) => {
            if (this.searchProperty && row[this.searchProperty] != null) {
                const val = row[this.searchProperty];
                try {
                    if (String(val).toLowerCase().includes(query)) {
                        return true;
                    }
                } catch {
                    // ignore
                }
            }

            return this.columns.some((col) => {
                if (col.data !== null && col.data !== undefined) {
                    const value = row[col.data];
                    if (value !== undefined && value !== null) {
                        try {
                            return String(value).toLowerCase().includes(query);
                        } catch {
                            return false;
                        }
                    }
                }
                return false;
            });
        });
    }

    /**
     * Returns a sorted clone of the provided array based on current sort state.
     * Sorting behavior matches the existing implementation (including null ordering).
     * @param {Array} input
     * @returns {Array}
     */
    getSortedData(input) {
        const data = Array.from(input);

        if (!this.sortColumn) {
            return data;
        }

        const colKey = this.sortColumn;
        const asc = this.sortAsc;

        data.sort((a, b) => {
            let valA = a[colKey];
            let valB = b[colKey];

            const typeA = typeof valA;
            const typeB = typeof valB;

            if (valA == null && valB != null) return asc ? -1 : 1;
            if (valA != null && valB == null) return asc ? 1 : -1;
            if (valA == null && valB == null) return 0;

            if (typeA === "string") valA = valA.toLowerCase();
            if (typeB === "string") valB = valB.toLowerCase();

            if (valA > valB) return asc ? 1 : -1;
            if (valA < valB) return asc ? -1 : 1;
            return 0;
        });

        return data;
    }

    /**
     * Computes the visible range indices for the current page/page size.
     * @param {number} total
     * @returns {{startIndex:number, endIndex:number}}
     */
    getVisibleRange(total) {
        if (this.currentPageSize === -1) {
            return { startIndex: 0, endIndex: total };
        }

        const startIndex = (this.currentPage - 1) * this.currentPageSize;
        const endIndex = Math.min(startIndex + this.currentPageSize, total);

        return { startIndex, endIndex };
    }

    /**
     * Renders the visible rows into <tbody>.
     * @param {Array} visible
     * @returns {void}
     */
    renderRows(visible) {
        const tbody = this.elements.tbody;
        if (!tbody) return;

        tbody.innerHTML = "";

        visible.forEach((item) => {
            const tr = document.createElement("tr");

            this.columns.forEach((col) => {
                const td = document.createElement("td");

                if (col.className) td.className = col.className;
                if (col.width) td.style.width = col.width;

                if (typeof col.render === "function") {
                    const rendered = col.render(item[col.data], item);
                    if (rendered instanceof Node) {
                        td.appendChild(rendered);
                    } else {
                        td.innerHTML = rendered;
                    }
                } else {
                    const val = item[col.data];
                    td.textContent = val !== undefined && val !== null ? String(val) : "";
                }

                tr.appendChild(td);
            });

            if (typeof this.rowClassFn === "function") {
                const cls = this.rowClassFn(item);
                if (cls) tr.classList.add(cls);
            }

            tbody.appendChild(tr);
        });
    }

    /**
     * Updates the info text ("Showing X to Y of Z entries ...").
     * @param {{total:number, startIndex:number, endIndex:number}} args
     * @returns {void}
     */
    updateInfoText({ total, startIndex, endIndex }) {
        const infoEl = this.elements.info;
        if (!infoEl) return;

        if (total === 0) {
            infoEl.textContent = "No entries";
            return;
        }

        const from = this.currentPageSize === -1 ? 1 : startIndex + 1;
        const to = this.currentPageSize === -1 ? total : endIndex;

        let msg = `Showing ${from} to ${to} of ${total} entries`;
        if (this.originalTotalCount && this.originalTotalCount > total) {
            msg += ` (filtered from ${this.originalTotalCount} total entries)`;
        }

        infoEl.textContent = msg;
    }

    /**
     * Recalculates max page buttons based on available width (same heuristic as before).
     * @param {number} totalPages
     * @returns {void}
     */
    recalculateMaxPageButtons(totalPages) {
        const pageNumbersSpan = this.elements.pageNumbers;
        if (!pageNumbersSpan || !pageNumbersSpan.parentElement) return;

        const parentWidth = pageNumbersSpan.parentElement.clientWidth || 0;
        const reserved = 180;
        const avail = Math.max(0, parentWidth - reserved);

        const digits = totalPages.toString().length;
        const approx = 30 + digits * 8;

        const maxBtns = Math.floor(avail / approx);
        this.maxPageButtons = Math.max(5, maxBtns);
    }

    /**
     * Renders pagination number buttons with ellipses (same behavior as before).
     * @param {number} totalPages
     * @returns {void}
     */
    renderPaginationNumbers(totalPages) {
        const pageNumbersSpan = this.elements.pageNumbers;
        if (!pageNumbersSpan) return;

        pageNumbersSpan.innerHTML = "";

        if (totalPages <= 1) {
            return;
        }

        const maxButtons = this.maxPageButtons;
        const siblings = Math.max(Math.floor((maxButtons - 4) / 2), 1);

        /** @type {Array<number|{ellipsis:true,target:number}>} */
        const range = [1];

        if (totalPages <= maxButtons) {
            for (let i = 2; i <= totalPages; i++) range.push(i);
        } else {
            let start = Math.max(2, this.currentPage - siblings);
            let end = Math.min(totalPages - 1, this.currentPage + siblings);

            if (this.currentPage <= siblings + 2) {
                start = 2;
                end = 2 + siblings * 2;
            }

            if (this.currentPage >= totalPages - siblings - 1) {
                end = totalPages - 1;
                start = end - siblings * 2;
            }

            if (start > 2) {
                const target = Math.max(1, start - (siblings * 2 + 1));
                range.push({ ellipsis: true, target });
            }

            for (let i = start; i <= end; i++) range.push(i);

            if (end < totalPages - 1) {
                const target = Math.min(totalPages, end + (siblings * 2 + 1));
                range.push({ ellipsis: true, target });
            }

            range.push(totalPages);
        }

        range.forEach((p) => {
            if (typeof p === "object" && p.ellipsis) {
                const span = document.createElement("span");
                span.textContent = "…";
                span.classList.add("page-ellipsis");
                span.title = `Jump to page ${p.target}`;
                span.style.cursor = "pointer";
                span.addEventListener("click", () => {
                    this.currentPage = p.target;
                    this.render();
                });
                pageNumbersSpan.appendChild(span);
                return;
            }

            const btn = document.createElement("button");
            btn.textContent = String(p);

            if (p === this.currentPage) {
                btn.disabled = true;
            }

            btn.addEventListener("click", () => {
                this.currentPage = p;
                this.render();
            });

            pageNumbersSpan.appendChild(btn);
        });
    }

    /**
     * Updates prev/next disabled state based on the current rendered page count.
     * @param {number} totalPages
     * @returns {void}
     */
    updatePrevNextDisabled(totalPages) {
        const { prevBtn, nextBtn } = this.elements;
        if (prevBtn) prevBtn.disabled = this.currentPage <= 1;
        if (nextBtn) nextBtn.disabled = this.currentPage >= totalPages;
    }

    /**
     * Updates header classes to reflect current sort state.
     * @returns {void}
     */
    updateSortIndicators() {
        if (!this.headerCells || this.headerCells.length !== this.columns.length) return;

        this.headerCells.forEach((th, idx) => {
            const col = this.columns[idx];

            if (col.sortable !== false && col.data !== null && col.data !== undefined) {
                th.classList.remove("sorted-asc", "sorted-desc");

                if (col.data === this.sortColumn) {
                    th.classList.add(this.sortAsc ? "sorted-asc" : "sorted-desc");
                }
            }
        });
    }

    /**
     * Attaches detail toggle handlers for the currently rendered rows.
     * Behavior matches the existing implementation:
     * - Only works when detailsEnabled and detailFormatter is a function.
     * - Looks for a first cell with class "details-control" and toggles a sibling row.
     * @param {Array} visible
     * @returns {void}
     */
    attachDetailHandlers(visible) {
        if (!this.detailsEnabled || typeof this.detailFormatter !== "function") return;

        const tbody = this.elements.tbody;
        if (!tbody) return;

        const rows = Array.from(tbody.children);
        rows.forEach((tr, idx) => {
            const cells = Array.from(tr.children);
            if (cells.length === 0) return;

            const firstCell = cells[0];
            if (!firstCell.classList.contains("details-control")) return;

            const iconEl = firstCell.querySelector(".toggle-icon");
            if (iconEl) iconEl.textContent = "➕";

            // Keep onclick assignment semantics from the original code.
            firstCell.onclick = () => {
                const rowItem = visible[idx];
                const next = tr.nextSibling;

                if (next && next.classList && next.classList.contains("detail-container")) {
                    next.remove();
                    if (iconEl) iconEl.textContent = "➕";
                    return;
                }

                const detailTr = document.createElement("tr");
                detailTr.classList.add("detail-container");

                const detailTd = document.createElement("td");
                detailTd.colSpan = this.columns.length;
                detailTd.innerHTML = this.detailFormatter(rowItem);

                detailTr.appendChild(detailTd);
                tr.after(detailTr);

                if (iconEl) iconEl.textContent = "➖";
            };
        });
    }
}

export default Paginator;
