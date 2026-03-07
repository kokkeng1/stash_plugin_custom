(function () {
  "use strict";

  const PLUGIN_ID = "kokkengMangaViewer";
  let pluginConfig = null;

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

  // SimpleLightbox: 헤더/푸터/네비 버튼을 숨기고 hover 시 표시
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

.Lightbox-footer {
  bottom: 0;
}

.Lightbox-navbutton {
  opacity: 0;
  transition: opacity 0.5s ease;
}

.Lightbox-navbutton:hover,
.Lightbox-header:hover,
.Lightbox-footer:hover {
  opacity: 1;
}
`;

  // DarkBackground: 배경 투명도 ~8% (거의 투명)
  const CSS_DARK_BACKGROUND = `
.Lightbox {
  background-color: rgba(20, 20, 20, 0.95) !important;
}
`;

  function injectStyle(id, css) {
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
  }

  function removeStyle(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  async function applyConfig() {
    const config = await loadConfig();

    if (config.simpleLightbox) {
      injectStyle("kokkengMangaViewer-simpleLightbox", CSS_SIMPLE_LIGHTBOX);
    } else {
      removeStyle("kokkengMangaViewer-simpleLightbox");
    }

    if (config.darkBackground) {
      injectStyle("kokkengMangaViewer-darkBackground", CSS_DARK_BACKGROUND);
    } else {
      removeStyle("kokkengMangaViewer-darkBackground");
    }
  }

  applyConfig();
  console.log("[kokkengMangaViewer] loaded");
})();
