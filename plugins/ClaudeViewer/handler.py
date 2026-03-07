"""
honeyview-stash:// 프로토콜 핸들러
Stash에서 보낸 이미지/압축파일 경로를 Honeyview로 열기
"""

import sys
import subprocess
import os
from urllib.parse import urlparse, parse_qs, unquote

HONEYVIEW = r"C:\Program Files\Honeyview\Honeyview.exe"

# 압축파일 확장자 목록 (Honeyview가 직접 열 수 있는 것들)
ARCHIVE_EXTS = ('.zip', '.rar', '.cbz', '.cbr', '.7z', '.tar', '.gz', '.lzh')


def parse_path(url: str) -> str:
    """
    honeyview-stash://open?path=ENCODED_PATH 에서 실제 파일 경로 추출
    """
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    encoded = qs.get('path', [''])[0]
    return unquote(encoded)


def find_archive_boundary(path: str) -> int:
    """
    경로 안에 압축파일 확장자가 있으면 그 끝 인덱스를 반환.
    없으면 -1 반환.
    예: C:\images.zip\page001.jpg  →  인덱스 14 (zip 직후)
    """
    lower = path.lower()
    for ext in ARCHIVE_EXTS:
        idx = lower.find(ext)
        if idx != -1:
            return idx + len(ext)
    return -1


def open_with_honeyview(path: str):
    """
    경로가 압축파일 내부 이미지면 압축파일 자체를 열고,
    일반 이미지면 이미지를 직접 열기.
    """
    if not os.path.exists(HONEYVIEW):
        raise FileNotFoundError(f"Honeyview를 찾을 수 없음: {HONEYVIEW}")

    archive_end = find_archive_boundary(path)

    if archive_end != -1:
        # 압축파일 경로만 추출
        open_path = path[:archive_end]
    else:
        open_path = path

    if not os.path.exists(open_path):
        raise FileNotFoundError(f"파일을 찾을 수 없음: {open_path}")

    subprocess.Popen(
        [HONEYVIEW, open_path],
        creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
    )


def main():
    if len(sys.argv) < 2:
        return

    url = sys.argv[1]
    path = parse_path(url)

    if not path:
        return

    open_with_honeyview(path)


if __name__ == '__main__':
    main()
