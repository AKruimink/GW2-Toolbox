import StorageManager from "./storagemanager.js";

const STORAGE_KEY = "gw2toolbox.apiKey";

export function init({ root }) {
    const achievementsSection = root.querySelector("#achievementsSection");
    const missingApiKeySection = root.querySelector("#missingApiKeySection");
    const button = root.querySelector("#configureApiKeyButton");

    if (!achievementsSection || !missingApiKeySection || !button) {
        return undefined;
    }

    const apiKey = StorageManager.getItem(STORAGE_KEY, "").trim();
    const handleClick = () => {
        window.location.hash = "#/home";
    };

    if (!apiKey) {
        achievementsSection.classList.add("hidden");
        missingApiKeySection.classList.remove("hidden");
    } else {
        achievementsSection.classList.remove("hidden");
        missingApiKeySection.classList.add("hidden");
    }

    button.addEventListener("click", handleClick);

    return () => {
        button.removeEventListener("click", handleClick);
    };
}
