const WIKI_BASE = "https://wiki.guildwars2.com/wiki/";
const GW2_API_BASE = "https://api.guildwars2.com/v2";

export function chunkArray(items, size) {
    if (!Array.isArray(items) || size <= 0) return [];

    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

export async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}${body ? ` - ${body}` : ""}`);
    }
    return response.json();
}

export async function fetchByIdsInBatches(baseUrl, ids, batchSize = 200) {
    const uniqueIds = Array.from(new Set((ids || []).filter((value) => value !== undefined && value !== null)));
    if (uniqueIds.length === 0) return [];

    const batches = chunkArray(uniqueIds, batchSize);
    const results = [];

    for (const batch of batches) {
        const data = await fetchJson(`${baseUrl}?ids=${batch.join(",")}`);
        if (Array.isArray(data)) {
            results.push(...data);
        }
    }

    return results;
}

export function slugifyForWiki(value) {
    return encodeURIComponent(String(value || "").trim().replace(/\s+/g, "_"));
}

export function buildWikiUrl(pageName) {
    return `${WIKI_BASE}${slugifyForWiki(pageName)}`;
}

export function buildWikiFileUrl(fileName) {
    return `${WIKI_BASE}Special:FilePath/${slugifyForWiki(fileName)}`;
}

export function gw2ApiUrl(path) {
    const safePath = String(path || "").replace(/^\/+/, "");
    return `${GW2_API_BASE}/${safePath}`;
}
