import StorageManager from "./storagemanager.js";
import { initFormControls } from "./form-controls.js";
import Paginator from "./paginator.js";
import { buildWikiFileUrl, buildWikiUrl, chunkArray, fetchByIdsInBatches, fetchJson, gw2ApiUrl } from "./api-client.js";

const STORAGE_KEY = "gw2toolbox.apiKey";
const CACHE_KEY = "gw2toolbox.achievements.v3";
const REWARDS_STORAGE_KEY = "gw2toolbox.achievements.rewards";
const SHOW_STORAGE_KEY = "gw2toolbox.achievements.show";

const CACHE_TTL_MS = 15 * 60 * 1000;
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const ACHIEVEMENT_BATCH_SIZE = 200;
const REFRESH_BATCH_SIZE = 120;

const MASTERY_REGION_ICON_FILE = {
    Tyria: "Mastery_point_(Central_Tyria).png",
    Maguuma: "Mastery_point_(Heart_of_Thorns).png",
    Desert: "Mastery_point_(Path_of_Fire).png",
    Tundra: "Mastery_point_(Icebrood_Saga).png",
    Cantha: "Mastery_point_(End_of_Dragons).png",
    Jade: "Mastery_point_(End_of_Dragons).png",
    Sky: "Mastery_point_(Secrets_of_the_Obscure).png",
    Lowland: "Mastery_point_(Janthir_Wilds).png",
    Unknown: "Mastery_point_(Central_Tyria).png",
};

function nowMs() {
    return Date.now();
}

function getSelectedValues(picker) {
    if (!picker) return [];

    return Array.from(picker.querySelectorAll(".select-picker-option.selected:not(.select-picker-all)"))
        .map((option) => option.dataset.value)
        .filter(Boolean);
}

function getAchievementStatus(accountRow) {
    if (!accountRow) return "Unstarted";
    if (accountRow.done) return "Finished";
    if (accountRow.current > 0 || (Array.isArray(accountRow.bits) && accountRow.bits.length > 0)) return "Started";
    return "Unstarted";
}

function calculatePoints(tiers, accountState) {
    const tierList = Array.isArray(tiers) ? tiers : [];
    if (tierList.length === 0) return { earned: 0, max: 0 };

    const max = Number(tierList[tierList.length - 1]?.points || 0);

    if (accountState?.done) {
        return { earned: max, max };
    }

    const current = Number(accountState?.current || 0);
    let earned = 0;

    for (const tier of tierList) {
        if (current >= Number(tier?.count || 0)) {
            earned = Number(tier?.points || earned);
        } else {
            break;
        }
    }

    return { earned, max };
}

function calculateObjectives(bits, accountBits) {
    const bitRows = Array.isArray(bits) ? bits : [];
    const progressRows = Array.isArray(accountBits) ? accountBits : [];

    let completed = 0;

    bitRows.forEach((bit, index) => {
        const goal = Number(bit?.value || 0);
        const current = Number(progressRows[index] || 0);
        const isComplete = goal > 0 ? current >= goal : current > 0;

        if (isComplete) {
            completed += 1;
        }
    });

    const total = bitRows.length;

    return {
        completed,
        total,
        percent: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
}

function filterAchievements(rows, query, rewardFilters, showFilters) {
    const normalizedQuery = String(query || "").trim().toLowerCase();
    const rewardFilterList = Array.isArray(rewardFilters) ? rewardFilters : [];
    const showFilterList = Array.isArray(showFilters) ? showFilters : [];

    return (rows || []).filter((row) => {
        if (normalizedQuery && !row.searchText.includes(normalizedQuery)) {
            return false;
        }

        if (rewardFilterList.length > 0) {
            const wantNone = rewardFilterList.includes("None");
            const rewardTags = Array.isArray(row.rewardTags) ? row.rewardTags : [];
            const tagMatch = rewardTags.some((tag) => rewardFilterList.includes(tag));

            if (!tagMatch && !(wantNone && rewardTags.length === 0)) {
                return false;
            }
        }

        if (showFilterList.length > 0 && !showFilterList.includes(row.status)) {
            return false;
        }

        return true;
    });
}

function readCache(apiKey) {
    const fallback = {
        version: 2,
        apiKey,
        entries: {},
    };

    const cache = StorageManager.getJson(CACHE_KEY, fallback);

    if (!cache || cache.apiKey !== apiKey || typeof cache.entries !== "object" || !cache.entries) {
        return fallback;
    }

    return {
        version: 2,
        apiKey,
        entries: cache.entries,
    };
}

function writeCache(cache) {
    StorageManager.setJson(CACHE_KEY, cache);
}

function splitCacheByFreshness(entries, ids, referenceTime = nowMs()) {
    const freshIds = [];
    const expiredIds = [];
    const missingIds = [];

    for (const id of ids) {
        const entry = entries[String(id)];

        if (!entry || !entry.timestamp || !entry.data) {
            missingIds.push(id);
            continue;
        }

        if ((referenceTime - entry.timestamp) < CACHE_TTL_MS) {
            freshIds.push(id);
        } else {
            expiredIds.push(id);
        }
    }

    return { freshIds, expiredIds, missingIds };
}

function mapById(rows) {
    const map = {};

    for (const row of rows || []) {
        if (row && row.id !== undefined && row.id !== null) {
            map[row.id] = row;
        }
    }

    return map;
}

function mapMasteryRegionName(mastery, reward) {
    const regionHints = [
        mastery?.region,
        mastery?.track?.region,
        mastery?.track?.name,
        reward?.region,
        reward?.name,
    ]
        .filter((value) => typeof value === "string")
        .join(" ")
        .toLowerCase();

    if (!regionHints) return "Unknown";

    if (regionHints.includes("janthir") || regionHints.includes("lowland")) return "Lowland";
    if (regionHints.includes("cantha") || regionHints.includes("end of dragons") || regionHints.includes("jade")) return "Cantha";
    if (regionHints.includes("maguuma") || regionHints.includes("heart of thorns")) return "Maguuma";
    if (regionHints.includes("desert") || regionHints.includes("path of fire")) return "Desert";
    if (regionHints.includes("tundra") || regionHints.includes("icebrood")) return "Tundra";
    if (regionHints.includes("sky") || regionHints.includes("obscure")) return "Sky";
    if (regionHints.includes("tyria") || regionHints.includes("central")) return "Tyria";

    return "Unknown";
}

class RewardResolver {
    constructor() {
        this.items = {};
        this.masteries = {};
        this.skins = {};
        this.titles = {};
    }

    async prefetchAll(achievements) {
        const itemIds = new Set();
        const masteryIds = new Set();
        const skinIds = new Set();
        const titleIds = new Set();

        for (const achievement of achievements || []) {
            for (const reward of achievement?.rewards || []) {
                if (reward?.type === "Item" && reward.id) itemIds.add(reward.id);
                if (reward?.type === "Mastery" && reward.id) masteryIds.add(reward.id);
                if (reward?.type === "Skin" && reward.id) skinIds.add(reward.id);
                if (reward?.type === "Title" && reward.id) titleIds.add(reward.id);
            }
        }

        await Promise.all([
            this.prefetchType("items", itemIds, this.items),
            this.prefetchType("masteries", masteryIds, this.masteries),
            this.prefetchType("skins", skinIds, this.skins),
            this.prefetchType("titles", titleIds, this.titles),
        ]);
    }

    async prefetchType(path, idSet, target) {
        const ids = Array.from(idSet || []).filter((id) => target[id] === undefined);
        if (ids.length === 0) return;

        const rows = await fetchByIdsInBatches(gw2ApiUrl(path), ids, 200).catch(() => []);
        const byId = mapById(rows);

        for (const id of ids) {
            target[id] = byId[id] || null;
        }
    }

    resolve(reward) {
        if (!reward || typeof reward !== "object") {
            return {
                type: "Unknown",
                label: "Unknown reward",
                link: null,
                icon: null,
                filterTag: null,
            };
        }

        if (reward.type === "AP") {
            const count = Number(reward.count || 0);
            return {
                type: "AP",
                label: `${count} Achievement Points`,
                link: buildWikiUrl("Achievement Point"),
                icon: null,
                filterTag: "AP",
            };
        }

        if (reward.type === "Coin") {
            const count = Number(reward.count || 0);
            return {
                type: "Coin",
                label: `${count} Coins`,
                link: buildWikiUrl("Coin"),
                icon: null,
                filterTag: null,
            };
        }

        if (reward.type === "Item" && reward.id) {
            const item = this.items[reward.id] || null;
            const qty = Number(reward.count || 0) > 1 ? `${reward.count}x ` : "";
            const name = item?.name || reward.name || `Item ${reward.id}`;

            return {
                type: "Item",
                label: `${qty}${name}`,
                link: buildWikiUrl(name),
                icon: item?.icon || null,
                filterTag: null,
            };
        }

        if (reward.type === "Skin" && reward.id) {
            const skin = this.skins[reward.id] || null;
            const name = skin?.name || reward.name || `Skin ${reward.id}`;

            return {
                type: "Skin",
                label: name,
                link: buildWikiUrl(name),
                icon: skin?.icon || null,
                filterTag: null,
            };
        }

        if (reward.type === "Title" && reward.id) {
            const title = this.titles[reward.id] || null;
            const name = title?.name || reward.name || `Title ${reward.id}`;

            return {
                type: "Title",
                label: `Title: ${name}`,
                link: buildWikiUrl(name),
                icon: null,
                filterTag: "Titles",
            };
        }

        if (reward.type === "Mastery" && reward.id) {
            const mastery = this.masteries[reward.id] || null;
            const name = mastery?.name || reward.name || `Mastery ${reward.id}`;
            const region = mapMasteryRegionName(mastery, reward);
            const fileName = MASTERY_REGION_ICON_FILE[region] || MASTERY_REGION_ICON_FILE.Unknown;

            return {
                type: "Mastery",
                label: `${name} Mastery`,
                link: null,
                icon: buildWikiFileUrl(fileName),
                filterTag: "Masteries",
            };
        }

        return {
            type: reward.type || "Unknown",
            label: reward.name || reward.type || "Reward",
            link: reward.name ? buildWikiUrl(reward.name) : null,
            icon: null,
            filterTag: null,
        };
    }
}

function buildSearchText(payload) {
    return [
        payload.title,
        payload.description,
        payload.requirement,
        payload.quote,
        payload.category,
        payload.group,
        ...(payload.rewards || []).map((reward) => reward.label),
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
}

function buildAchievementPayload(achievement, context, rewardResolver) {
    const accountState = context.accountMap[achievement.id] || null;
    const category = context.achievementCategoryMap[achievement.id] || null;
    const group = context.groupMap[achievement.group] || null;

    const status = getAchievementStatus(accountState);
    const points = calculatePoints(achievement.tiers, accountState);
    const objectives = calculateObjectives(achievement.bits, accountState?.bits);

    const rewards = (achievement.rewards || []).map((reward) => rewardResolver.resolve(reward));
    const rewardTags = Array.from(new Set(rewards.map((reward) => reward.filterTag).filter(Boolean)));

    const payload = {
        id: achievement.id,
        title: achievement.name,
        description: achievement.description || achievement.requirement || "",
        requirement: achievement.requirement || "",
        quote: achievement.locked_text || "",
        icon: achievement.icon || category?.icon || "",
        category: category?.name || "",
        categoryWikiUrl: category?.name ? buildWikiUrl(category.name) : "",
        group: group?.name || "",
        groupId: achievement.group || null,
        status,
        done: Boolean(accountState?.done),
        current: Number(accountState?.current || 0),
        tiers: Array.isArray(achievement.tiers) ? achievement.tiers : [],
        bits: Array.isArray(achievement.bits) ? achievement.bits : [],
        accountBits: Array.isArray(accountState?.bits) ? accountState.bits : [],
        objectivesCompleted: objectives.completed,
        totalObjectives: objectives.total,
        objectivesPercent: objectives.percent,
        apEarned: points.earned,
        maxPoints: points.max,
        rewards,
        rewardTags,
        wikiUrl: buildWikiUrl(achievement.name),
        rawAchievement: achievement,
        accountState,
    };

    payload.searchText = buildSearchText(payload);

    return payload;
}

async function fetchAchievementContext(apiKey) {
    const [achievementIds, categories, groups, accountAchievements] = await Promise.all([
        fetchJson(gw2ApiUrl("achievements")),
        fetchJson(gw2ApiUrl("achievements/categories?ids=all")),
        fetchJson(gw2ApiUrl("achievements/groups?ids=all")),
        fetchJson(`${gw2ApiUrl("account/achievements")}?access_token=${encodeURIComponent(apiKey)}`),
    ]);

    const achievementCategoryMap = {};
    for (const category of categories || []) {
        for (const achievementId of category.achievements || []) {
            achievementCategoryMap[achievementId] = category;
        }
    }

    const groupMap = {};
    for (const group of groups || []) {
        groupMap[group.id] = group;
    }

    const accountMap = {};
    for (const accountAchievement of accountAchievements || []) {
        accountMap[accountAchievement.id] = accountAchievement;
    }

    return {
        ids: Array.isArray(achievementIds) ? achievementIds : [],
        achievementCategoryMap,
        groupMap,
        accountMap,
    };
}

async function fetchAchievementsByIds(ids) {
    const batches = chunkArray(ids, ACHIEVEMENT_BATCH_SIZE);
    const results = [];

    for (const batch of batches) {
        const rows = await fetchJson(`${gw2ApiUrl("achievements")}?ids=${batch.join(",")}`);
        if (Array.isArray(rows)) {
            results.push(...rows);
        }
    }

    return results;
}

async function buildPayloadsForIds(ids, context, rewardResolver) {
    if (!ids || ids.length === 0) return [];

    const achievements = await fetchAchievementsByIds(ids);
    await rewardResolver.prefetchAll(achievements);

    return achievements.map((achievement) => buildAchievementPayload(achievement, context, rewardResolver));
}

function upsertCacheEntries(cache, payloads, timestamp = nowMs()) {
    for (const payload of payloads) {
        cache.entries[String(payload.id)] = {
            id: payload.id,
            timestamp,
            data: payload,
        };
    }
}

function getCachedPayloads(cache, ids) {
    const payloads = [];

    for (const id of ids) {
        const entry = cache.entries[String(id)];
        if (entry?.data) {
            payloads.push(entry.data);
        }
    }

    return payloads;
}

function sortPayloadsByIdOrder(payloads, ids) {
    const indexMap = new Map(ids.map((id, index) => [id, index]));

    return [...payloads].sort((a, b) => {
        return (indexMap.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (indexMap.get(b.id) ?? Number.MAX_SAFE_INTEGER);
    });
}

async function refreshAchievementIds(apiKey, ids, onUpdate) {
    if (!ids || ids.length === 0) return;

    const context = await fetchAchievementContext(apiKey);
    const cache = readCache(apiKey);
    const rewardResolver = new RewardResolver();

    const chunks = chunkArray(ids, REFRESH_BATCH_SIZE);

    for (const chunk of chunks) {
        const payloads = await buildPayloadsForIds(chunk, context, rewardResolver);
        upsertCacheEntries(cache, payloads);
        writeCache(cache);

        const allPayloads = getCachedPayloads(cache, context.ids);
        onUpdate(sortPayloadsByIdOrder(allPayloads, context.ids), true);
    }
}

async function loadAchievementsWithCache(apiKey, onUpdate) {
    const context = await fetchAchievementContext(apiKey);
    const cache = readCache(apiKey);
    const split = splitCacheByFreshness(cache.entries, context.ids);
    const rewardResolver = new RewardResolver();

    if (split.freshIds.length > 0 || split.expiredIds.length > 0) {
        const cached = getCachedPayloads(cache, [...split.freshIds, ...split.expiredIds]);
        onUpdate(sortPayloadsByIdOrder(cached, context.ids), false);
    }

    if (split.missingIds.length > 0) {
        const missingPayloads = await buildPayloadsForIds(split.missingIds, context, rewardResolver);
        upsertCacheEntries(cache, missingPayloads);
        writeCache(cache);

        const allPayloads = getCachedPayloads(cache, context.ids);
        onUpdate(sortPayloadsByIdOrder(allPayloads, context.ids), true);
    } else {
        const allPayloads = getCachedPayloads(cache, context.ids);
        onUpdate(sortPayloadsByIdOrder(allPayloads, context.ids), true);
    }

    if (split.expiredIds.length > 0) {
        void refreshAchievementIds(apiKey, split.expiredIds, onUpdate);
    }
}

async function periodicRefreshAll(apiKey, onUpdate) {
    const context = await fetchAchievementContext(apiKey);
    await refreshAchievementIds(apiKey, context.ids, onUpdate);
}

function renderRewardFallback(reward, link) {
    if (reward.type === "Title") {
        const span = document.createElement("span");
        span.style.fontSize = "12px";
        span.style.maxWidth = "140px";
        span.style.whiteSpace = "nowrap";
        span.style.overflow = "hidden";
        span.style.textOverflow = "ellipsis";
        span.textContent = reward.label;
        link.appendChild(span);
        return;
    }

    const fallback = document.createElement("div");
    fallback.style.width = "32px";
    fallback.style.height = "32px";
    fallback.style.borderRadius = "4px";
    fallback.style.display = "flex";
    fallback.style.alignItems = "center";
    fallback.style.justifyContent = "center";
    fallback.style.fontSize = "16px";
    fallback.style.backgroundColor = "rgba(200, 150, 50, 0.3)";
    fallback.style.border = "1px solid rgba(200, 150, 50, 0.5)";

    if (reward.type === "Mastery") {
        fallback.textContent = "✦";
    } else {
        fallback.textContent = "?";
    }

    link.appendChild(fallback);
}

function renderRewardElement(reward) {
    const wrapper = document.createElement("span");
    wrapper.className = "achievement-reward";

    if (reward.type === "Title") {
        wrapper.style.display = "inline-flex";
        wrapper.style.alignItems = "center";
        wrapper.style.maxWidth = "220px";

        const titleText = document.createElement("span");
        titleText.textContent = reward.label;
        titleText.title = reward.label;
        titleText.style.fontSize = "12px";
        titleText.style.whiteSpace = "nowrap";
        titleText.style.overflow = "hidden";
        titleText.style.textOverflow = "ellipsis";

        wrapper.appendChild(titleText);
        return wrapper;
    }

    const link = reward.link ? document.createElement("a") : document.createElement("span");
    if (reward.link) {
        link.href = reward.link;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
    }
    link.title = reward.label;
    link.style.display = "inline-flex";
    link.style.width = "32px";
    link.style.height = "32px";
    link.style.alignItems = "center";
    link.style.justifyContent = "center";

    if (reward.icon) {
        const img = document.createElement("img");
        img.src = reward.icon;
        img.alt = reward.label;
        img.style.width = "32px";
        img.style.height = "32px";
        img.style.borderRadius = "4px";
        img.style.objectFit = "cover";
        img.onerror = () => {
            img.remove();
            renderRewardFallback(reward, link);
        };
        link.appendChild(img);
    } else {
        renderRewardFallback(reward, link);
    }

    wrapper.appendChild(link);

    return wrapper;
}

function formatObjectivesDetail(row) {
    const achievement = row.rawAchievement;
    let html = "";

    if (Array.isArray(achievement.bits) && achievement.bits.length > 0) {
        const accountBits = Array.isArray(row.accountBits) ? row.accountBits : [];

        html += '<div class="achievement-detail-section">';
        html += '<h4 class="detail-section-title">Objectives</h4>';
        html += '<div class="achievement-objectives-list">';

        achievement.bits.forEach((bit, index) => {
            const text = bit?.text || (bit?.type ? `${bit.type} #${bit.id}` : "Unnamed objective");
            const current = accountBits[index] ?? 0;
            const goal = bit?.value || 0;
            const isComplete = goal > 0 ? current >= goal : current > 0;
            const progress = goal > 0 ? `${current}/${goal}` : String(current);

            html += `<div class="achievement-objective-row ${isComplete ? "complete" : ""}">
                <span class="objective-check">${isComplete ? "✓" : "○"}</span>
                <span class="objective-text"><strong>Step ${index + 1}:</strong> ${text}</span>
                ${goal > 0 ? `<span class="objective-progress">${progress}</span>` : ""}
            </div>`;
        });

        html += "</div>";
        html += "</div>";
    }

    if (Array.isArray(achievement.tiers) && achievement.tiers.length > 0) {
        html += '<div class="achievement-detail-section">';
        html += '<h4 class="detail-section-title">Tiers</h4>';
        html += '<div class="achievement-tiers-list">';

        achievement.tiers.forEach((tier, index) => {
            const isComplete = row.done || row.current >= Number(tier?.count || 0);

            html += `<div class="achievement-tier-row ${isComplete ? "complete" : ""}">
                <span class="tier-check">${isComplete ? "✓" : "○"}</span>
                <span class="tier-info">Tier ${index + 1}: ${Number(tier?.count || 0)}</span>
                <span class="tier-points">${Number(tier?.points || 0)} AP</span>
            </div>`;
        });

        html += "</div>";
        html += "</div>";
    }

    if (achievement.requirement) {
        html += '<div class="achievement-detail-section">';
        html += '<h4 class="detail-section-title">Requirement</h4>';
        html += `<p class="achievement-requirement">${achievement.requirement}</p>`;
        html += "</div>";
    }

    return html;
}

function buildCardElement(item) {
    const wrapper = document.createElement("div");
    wrapper.className = "achievement-card";
    wrapper.dataset.achievementId = String(item.id);

    const main = document.createElement("div");
    main.className = "achievement-card-main";

    const iconContainer = document.createElement("div");
    iconContainer.className = "achievement-icon-container";
    const icon = document.createElement("img");
    icon.className = "achievement-icon";
    icon.src = item.icon || "";
    icon.alt = item.title;
    iconContainer.appendChild(icon);
    main.appendChild(iconContainer);

    const content = document.createElement("div");
    content.className = "achievement-content";

    const titleLink = document.createElement("a");
    titleLink.className = "achievement-title";
    titleLink.href = item.wikiUrl;
    titleLink.target = "_blank";
    titleLink.rel = "noopener noreferrer";
    titleLink.textContent = item.title;
    content.appendChild(titleLink);

    const descriptionEl = document.createElement("p");
    descriptionEl.className = "achievement-description";
    descriptionEl.textContent = item.description;
    content.appendChild(descriptionEl);

    if (item.quote) {
        const quoteEl = document.createElement("p");
        quoteEl.className = "achievement-quote";
        quoteEl.textContent = `"${item.quote}"`;
        content.appendChild(quoteEl);
    }

    if (item.category) {
        const categoryContainer = document.createElement("div");
        categoryContainer.className = "achievement-categories";

        const categoryBadge = document.createElement("a");
        categoryBadge.className = "achievement-category-badge";
        categoryBadge.href = item.categoryWikiUrl || "#";
        categoryBadge.target = item.categoryWikiUrl ? "_blank" : "";
        categoryBadge.rel = item.categoryWikiUrl ? "noopener noreferrer" : "";
        categoryBadge.textContent = item.category;

        categoryContainer.appendChild(categoryBadge);
        content.appendChild(categoryContainer);
    }

    main.appendChild(content);

    const stats = document.createElement("div");
    stats.className = "achievement-stats";

    const apStat = document.createElement("div");
    apStat.className = "achievement-stat ap-stat";
    apStat.innerHTML = `<span class="stat-value">${item.apEarned}/${item.maxPoints}</span><span class="stat-label">AP</span>`;
    stats.appendChild(apStat);

    const completionStat = document.createElement("div");
    completionStat.className = "achievement-stat completion-stat";
    if (item.done) {
        completionStat.innerHTML = "<span class=\"stat-value completed-value\">✓ Completed</span><span class=\"stat-label\">Status</span>";
    } else if (item.current > 0) {
        completionStat.innerHTML = `<span class="stat-value">${item.current}</span><span class="stat-label">Progress</span>`;
    } else {
        completionStat.innerHTML = "<span class=\"stat-value\">Not Started</span><span class=\"stat-label\">Status</span>";
    }
    stats.appendChild(completionStat);

    if (item.totalObjectives > 0) {
        const objectivesStat = document.createElement("div");
        objectivesStat.className = "achievement-stat objectives-stat";
        objectivesStat.innerHTML = `<span class="stat-value">${item.objectivesCompleted}/${item.totalObjectives} (${item.objectivesPercent}%)</span><span class="stat-label">Objectives</span>`;
        stats.appendChild(objectivesStat);
    }

    main.appendChild(stats);
    wrapper.appendChild(main);

    if (Array.isArray(item.rewards) && item.rewards.length > 0) {
        const rewardSection = document.createElement("div");
        rewardSection.className = "achievement-rewards-section";

        const rewardLabel = document.createElement("span");
        rewardLabel.className = "reward-section-label";
        rewardLabel.textContent = "Rewards: ";
        rewardSection.appendChild(rewardLabel);

        const rewardContainer = document.createElement("div");
        rewardContainer.className = "achievement-rewards";
        item.rewards.forEach((reward) => {
            rewardContainer.appendChild(renderRewardElement(reward));
        });

        rewardSection.appendChild(rewardContainer);
        wrapper.appendChild(rewardSection);
    }

    const detailContainer = document.createElement("div");
    detailContainer.className = "achievement-detail-container";
    detailContainer.style.display = "none";
    detailContainer.innerHTML = formatObjectivesDetail(item);
    wrapper.appendChild(detailContainer);

    const expandBtn = document.createElement("button");
    expandBtn.className = "achievement-expand-btn";
    expandBtn.type = "button";
    expandBtn.setAttribute("aria-expanded", "false");

    const expandText = document.createElement("span");
    expandText.className = "expand-text";
    expandText.textContent = "Show More";

    const expandIcon = document.createElement("span");
    expandIcon.className = "expand-icon";
    expandIcon.textContent = "▼";

    expandBtn.appendChild(expandText);
    expandBtn.appendChild(expandIcon);

    expandBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        const expanded = expandBtn.getAttribute("aria-expanded") === "true";

        if (expanded) {
            detailContainer.style.display = "none";
            expandBtn.setAttribute("aria-expanded", "false");
            expandText.textContent = "Show More";
            return;
        }

        detailContainer.style.display = "flex";
        expandBtn.setAttribute("aria-expanded", "true");
        expandText.textContent = "Show Less";
    });

    wrapper.appendChild(expandBtn);

    return wrapper;
}

export function init({ root }) {
    const achievementsSection = root.querySelector("#achievementsSection");
    const achievementResultsSection = root.querySelector("#achievementResultsSection");
    const missingApiKeySection = root.querySelector("#missingApiKeySection");
    const configureApiKeyButton = root.querySelector("#configureApiKeyButton");
    const statusElement = root.querySelector("#achievementPaginatorStatus");
    const paginatorContainer = root.querySelector("#achievementPaginatorContainer");

    if (!achievementsSection || !achievementResultsSection || !missingApiKeySection || !configureApiKeyButton || !statusElement || !paginatorContainer) {
        return undefined;
    }

    const apiKey = StorageManager.getItem(STORAGE_KEY, "").trim();

    const queryInput = root.querySelector("#achievementSearchQuery");
    const rewardsPicker = root.querySelector(`[data-storage-key='${REWARDS_STORAGE_KEY}']`);
    const showPicker = root.querySelector(`[data-storage-key='${SHOW_STORAGE_KEY}']`);

    let paginator = null;
    let allRows = [];
    let refreshIntervalId = null;
    const cleanupFns = [];

    const configureApiKeyHandler = () => {
        window.location.hash = "#/home";
    };

    const updatePaginator = () => {
        if (!paginator) return;

        const query = queryInput ? queryInput.value : "";
        const rewardFilters = getSelectedValues(rewardsPicker);
        const showFilters = getSelectedValues(showPicker);
        const filteredRows = filterAchievements(allRows, query, rewardFilters, showFilters);

        if (filteredRows.length === 0) {
            statusElement.textContent = "No achievements match the current filters.";
            statusElement.classList.add("achievements-placeholder");
        } else {
            statusElement.textContent = "";
            statusElement.classList.remove("achievements-placeholder");
        }

        paginator.setData(filteredRows);
    };

    const ensurePaginator = () => {
        if (paginator) return;

        paginator = new Paginator({
            container: paginatorContainer,
            storageKey: "gw2toolbox.achievements.pageSize",
            columns: [
                {
                    title: "",
                    data: "title",
                    sortable: false,
                    className: "details-control",
                    render: (_, item) => buildCardElement(item),
                },
            ],
            defaultPageSize: 25,
            detailsEnabled: false,
        });
    };

    const setRows = (rows) => {
        allRows = Array.isArray(rows) ? rows : [];

        ensurePaginator();
        updatePaginator();
    };

    const attachFilterListeners = () => {
        if (queryInput) {
            const onInput = () => updatePaginator();
            queryInput.addEventListener("input", onInput);
            cleanupFns.push(() => queryInput.removeEventListener("input", onInput));
        }

        [rewardsPicker, showPicker].forEach((picker) => {
            if (!picker) return;
            const onChange = () => updatePaginator();
            picker.addEventListener("change", onChange);
            cleanupFns.push(() => picker.removeEventListener("change", onChange));
        });
    };

    const loadData = async () => {
        statusElement.textContent = "Loading achievements...";
        statusElement.classList.add("achievements-placeholder");

        try {
            await loadAchievementsWithCache(apiKey, (rows, done) => {
                setRows(rows);

                if (!done) {
                    statusElement.textContent = `Loading achievements (${rows.length})...`;
                    statusElement.classList.add("achievements-placeholder");
                    return;
                }

                if (!rows.length) {
                    statusElement.textContent = "No achievements could be loaded.";
                    statusElement.classList.add("achievements-placeholder");
                    return;
                }

                statusElement.textContent = "";
                statusElement.classList.remove("achievements-placeholder");
            });
        } catch (error) {
            statusElement.textContent = `Unable to load achievements. ${error.message}`;
            statusElement.classList.add("achievements-placeholder");
            console.error(error);
        }
    };

    const startPeriodicRefresh = () => {
        refreshIntervalId = window.setInterval(() => {
            void periodicRefreshAll(apiKey, (rows) => {
                setRows(rows);
            }).catch((error) => {
                console.warn("Periodic achievement refresh failed", error);
            });
        }, REFRESH_INTERVAL_MS);
    };

    configureApiKeyButton.addEventListener("click", configureApiKeyHandler);
    const cleanupForm = initFormControls({ root });

    if (!apiKey) {
        achievementsSection.classList.add("hidden");
        achievementResultsSection.classList.add("hidden");
        missingApiKeySection.classList.remove("hidden");
    } else {
        achievementsSection.classList.remove("hidden");
        achievementResultsSection.classList.remove("hidden");
        missingApiKeySection.classList.add("hidden");

        attachFilterListeners();
        void loadData();
        startPeriodicRefresh();
    }

    return () => {
        configureApiKeyButton.removeEventListener("click", configureApiKeyHandler);

        if (refreshIntervalId) {
            window.clearInterval(refreshIntervalId);
        }

        cleanupFns.forEach((fn) => fn());

        if (typeof cleanupForm === "function") {
            cleanupForm();
        }

        if (paginator && typeof paginator.destroy === "function") {
            paginator.destroy();
        }
    };
}
