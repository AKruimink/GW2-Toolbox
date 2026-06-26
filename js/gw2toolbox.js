const routes = {
    "/home": {
        html: "views/home.html",
        css: ["css/home.css", "css/input.css"],
        module: "./home.js",
    },
    "/achievements": {
        html: "views/achievements.html",
        css: ["css/input.css", "css/buttons.css", "css/form-controls.css", "css/achievements.css", "css/paginator.css"],
        module: "./achievements.js",
    },
    "/about": {
        html: "views/about.html",
        css: [],
        module: null,
    },
};

const appElement = document.getElementById("content");

let currentRoute = {
    route: null,
    cleanup: null,
    cssHrefs: [],
};

/**
 * Ensures a valid route, defaulting to "/achievements" when missing/unknown.
 * @param {string} route Route candidate (e.g. "/about").
 * @returns {string} A normalized route that exists in the routes map.
 */
function normalizeRoute(route) {
    if (!route) {
        return "/home";
    }

    return routes[route] ? route : "/home";
}

/**
 * Reads the current location hash and converts it into a normalized route string.
 * @returns {string} Normalized route derived from window.location.hash.
 */
function getRouteFromHash() {
    const hash = window.location.hash || "#/achievements";
    const route = hash.startsWith("#") ? hash.slice(1) : hash;

    return normalizeRoute(route);
}

/**
 * Updates the navbar UI so the active tab matches the current route.
 * @param {string} route Normalized route string.
 * @returns {void}
 */
function setActiveTab(route) {
    document.querySelectorAll(".tab").forEach((a) => {
        const isActive = a.dataset.route === route;
        a.classList.toggle("active", isActive);
    });
}

/**
 * Dynamically attaches a stylesheet link once per view CSS href.
 * @param {string} href Stylesheet href to attach.
 * @returns {void}
 */
function loadCss(href) {
    if (document.querySelector(`link[data-view-css="${href}"]`)) {
        return;
    }

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute("data-view-css", href);

    document.head.appendChild(link);
}

/**
 * Removes a dynamically-attached view stylesheet link (if present).
 * @param {string} href Stylesheet href to remove.
 * @returns {void}
 */
function unloadCss(href) {
    const link = document.querySelector(`link[data-view-css="${href}"]`);
    if (link) {
        link.remove();
    }
}

/**
 * Loads a route's HTML/CSS/modules, swaps the DOM, runs init(), and cleans up prior view resources.
 * View modules may export an init({ root }) function that optionally returns a cleanup function.
 * @param {string} route Normalized route string.
 * @returns {Promise<void>}
 */
async function loadView(route) {
    const routeDefinition = routes[route];

    const previousCleanup = currentRoute.cleanup;
    const previousCssHrefs = currentRoute.cssHrefs;

    // Preload the new CSS
    const nextCssHrefs = [];
    for (const href of routeDefinition.css) {
        loadCss(href);
        nextCssHrefs.push(href);
    }

    // Preload the new HTML
    const response = await fetch(routeDefinition.html, { cache: "no-cache" });
    if (!response.ok) {
        if (appElement) {
            appElement.innerHTML = `<div role="alert">Failed to load view: ${route}</div>`;
        }
        return;
    }

    const nextHtml = await response.text();

    // Cleanup the old view
    if (typeof previousCleanup === "function") {
        try {
            previousCleanup();
        } catch {
            /* ignore */
        }
    }

    // Swap DOM
    if (appElement) {
        appElement.innerHTML = nextHtml;
    }
    setActiveTab(route);

    // Load module after the DOM swap
    let nextCleanup = null;

    if (routeDefinition.module) {
        const mod = await import(routeDefinition.module);

        if (typeof mod.init === "function") {
            const cleanupFunction = mod.init({ root: appElement });

            if (typeof cleanupFunction === "function") {
                nextCleanup = cleanupFunction;
            }
        }
    }

    // Update current route state
    currentRoute = {
        route,
        cleanup: nextCleanup,
        cssHrefs: nextCssHrefs,
    };

    // Cleanup old CSS that is not needed by the new view
    for (const href of previousCssHrefs) {
        if (!nextCssHrefs.includes(href)) {
            unloadCss(href);
        }
    }
}

/**
 * Handles hash changes by closing any open nav dropdown and loading the new route.
 * @returns {void}
 */
function onRouteChange() {
    const navDropDown = document.querySelector(".navbar-dropdown[open]");
    if (navDropDown) {
        navDropDown.open = false;
    }

    const route = getRouteFromHash();
    void loadView(route);
}

window.addEventListener("hashchange", onRouteChange);

if (!window.location.hash) {
    window.location.hash = "#/home";
}

onRouteChange();

/**
 * Initializes the theme toggle button (light/dark) and persists preference in localStorage.
 * @returns {void}
 */
function setupThemeToggle() {
    const THEME_KEY = "gw2toolbox.theme";
    const toggleBtn = document.getElementById("themeToggle");
    if (!toggleBtn) {
        return;
    }

    /**
     * Determines the initial theme:
     * - from storage, if present
     * - otherwise from OS preference (defaults to dark when unknown)
     * @returns {"light"|"dark"}
     */
    function getInitialTheme() {
        const stored = localStorage.getItem(THEME_KEY);
        if (stored === "light" || stored === "dark") {
            return stored;
        }

        return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }

    /**
     * Applies the given theme to the document and persists it.
     * @param {"light"|"dark"} theme Theme to apply.
     * @returns {void}
     */
    function applyTheme(theme) {
        const isLight = theme === "light";

        document.body.classList.toggle("light-mode", isLight);
        toggleBtn.setAttribute("aria-pressed", String(isLight));
        toggleBtn.dataset.theme = isLight ? "light" : "dark";

        localStorage.setItem(THEME_KEY, isLight ? "light" : "dark");
    }

    let currentTheme = getInitialTheme();
    applyTheme(currentTheme);

    toggleBtn.addEventListener("click", () => {
        currentTheme = currentTheme === "light" ? "dark" : "light";
        applyTheme(currentTheme);
    });
}

setupThemeToggle();
