/**
 * Achievements Module
 * 
 * Handles loading, caching, filtering, and rendering Guild Wars 2 achievements.
 * Features:
 * - Intelligent caching with stale-while-revalidate pattern
 * - Batch loading from GW2 API (200 at a time, 4 concurrent workers)
 * - Real-time filtering by query, rewards, and completion status
 * - Custom card-based pagination
 * - Persistent filter preferences
 */

import StorageManager from "./storagemanager.js";
import { initFormControls } from "./form-controls.js";
import Paginator from "./paginator.js";

// ========== STORAGE & CACHE CONFIGURATION ==========
const STORAGE_KEY = "gw2toolbox.apiKey";
const ACHIEVEMENTS_CACHE_KEY = "gw2toolbox.achievementsCache";

/** Cache is fresh for 15 minutes - use cached data immediately */
const CACHE_TTL = 15 * 60 * 1000;
/** Cache can be used for up to 30 minutes - refresh in background */
const CACHE_STALE_TTL = 30 * 60 * 1000;

// ========== API ENDPOINTS & BATCHING ==========
const API_BASE = "https://api.guildwars2.com/v2";
const WIKI_BASE = "https://wiki.guildwars2.com/wiki/";
/** Achievements loaded per API request (max 200 per GW2 API) */
const ACHIEVEMENT_BATCH_SIZE = 200;
/** Number of parallel batch requests to process simultaneously */
const BATCH_CONCURRENCY = 4;

/**
 * Converts achievement names to URL-safe slugs for wiki links.
 * Replaces spaces with underscores and removes special characters.
 * @param {string} value - Achievement name to slugify
 * @returns {string} URL-encoded slug suitable for wiki URLs
 */
function slugifyForWiki(value) {
    return encodeURIComponent(String(value).trim().replace(/\s+/g, "_").replace(/[:\/\\?#%\[\] ]+/g, "_"));
}

/**
 * Builds a wiki URL for an achievement or item name.
 * Example: "Ascended Armor" → "https://wiki.guildwars2.com/wiki/Ascended_Armor"
 * @param {string} value - Name to link to
 * @returns {string} Full wiki URL
 */
function buildWikiUrl(value) {
    return `${WIKI_BASE}${slugifyForWiki(value)}`;
}

/**
 * Fetches and parses JSON from an API endpoint.
 * Throws descriptive error with status code and body on failure.
 * @param {string} url - API endpoint URL
 * @param {object} [options={}] - Fetch options (headers, method, etc.)
 * @returns {Promise<object>} Parsed JSON response
 * @throws {Error} With HTTP status and response body
 */
async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`);
    }
    return response.json();
}

/**
 * Splits an array into smaller chunks of specified size.
 * Used to batch achievements into API-friendly request sizes.
 * @param {array} items - Array to split
 * @param {number} size - Size of each chunk
 * @returns {array[]} Array of chunked arrays
 */
function chunkArray(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

/**
 * Fetches achievement details in parallel batches with progress reporting.
 * 
 * Processing:
 * - Splits achievement IDs into batches of ACHIEVEMENT_BATCH_SIZE (200)
 * - Processes BATCH_CONCURRENCY (4) batches in parallel for speed
 * - After each batch completes, reports progress via onProgress callback
 * - Maintains result order despite parallel execution
 * 
 * @param {number[]} ids - All achievement IDs to fetch
 * @param {object} accountMap - Map of achievement ID → user's account progress
 * @param {object} categories - Map of category ID → category metadata
 * @param {object} groups - Map of group ID → group metadata
 * @param {function} [onProgress] - Called after each batch: (rows, totalIds, isComplete)
 * @returns {Promise<object[]>} Array of transformed achievement rows
 */
async function fetchAchievementDetailsInBatches(ids, accountMap, categories, groups, onProgress) {
    const batches = chunkArray(ids, ACHIEVEMENT_BATCH_SIZE);
    const queue = batches.map((batch, index) => ({ batch, index }));
    const resultsByIndex = new Array(batches.length);

    // Worker function: processes batches from queue in order as they're available
    const worker = async () => {
        while (queue.length > 0) {
            const item = queue.shift();
            const results = await fetchJson(`${API_BASE}/achievements?ids=${item.batch.join(",")}`);
            const rows = Array.isArray(results)
                ? results.map((achievement) => buildAchievementRow(achievement, accountMap, categories, groups))
                : [];

            resultsByIndex[item.index] = rows;
            const availableRows = resultsByIndex.filter(Boolean).flat();
            if (typeof onProgress === "function") {
                onProgress(availableRows, ids.length, queue.length === 0);
            }
        }
    };

    // Spawn BATCH_CONCURRENCY workers - they all pull from the same queue
    const workers = Array.from({ length: Math.min(BATCH_CONCURRENCY, queue.length) }, () => worker());
    await Promise.all(workers);
    return resultsByIndex.flat();
}

/**
 * Fetches all achievement data from the GW2 API.
 * 
 * Parallel fetches:
 * 1. All achievement categories (for names/hierarchy)
 * 2. All achievement groups (for organization)
 * 3. All achievement IDs (available to the player)
 * 4. Account's personal achievement progress
 * 
 * Then transforms all this data into display-ready rows using buildAchievementRow().
 * 
 * @param {string} apiKey - Valid GW2 API key with achievements permission
 * @param {function} [onProgress] - Called during batch loading: (rows, totalIds, isComplete)
 * @returns {Promise<object[]>} Array of achievement rows with all data merged
 */
async function fetchAllAchievementDetails(apiKey, onProgress = () => {}) {
    // Parallel requests for independent data
    const [categories, groups, ids, accountAchievements] = await Promise.all([
        fetchJson(`${API_BASE}/achievements/categories?ids=all`),
        fetchJson(`${API_BASE}/achievements/groups?ids=all`),
        fetchJson(`${API_BASE}/achievements`),
        fetchJson(`${API_BASE}/account/achievements?access_token=${encodeURIComponent(apiKey)}`),
    ]);

    // Convert arrays to maps for O(1) lookup during row building
    const categoryMap = (categories || []).reduce((map, item) => {
        map[item.id] = item;
        return map;
    }, {});

    const groupMap = (groups || []).reduce((map, item) => {
        map[item.id] = item;
        return map;
    }, {});

    // Account achievements indexed by achievement ID for quick progress lookup
    const accountMap = (accountAchievements || []).reduce((map, row) => {
        map[row.id] = row;
        return map;
    }, {});

    const rows = await fetchAchievementDetailsInBatches(ids, accountMap, categoryMap, groupMap, onProgress);
    return rows;
}

/**
 * Retrieves cached achievements if still valid for the current API key.
 * 
 * Validation:
 * - Cache must exist
 * - API key in cache must match current API key (invalidate on key change)
 * - Data must be an array
 * - Timestamp must be a number
 * 
 * @param {string} apiKey - Current API key to validate cache against
 * @returns {object|null} Cache object with {apiKey, timestamp, data:[]} or null if invalid
 */
function getCachedAchievements(apiKey) {
    const cache = StorageManager.getJson(ACHIEVEMENTS_CACHE_KEY, null);
    if (!cache || cache.apiKey !== apiKey || !Array.isArray(cache.data) || typeof cache.timestamp !== "number") {
        return null;
    }

    return cache;
}

/**
 * Saves achievements to cache with current timestamp.
 * Cache format: {apiKey, timestamp, data: [...achievements]}
 * 
 * @param {string} apiKey - API key used to fetch this data
 * @param {object[]} data - Array of achievement rows to cache
 * @returns {void}
 */
function setCachedAchievements(apiKey, data) {
    StorageManager.setJson(ACHIEVEMENTS_CACHE_KEY, {
        apiKey,
        timestamp: Date.now(),
        data,
    });
}

/**
 * Extracts selected values from a multi-select picker element.
 * Filters out the "Select all" option which uses different class.
 * 
 * @param {HTMLElement} picker - Multi-select picker element
 * @returns {string[]} Array of selected option values
 */
function getSelectedValues(picker) {
    if (!picker) return [];

    return Array.from(picker.querySelectorAll(".select-picker-option.selected:not(.select-picker-all)"))
        .map((option) => option.dataset.value);
}

/**
 * Calculates achievement status based on account progress.
 * 
 * Status logic:
 * - "Finished": done flag is true
 * - "Started": current progress > 0 OR any individual bit (objective) > 0
 * - "Unstarted": no progress at all
 * 
 * Used for filtering achievements by completion state.
 * 
 * @param {object} accountRow - User's progress on this achievement from account API
 * @returns {string} One of: "Finished", "Started", "Unstarted"
 */
function getAchievementStatus(accountRow) {
    if (!accountRow) return "Unstarted";
    if (accountRow.done) return "Finished";
    if (accountRow.current || (Array.isArray(accountRow.bits) && accountRow.bits.some((value) => value > 0))) return "Started";
    return "Unstarted";
}

/**
 * Normalizes reward data from API into consistent display format.
 * 
 * Handles various reward types:
 * - AP: Achievement Points
 * - Coin: Gold/Silver/Copper currency
 * - Item: Tradeable items (shows quantity if > 1)
 * - Mastery: Mastery points
 * - Title: Account titles
 * - Generic: Any other reward type
 * 
 * Returns an object with human-readable label and wiki link when applicable.
 * 
 * @param {object} reward - Reward object from API
 * @param {string} [reward.type] - Reward type (AP, Coin, Item, etc.)
 * @param {string} [reward.id] - Item/reward ID
 * @param {string} [reward.name] - Reward name
 * @param {number} [reward.count] - Quantity (for items/currency)
 * @returns {{label: string, link: string|null}} Formatted reward with optional wiki link
 */
function normalizeReward(reward) {
    if (!reward || typeof reward !== "object") {
        return { label: "Unknown", link: null };
    }

    let label = reward.id || reward.name || reward.type || "Reward";
    if (reward.type === "AP") {
        label = "AP";
    } else if (reward.type === "Coin") {
        label = `${reward.count || 0} coins`;
    } else if (reward.type === "Item") {
        if (reward.count) {
            label = `${reward.count}× ${reward.id ?? reward.name ?? "Item"}`;
        }
    }

    const labelText = String(label || "");
    return {
        label: labelText,
        link: labelText ? buildWikiUrl(labelText.replace(/^\d+×\s*/, "")) : null,
    };
}

/**
 * Transforms raw API achievement data into display-ready row object.
 * 
 * This is the main data transformation function. It:
 * 1. Enriches achievement with user's account progress
 * 2. Looks up category and group names
 * 3. Normalizes reward data
 * 4. Calculates completion status
 * 5. Pre-computes searchable text for efficient filtering
 * 6. Builds wiki URL for the achievement name
 * 
 * The returned row object is used for rendering cards and applying filters.
 * 
 * @param {object} achievement - Raw API achievement data
 * @param {object} accountMap - Map of achievement ID → user progress
 * @param {object} categories - Map of category ID → category metadata
 * @param {object} groups - Map of group ID → group metadata
 * @returns {object} Transformed achievement row with all display fields
 */
function buildAchievementRow(achievement, accountMap, categories, groups) {
    const accountState = accountMap[achievement.id] || null;
    const category = categories[achievement.category] || null;
    const group = groups[achievement.group] || null;
    const rewards = Array.isArray(achievement.rewards) ? achievement.rewards.map(normalizeReward) : [];
    const status = getAchievementStatus(accountState);
    const rewardLabels = rewards.length ? rewards.map((reward) => reward.label) : ["None"];
    
    // Pre-compute searchable text by aggregating all fields that users might search for
    const searchText = [
        achievement.name,
        achievement.description,
        achievement.requirement,
        category?.name,
        group?.name,
        rewardLabels.join(" "),
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    return {
        id: achievement.id,
        title: achievement.name,
        description: achievement.description || achievement.requirement || "",
        requirement: achievement.requirement || "",
        icon: achievement.icon,
        points: achievement.points,
        category: category?.name || "",
        group: group?.name || "",
        status,
        current: accountState?.current ?? 0,
        done: Boolean(accountState?.done),
        rewards,
        wikiUrl: buildWikiUrl(achievement.name),
        searchText, // Used for free-text search filtering
        rawAchievement: achievement,
        accountState,
    };
}

/**
 * Filters achievements based on query string, reward types, and completion status.
 * Uses AND logic between filter types (must match query AND rewards AND status)
 * but OR logic within each filter type.
 * 
 * @param {object[]} data - Array of achievement rows to filter
 * @param {string} query - Free-text search query (searches pre-computed searchText)
 * @param {string[]} rewardFilters - Array of reward type names to match (OR logic)
 * @param {string[]} showFilters - Array of statuses to match: "Started", "Finished", "Unstarted"
 * @returns {object[]} Filtered achievement rows
 */
function filterAchievements(data, query, rewardFilters, showFilters) {
    const normalizedQuery = String(query || "").trim().toLowerCase();
    return data.filter((row) => {
        // Query filter: achievement must contain search text
        if (normalizedQuery) {
            if (!row.searchText.includes(normalizedQuery)) {
                return false;
            }
        }

        // Reward filter: achievement must have one of the selected reward types (OR logic)
        if (Array.isArray(rewardFilters) && rewardFilters.length > 0) {
            const hasNone = rewardFilters.includes("None");
            const rewardTypes = row.rewards.map((reward) => reward.label);
            const matches = row.rewards.some((reward) => rewardFilters.includes(reward.label))
                || (hasNone && row.rewards.length === 0);
            if (!matches) {
                return false;
            }
        }

        // Status filter: achievement must match one of the selected statuses (OR logic)
        if (Array.isArray(showFilters) && showFilters.length > 0) {
            if (!showFilters.includes(row.status)) {
                return false;
            }
        }

        return true;
    });
}

/**
 * Formats achievement objectives/bits for display in expandable detail row.
 * 
 * If achievement has bits (individual objectives):
 *   Shows each bit with user's current progress vs goal (e.g., "5/10")
 * If no bits:
 *   Shows the general requirement text
 * 
 * Returns HTML string for insertion into detail formatter.
 * 
 * @param {object} row - Achievement row with rawAchievement and accountState
 * @returns {string} HTML markup for achievement detail section
 */
function formatObjectives(row) {
    const achievement = row.rawAchievement;
    if (!Array.isArray(achievement.bits) || achievement.bits.length === 0) {
        return `<div class="achievement-detail">
            <div class="achievement-detail-title">Requirement</div>
            <p>${achievement.requirement || "No objective details available."}</p>
        </div>`;
    }

    // Map account progress bits to achievement's bit definitions
    const accountBits = Array.isArray(row.accountState?.bits) ? row.accountState.bits : [];
    const bitsHtml = achievement.bits
        .map((bit, index) => {
            const current = accountBits[index] != null ? accountBits[index] : 0;
            const goal = bit.value || 0;
            const progress = goal ? `${current}/${goal}` : (current ? String(current) : "0");
            return `<div class="achievement-objective">${bit.text} ${goal ? `<strong>${progress}</strong>` : ""}</div>`;
        })
        .join("");

    return `<div class="achievement-detail">
        <div class="achievement-detail-title">Objectives</div>
        <div class="achievement-objectives">${bitsHtml}</div>
    </div>`;
}

/**
 * Loads achievement data with intelligent caching (stale-while-revalidate pattern).
 * 
 * Cache TTL Strategy:
 * - Fresh (0-15 min):   Use cache, don't refresh
 * - Stale (15-30 min):  Use cache immediately, refresh in background
 * - Expired (30+ min):  Fetch fresh data
 * 
 * This ensures users get instant results even if data is slightly stale, while
 * keeping data reasonably up-to-date.
 * 
 * @param {string} apiKey - GW2 API key for fetching data
 * @param {function} [onProgress] - Called during load: (rows, totalIds, isComplete, isFresh)
 * @returns {Promise<object[]>} Achievement rows (cached or fresh)
 */
async function loadAchievementData(apiKey, onProgress = () => {}) {
    const cache = getCachedAchievements(apiKey);
    const now = Date.now();
    const cacheAge = cache ? now - cache.timestamp : Infinity;
    const hasCache = Boolean(cache && Array.isArray(cache.data) && cache.data.length > 0);

    if (hasCache) {
        // Report cached data immediately
        onProgress(cache.data, cache.data.length, true, cacheAge <= CACHE_TTL);

        if (cacheAge <= CACHE_TTL) {
            // Cache is fresh - return it without background refresh
            return cache.data;
        }

        if (cacheAge <= CACHE_STALE_TTL) {
            // Cache is stale - return it but refresh in background
            fetchAllAchievementDetails(apiKey, onProgress)
                .then((rows) => {
                    setCachedAchievements(apiKey, rows);
                    onProgress(rows, rows.length, false, true);
                })
                .catch((error) => {
                    console.warn("Background achievement refresh failed", error);
                });

            return cache.data;
        }
    }

    // Cache expired or doesn't exist - fetch fresh data
    const rows = await fetchAllAchievementDetails(apiKey, onProgress);
    setCachedAchievements(apiKey, rows);
    return rows;
}

/**
 * Initializes the achievements page module.
 * 
 * Called when user navigates to /achievements route with root element.
 * Sets up:
 * - API key validation and conditional UI display
 * - Event listeners for filters (query, rewards, show status)
 * - Achievement data loading and caching
 * - Paginator component with achievement card rendering
 * - Form control persistence
 * - Returns cleanup function for route change
 * 
 * @param {object} options - Initialization options
 * @param {HTMLElement} options.root - Root element containing achievements view DOM
 * @returns {function|undefined} Cleanup function called on route change
 */
export function init({ root }) {
    // ========== DOM ELEMENT CACHING ==========
    const achievementsSection = root.querySelector("#achievementsSection");
    const achievementResultsSection = root.querySelector("#achievementResultsSection");
    const missingApiKeySection = root.querySelector("#missingApiKeySection");
    const button = root.querySelector("#configureApiKeyButton");
    const statusElement = root.querySelector("#achievementPaginatorStatus");
    const paginatorContainer = root.querySelector("#achievementPaginatorContainer");

    if (!achievementsSection || !achievementResultsSection || !missingApiKeySection || !button || !statusElement || !paginatorContainer) {
        return undefined;
    }

    // ========== INITIALIZATION STATE ==========
    const apiKey = StorageManager.getItem(STORAGE_KEY, "").trim();
    const handleClick = () => {
        window.location.hash = "#/home";
    };

    let paginator = null;
    let allRows = [];
    let filterCleanup = [];

    const queryInput = root.querySelector("#achievementSearchQuery");
    const rewardsPicker = root.querySelector("[data-storage-key='gw2toolbox.achievements.rewards']");
    const showPicker = root.querySelector("[data-storage-key='gw2toolbox.achievements.show']");

    /**
     * Re-filters achievements based on current filter values and updates paginator.
     * Called whenever any filter changes (query, rewards, or show status).
     */
    const updatePaginator = () => {
        if (!paginator) return;
        const query = queryInput ? queryInput.value : "";
        const rewardFilters = getSelectedValues(rewardsPicker);
        const showFilters = getSelectedValues(showPicker);
        const filtered = filterAchievements(allRows, query, rewardFilters, showFilters);

        if (filtered.length === 0) {
            statusElement.textContent = "No achievements match the current filters.";
            statusElement.classList.add("achievements-placeholder");
        } else {
            statusElement.textContent = "";
        }

        paginator.setData(filtered);
    };

    /**
     * Attaches input event listeners to all filter controls.
     * Updates paginator on any filter change.
     */
    const attachFilterListeners = () => {
        if (queryInput) {
            const handler = () => updatePaginator();
            queryInput.addEventListener("input", handler);
            filterCleanup.push(() => queryInput.removeEventListener("input", handler));
        }

        [rewardsPicker, showPicker].forEach((picker) => {
            if (!picker) return;
            const handler = () => updatePaginator();
            picker.addEventListener("change", handler);
            filterCleanup.push(() => picker.removeEventListener("change", handler));
        });
    };

    /**
     * Creates and initializes the Paginator component.
     * Configures a single-column paginator that renders achievement cards.
     */
    const initializePaginator = () => {
        paginator = new Paginator({
            container: paginatorContainer,
            storageKey: "gw2toolbox.achievements.pageSize",
            columns: [
                {
                    title: "",
                    data: "title",
                    sortable: false,
                    className: "details-control",
                    // Custom render function for achievement card
                    render: (_, item) => {
                        const wrapper = document.createElement("div");
                        wrapper.className = "achievement-card";

                        const main = document.createElement("div");
                        main.className = "achievement-card-main";

                        const icon = document.createElement("img");
                        icon.className = "achievement-icon";
                        icon.src = item.icon || "";
                        icon.alt = item.title;

                        const meta = document.createElement("div");
                        meta.className = "achievement-meta";

                        const title = document.createElement("a");
                        title.className = "achievement-title";
                        title.href = item.wikiUrl;
                        title.target = "_blank";
                        title.rel = "noopener noreferrer";
                        title.textContent = item.title;

                        const subtitle = document.createElement("div");
                        subtitle.className = "achievement-subtitle";
                        subtitle.textContent = `${item.category}${item.group ? ` — ${item.group}` : ""}`.trim();

                        const description = document.createElement("div");
                        description.className = "achievement-description";
                        description.textContent = item.description;

                        meta.appendChild(title);
                        if (subtitle.textContent) meta.appendChild(subtitle);
                        meta.appendChild(description);

                        const progress = document.createElement("div");
                        progress.className = "achievement-progress";
                        progress.innerHTML = `<div>${item.status}</div><div>${item.done ? "Completed" : `Progress ${item.current}`}</div>`;

                        main.appendChild(icon);
                        main.appendChild(meta);
                        main.appendChild(progress);

                        const rewardRow = document.createElement("div");
                        rewardRow.className = "achievement-rewards";

                        item.rewards.forEach((reward) => {
                            const rewardEl = document.createElement("span");
                            rewardEl.className = "achievement-reward";

                            if (reward.link) {
                                const link = document.createElement("a");
                                link.href = reward.link;
                                link.target = "_blank";
                                link.rel = "noopener noreferrer";
                                link.textContent = reward.label;
                                rewardEl.appendChild(link);
                            } else {
                                rewardEl.textContent = reward.label;
                            }

                            rewardRow.appendChild(rewardEl);
                        });

                        wrapper.appendChild(main);
                        if (item.rewards.length) {
                            wrapper.appendChild(rewardRow);
                        }

                        return wrapper;
                    },
                },
            ],
            defaultPageSize: 25,
            detailsEnabled: true,
            detailFormatter: (item) => formatObjectives(item),
        });
    };

    /**
     * Loads achievement data and starts the display/update flow.
     * Handles loading states and error messages.
     */
    const loadData = async () => {
        if (!statusElement || !paginatorContainer) {
            return;
        }

        statusElement.textContent = "Loading achievements...";
        statusElement.classList.add("achievements-placeholder");

        try {
            // Progress callback: updates display as achievements load in batches
            const updateRows = (rows, total, completed) => {
                allRows = rows;
                if (!paginator) {
                    initializePaginator();
                }
                updatePaginator();

                if (completed) {
                    statusElement.textContent = rows.length === 0 ? "No achievements could be loaded." : "";
                    statusElement.classList.toggle("achievements-placeholder", rows.length === 0);
                } else {
                    statusElement.textContent = `Loading achievements (${rows.length}/${total})...`;
                    statusElement.classList.add("achievements-placeholder");
                }
            };

            const rows = await loadAchievementData(apiKey, updateRows);
            allRows = rows;
            if (!paginator) {
                initializePaginator();
            }
            updatePaginator();
            if (rows.length === 0) {
                statusElement.textContent = "No achievements could be loaded.";
            }
        } catch (error) {
            statusElement.textContent = `Unable to load achievements. ${error.message}`;
            console.error(error);
        }
    };

    // ========== CONDITIONAL UI SETUP ==========
    if (!apiKey) {
        // Hide main content, show API key configuration prompt
        achievementsSection.classList.add("hidden");
        achievementResultsSection.classList.add("hidden");
        missingApiKeySection.classList.remove("hidden");
    } else {
        // Show main content, hide API key prompt
        achievementsSection.classList.remove("hidden");
        achievementResultsSection.classList.remove("hidden");
        missingApiKeySection.classList.add("hidden");
        
        // Start the data loading and filter setup
        attachFilterListeners();
        loadData();
    }

    // ========== EVENT SETUP & FORM INITIALIZATION ==========
    button.addEventListener("click", handleClick);
    const cleanupForm = initFormControls({ root });

    // ========== CLEANUP FUNCTION (called on route change) ==========
    return () => {
        button.removeEventListener("click", handleClick);
        filterCleanup.forEach((fn) => fn());
        if (typeof cleanupForm === "function") {
            cleanupForm();
        }
        if (paginator && typeof paginator.destroy === "function") {
            paginator.destroy();
        }
    };
}
