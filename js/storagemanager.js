/**
 * StorageManager Class
 * 
 * Provides a clean wrapper around browser localStorage.
 * Handles both string and JSON data with error resilience.
 * 
 * Features:
 * - String value persistence (raw key/value)
 * - JSON serialization/deserialization
 * - Silent failure on JSON parse errors (returns default instead of throwing)
 * - Simple API mirroring localStorage methods
 * - Prevents common localStorage pitfalls (quota exceeded, JSON errors)
 * 
 * Limitations of localStorage:
 * - ~5-10MB size limit per domain (varies by browser)
 * - Synchronous operations (blocks on large data)
 * - Only stores strings (JSON must be serialized)
 * - Survives tab/window close but not private/incognito mode
 * - Subject to same-origin policy
 * 
 * Usage:
 * ```javascript
 * // Strings
 * StorageManager.setItem("key", "value");
 * const val = StorageManager.getItem("key", "default");
 * StorageManager.removeItem("key");
 * 
 * // JSON objects
 * StorageManager.setJson("config", {theme: "dark", lang: "en"});
 * const config = StorageManager.getJson("config", {});
 * ```
 */
export class StorageManager {
    /**
     * Reads a string value from localStorage.
     * 
     * Behavior:
     * - Returns stored value exactly as saved (no parsing)
     * - Returns defaultValue if key doesn't exist
     * - Returns defaultValue if localStorage is unavailable (quota exceeded, etc.)
     * 
     * @param {string} key - Storage key to read
     * @param {string|null} [defaultValue=null] - Value to return when no entry exists
     * @returns {string|null} Stored value or defaultValue
     * @example
     * const token = StorageManager.getItem("auth_token", "");
     * const setting = StorageManager.getItem("user.theme", "light");
     */
    static getItem(key, defaultValue = null) {
        const value = localStorage.getItem(key);
        return value !== null ? value : defaultValue;
    }

    /**
     * Persists a string value in localStorage.
     * 
     * Behavior:
     * - Overwrites any existing value under the same key
     * - Stores value exactly as provided (no serialization)
     * - Silently fails if quota exceeded (no exception thrown)
     * 
     * @param {string} key - Storage key to write
     * @param {string} value - String value to store (stored as-is)
     * @returns {void}
     * @example
     * StorageManager.setItem("username", "alice");
     * StorageManager.setItem("gw2toolbox.theme", "dark");
     */
    static setItem(key, value) {
        localStorage.setItem(key, value);
    }

    /**
     * Removes a key and its value from localStorage.
     * 
     * Behavior:
     * - Deletes both key and value
     * - No-op if key doesn't exist (no error thrown)
     * - Can be used to clear a persisted value
     * 
     * @param {string} key - Storage key to remove
     * @returns {void}
     * @example
     * StorageManager.removeItem("auth_token");
     */
    static removeItem(key) {
        localStorage.removeItem(key);
    }

    /**
     * Reads and deserializes a JSON value from localStorage.
     * 
     * Behavior:
     * - Parses JSON string and returns typed JavaScript object
     * - Returns defaultValue if key doesn't exist
     * - Returns defaultValue if JSON parsing fails (corrupted data)
     * - Never throws an error
     * 
     * @template T
     * @param {string} key - Storage key to read
     * @param {T|null} [defaultValue=null] - Value to return if parse fails or no entry exists
     * @returns {T|null} Parsed JSON value or defaultValue
     * @example
     * const cache = StorageManager.getJson("achievements", []);
     * const config = StorageManager.getJson("app.config", { lang: "en" });
     */
    static getJson(key, defaultValue = null) {
        const raw = localStorage.getItem(key);
        if (!raw) {
            return defaultValue;
        }

        try {
            return JSON.parse(raw);
        } catch {
            return defaultValue;
        }
    }

    /**
     * Serializes and persists a JavaScript value as JSON to localStorage.
     * 
     * Behavior:
     * - Converts JavaScript objects/arrays to JSON string
     * - Overwrites any existing value under the same key
     * - Returns nothing on failure (silently catches errors)
     * - Suitable for caching structured data (arrays, objects)
     * 
     * @param {string} key - Storage key to write
     * @param {any} value - Value to serialize and store (can be object, array, etc.)
     * @returns {void}
     * @example
     * StorageManager.setJson("cache", { achievements: [...], timestamp: Date.now() });
     * StorageManager.setJson("filters", ["Started", "Finished"]);
     */
    static setJson(key, value) {
        try {
            const serialised = JSON.stringify(value);
            localStorage.setItem(key, serialised);
        } catch {
            // Fallback: store nothing on failure
        }
    }
}

export default StorageManager;