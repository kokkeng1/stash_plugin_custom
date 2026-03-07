#!/usr/bin/env python3
"""
FilenameAutoTagger — Stash 플러그인
파일명에서 tags.json의 키워드/패턴을 찾아 태그를 자동으로 부여합니다.

동작 방식:
  - Scene.Create.Post 훅: 새 영상 스캔 시 해당 영상에 자동 적용
  - 수동 태스크(mode: all): 전체 영상에 일괄 적용
"""
import sys
import json
import os
import re
import urllib.request

# ── 패턴 컴파일 (FilenameTagExtractor와 동일한 규칙) ──────────────────────────
_REGEX_CHARS = re.compile(r'[\\[\]?*+()|^${}]')
_HAS_ASCII_ALNUM = re.compile(r'[a-zA-Z0-9]')


def load_patterns(config_path):
    with open(config_path, encoding="utf-8") as f:
        data = json.load(f)

    compiled = []
    for tag_name, items_str in data.items():
        for item in items_str.split(","):
            item = item.strip()
            if not item:
                continue
            if _REGEX_CHARS.search(item):
                pattern = item
            elif _HAS_ASCII_ALNUM.search(item):
                pattern = r'(?<![a-zA-Z0-9])' + re.escape(item) + r'(?![a-zA-Z0-9])'
            else:
                pattern = re.escape(item)
            try:
                compiled.append((re.compile(pattern, re.IGNORECASE), tag_name))
            except re.error as e:
                log(f"Invalid pattern '{item}': {e}")
    return compiled


def extract_tags(filename, patterns):
    name_normalized = re.sub(r'[-_.()\[\]]+', ' ', filename)
    found = {}
    for pattern, tag_name in patterns:
        if tag_name not in found and pattern.search(name_normalized):
            found[tag_name] = True
    return list(found.keys())


# ── 로그 / GraphQL 헬퍼 ────────────────────────────────────────────────────────
_LOG_LEVELS = {"trace": b"t", "debug": b"d", "info": b"i", "warning": b"w", "error": b"e"}

def log(msg, level="info"):
    """Stash 플러그인 로그 포맷으로 stderr에 출력.
    format: SOH + levelChar + STX + message + newline
    """
    c = _LOG_LEVELS.get(level, b"i")
    line = b"\x01" + c + b"\x02" + f"{msg}\n".encode("utf-8")
    sys.stderr.buffer.write(line)
    sys.stderr.buffer.flush()


def stash_gql(url, cookie_header, query, variables=None):
    payload = {"query": query}
    if variables:
        payload["variables"] = variables
    headers = {"Content-Type": "application/json"}
    if cookie_header:
        headers["Cookie"] = cookie_header
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


# ── 태그 찾기 / 생성 ─────────────────────────────────────────────────────────
def find_or_create_tag(url, cookie_header, tag_name):
    """태그 이름 또는 별칭으로 ID 조회. 없으면 생성 후 ID 반환. 실패 시 None."""
    # 1. 기본 이름으로 검색
    r = stash_gql(url, cookie_header,
        "query($f: TagFilterType) { findTags(tag_filter: $f) { tags { id } } }",
        {"f": {"name": {"value": tag_name, "modifier": "EQUALS"}}},
    )
    tags = r["data"]["findTags"]["tags"]
    if tags:
        return tags[0]["id"]

    # 2. 별칭(alias)으로 검색 — "X is used as alias for Y" 케이스 대응
    r = stash_gql(url, cookie_header,
        "query($f: TagFilterType) { findTags(tag_filter: $f) { tags { id } } }",
        {"f": {"aliases": {"value": tag_name, "modifier": "EQUALS"}}},
    )
    tags = r["data"]["findTags"]["tags"]
    if tags:
        log(f"태그 '{tag_name}'은 별칭으로 존재 → id={tags[0]['id']} 사용", level="debug")
        return tags[0]["id"]

    # 3. 태그 생성
    r = stash_gql(url, cookie_header,
        "mutation($input: TagCreateInput!) { tagCreate(input: $input) { id } }",
        {"input": {"name": tag_name}},
    )
    tag_create = (r.get("data") or {}).get("tagCreate")
    if tag_create:
        log(f"태그 생성: '{tag_name}' (id={tag_create['id']})")
        return tag_create["id"]

    errors = r.get("errors", [])
    log(f"태그 '{tag_name}' 처리 실패: {errors}")
    return None


# ── 영상 1개 처리 ─────────────────────────────────────────────────────────────
def process_scene(url, cookie_header, scene_id, patterns):
    r = stash_gql(url, cookie_header,
        "query($id: ID!) { findScene(id: $id) { id files { path } tags { id name } } }",
        {"id": str(scene_id)},
    )
    scene = r["data"]["findScene"]
    if not scene:
        log(f"씬 {scene_id} 없음")
        return 0

    # 파일명 추출
    files = scene.get("files") or []
    filename = os.path.basename(files[0]["path"]) if files else ""
    if not filename:
        return 0

    # 패턴 매칭
    matched = extract_tags(filename, patterns)
    if not matched:
        return 0

    # 이미 있는 태그 제외
    existing_names = {t["name"] for t in (scene.get("tags") or [])}
    new_tags = [t for t in matched if t not in existing_names]
    if not new_tags:
        return 0

    # 태그 ID 확보 (None 제거)
    existing_ids = [t["id"] for t in (scene.get("tags") or [])]
    new_ids = [find_or_create_tag(url, cookie_header, t) for t in new_tags]
    new_ids = [i for i in new_ids if i is not None]
    if not new_ids:
        return 0
    all_ids = existing_ids + new_ids

    # 영상 업데이트
    stash_gql(url, cookie_header,
        "mutation($input: SceneUpdateInput!) { sceneUpdate(input: $input) { id } }",
        {"input": {"id": str(scene_id), "tag_ids": all_ids}},
    )
    log(f"'{filename}': {new_tags}")
    return len(new_tags)


# ── 메인 ─────────────────────────────────────────────────────────────────────
def main():
    input_data = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    server = input_data.get("server_connection", {})
    args = input_data.get("args", {})

    plugin_dir = server.get("PluginDir", os.path.dirname(os.path.abspath(__file__)))
    host = server.get("Host", "localhost")
    if not host or host == "0.0.0.0":
        host = "localhost"
    stash_url = f"http://{host}:{server.get('Port', 9999)}/graphql"

    session_cookie = server.get("SessionCookie") or {}
    cookie_header = ""
    if session_cookie:
        cookie_header = f"{session_cookie.get('Name', 'session')}={session_cookie.get('Value', '')}"

    # tags.json 로드
    config_path = os.path.join(plugin_dir, "tags.json")
    try:
        patterns = load_patterns(config_path)
    except FileNotFoundError:
        msg = f"tags.json 없음: {config_path}"
        log(msg, level="error")
        sys.stdout.buffer.write(json.dumps({"error": msg}).encode("utf-8"))
        return

    try:
        hook_context = args.get("hookContext")

        if hook_context:
            # ── 훅 모드: 단일 영상 처리 ─────────────────────────────────
            scene_id = str(hook_context.get("id", ""))
            process_scene(stash_url, cookie_header, scene_id, patterns)
            msg = "ok"

        else:
            # ── 수동 태스크 모드: 전체 영상 처리 ────────────────────────
            log("전체 영상 처리 시작...")
            r = stash_gql(stash_url, cookie_header,
                "{ findScenes(filter: { per_page: -1 }) { count scenes { id } } }",
            )
            scenes = r["data"]["findScenes"]["scenes"]
            total = r["data"]["findScenes"]["count"]
            log(f"총 {total}개 영상 처리 예정")

            added = 0
            for i, s in enumerate(scenes, 1):
                added += process_scene(stash_url, cookie_header, s["id"], patterns)
                if i % 100 == 0:
                    log(f"진행: {i}/{total}")

            msg = f"완료: {total}개 영상 처리, {added}개 태그 추가"
            log(msg)

        sys.stdout.buffer.write(json.dumps({"output": msg}).encode("utf-8"))

    except Exception as e:
        log(f"오류: {e}", level="error")
        sys.stdout.buffer.write(json.dumps({"error": str(e)}).encode("utf-8"))


if __name__ == "__main__":
    main()
