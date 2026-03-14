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

  async function saveConfig(updates) {
    const cfg = await loadConfig();
    const newCfg = Object.assign({}, cfg, updates);
    try {
      await fetch("/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query:
            "mutation ($id: ID!, $input: Map!) { configurePlugin(plugin_id: $id, input: $input) }",
          variables: { id: PLUGIN_ID, input: newCfg },
        }),
      });
      pluginConfig = newCfg;
    } catch (e) {
      console.error("[kmv] saveConfig 오류:", e);
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

  const CSS_GALLERY_FILL_THUMBNAIL = `
.gallery-card-cover {
  overflow: hidden;
}
.gallery-card-image {
  width: 100% !important;
  height: auto !important;
  aspect-ratio: 4 / 5 !important;
  object-fit: cover !important;
  object-position: top center;
}
`;

  const CSS_LB_SCROLL = `
.kmv-lb-scroll {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  overflow-y: auto;
  overflow-x: hidden;
  z-index: 100;
  background: transparent;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.kmv-lb-scroll-row {
  width: 100%;
  min-height: 50vh;
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  background: #000;
  line-height: 0;
}
.kmv-lb-scroll-row img {
  max-width: 100%;
  height: auto;
  display: block;
}
.kmv-lb-scroll-end {
  padding: 16px;
  color: #555;
  font-size: 0.82em;
  flex-shrink: 0;
}
.kmv-lb-scroll-active .Lightbox-navbutton {
  display: none !important;
}
.kmv-lb-scroll-active .Lightbox-carousel {
  display: none;
}
.kmv-lb-scroll-active .Lightbox-header,
.kmv-lb-scroll-active .Lightbox-footer {
  z-index: 101;
}
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
    if (cfg.galleryFillThumbnail) {
      injectStyle("kmv-gallery-fill-thumbnail", CSS_GALLERY_FILL_THUMBNAIL);
    } else {
      removeStyle("kmv-gallery-fill-thumbnail");
    }
  }

  // ── Settings UI ───────────────────────────────────────────────────────────

  function setupGalleryRatioVisibility() {
    const toggleId = `plugin-${PLUGIN_ID}-galleryFillThumbnail`;
    const ratioId = `plugin-${PLUGIN_ID}-galleryThumbnailRatio`;
    let checkbox = null;

    function updateVisibility() {
      const ratioEl = document.getElementById(ratioId);
      if (ratioEl && checkbox) {
        ratioEl.style.display = checkbox.checked ? "" : "none";
      }
    }

    const observer = new MutationObserver(() => {
      const ratioEl = document.getElementById(ratioId);
      if (!ratioEl) return;
      const newCheckbox = document.getElementById(toggleId);
      if (newCheckbox && newCheckbox !== checkbox) {
        if (checkbox) checkbox.removeEventListener("change", updateVisibility);
        checkbox = newCheckbox;
        checkbox.addEventListener("change", updateVisibility);
        updateVisibility();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ── Lightbox Scroll Mode ───────────────────────────────────────────────────

  var SCROLL_ID = "kmv-lb-scroll";

  // 현재 Lightbox carousel에서 보이는 이미지의 ID 반환 (src 파싱)
  function getLbCurrentImageId(lb) {
    var img = lb.querySelector(".Lightbox-carousel-image img");
    if (!img || !img.src) return null;
    var m = img.src.match(/\/image\/(\d+)\//);
    return m ? m[1] : null;
  }

  // carousel 이미지 src가 채워질 때까지 기다린 후 ID 반환
  function waitForCarouselImageId(lb) {
    return new Promise(function (resolve) {
      function read() {
        var id = getLbCurrentImageId(lb);
        if (id) { resolve(id); return true; }
        return false;
      }
      if (read()) return;
      var obs = new MutationObserver(function () { if (read()) obs.disconnect(); });
      obs.observe(lb, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
      setTimeout(function () { obs.disconnect(); resolve(null); }, 1500);
    });
  }

  // 스크롤 컨테이너에서 가장 많이 보이는 row의 이미지 ID 반환
  // getBoundingClientRect 사용 → CSS transform/scale 환경에서도 정확한 화면 좌표 기준
  function getScrollCurrentImageId(scrollEl) {
    var rows = scrollEl.querySelectorAll(".kmv-lb-scroll-row");
    var cRect = scrollEl.getBoundingClientRect();
    var bestId = null;
    var bestArea = 0;
    rows.forEach(function (row) {
      var rRect = row.getBoundingClientRect();
      var visible = Math.max(0, Math.min(rRect.bottom, cRect.bottom) - Math.max(rRect.top, cRect.top));
      if (visible > bestArea) {
        bestArea = visible;
        var img = row.querySelector("img");
        if (img) {
          var m = img.src.match(/\/image\/(\d+)\//);
          bestId = m ? m[1] : null;
        }
      }
    });
    return bestId;
  }

  // .Lightbox-display가 DOM에 나타날 때까지 대기 (캐시된 config로 즉시 실행될 때 대응)
  function waitForDisplay(lb) {
    return new Promise(function (resolve) {
      var el = lb.querySelector(".Lightbox-display");
      if (el) { resolve(el); return; }
      var obs = new MutationObserver(function () {
        var el = lb.querySelector(".Lightbox-display");
        if (el) { obs.disconnect(); resolve(el); }
      });
      obs.observe(lb, { childList: true, subtree: true });
      setTimeout(function () { obs.disconnect(); resolve(null); }, 2000);
    });
  }

  // imageId를 받아서 해당 이미지부터 시작. 없으면 carousel에서 읽어서 대기
  async function activateScrollMode(lb, imageId) {
    var display = await waitForDisplay(lb);
    if (!display) return;
    if (display.querySelector("#" + SCROLL_ID)) return;

    var m = window.location.pathname.match(/^\/galleries\/(\d+)/);
    if (!m) return;

    // 즉시 스크롤 모드 UI 구성 (carousel 플래시 방지)
    display.style.position = "relative";
    lb.classList.add("kmv-lb-scroll-active");

    var scrollEl = document.createElement("div");
    scrollEl.id = SCROLL_ID;
    scrollEl.className = "kmv-lb-scroll";
    display.appendChild(scrollEl);

    var loading = document.createElement("div");
    loading.className = "kmv-lb-scroll-end";
    loading.textContent = "이미지 로딩 중...";
    scrollEl.appendChild(loading);

    // 외부에서 imageId가 주어지지 않은 경우(자동 활성화)엔 carousel에서 읽기
    // carousel이 display:none이어도 img[src]는 DOM에 남아있으므로 정상 동작
    if (!imageId) {
      imageId = await waitForCarouselImageId(lb);
    }

    try {
      var res = await fetch("/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query:
            "{ findImages(" +
            '  image_filter: { galleries: { value: ["' + m[1] + '"], modifier: INCLUDES } }' +
            '  filter: { per_page: -1, sort: "path", direction: ASC }' +
            ") { images { id } } }",
        }),
      });
      var data = await res.json();
      var images =
        (data && data.data && data.data.findImages && data.data.findImages.images) || [];

      loading.remove();

      images.forEach(function (img, i) {
        var row = document.createElement("div");
        row.className = "kmv-lb-scroll-row";
        var imgEl = document.createElement("img");
        imgEl.src = "/image/" + img.id + "/image";
        imgEl.loading = "lazy";
        imgEl.alt = String(i + 1);
        row.appendChild(imgEl);
        scrollEl.appendChild(row);
      });

      var footer = document.createElement("div");
      footer.className = "kmv-lb-scroll-end";
      footer.textContent = "끝 — 총 " + images.length + "장";
      scrollEl.appendChild(footer);

      // imageId로 시작 위치 결정 (정렬 순서와 무관하게 동일 이미지 찾기)
      var startIdx = 0;
      if (imageId) {
        var found = images.findIndex(function (img) { return img.id === imageId; });
        if (found >= 0) startIdx = found;
      }

      // 스크롤 시 indicator 텍스트 직접 갱신
      var total = images.length;
      scrollEl.addEventListener("scroll", function () {
        var curId = getScrollCurrentImageId(scrollEl);
        var curIdx = curId ? images.findIndex(function (img) { return img.id === curId; }) : 0;
        if (curIdx < 0) curIdx = 0;
        var indicator = lb.querySelector(".Lightbox-header-indicator");
        if (indicator) indicator.textContent = (curIdx + 1) + " / " + total;
      });

      // 시작 위치로 스크롤
      var rows = scrollEl.querySelectorAll(".kmv-lb-scroll-row");

      if (startIdx > 0 && rows[startIdx]) {
        var targetRow = rows[startIdx];
        var isUserScrolled = false;

        // 사용자가 직접 스크롤하면 자동 snap 중단
        scrollEl.addEventListener("scroll", function onUserScroll() {
          isUserScrolled = true;
          scrollEl.removeEventListener("scroll", onUserScroll);
        }, { once: true });

        // offsetTop 기반 scrollTop 설정 (layout 픽셀 단위 → scrollTop과 동일 좌표계)
        function snapToTarget() {
          scrollEl.scrollTop = targetRow.offsetTop;
        }

        // 타겟 이전 이미지가 로드되면 snap 재호출 (레이아웃 밀림 보정)
        if (rows[startIdx - 1]) {
          var prevImg = rows[startIdx - 1].querySelector("img");
          if (prevImg && !prevImg.complete) {
            prevImg.addEventListener("load", function () {
              if (!isUserScrolled) snapToTarget();
            }, { once: true });
          }
        }

        snapToTarget();
      }
      // 초기 indicator 갱신
      var indicator = lb.querySelector(".Lightbox-header-indicator");
      if (indicator) indicator.textContent = (startIdx + 1) + " / " + total;
    } catch (e) {
      loading.textContent = "오류: " + String(e);
      loading.style.color = "#f88";
    }
  }

  function deactivateScrollMode(lb) {
    var scrollEl = lb.querySelector("#" + SCROLL_ID);
    var targetImageId = null;
    if (scrollEl) {
      targetImageId = getScrollCurrentImageId(scrollEl);
      scrollEl.remove();
    }
    lb.classList.remove("kmv-lb-scroll-active");
    var display = lb.querySelector(".Lightbox-display");
    if (display) display.style.position = "";

    // 현재 보던 이미지 ID로 nav 썸네일 찾아서 클릭
    if (targetImageId) {
      setTimeout(function () {
        var navImages = lb.querySelectorAll(".Lightbox-nav-image");
        for (var i = 0; i < navImages.length; i++) {
          var navImg = navImages[i].querySelector("img");
          if (navImg && navImg.src.includes("/image/" + targetImageId + "/")) {
            navImages[i].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
            break;
          }
        }
      }, 50);
    }
  }

  function setupLightboxScrollMode() {
    var currentLb = null;
    var isLoading = false;

    injectStyle("kmv-lb-scroll-css", CSS_LB_SCROLL);

    // ── Lightbox open 감지 → 스크롤 모드 자동 활성화 ─────────────────────

    var lbObserver = new MutationObserver(function () {
      var lb = document.querySelector(".Lightbox");
      if (lb && lb !== currentLb) {
        currentLb = lb;
        if (isLoading) return;
        isLoading = true;
        loadConfig().then(function (cfg) {
          isLoading = false;
          // 콜백 시점의 currentLb를 사용 (로딩 중 lb가 교체됐을 경우 대응)
          if (cfg.lightboxScrollMode && currentLb) activateScrollMode(currentLb);
        });
      } else if (!lb) {
        currentLb = null;
      }
    });

    lbObserver.observe(document.body, { childList: true, subtree: true });

    // ── Lightbox 옵션 팝오버에 토글 삽입 ─────────────────────────────────

    var OPT_CB_ID = "kmv-lb-opt-scroll";
    var lastPopover = null;

    function tryInjectOption() {
      var lb = document.querySelector(".Lightbox");
      if (!lb) return;

      var popover = lb.querySelector(".popover");
      if (!popover || popover === lastPopover) return;
      lastPopover = popover;

      var content = popover.querySelector(".popover-body");
      if (!content) return;
      if (content.querySelector("#" + OPT_CB_ID)) return;

      // 기존 Form.Group 스타일에 맞게 삽입
      var group = document.createElement("div");
      group.className = "form-group";
      group.style.cssText = "margin-top:8px;border-top:1px solid #444;padding-top:8px;";
      group.innerHTML =
        '<div class="row mb-1">' +
          '<div class="col">' +
            '<div class="form-check">' +
              '<input type="checkbox" class="form-check-input" id="' + OPT_CB_ID + '">' +
              '<label class="form-check-label" for="' + OPT_CB_ID + '">세로 스크롤 모드</label>' +
            '</div>' +
          '</div>' +
        '</div>';

      var cb = group.querySelector("input");

      // 현재 설정 반영
      loadConfig().then(function (cfg) {
        cb.checked = !!cfg.lightboxScrollMode;
      });

      cb.addEventListener("change", async function () {
        var checked = cb.checked;
        await saveConfig({ lightboxScrollMode: checked });

        // 옵션 버튼 클릭으로 팝오버 닫기
        var optBtn = lb.querySelector(".Lightbox-header-options-icon button");
        if (optBtn) optBtn.click();

        var currentLbEl = document.querySelector(".Lightbox");
        if (!currentLbEl) return;
        if (checked) {
          // 체크박스 변경 시점의 현재 이미지 ID 캡처 (carousel이 아직 살아있는 시점)
          var currentImageId = getLbCurrentImageId(currentLbEl);
          activateScrollMode(currentLbEl, currentImageId);
        } else {
          deactivateScrollMode(currentLbEl);
        }
      });

      content.appendChild(group);
    }

    var popoverObserver = new MutationObserver(function () {
      tryInjectOption();
      // 팝오버가 닫히면 참조 초기화
      var lb = document.querySelector(".Lightbox");
      if (!lb || !lb.querySelector(".popover")) {
        lastPopover = null;
      }
    });

    popoverObserver.observe(document.body, { childList: true, subtree: true });
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  applyConfig();
  setupGalleryRatioVisibility();
  setupLightboxScrollMode();
  console.log("[kokkengMangaViewer] loaded");
})();
