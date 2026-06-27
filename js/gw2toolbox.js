/**
 * GW2 Toolbox Main Router & Application Loader
 * 
 * Manages single-page application (SPA) navigation with:
 * - Hash-based routing (#/home, #/achievements, #/about)
 * - Dynamic view loading (HTML, CSS, JS modules)
 * - Resource cleanup on route change (prevents memory leaks)
 * - Theme toggle (light/dark mode)
 */

// ========== ROUTE DEFINITIONS ==========
/**
 * Route configuration map.
 * Each route specifies:
 * - html: Template file to load
 * - css: Stylesheets to load (only when this route is active)
 * - module: JavaScript module with init() function (optional)
 */
const routes = {
    "/home": {
        html: "views/home.html",
        css: ["css/home.css", "css/input.css", "css/form-controls.css"],
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

// ========== APPLICATION STATE ==========
const appElement = document.getElementById("content");

/**
 * Current route state tracking.
 * Keeps track of loaded CSS, cleanup function, and route for cleanup on navigation.
 */
let currentRoute = {
    route: null,
    cleanup: null,
    cssHrefs: [],
};

/**
 * Validates and normalizes a route string.
 * Defaults to "/home" for unknown/missing routes.
 * 
 * @param {string} route - Route candidate (e.g. "/about")
 * @returns {string} Valid route that exists in routes map
 */
function normalizeRoute(route) {
    if (!route) {
        return "/home";
    }

    return routes[route] ? route : "/home";
}

/**
 * Extracts the current route from window.location.hash.
 * Hash format: #/route-name
 * 
 * @returns {string} Normalized route string
 */
function getRouteFromHash() {
    const hash = window.location.hash || "#/achievements";
    const route = hash.startsWith("#") ? hash.slice(1) : hash;

    return normalizeRoute(route);
}

/**
 * Updates navbar active tab styling to match current route.
 * Adds "active" class to matching tab, removes from others.
 * 
 * @param {string} route - Current normalized route
 * @returns {void}
 */
function setActiveTab(route) {
    document.querySelectorAll(".tab").forEach((a) => {
        const isActive = a.dataset.route === route;
        a.classList.toggle("active", isActive);
    });
}

/**
 * Dynamically loads a stylesheet link into the page if not already loaded.
 * Used to load route-specific CSS without bundling everything globally.
 * 
 * @param {string} href - Stylesheet URL or path
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
 * Removes a dynamically-loaded view stylesheet from the page.
 * Called during cleanup to avoid CSS bloat when switching routes.
 * 
 * @param {string} href - Stylesheet URL or path to remove
 * @returns {void}
 */
function unloadCss(href) {
    const link = document.querySelector(`link[data-view-css="${href}"]`);
    if (link) {
        link.remove();
    }
}

/**
 * Loads a route's resources and initializes the view.
 * 
 * Process:
 * 1. Loads route-specific CSS
 * 2. Fetches and parses route HTML template
 * 3. Runs cleanup from previous view (unbinds listeners, destroys components)
 * 4. Swaps new HTML into DOM
 * 5. Imports and runs module's init() function
 * 6. Unloads CSS no longer needed by new route
 * 
 * @param {string} route - Normalized route string
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
    // This calls any cleanup functions returned by the previous module's init()
    if (typeof previousCleanup === "function") {
        try {
            previousCleanup();
        } catch {
            /* ignore cleanup errors */
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
 * Handles hash change events and initiates route loading.
 * Also closes any open navigation dropdown.
 * 
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

// ========== INITIAL SETUP ==========
window.addEventListener("hashchange", onRouteChange);

if (!window.location.hash) {
    window.location.hash = "#/home";
}

onRouteChange();

/**
 * Initializes the theme toggle button for light/dark mode.
 * Persists theme preference to localStorage.
 * 
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
