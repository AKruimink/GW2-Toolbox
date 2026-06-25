export class StorageManager {
    /**
     * Reads a string value from localStorage.  
     * If the key does not exist then the provided defaultValue is returned instead.  
     * Values are stored exactly as provided and are not parsed.
     * @param {string} key The key to read.
     * @param {string|null} [defaultValue=null] Value to return when no entry exists.
     * @returns {string|null} The stored value or the defaultValue.
     */
    static getItem(key, defaultValue = null) {
        const value = localStorage.getItem(key);
        return value !== null ? value : defaultValue;
    }

    /**
     * Persists a string value in localStorage.  
     * The key/value will overwrite any existing value stored under the same key.
     * @param {string} key The key to write.
     * @param {string} value The string value to store.
     * @returns {void}
     */
    static setItem(key, value) {
        localStorage.setItem(key, value);
    }

    /**
     * Removes a key and its value from localStorage.  
     * If the key does not exist this operation has no effect.
     * @param {string} key The key to remove.
     * @returns {void}
     */
    static removeItem(key) {
        localStorage.removeItem(key);
    }

    /**
     * Reads a JSON encoded value from localStorage.  
     * If the value cannot be parsed or does not exist the provided default value is returned.
     * @param {string} key The key to read.
     * @param {T|null} [defaultValue=null] Value to return if parsing fails or no entry exists.
     * @returns {T|null} Parsed JSON value (typed) or defaultValue.
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
     * Serialises a JavaScript value to JSON and stores it in localStorage.  
     * Complex objects will be stringified using JSON.stringify.
     * @param {string} key The key to write.
     * @param {JsonValue} value The value to serialise and store.
     * @returns {boolean} True when successfully stored; false if serialisation fails.
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