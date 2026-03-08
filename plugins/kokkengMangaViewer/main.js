(function () {
  "use strict";

  // ── Constants ─────────────────────────────────────────────────────────────

  const PLUGIN_ID = "kokkengMangaViewer";

  // ── State ─────────────────────────────────────────────────────────────────

  let pluginConfig = null;

  // ── Config ────────────────────────────────────────────────────────────────

  async function loadConfig() {
    if (pluginConfig !== null) return pluginConfig;
    try {
      const res = await fetch("/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "{ configuration { plugins } }" }),
      });
      const data = await res.json();
      pluginConfig =
        (data &&
          data.data &&
          data.data.configuration &&
          data.data.configuration.plugins &&
          data.data.configuration.plugins[PLUGIN_ID]) ||
        {};
    } catch (e) {
      pluginConfig = {};
    }
    return pluginConfig;
  }

  // ── CSS ───────────────────────────────────────────────────────────────────

  const CSS_SIMPLE_LIGHTBOX = `
.Lightbox-header,
.Lightbox-footer {
  z-index: 9999;
  position: absolute;
  width: 100%;
  opacity: 0;
  background-color: #0008;
  transition: opacity 0.5s ease;
}
.Lightbox-footer { bottom: 0; }
.Lightbox-navbutton {
  opacity: 0;
  transition: opacity 0.5s ease;
}
.Lightbox-navbutton:hover,
.Lightbox-header:hover,
.Lightbox-footer:hover { opacity: 1; }
`;

  const CSS_DARK_BACKGROUND = `
.Lightbox { background-color: rgba(20, 20, 20, 0.99) !important; }
`;

  function injectStyle(id, css) {
    if (document.getElementById(id)) return;
    const el = document.createElement("style");
    el.id = id;
    el.textContent = css;
    document.head.appendChild(el);
  }

  function removeStyle(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  async function applyConfig() {
    const cfg = await loadConfig();
    if (cfg.simpleLightbox) {
      injectStyle("kmv-simple-lightbox", CSS_SIMPLE_LIGHTBOX);
    } else {
      removeStyle("kmv-simple-lightbox");
    }
    if (cfg.darkBackground) {
      injectStyle("kmv-dark-background", CSS_DARK_BACKGROUND);
    } else {
      removeStyle("kmv-dark-background");
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  applyConfig();
  loadConfig();
  console.log("[kokkengMangaViewer] loaded");
})();
