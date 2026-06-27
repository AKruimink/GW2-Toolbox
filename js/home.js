/**
 * Home Module - GW2 API Key Configuration
 * 
 * Handles the home page where users configure their Guild Wars 2 API key.
 * 
 * Features:
 * - Real-time API key format validation
 * - Automatic hyphen formatting (user types continuous, we format with hyphens)
 * - Smart cursor position tracking (maintains correct position after formatting)
 * - Live error messages for invalid keys
 * - Persistent storage of valid API key
 * - Form control persistence
 */

import StorageManager from "./storagemanager.js";
import { initFormControls } from "./form-controls.js";

// ========== API KEY CONFIGURATION ==========
const STORAGE_KEY = "gw2toolbox.apiKey";

/**
 * GW2 API key format regex.
 * Expected format: 8-4-4-4-20-4-4-4-12 alphanumeric characters with hyphens
 * Example: XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXXXXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
 */
const API_KEY_PATTERN = /^[A-Za-z0-9]{8}(?:-[A-Za-z0-9]{4}){3}-[A-Za-z0-9]{20}(?:-[A-Za-z0-9]{4}){3}-[A-Za-z0-9]{12}$/;

/**
 * Defines the structure of a properly formatted API key.
 * Each number represents the character count for that segment.
 * Segments are joined with hyphens during formatting.
 */
const FORMAT_GROUPS = [8, 4, 4, 4, 20, 4, 4, 4, 12];

/**
 * Removes all non-alphanumeric characters from a string.
 * Used to extract the raw key before reformatting with hyphens.
 * Example: "ABCD-EF12" → "ABCDEF12"
 * 
 * @param {string} value - String to strip
 * @returns {string} String with only alphanumeric characters
 */
function stripKey(value) {
    return value.replace(/[^A-Za-z0-9]/g, "");
}

/**
 * Formats a raw API key string with proper hyphen placement.
 * 
 * Process:
 * 1. Strip all non-alphanumeric characters
 * 2. Split into segments matching FORMAT_GROUPS sizes
 * 3. Join segments with hyphens
 * 
 * Example: "ABCDEFGH1234EFGH5678" → "ABCDEFGH-1234-EFGH-5678"
 * 
 * @param {string} value - Raw or partially formatted API key
 * @returns {string} Properly formatted API key with hyphens
 */
function formatApiKey(value) {
    const stripped = stripKey(value);
    let currentIndex = 0;
    const formattedParts = [];

    for (const length of FORMAT_GROUPS) {
        if (currentIndex >= stripped.length) {
            break;
        }

        const segment = stripped.slice(currentIndex, currentIndex + length);
        formattedParts.push(segment);
        currentIndex += length;
    }

    return formattedParts.join("-");
}

/**
 * Converts a raw character index (position in unformatted key) to a cursor position in formatted key.
 * Accounts for hyphens added during formatting.
 * 
 * Example: If formatting "ABCDEFGH-1234...", raw position 8 becomes cursor position 9 (after the hyphen)
 * 
 * @param {number} rawIndex - Position in the unformatted key string
 * @returns {number} Corresponding cursor position in the formatted key
 */
function calculateCursorFromRaw(rawIndex) {
    let cursor = 0;
    let remaining = rawIndex;

    for (const length of FORMAT_GROUPS) {
        if (remaining <= length) {
            return cursor + remaining;
        }

        remaining -= length;
        cursor += length + 1;
    }

    return cursor;
}

/**
 * Converts a cursor position in a formatted key to the corresponding raw character index.
 * Strips hyphens to find actual character position.
 * 
 * Used after formatting: we know new cursor position, need to maintain user's logical position.
 * 
 * @param {string} value - Formatted API key string
 * @param {number} cursorPosition - Cursor position in the formatted string
 * @returns {number} Position in the unformatted (raw) key string
 */
function getRawIndexFromCursor(value, cursorPosition) {
    const before = value.slice(0, cursorPosition);
    return stripKey(before).length;
}

/**
 * Validates an API key against the expected GW2 format.
 * 
 * Validation:
 * - Empty strings are considered valid (user can delete and re-enter)
 * - Must match API_KEY_PATTERN regex
 * - Provides error message if invalid
 * 
 * @param {string} value - API key to validate (should be trimmed)
 * @returns {{valid: boolean, message: string}} Validation result with optional error message
 */
function validateApiKey(value) {
    if (!value) {
        return { valid: true, message: "" };
    }

    if (API_KEY_PATTERN.test(value)) {
        return { valid: true, message: "" };
    }

    return {
        valid: false,
        message: "The API key must match the expected format and contain only letters, numbers, and hyphens.",
    };
}

/**
 * Updates UI to show validation state.
 * 
 * Updates:
 * - Input invalid class (for red border styling)
 * - Input aria-invalid attribute (for accessibility)
 * - Input title attribute (for hover tooltips)
 * - Error message visibility and text
 * 
 * @param {HTMLElement} input - API key input element
 * @param {HTMLElement} errorElement - Error message display element
 * @param {{valid: boolean, message: string}} validationResult - Validation result to display
 * @returns {void}
 */
function renderValidation(input, errorElement, validationResult) {
    const invalid = !validationResult.valid && input.value.trim() !== "";

    input.classList.toggle("invalid", invalid);
    input.setAttribute("aria-invalid", String(invalid));
    input.title = invalid ? validationResult.message : "";
    errorElement.textContent = invalid ? validationResult.message : "";
    errorElement.classList.toggle("visible", invalid);
}

/**
 * Initializes the home page module.
 * 
 * Sets up:
 * - API key input with real-time formatting
 * - Cursor position tracking during formatting
 * - Live validation with error display
 * - Persistent storage on valid input
 * - Form control initialization
 * - Returns cleanup function for route change
 * 
 * @param {object} options - Initialization options
 * @param {HTMLElement} options.root - Root element containing home page DOM
 * @returns {function|undefined} Cleanup function called on route change
 */
export function init({ root }) {
    const input = root.querySelector("#apiKeyInput");
    const errorElement = root.querySelector("#apiKeyError");

    if (!input || !errorElement) {
        return undefined;
    }

    // ========== RESTORE PERSISTED API KEY ==========
    const storedValue = StorageManager.getItem(STORAGE_KEY, "");

    if (storedValue) {
        input.value = storedValue;
        renderValidation(input, errorElement, { valid: true, message: "" });
    }

    // ========== INPUT HANDLER WITH FORMATTING & VALIDATION ==========
    /**
     * Handles input changes: formats, validates, and persists.
     * 
     * Process:
     * 1. Get current cursor position
     * 2. Format the input with hyphens
     * 3. Calculate new cursor position (smart positioning)
     * 4. Validate the formatted key
     * 5. Update UI with validation state
     * 6. Persist to localStorage if valid (or clear if empty)
     */
    const onInput = (event) => {
        const cursorStart = input.selectionStart || 0;
        const rawCursorIndex = getRawIndexFromCursor(input.value, cursorStart);
        const formattedValue = formatApiKey(input.value);
        const newCursor = calculateCursorFromRaw(rawCursorIndex);

        if (formattedValue !== input.value) {
            input.value = formattedValue;
        }

        input.setSelectionRange(newCursor, newCursor);

        const validationResult = validateApiKey(input.value.trim());
        renderValidation(input, errorElement, validationResult);

        if (input.value.trim() === "") {
            StorageManager.removeItem(STORAGE_KEY);
            return;
        }

        if (validationResult.valid) {
            StorageManager.setItem(STORAGE_KEY, input.value.trim());
        }
    };

    // ========== EVENT LISTENER & CLEANUP ==========
    input.addEventListener("input", onInput);
    const cleanupForm = initFormControls({ root });

    return () => {
        input.removeEventListener("input", onInput);
        if (typeof cleanupForm === "function") {
            cleanupForm();
        }
    };
}
