const routes = {
    "/achievements": {
        html: "views/achievements.html",
        css: [
            "css/achievements.css",
            "css/paginator.css",
        ],
        module: "./achievements.js",
    },
    "/about": {
        html: "views/about.html",
        css: [],
        module: null,
    },
};

const appElement = document.getElementById("app");

let currentRoute = {
    route: null,
    cleanup: null,
    cssHrefs: []
};

// Ensure a valid route, default to "/achievements" when missing/unknown.
function normalizeRoute(route) {
    if (!route) {
        return "/achievements";
    }

    return routes[route] ? route : "/achievements";
}

// Read the current hash and convert it into a normalized route string.
function getRouteFromHash() {
    const hash = window.location.hash || "#/achievements";
    const route = hash.startsWith("#") ? hash.slice(1) : hash;

    return normalizeRoute(route);
}

// Update the navbar UI so the active tab matches the current route.
function setActiveTab(route) {
    document.querySelectorAll(".tab").forEach((a) => {
        const isActive = a.dataset.route === route;
        a.classList.toggle("active", isActive);
    });
}

// Dynamically attach a stylesheet link once per view CSS href.
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

// Remove a dynamically-attached view stylesheet link (if present).
function unloadCss(href) {
    const link = document.querySelector(`link[data-view-css="${href}"]`);
    if (link) {
        link.remove();
    }
}

// Load a route's HTML/CSS/modules, swap the DOM, run init(), and cleanup prior view resources.
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
        appElement.innerHTML = `<div role="alert">Failed to load view: ${route}</div>`;
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

    appElement.innerHTML = nextHtml;
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

    // Cleanup the old CSS
    for (const href of previousCssHrefs) {
        if (!nextCssHrefs.includes(href)) {
            unloadCss(href);
        }
    }
}

// Handle hash changes by closing any open nav dropdown and loading the new route.
function onRouteChange() {
    const navDropDown = document.querySelector(".navbar-dropdown[open]");
    if (navDropDown) {
        navDropDown.open = false;
    }

    const route = getRouteFromHash();
    loadView(route);
}

window.addEventListener("hashchange", onRouteChange);

if (!window.location.hash) {
    window.location.hash = "#/achievements";
}

onRouteChange();

// Initialize the theme toggle button
function setupThemeToggle() {
    const THEME_KEY = "gw2toolbox.theme";
    const toggleBtn = document.getElementById("themeToggle");
    if (!toggleBtn) {
        return;
    }

    function getInitialTheme() {
        const stored = localStorage.getItem(THEME_KEY);
        if (stored === "light" || stored === "dark") {
            return stored;
        }

        // Optional: default based on OS preference when nothing is stored
        return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }

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
