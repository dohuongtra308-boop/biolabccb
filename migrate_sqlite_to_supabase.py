"""Chuyển dữ liệu BioLab từ SQLite sang Supabase PostgreSQL.

Ví dụ PowerShell:
  $env:DATABASE_URL="postgresql://..."
  python migrate_sqlite_to_supabase.py --source biolab.db --yes
"""

import argparse
import os
import sqlite3


TABLES = [
    "users", "auth_sessions", "equipment", "classes", "lesson_catalog", "academic_terms",
    "lab_manager_assignments", "lab_sessions", "session_borrow_items",
    "equipment_borrow_events", "group_submissions", "session_reports",
    "inventory_transactions", "audit_logs", "breakage_reports", "notifications",
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="biolab.db")
    parser.add_argument("--yes", action="store_true", help="Xác nhận ghi đè dữ liệu đích")
    args = parser.parse_args()
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url.startswith(("postgresql://", "postgres://")):
        raise SystemExit("Hãy đặt DATABASE_URL bằng connection string PostgreSQL của Supabase")
    if not args.yes:
        raise SystemExit("Lệnh sẽ thay dữ liệu Supabase. Chạy lại với --yes khi đã sao lưu")
    if not os.path.isfile(args.source):
        raise SystemExit(f"Không tìm thấy SQLite: {args.source}")

    # Import sau khi đã kiểm tra DATABASE_URL để database.py chọn PostgreSQL.
    from database import get_db, init_db

    init_db()
    source = sqlite3.connect(args.source)
    source.row_factory = sqlite3.Row
    target = get_db()
    try:
        for table in reversed(TABLES):
            target.execute(f'DELETE FROM "{table}"')

        for table in TABLES:
            source_columns = [row[1] for row in source.execute(f'PRAGMA table_info("{table}")')]
            if not source_columns:
                continue
            target_columns = [row["column_name"] for row in target.execute("""
                SELECT column_name FROM information_schema.columns
                WHERE table_schema='public' AND table_name=? ORDER BY ordinal_position
            """, (table,)).fetchall()]
            columns = [name for name in source_columns if name in target_columns]
            rows = source.execute(
                f'SELECT {", ".join(chr(34) + name + chr(34) for name in columns)} FROM "{table}"'
            ).fetchall()
            if rows:
                column_sql = ", ".join(f'"{name}"' for name in columns)
                marks = ", ".join("?" for _ in columns)
                target.cursor().executemany(
                    f'INSERT INTO "{table}" ({column_sql}) VALUES ({marks})',
                    [tuple(row[name] for name in columns) for row in rows],
                )
            if "id" in columns:
                max_id = source.execute(f'SELECT MAX(id) FROM "{table}"').fetchone()[0]
                if max_id:
                    sequence = target.execute(
                        "SELECT pg_get_serial_sequence(?, 'id') AS sequence_name", (table,)
                    ).fetchone()["sequence_name"]
                    if sequence:
                        target.execute("SELECT setval(?, ?, true)", (sequence, max_id))
            print(f"[OK] {table}: {len(rows)} dòng")
        target.commit()
    except Exception:
        target.rollback()
        raise
    finally:
        source.close()
        target.close()
    print("[SUCCESS] Đã chuyển dữ liệu SQLite sang Supabase PostgreSQL")


if __name__ == "__main__":
    main()
