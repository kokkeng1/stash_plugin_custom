import sys
import json
import os
import sqlite3


def log(msg, level="info"):
    levels = {"trace": b"t", "debug": b"d", "info": b"i", "warning": b"w", "error": b"e"}
    c = levels.get(level, b"i")
    line = b"\x01" + c + b"\x02" + f"{msg}\n".encode("utf-8")
    sys.stderr.buffer.write(line)
    sys.stderr.buffer.flush()


def get_db_path():
    # 플러그인 위치: {stash}/plugins/softDelete/softDelete.py
    # DB 위치:      {stash}/stash-go.sqlite
    plugin_dir = os.path.dirname(os.path.abspath(__file__))
    stash_dir  = os.path.dirname(os.path.dirname(plugin_dir))
    return os.path.join(stash_dir, "stash-go.sqlite")


def unlink_file_from_scene(db_path, file_paths):
    """씬-파일 연결(scenes_files)만 제거 — files/video_files 등 메타데이터는 유지"""
    conn = sqlite3.connect(db_path, timeout=10)
    try:
        cur = conn.cursor()

        for path in file_paths:
            folder_path = os.path.dirname(path)
            basename    = os.path.basename(path)

            cur.execute("""
                SELECT f.id FROM files f
                JOIN folders fo ON f.parent_folder_id = fo.id
                WHERE fo.path = ? AND f.basename = ?
            """, (folder_path, basename))

            row = cur.fetchone()
            if row:
                cur.execute("DELETE FROM scenes_files WHERE file_id = ?", (row[0],))
            else:
                log(f"DB에서 파일 레코드를 찾을 수 없음: {path}", "warning")

        conn.commit()
    finally:
        conn.close()


def main():
    try:
        raw = sys.stdin.buffer.read().decode("utf-8")
        input_data = json.loads(raw)

        args = input_data.get("args", {})

        mode = args.get("mode", "")
        if mode != "soft_delete":
            sys.stdout.write("{}")
            return

        file_paths = args.get("file_paths", [])
        if not file_paths:
            log("file_paths가 비어있습니다", "warning")
            sys.stdout.write("{}")
            return

        deleted = []
        skipped = []
        errors  = []

        # 1. 물리 파일 삭제
        for path in file_paths:
            try:
                if not path:
                    continue
                if os.path.exists(path):
                    os.remove(path)
                    deleted.append(path)
                else:
                    skipped.append(path)
            except Exception as e:
                log(f"파일 삭제 오류 [{path}]: {e}", "error")
                errors.append({"path": path, "error": str(e)})

        # 2. scenes_files 연결 해제 (씬 및 파일 메타데이터는 유지, 경로만 삭제)
        try:
            db_path = get_db_path()
            unlink_file_from_scene(db_path, file_paths)
        except Exception as e:
            log(f"DB 경로 연결 해제 오류: {e}", "error")
            errors.append({"path": "DB", "error": str(e)})

        if errors:
            log(f"soft delete 완료 (오류 {len(errors)}개) — 삭제 {len(deleted)}개 / 스킵 {len(skipped)}개", "warning")
        else:
            log(f"soft delete 완료 — 삭제 {len(deleted)}개 / 스킵 {len(skipped)}개")
        sys.stdout.write(json.dumps({
            "deleted": deleted,
            "skipped": skipped,
            "errors":  errors,
        }))

    except Exception as e:
        log(f"플러그인 오류: {e}", "error")
        sys.stdout.write("{}")


main()
