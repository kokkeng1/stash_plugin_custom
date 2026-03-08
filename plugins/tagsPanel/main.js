(function () {
  "use strict";

  // ── Constants ─────────────────────────────────────────────────────────────

  const PLUGIN_ID = "tagsPanel";
  const PANEL_DETAIL_ID = "kmv-tag-panel";
  const PANEL_EDIT_ID = "kmv-tag-panel-edit";

  // ── State ─────────────────────────────────────────────────────────────────

  let pluginConfig = null;
  let isOwnMutation = false;

  let currentEntity = null; // { type: 'scene'|'gallery'|'image', id: string }
  let panelTagSet = new Set();
  let tagSetLoaded = false;
  let allTagsCache = null;
  let injectingDetail = false;
  let injectingEdit = false;

  let lastPath = "";

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

  // Hides original read-only TagLink badges in detail tabs (prevents flicker).
  // Only injected when detailPanel is enabled.
  const CSS_DETAIL_HIDE = `
.row:has(.scene-details) + .row .tag-item.tag-link { display: none !important; }
.row:has(.scene-details) + .row h6:has(+ .tag-item.tag-link) { display: none !important; }
.row:has(.gallery-details) + .row .tag-item.tag-link { display: none !important; }
.row:has(.gallery-details) + .row h6:has(+ .tag-item.tag-link) { display: none !important; }
.row:has(.image-details) + .row .tag-item.tag-link { display: none !important; }
.row:has(.image-details) + .row h6:has(+ .tag-item.tag-link) { display: none !important; }
`;

  // Hides the original Form.Group (label + TagSelect) in edit tabs.
  // Always injected on entity pages (edit panel is always active).
  const CSS_EDIT_HIDE = `
#scene-edit-details .form-group:has(.tag-select) { display: none !important; }
#gallery-edit-details .form-group:has(.tag-select) { display: none !important; }
#image-edit-details .form-group:has(.tag-select) { display: none !important; }
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

  // ── GraphQL ───────────────────────────────────────────────────────────────

  async function gqlQuery(query, variables) {
    const res = await fetch("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    return res.json();
  }

  // ── Entity config ─────────────────────────────────────────────────────────

  const ENTITY_CONFIG = {
    scene: {
      detailClass: "scene-details",
      editContainerId: "scene-edit-details",
      findQuery: function (id) {
        return '{ findScene(id: "' + id + '") { tags { id } } }';
      },
      findPath: function (data) {
        return data.data && data.data.findScene && data.data.findScene.tags;
      },
      mutation:
        "mutation($input: SceneUpdateInput!) { sceneUpdate(input: $input) { id } }",
      mutationKey: "sceneUpdate",
    },
    gallery: {
      detailClass: "gallery-details",
      editContainerId: "gallery-edit-details",
      findQuery: function (id) {
        return '{ findGallery(id: "' + id + '") { tags { id } } }';
      },
      findPath: function (data) {
        return (
          data.data && data.data.findGallery && data.data.findGallery.tags
        );
      },
      mutation:
        "mutation($input: GalleryUpdateInput!) { galleryUpdate(input: $input) { id } }",
      mutationKey: "galleryUpdate",
    },
    image: {
      detailClass: "image-details",
      editContainerId: "image-edit-details",
      findQuery: function (id) {
        return '{ findImage(id: "' + id + '") { tags { id } } }';
      },
      findPath: function (data) {
        return data.data && data.data.findImage && data.data.findImage.tags;
      },
      mutation:
        "mutation($input: ImageUpdateInput!) { imageUpdate(input: $input) { id } }",
      mutationKey: "imageUpdate",
    },
  };

  // ── Fetch interceptor ─────────────────────────────────────────────────────
  // When the Edit form submits, patch tag_ids so stale formik data
  // doesn't overwrite tags already saved by our panel.

  var _origFetch = window.fetch;
  window.fetch = function (url, options) {
    if (
      !isOwnMutation &&
      tagSetLoaded &&
      currentEntity &&
      url === "/graphql" &&
      options &&
      options.body
    ) {
      try {
        var body = JSON.parse(options.body);
        if (body.variables && body.variables.input) {
          var input = body.variables.input;
          var ecfg = ENTITY_CONFIG[currentEntity.type];
          if (
            body.query &&
            body.query.indexOf(ecfg.mutationKey) !== -1 &&
            input.id === currentEntity.id
          ) {
            input.tag_ids = Array.from(panelTagSet);
            options = Object.assign({}, options, {
              body: JSON.stringify(body),
            });
          }
        }
      } catch (e) {}
    }
    return _origFetch.apply(this, arguments);
  };

  // ── Tag Panel helpers ─────────────────────────────────────────────────────

  async function fetchAllTags() {
    if (allTagsCache) return allTagsCache;
    const data = await gqlQuery(
      '{ findTags(filter: { per_page: -1, sort: "name" }) { tags { id name child_count children { id } } } }'
    );
    allTagsCache =
      (data.data && data.data.findTags && data.data.findTags.tags) || [];
    return allTagsCache;
  }

  // Hierarchy filter:
  // If any ATTACHED tag has child tags → show only those children.
  // If no attached tag has children → show all tags.
  // When hierarchyFilter is off → always show all tags.
  function getTagsForPanel(allTags, attachedIds, useHierarchy) {
    if (!useHierarchy) return { tags: allTags, parentNames: [] };

    var attachedParents = allTags.filter(function (t) {
      return attachedIds.has(t.id) && t.child_count > 0;
    });

    if (attachedParents.length === 0) return { tags: allTags, parentNames: [] };

    var childIds = new Set();
    attachedParents.forEach(function (parent) {
      (parent.children || []).forEach(function (c) { childIds.add(c.id); });
    });

    return {
      tags: allTags.filter(function (t) { return childIds.has(t.id); }),
      parentNames: attachedParents.map(function (p) { return p.name; }),
    };
  }

  async function ensureTagSet(entityType, entityId) {
    if (tagSetLoaded) return;
    const ecfg = ENTITY_CONFIG[entityType];
    const data = await gqlQuery(ecfg.findQuery(entityId));
    if (
      !currentEntity ||
      currentEntity.type !== entityType ||
      currentEntity.id !== entityId
    )
      return;
    const tags = ecfg.findPath(data);
    panelTagSet = new Set(tags ? tags.map(function (t) { return t.id; }) : []);
    tagSetLoaded = true;
  }

  async function saveEntityTags(entityType, entityId, tagIds) {
    const ecfg = ENTITY_CONFIG[entityType];
    isOwnMutation = true;
    try {
      return await gqlQuery(ecfg.mutation, {
        input: { id: entityId, tag_ids: tagIds },
      });
    } finally {
      isOwnMutation = false;
    }
  }

  // ── Tag Panel UI ──────────────────────────────────────────────────────────

  function setBadgeAttached(badge, attached) {
    badge.style.opacity = attached ? "1" : "0.3";
    badge.style.fontWeight = attached ? "600" : "normal";
  }

  function syncAllBadges(tagId, attached) {
    var badges = document.querySelectorAll('[data-kmv-tag="' + tagId + '"]');
    for (var i = 0; i < badges.length; i++) {
      setBadgeAttached(badges[i], attached);
    }
  }

  async function onTagClick(entityType, entityId, tagId) {
    if (
      !currentEntity ||
      currentEntity.type !== entityType ||
      currentEntity.id !== entityId
    )
      return;

    var wasAttached = panelTagSet.has(tagId);
    if (wasAttached) { panelTagSet.delete(tagId); }
    else { panelTagSet.add(tagId); }
    syncAllBadges(tagId, !wasAttached);

    var result = await saveEntityTags(entityType, entityId, [...panelTagSet]);
    var ecfg = ENTITY_CONFIG[entityType];
    if (!result.data || !result.data[ecfg.mutationKey]) {
      if (wasAttached) { panelTagSet.add(tagId); }
      else { panelTagSet.delete(tagId); }
      syncAllBadges(tagId, wasAttached);
      console.error("[tagsPanel] update failed", result);
    }
  }

  function buildTagPanel(entityType, entityId, tags, panelId, parentNames) {
    var panel = document.createElement("div");
    panel.id = panelId;

    var h6 = document.createElement("h6");
    var postfix = parentNames && parentNames.length > 0 ? " in " + parentNames.join(", ") : "";
    h6.textContent = "Tags" + postfix + " (" + tags.length + ")";
    panel.appendChild(h6);

    var list = document.createElement("div");
    tags.forEach(function (tag) {
      var badge = document.createElement("span");
      badge.className = "badge badge-secondary tag-item";
      badge.dataset.kmvTag = tag.id;
      badge.textContent = tag.name;
      badge.style.cssText =
        "cursor:pointer; margin:2px; transition:opacity 0.2s, font-weight 0.1s;";
      setBadgeAttached(badge, panelTagSet.has(tag.id));
      badge.addEventListener("click", function () {
        onTagClick(entityType, entityId, tag.id);
      });
      list.appendChild(badge);
    });
    panel.appendChild(list);
    return panel;
  }

  // ── Detail panel injection ────────────────────────────────────────────────

  async function tryInjectDetailPanel() {
    if (injectingDetail || !currentEntity) return false;
    injectingDetail = true;
    try {
      return await _doInjectDetail(currentEntity.type, currentEntity.id);
    } finally {
      injectingDetail = false;
    }
  }

  async function _doInjectDetail(entityType, entityId) {
    var cfg = await loadConfig();
    if (!currentEntity || currentEntity.type !== entityType || currentEntity.id !== entityId) return false;
    if (!cfg.detailPanel) return false;
    if (document.getElementById(PANEL_DETAIL_ID)) return true;

    var ecfg = ENTITY_CONFIG[entityType];
    var detailEl = document.querySelector("." + ecfg.detailClass);
    if (!detailEl) return false;
    var firstRow = detailEl.closest(".row");
    if (!firstRow) return false;
    var secondRow = firstRow.nextElementSibling;
    if (!secondRow) return false;
    var container = secondRow.querySelector(".col-12");
    if (!container) return false;

    var allTags = await fetchAllTags();
    await ensureTagSet(entityType, entityId);

    if (!currentEntity || currentEntity.type !== entityType || currentEntity.id !== entityId) return false;
    if (document.getElementById(PANEL_DETAIL_ID)) return true;

    var result = getTagsForPanel(allTags, panelTagSet, cfg.hierarchyFilter);
    var tags = result.tags;
    var parentNames = result.parentNames;

    var firstBadge = container.querySelector(".tag-item.tag-link");
    var tagsH6 =
      firstBadge &&
      firstBadge.previousElementSibling &&
      firstBadge.previousElementSibling.tagName === "H6"
        ? firstBadge.previousElementSibling
        : null;

    var panel = buildTagPanel(entityType, entityId, tags, PANEL_DETAIL_ID, parentNames);

    if (tagsH6) {
      container.insertBefore(panel, tagsH6);
    } else if (firstBadge) {
      container.insertBefore(panel, firstBadge);
    } else {
      var perfDiv = container.querySelector(".scene-performers");
      if (perfDiv) {
        var ref = perfDiv.previousElementSibling;
        while (ref && ref.tagName !== "H6") ref = ref.previousElementSibling;
        container.insertBefore(panel, ref || perfDiv);
      } else {
        container.appendChild(panel);
      }
    }
    return true;
  }

  // ── Edit panel injection ──────────────────────────────────────────────────

  async function tryInjectEditPanel() {
    if (injectingEdit || !currentEntity) return false;
    injectingEdit = true;
    try {
      return await _doInjectEdit(currentEntity.type, currentEntity.id);
    } finally {
      injectingEdit = false;
    }
  }

  async function _doInjectEdit(entityType, entityId) {
    var cfg = await loadConfig();
    if (!currentEntity || currentEntity.type !== entityType || currentEntity.id !== entityId) return false;
    if (document.getElementById(PANEL_EDIT_ID)) return true;

    var ecfg = ENTITY_CONFIG[entityType];
    var editContainer = document.getElementById(ecfg.editContainerId);
    if (!editContainer) return false;
    var tagSelect = editContainer.querySelector(".tag-select");
    if (!tagSelect) return false;
    var formGroup = tagSelect.closest(".form-group");
    if (!formGroup) return false;

    var allTags = await fetchAllTags();
    await ensureTagSet(entityType, entityId);

    if (!currentEntity || currentEntity.type !== entityType || currentEntity.id !== entityId) return false;
    if (document.getElementById(PANEL_EDIT_ID)) return true;

    var result = getTagsForPanel(allTags, panelTagSet, cfg.hierarchyFilter);
    var tags = result.tags;
    var parentNames = result.parentNames;

    var panel = buildTagPanel(entityType, entityId, tags, PANEL_EDIT_ID, parentNames);
    formGroup.parentNode.insertBefore(panel, formGroup.nextSibling);
    return true;
  }

  // ── SPA navigation ────────────────────────────────────────────────────────

  function getEntityFromPath(path) {
    var m;
    m = path.match(/^\/scenes\/(\d+)/);
    if (m) return { type: "scene", id: m[1] };
    m = path.match(/^\/galleries\/(\d+)/);
    if (m) return { type: "gallery", id: m[1] };
    m = path.match(/^\/images\/(\d+)/);
    if (m) return { type: "image", id: m[1] };
    return null;
  }

  function onNavigate() {
    var path = window.location.pathname;
    if (path === lastPath) return;
    lastPath = path;

    var entity = getEntityFromPath(path);
    if (entity) {
      currentEntity = entity;
      tagSetLoaded = false;
      panelTagSet = new Set();

      // Edit panel CSS: always hide original TagSelect on entity pages.
      injectStyle("tp-edit-hide", CSS_EDIT_HIDE);

      // Detail panel CSS: only hide original tags when detailPanel is on.
      loadConfig().then(function (cfg) {
        if (
          cfg.detailPanel &&
          currentEntity &&
          currentEntity.type === entity.type &&
          currentEntity.id === entity.id
        ) {
          injectStyle("tp-detail-hide", CSS_DETAIL_HIDE);
        }
      });
    } else {
      currentEntity = null;
      tagSetLoaded = false;
      panelTagSet = new Set();
      removeStyle("tp-detail-hide");
      removeStyle("tp-edit-hide");
      var dp = document.getElementById(PANEL_DETAIL_ID);
      if (dp) dp.remove();
      var ep = document.getElementById(PANEL_EDIT_ID);
      if (ep) ep.remove();
    }
  }

  // ── Observers ─────────────────────────────────────────────────────────────

  var navWatcher = new MutationObserver(function () {
    onNavigate();
    if (!currentEntity) return;

    if (!injectingDetail && !document.getElementById(PANEL_DETAIL_ID)) {
      tryInjectDetailPanel();
    }
    if (!injectingEdit && !document.getElementById(PANEL_EDIT_ID)) {
      tryInjectEditPanel();
    }
  });
  navWatcher.observe(document.body, { childList: true, subtree: true });

  // ── Init ──────────────────────────────────────────────────────────────────

  loadConfig();
  onNavigate();
  console.log("[tagsPanel] loaded");
})();
