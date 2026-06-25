import StorageManager from "./storagemanager.js";

const STORAGE_KEY = "gw2toolbox.apiKey";
const API_KEY_PATTERN = /^[A-Za-z0-9]{8}(?:-[A-Za-z0-9]{4}){3}-[A-Za-z0-9]{24}(?:-[A-Za-z0-9]{4}){3}-[A-Za-z0-9]{24}$/;
const FORMAT_GROUPS = [8, 4, 4, 4, 24, 4, 4, 4, 24];

function stripKey(value) {
    return value.replace(/[^A-Za-z0-9]/g, "");
}

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

function getRawIndexFromCursor(value, cursorPosition) {
    const before = value.slice(0, cursorPosition);
    return stripKey(before).length;
}

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

function renderValidation(input, errorElement, validationResult) {
    const invalid = !validationResult.valid && input.value.trim() !== "";

    input.classList.toggle("invalid", invalid);
    input.setAttribute("aria-invalid", String(invalid));
    input.title = invalid ? validationResult.message : "";
    errorElement.textContent = invalid ? validationResult.message : "";
    errorElement.classList.toggle("visible", invalid);
}

export function init({ root }) {
    const input = root.querySelector("#apiKeyInput");
    const errorElement = root.querySelector("#apiKeyError");

    if (!input || !errorElement) {
        return undefined;
    }

    const storedValue = StorageManager.getItem(STORAGE_KEY, "");

    if (storedValue) {
        input.value = storedValue;
        renderValidation(input, errorElement, { valid: true, message: "" });
    }

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

    input.addEventListener("input", onInput);

    return () => {
        input.removeEventListener("input", onInput);
    };
}
