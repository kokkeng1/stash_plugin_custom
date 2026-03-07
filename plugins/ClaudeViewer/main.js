(function () {
  "use strict";

  console.log("[ClaudeViewer] 스크립트 시작");

  // 캡처 단계에서 .preview-button 클릭을 가로채기
  // → React 렌더 타이밍과 무관하게 동작
  document.addEventListener(
    "click",
    async function (ev) {
      // .preview-button 안의 버튼인지 확인
      const btn = ev.target.closest(".preview-button button");
      if (!btn) return;

      // 상위 이미지 카드에서 링크 추출 → 이미지 ID 파싱
      const card = btn.closest(".image-card");
      if (!card) return;

      const link = card.querySelector("a.image-card-link");
      if (!link) return;

      const match = link.getAttribute("href")?.match(/\/images\/(\d+)/);
      if (!match) return;

      const imageId = match[1];
      console.log("[ClaudeViewer] 이미지 ID:", imageId);

      // 원래 이벤트(Lightbox) 차단
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();

      try {
        const res = await fetch("/graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `{ findImage(id: "${imageId}") { visual_files { ... on ImageFile { path } } } }`,
          }),
        });
        const data = await res.json();
        const path = data?.data?.findImage?.visual_files?.[0]?.path;

        if (path) {
          console.log("[ClaudeViewer] 파일 경로:", path);
          const a = document.createElement("a");
          a.href = "honeyview-stash://open?path=" + encodeURIComponent(path);
          a.click();
        } else {
          console.warn("[ClaudeViewer] 파일 경로 없음, GraphQL 응답:", JSON.stringify(data));
        }
      } catch (e) {
        console.error("[ClaudeViewer] 오류:", e);
      }
    },
    true // capture phase — React 이벤트보다 먼저 실행
  );

  console.log("[ClaudeViewer] 이벤트 리스너 등록 완료 ♥");
})();
