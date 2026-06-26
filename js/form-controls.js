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

function updateClearButtonVisibility(root, clearButton) {
    if (!clearButton) {
        return;
    }

    const hasValue = root.matches(".select-picker")
        ? root.querySelectorAll(".select-picker-option.selected").length > 0
        : Boolean(root.value.trim());

    clearButton.classList.toggle("hidden", !hasValue);
}

function createClearButtonForInput(input) {
    const shouldClear = input.dataset.clearable === "true";
    if (!shouldClear) {
        return null;
    }

    let button = input.parentElement.querySelector(".clear-button");
    if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "clear-button hidden";
        button.setAttribute("aria-label", "Clear input");
        button.textContent = "×";
        input.parentElement.appendChild(button);
    }

    const update = () => {
        const hasValue = Boolean(input.value.trim());
        button.classList.toggle("hidden", !hasValue);
    };

    const onClear = () => {
        input.value = "";
        persistControlValue(input);
        update();
        input.focus();
    };

    input.addEventListener("input", update);
    button.addEventListener("click", onClear);
    update();

    return () => {
        input.removeEventListener("input", update);
        button.removeEventListener("click", onClear);
    };
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
    const clearButton = picker.querySelector(".clear-button");
    const dropdown = picker.querySelector(".select-picker-dropdown");
    const searchInput = picker.querySelector(".select-search");
    const allOption = picker.querySelector(".select-picker-all");
    const options = Array.from(picker.querySelectorAll(".select-picker-option")).filter((option) => !option.classList.contains("select-picker-all"));

    if (!input || !dropdown || !searchInput || options.length === 0 || !allOption) {
        return () => {};
    }

    const updateSelectAllOption = () => {
        const allSelected = options.length > 0 && options.every((option) => option.classList.contains("selected"));
        allOption.classList.toggle("selected", allSelected);
        const label = allOption.querySelector("span");
        if (label) {
            label.textContent = allSelected ? "Deselect all" : "Select all";
        }
    };

    updatePickerLabel(picker);
    updateClearButtonVisibility(picker, clearButton);
    updateSelectAllOption();

    const onInputClick = (event) => {
        event.stopPropagation();
        const open = dropdown.classList.contains("hidden");
        closeAllPickers();
        toggleDropdown(picker, open);
    };

    const onSearchInput = () => {
        filterOptions(picker, searchInput.value);
    };

    const updateSelectedState = () => {
        updatePickerLabel(picker);
        persistControlValue(picker);
        updateClearButtonVisibility(picker, clearButton);
        updateSelectAllOption();
        picker.dispatchEvent(new Event("change", { bubbles: true }));
    };

    const onOptionClick = (option) => {
        if (option === allOption) {
            const allSelected = options.length > 0 && options.every((item) => item.classList.contains("selected"));
            options.forEach((item) => item.classList.toggle("selected", !allSelected));
        } else if (!singleSelect) {
            option.classList.toggle("selected");
        } else {
            options.forEach((item) => {
                item.classList.toggle("selected", item === option);
            });
        }

        updateSelectedState();
        if (singleSelect) {
            toggleDropdown(picker, false);
        }
    };

    const optionElements = [allOption, ...options];
    const optionHandlers = optionElements.map((option) => {
        const handler = () => onOptionClick(option);
        option.addEventListener("click", handler);
        return { option, handler };
    });

    const onClearClick = () => {
        options.forEach((option) => option.classList.remove("selected"));
        allOption.classList.remove("selected");
        updateSelectedState();
    };

    if (clearButton) {
        clearButton.addEventListener("click", onClearClick);
    }

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
        if (clearButton) {
            clearButton.removeEventListener("click", onClearClick);
        }
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
            if (control.dataset.clearable === "true") {
                const cleanupClear = createClearButtonForInput(control);
                if (cleanupClear) {
                    cleanup.push(cleanupClear);
                }
            }
        }

        if (control.matches(".select-picker")) {
            cleanup.push(initializePicker(control));
        }
    });

    return () => cleanup.forEach((fn) => fn());
}
