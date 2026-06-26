import StorageManager from "./storagemanager.js";

const defaultValueGetters = {
    text: (element) => element.value,
    multi: (element) => {
        const selected = element.querySelectorAll(".select-picker-option.selected");
        return Array.from(selected).map((item) => item.dataset.value);
    },
};

const valueSetters = {
    text: (element, value) => {
        element.value = value;
    },
    multi: (element, values) => {
        const normalized = Array.isArray(values) ? values : [];
        element.querySelectorAll(".select-picker-option").forEach((option) => {
            const isSelected = normalized.includes(option.dataset.value);
            option.classList.toggle("selected", isSelected);
        });
        updatePickerLabel(element);
    },
};

function getStorageKey(element) {
    return element.dataset.storageKey;
}

function getPersist(element) {
    return element.dataset.persist !== "false";
}

function getValidationFn(name) {
    return name ? window[name] : null;
}

function updatePickerLabel(root) {
    const selected = Array.from(root.querySelectorAll(".select-picker-option.selected")).map((option) => option.textContent.trim());
    const input = root.querySelector(".select-picker-input");

    if (!input) {
        return;
    }

    if (selected.length === 0) {
        input.value = "";
        input.placeholder = root.dataset.placeholder || "Select...";
    } else {
        input.value = selected.join(", ");
    }
}

function toggleDropdown(root, open) {
    const dropdown = root.querySelector(".select-picker-dropdown");
    if (!dropdown) return;

    dropdown.classList.toggle("hidden", !open);
}

function closeAllPickers() {
    document.querySelectorAll(".select-picker").forEach((picker) => {
        const dropdown = picker.querySelector(".select-picker-dropdown");
        if (dropdown) {
            dropdown.classList.add("hidden");
        }
    });
}

function filterOptions(root, query) {
    const normalized = query.trim().toLowerCase();
    root.querySelectorAll(".select-picker-option").forEach((option) => {
        const text = option.textContent.trim().toLowerCase();
        option.style.display = text.includes(normalized) ? "flex" : "none";
    });
}

function initializePicker(picker) {
    const singleSelect = picker.dataset.multiselect !== "true";
    const input = picker.querySelector(".select-picker-input");
    const dropdown = picker.querySelector(".select-picker-dropdown");
    const searchInput = picker.querySelector(".select-search");
    const options = Array.from(picker.querySelectorAll(".select-picker-option"));

    if (!input || !dropdown || !searchInput || options.length === 0) {
        return () => {};
    }

    updatePickerLabel(picker);

    const onInputClick = (event) => {
        event.stopPropagation();
        const open = dropdown.classList.contains("hidden");
        closeAllPickers();
        toggleDropdown(picker, open);
    };

    const onSearchInput = () => {
        filterOptions(picker, searchInput.value);
    };

    const optionHandlers = options.map((option) => {
        const handler = () => {
            if (!singleSelect) {
                option.classList.toggle("selected");
            } else {
                options.forEach((item) => {
                    item.classList.toggle("selected", item === option);
                });
            }
            updatePickerLabel(picker);
            persistControlValue(picker);
            if (singleSelect) {
                toggleDropdown(picker, false);
            }
        };
        option.addEventListener("click", handler);
        return { option, handler };
    });

    const onDocumentClick = (event) => {
        if (!picker.contains(event.target)) {
            toggleDropdown(picker, false);
        }
    };

    input.addEventListener("click", onInputClick);
    searchInput.addEventListener("input", onSearchInput);
    document.addEventListener("click", onDocumentClick);

    return () => {
        input.removeEventListener("click", onInputClick);
        searchInput.removeEventListener("input", onSearchInput);
        document.removeEventListener("click", onDocumentClick);
        optionHandlers.forEach(({ option, handler }) => option.removeEventListener("click", handler));
    };
}

export function persistControlValue(element) {
    const key = getStorageKey(element);
    if (!key || !getPersist(element)) {
        return;
    }

    if (element.matches(".select-picker")) {
        const value = defaultValueGetters.multi(element);
        StorageManager.setJson(key, value);
        return;
    }

    const value = element.value;
    let validationResult = { valid: true };
    const validationName = element.dataset.validation;
    const validationFn = getValidationFn(validationName);
    if (validationFn) {
        validationResult = validationFn(value);
    }

    if (!validationResult.valid) {
        return;
    }

    if (!value) {
        StorageManager.removeItem(key);
        return;
    }

    StorageManager.setItem(key, value);
}

export function restoreControlValue(element) {
    const key = getStorageKey(element);
    if (!key) {
        return;
    }

    if (element.matches(".select-picker")) {
        const value = StorageManager.getJson(key, []);
        valueSetters.multi(element, value);
        return;
    }

    const value = StorageManager.getItem(key, "");
    if (value) {
        valueSetters.text(element, value);
    }
}

function attachTextControl(input) {
    const onInput = () => persistControlValue(input);
    input.addEventListener("input", onInput);

    return () => input.removeEventListener("input", onInput);
}

export function initFormControls({ root }) {
    const controls = Array.from(root.querySelectorAll("[data-storage-key]"));
    const cleanup = [];

    controls.forEach((control) => {
        restoreControlValue(control);

        if (control.matches(".text-input") && !control.closest(".select-picker")) {
            cleanup.push(attachTextControl(control));
        }

        if (control.matches(".select-picker")) {
            cleanup.push(initializePicker(control));
        }
    });

    return () => cleanup.forEach((fn) => fn());
}
