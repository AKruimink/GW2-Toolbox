import StorageManager from "./storagemanager.js";
import { initFormControls } from "./form-controls.js";
import Paginator from "./paginator.js";

const STORAGE_KEY = "gw2toolbox.apiKey";
const ACHIEVEMENTS_CACHE_KEY = "gw2toolbox.achievementsCache";
const CACHE_TTL = 15 * 60 * 1000;
const CACHE_STALE_TTL = 30 * 60 * 1000;
const API_BASE = "https://api.guildwars2.com/v2";
const WIKI_BASE = "https://wiki.guildwars2.com/wiki/";
const ACHIEVEMENT_BATCH_SIZE = 200;
const BATCH_CONCURRENCY = 4;

function slugifyForWiki(value) {
    return encodeURIComponent(String(value).trim().replace(/\s+/g, "_").replace(/[:\/\\?#%\[\] ]+/g, "_"));
}

function buildWikiUrl(value) {
    return `${WIKI_BASE}${slugifyForWiki(value)}`;
}

async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`);
    }
    return response.json();
}

function chunkArray(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

async function fetchAchievementDetailsInBatches(ids, accountMap, categories, groups, onProgress) {
    const batches = chunkArray(ids, ACHIEVEMENT_BATCH_SIZE);
    const queue = batches.map((batch, index) => ({ batch, index }));
    const resultsByIndex = new Array(batches.length);

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

    const workers = Array.from({ length: Math.min(BATCH_CONCURRENCY, queue.length) }, () => worker());
    await Promise.all(workers);
    return resultsByIndex.flat();
}

async function fetchAllAchievementDetails(apiKey, onProgress = () => {}) {
    const [categories, groups, ids, accountAchievements] = await Promise.all([
        fetchJson(`${API_BASE}/achievements/categories?ids=all`),
        fetchJson(`${API_BASE}/achievements/groups?ids=all`),
        fetchJson(`${API_BASE}/achievements`),
        fetchJson(`${API_BASE}/account/achievements?access_token=${encodeURIComponent(apiKey)}`),
    ]);

    const categoryMap = (categories || []).reduce((map, item) => {
        map[item.id] = item;
        return map;
    }, {});

    const groupMap = (groups || []).reduce((map, item) => {
        map[item.id] = item;
        return map;
    }, {});

    const accountMap = (accountAchievements || []).reduce((map, row) => {
        map[row.id] = row;
        return map;
    }, {});

    const rows = await fetchAchievementDetailsInBatches(ids, accountMap, categoryMap, groupMap, onProgress);
    return rows;
}

function getCachedAchievements(apiKey) {
    const cache = StorageManager.getJson(ACHIEVEMENTS_CACHE_KEY, null);
    if (!cache || cache.apiKey !== apiKey || !Array.isArray(cache.data) || typeof cache.timestamp !== "number") {
        return null;
    }

    return cache;
}

function setCachedAchievements(apiKey, data) {
    StorageManager.setJson(ACHIEVEMENTS_CACHE_KEY, {
        apiKey,
        timestamp: Date.now(),
        data,
    });
}

function getSelectedValues(picker) {
    if (!picker) return [];

    return Array.from(picker.querySelectorAll(".select-picker-option.selected:not(.select-picker-all)"))
        .map((option) => option.dataset.value);
}

function getAchievementStatus(accountRow) {
    if (!accountRow) return "Unstarted";
    if (accountRow.done) return "Finished";
    if (accountRow.current || (Array.isArray(accountRow.bits) && accountRow.bits.some((value) => value > 0))) return "Started";
    return "Unstarted";
}

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

function buildAchievementRow(achievement, accountMap, categories, groups) {
    const accountState = accountMap[achievement.id] || null;
    const category = categories[achievement.category] || null;
    const group = groups[achievement.group] || null;
    const rewards = Array.isArray(achievement.rewards) ? achievement.rewards.map(normalizeReward) : [];
    const status = getAchievementStatus(accountState);
    const rewardLabels = rewards.length ? rewards.map((reward) => reward.label) : ["None"];
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
        searchText,
        rawAchievement: achievement,
        accountState,
    };
}

function filterAchievements(data, query, rewardFilters, showFilters) {
    const normalizedQuery = String(query || "").trim().toLowerCase();
    return data.filter((row) => {
        if (normalizedQuery) {
            if (!row.searchText.includes(normalizedQuery)) {
                return false;
            }
        }

        if (Array.isArray(rewardFilters) && rewardFilters.length > 0) {
            const hasNone = rewardFilters.includes("None");
            const rewardTypes = row.rewards.map((reward) => reward.label);
            const matches = row.rewards.some((reward) => rewardFilters.includes(reward.label))
                || (hasNone && row.rewards.length === 0);
            if (!matches) {
                return false;
            }
        }

        if (Array.isArray(showFilters) && showFilters.length > 0) {
            if (!showFilters.includes(row.status)) {
                return false;
            }
        }

        return true;
    });
}

function formatObjectives(row) {
    const achievement = row.rawAchievement;
    if (!Array.isArray(achievement.bits) || achievement.bits.length === 0) {
        return `<div class="achievement-detail">
            <div class="achievement-detail-title">Requirement</div>
            <p>${achievement.requirement || "No objective details available."}</p>
        </div>`;
    }

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

async function loadAchievementData(apiKey, onProgress = () => {}) {
    const cache = getCachedAchievements(apiKey);
    const now = Date.now();
    const cacheAge = cache ? now - cache.timestamp : Infinity;
    const hasCache = Boolean(cache && Array.isArray(cache.data) && cache.data.length > 0);

    if (hasCache) {
        onProgress(cache.data, cache.data.length, true, cacheAge <= CACHE_TTL);

        if (cacheAge <= CACHE_TTL) {
            return cache.data;
        }

        if (cacheAge <= CACHE_STALE_TTL) {
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

    const rows = await fetchAllAchievementDetails(apiKey, onProgress);
    setCachedAchievements(apiKey, rows);
    return rows;
}

export function init({ root }) {
    const achievementsSection = root.querySelector("#achievementsSection");
    const achievementResultsSection = root.querySelector("#achievementResultsSection");
    const missingApiKeySection = root.querySelector("#missingApiKeySection");
    const button = root.querySelector("#configureApiKeyButton");
    const statusElement = root.querySelector("#achievementPaginatorStatus");
    const paginatorContainer = root.querySelector("#achievementPaginatorContainer");

    if (!achievementsSection || !achievementResultsSection || !missingApiKeySection || !button || !statusElement || !paginatorContainer) {
        return undefined;
    }

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

    const initializePaginator = () => {
        paginator = new Paginator({
            container: paginatorContainer,
            columns: [
                {
                    title: "",
                    data: "title",
                    sortable: false,
                    className: "details-control",
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
            pageSizes: [10, 25, 50, 100],
            defaultPageSize: 25,
            detailsEnabled: true,
            detailFormatter: (item) => formatObjectives(item),
        });
    };

    const loadData = async () => {
        if (!statusElement || !paginatorContainer) {
            return;
        }

        statusElement.textContent = "Loading achievements...";
        statusElement.classList.add("achievements-placeholder");

        try {
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

    if (!apiKey) {
        achievementsSection.classList.add("hidden");
        achievementResultsSection.classList.add("hidden");
        missingApiKeySection.classList.remove("hidden");
    } else {
        achievementsSection.classList.remove("hidden");
        achievementResultsSection.classList.remove("hidden");
        missingApiKeySection.classList.add("hidden");
        attachFilterListeners();
        loadData();
    }

    button.addEventListener("click", handleClick);
    const cleanupForm = initFormControls({ root });

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
