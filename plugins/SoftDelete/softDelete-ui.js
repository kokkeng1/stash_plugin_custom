(function () {
  "use strict";

  const PLUGIN_ID = "softDelete";
  const TASK_NAME = "파일만 삭제 (DB 유지)";

  // ── GraphQL 헬퍼 (origFetch 직접 호출 — 인터셉터 무한루프 방지) ──────────
  let origFetch;

  async function gqlDirect(query, variables) {
    const r = await origFetch.call(window, "/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const j = await r.json();
    return j.data;
  }

  // sceneIds → 파일 정보 목록 조회 (id + path)
  async function queryFileInfo(sceneIds) {
    const files = [];
    await Promise.all(sceneIds.map(async (id) => {
      const data = await gqlDirect(
        `query ($id: ID!) { findScene(id: $id) { files { id path } } }`,
        { id }
      );
      data?.findScene?.files?.forEach((f) => { if (f.path) files.push({ id: f.id, path: f.path }); });
    }));
    return files;
  }

  // ── 삭제 다이얼로그 감지 → 체크박스 주입 ────────────────────────────────
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        // 모달 내부에 #delete-file 이 있으면 씬 삭제 다이얼로그로 판단
        const target = node.querySelector
          ? node.querySelector("#delete-file")
          : null;
        if (target) {
          injectCheckbox(target.closest(".modal-content") || node);
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  function injectCheckbox(container) {
    if (!container || container.querySelector("#soft-delete-db")) return;

    // Form.Check 는 .form-group 없이 바로 .form-check 로 렌더링됨
    const genCb    = container.querySelector("#delete-generated");
    const genCheck = genCb?.closest(".form-check");
    if (!genCheck) return;

    // ── "DB에서도 삭제" 체크박스 삽입 ──
    const div = document.createElement("div");
    div.className = "form-check";
    div.innerHTML = `
      <input type="checkbox" id="soft-delete-db" class="form-check-input">
      <label class="form-check-label" for="soft-delete-db">
        DB에서도 삭제
        <small style="color:#aaa;margin-left:6px">(체크 시 DB까지 완전 삭제)</small>
      </label>`;
    genCheck.insertAdjacentElement("afterend", div);

    // 초기 상태: DB 유지 모드 (미체크) → 생성 콘텐츠 비활성화
    genCb.disabled = true;
    genCheck.style.opacity = "0.4";
    genCheck.title = "DB를 유지할 경우 생성 콘텐츠도 유지됩니다";

    // "DB에서도 삭제" 토글 시 → 생성 콘텐츠 활성/비활성화
    const dbCb = div.querySelector("#soft-delete-db");
    dbCb.addEventListener("change", () => {
      const keepDb = !dbCb.checked;
      genCb.disabled = keepDb;
      genCheck.style.opacity = keepDb ? "0.4" : "";
      genCheck.title = keepDb ? "DB를 유지할 경우 생성 콘텐츠도 유지됩니다" : "";
    });
  }

  // "DB에서도 삭제" 체크박스가 해제(= DB 유지 모드)인지 확인
  function isKeepDbMode() {
    const cb = document.getElementById("soft-delete-db");
    return cb !== null && !cb.checked;
  }

  // ── window.fetch 인터셉터 ────────────────────────────────────────────────
  origFetch = window.fetch;
  window.fetch = async function (url, opts, ...rest) {
    // GraphQL POST 요청만 처리
    if (
      typeof url !== "string" ||
      !url.includes("/graphql") ||
      opts?.method !== "POST"
    ) {
      return origFetch.call(this, url, opts, ...rest);
    }

    let body;
    try {
      body = JSON.parse(opts.body);
    } catch {
      return origFetch.call(this, url, opts, ...rest);
    }

    const query = body?.query ?? "";

    // scenesDestroy / sceneDestroy 뮤테이션만 처리
    const isScenesDestroy = query.includes("scenesDestroy");
    const isSceneDestroy  = !isScenesDestroy && /\bsceneDestroy\b/.test(query);
    if (!isScenesDestroy && !isSceneDestroy) {
      return origFetch.call(this, url, opts, ...rest);
    }

    // "DB에서도 삭제" 체크됐으면 → 기존 동작
    if (!isKeepDbMode()) {
      return origFetch.call(this, url, opts, ...rest);
    }

    // ── DB 유지 모드 ──────────────────────────────────────────────────────
    // variables 구조: { input: { ids, delete_file, ... } } 또는 플랫 구조 모두 처리
    const input      = body?.variables?.input ?? body?.variables ?? {};
    const sceneIds   = (input.ids ?? (input.id ? [input.id] : []));
    const deleteFile = input.delete_file ?? input.deleteFile ?? false;

    if (deleteFile && sceneIds.length > 0) {
      const fileInfos = await queryFileInfo(sceneIds);
      if (fileInfos.length > 0) {
        const filePaths = fileInfos.map((f) => f.path);

        // 물리 파일 삭제 + scenes_files 연결 해제 (Python에서 처리)
        await gqlDirect(
          `mutation RunTask($pid: ID!, $tn: String, $am: Map) {
             runPluginTask(plugin_id: $pid, task_name: $tn, args_map: $am)
           }`,
          { pid: PLUGIN_ID, tn: TASK_NAME, am: { mode: "soft_delete", file_paths: filePaths } }
        ).catch((e) => console.error("[softDelete] runPluginTask 오류:", e));
      }
    }

    // React에 성공 응답 반환 (UI는 삭제된 것처럼 동작, DB는 그대로)
    const mutationKey = isScenesDestroy ? "scenesDestroy" : "sceneDestroy";
    return new Response(
      JSON.stringify({ data: { [mutationKey]: true } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };
})();
