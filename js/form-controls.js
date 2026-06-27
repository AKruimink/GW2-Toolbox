/**
 * Form Controls Module
 * 
 * Provides form component management with persistence features:
 * - Text input persistence (saves to localStorage)
 * - Multi-select picker component with filtering
 * - Automatic clear buttons
 * - Validation hooks
 * - State restoration on page load
 */

import StorageManager from "./storagemanager.js";

// ========== VALUE GETTER/SETTER PATTERNS ==========
/**
 * Maps control types to functions that extract their current values.
 * Used for getting form state before persisting.
 */
const defaultValueGetters = {
    text: (element) => element.value,
    multi: (element) => {
        const selected = element.querySelectorAll(".select-picker-option.selected");
        return Array.from(selected).map((item) => item.dataset.value);
    },
};

/**
 * Maps control types to functions that set their values.
 * Used for restoring form state from storage.
 */
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

// ========== HELPER FUNCTIONS ==========

/**
 * Extracts storage key from element's data attribute.
 * Storage key determines where form value is persisted in localStorage.
 * @param {HTMLElement} element - Form control element
 * @returns {string|undefined} Storage key or undefined if not set
 */
function getStorageKey(element) {
    return element.dataset.storageKey;
}

/**
 * Checks if element should persist its value to localStorage.
 * Default is true unless explicitly set to "false".
 * @param {HTMLElement} element - Form control element
 * @returns {boolean} Whether to persist this control
 */
function getPersist(element) {
    return element.dataset.persist !== "false";
}

/**
 * Gets a validation function by name from window scope.
 * Allows HTML to reference validation functions: data-validation="validateApiKey"
 * @param {string} name - Function name to look up
 * @returns {function|null} Validation function or null
 */
function getValidationFn(name) {
    return name ? window[name] : null;
}

/**
 * Updates the display label of a multi-select picker to show selected items.
 * Shows placeholder text if nothing is selected.
 * 
 * @param {HTMLElement} root - Select picker element
 * @returns {void}
 */
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

/**
 * Shows or hides the clear button based on whether the control has a value.
 * @param {HTMLElement} root - Form control container
 * @param {HTMLElement} clearButton - Clear button element
 * @returns {void}
 */
function updateClearButtonVisibility(root, clearButton) {
    if (!clearButton) {
        return;
    }

    const hasValue = root.matches(".select-picker")
        ? root.querySelectorAll(".select-picker-option.selected").length > 0
        : Boolean(root.value.trim());

    clearButton.classList.toggle("hidden", !hasValue);
}

/**
 * Creates and configures a clear button for text/picker inputs.
 * Button is shown/hidden based on input value, clears on click.
 * 
 * @param {HTMLElement} input - Input element to attach clear button to
 * @returns {function|null} Cleanup function or null if not clearable
 */
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

/**
 * Closes all open multi-select picker dropdowns on the page.
 * Used to ensure only one picker is open at a time (click-away behavior).
 * @returns {void}
 */
function closeAllPickers() {
    document.querySelectorAll(".select-picker").forEach((picker) => {
        const dropdown = picker.querySelector(".select-picker-dropdown");
        if (dropdown) {
            dropdown.classList.add("hidden");
        }
    });
}

/**
 * Filters picker options to show only those matching the search query.
 * Uses case-insensitive substring matching on option text.
 * @param {HTMLElement} root - Select picker element
 * @param {string} query - Search query string
 * @returns {void}
 */
function filterOptions(root, query) {
    const normalized = query.trim().toLowerCase();
    root.querySelectorAll(".select-picker-option").forEach((option) => {
        const text = option.textContent.trim().toLowerCase();
        option.style.display = text.includes(normalized) ? "flex" : "none";
    });
}

/**
 * Initializes a multi-select picker component with full functionality.
 * 
 * Features:
 * - Toggle dropdown on input click
 * - Search/filter options in dropdown
 * - Single-select or multi-select modes
 * - "Select all" / "Deselect all" option
 * - Click-away to close dropdown
 * - Persists selections to localStorage
 * 
 * @param {HTMLElement} picker - Select picker element
 * @returns {function} Cleanup function to remove event listeners
 */
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

    // Determine if all options are selected, update "Select all" label accordingly
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

    // Called whenever selection changes - updates label, persists, fires change event
    const updateSelectedState = () => {
        updatePickerLabel(picker);
        persistControlValue(picker);
        updateClearButtonVisibility(picker, clearButton);
        updateSelectAllOption();
        picker.dispatchEvent(new Event("change", { bubbles: true }));
    };

    const onOptionClick = (option) => {
        if (option === allOption) {
            // Toggle all options based on current state
            const allSelected = options.length > 0 && options.every((item) => item.classList.contains("selected"));
            options.forEach((item) => item.classList.toggle("selected", !allSelected));
        } else if (!singleSelect) {
            // Multi-select: toggle individual option
            option.classList.toggle("selected");
        } else {
            // Single-select: select only this option, deselect others
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

    // Click anywhere outside picker to close dropdown
    const onDocumentClick = (event) => {
        if (!picker.contains(event.target)) {
            toggleDropdown(picker, false);
        }
    };

    input.addEventListener("click", onInputClick);
    searchInput.addEventListener("input", onSearchInput);
    document.addEventListener("click", onDocumentClick);

    // Return cleanup function to unbind all listeners
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

/**
 * Persists a form control's value to localStorage.
 * 
 * For text inputs:
 * - Runs optional validation function first
 * - Only persists if validation passes
 * - Removes from storage if value is empty
 * 
 * For multi-select pickers:
 * - Stores as JSON array of selected values
 * 
 * @param {HTMLElement} element - Form control to persist
 * @returns {void}
 */
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

/**
 * Restores a form control's value from localStorage.
 * 
 * For text inputs:
 * - Retrieves string value and sets to element
 * 
 * For multi-select pickers:
 * - Retrieves JSON array and marks matching options as selected
 * 
 * @param {HTMLElement} element - Form control to restore
 * @returns {void}
 */
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

/**
 * Attaches input listener to a text control to persist on every change.
 * @param {HTMLElement} input - Text input element
 * @returns {function} Cleanup function to remove listener
 */
function attachTextControl(input) {
    const onInput = () => persistControlValue(input);
    input.addEventListener("input", onInput);

    return () => input.removeEventListener("input", onInput);
}

/**
 * Initializes all form controls within a root element.
 * 
 * Handles:
 * - Restoration of persisted values on load
 * - Setup of event listeners for persistence
 * - Initialization of multi-select pickers
 * - Creation of clear buttons
 * 
 * @param {object} options - Initialization options
 * @param {HTMLElement} options.root - Root element containing form controls
 * @returns {function} Cleanup function called on route change
 */
export function initFormControls({ root }) {
    const controls = Array.from(root.querySelectorAll("[data-storage-key]"));
    const cleanup = [];

    controls.forEach((control) => {
        // Restore persisted value first
        restoreControlValue(control);

        // Setup text input persistence and clear button
        if (control.matches(".text-input") && !control.closest(".select-picker")) {
            cleanup.push(attachTextControl(control));
            if (control.dataset.clearable === "true") {
                const cleanupClear = createClearButtonForInput(control);
                if (cleanupClear) {
                    cleanup.push(cleanupClear);
                }
            }
        }

        // Setup multi-select picker
        if (control.matches(".select-picker")) {
            cleanup.push(initializePicker(control));
        }
    });

    // Return cleanup function that unbinds all listeners
    return () => cleanup.forEach((fn) => fn());
}
