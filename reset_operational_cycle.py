"""Safely clear BioLab operational data for a new school-year cycle."""

import argparse
import os
import shutil
from datetime import datetime

from database import DATABASE_URL, DB_FILE, get_db


OPERATIONAL_TABLES = (
    "group_submissions",
    "session_borrow_items",
    "breakage_reports",
    "session_reports",
    "equipment_borrow_events",
    "inventory_transactions",
    "lab_sessions",
    "notifications",
)


def reset_cycle(confirm=False):
    if not confirm:
        raise RuntimeError("Use --yes to confirm the operational-cycle reset")
    if DATABASE_URL:
        raise RuntimeError(
            "Script reset_operational_cycle.py hiện chỉ hỗ trợ SQLite. "
            "Không chạy script này với DATABASE_URL PostgreSQL/Supabase."
        )

    absolute_db = os.path.abspath(DB_FILE)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = os.path.join(
        os.path.dirname(absolute_db),
        f"biolab.before-school-year-reset-{timestamp}.db",
    )
    shutil.copy2(absolute_db, backup_path)

    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("BEGIN IMMEDIATE")

        counts_before = {
            table: cursor.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in OPERATIONAL_TABLES
        }

        # Return inventory still checked out by unfinished sessions. Confirmed
        # consumption and damage remain deducted from the physical inventory.
        outstanding = cursor.execute("""
            SELECT borrowed.equipment_id,
                   borrowed.quantity
                     - COALESCE(returned.quantity, 0)
                     - COALESCE(consumed.quantity, 0) AS outstanding_quantity
            FROM (
                SELECT equipment_id, SUM(quantity) AS quantity
                FROM inventory_transactions
                WHERE transaction_type = 'BORROW'
                GROUP BY equipment_id
            ) borrowed
            LEFT JOIN (
                SELECT equipment_id, SUM(quantity) AS quantity
                FROM inventory_transactions
                WHERE transaction_type = 'RETURN'
                GROUP BY equipment_id
            ) returned ON returned.equipment_id = borrowed.equipment_id
            LEFT JOIN (
                SELECT equipment_id, SUM(quantity) AS quantity
                FROM inventory_transactions
                WHERE transaction_type = 'CONSUME'
                GROUP BY equipment_id
            ) consumed ON consumed.equipment_id = borrowed.equipment_id
        """).fetchall()

        restored_quantity = 0
        for row in outstanding:
            quantity = max(0, int(row["outstanding_quantity"] or 0))
            if quantity:
                cursor.execute(
                    "UPDATE equipment SET available_qty=MIN(total_qty,available_qty+?) WHERE id=?",
                    (quantity, row["equipment_id"]),
                )
                restored_quantity += quantity

        for table in OPERATIONAL_TABLES:
            cursor.execute(f"DELETE FROM {table}")

        conn.commit()
        return backup_path, counts_before, restored_quantity
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Reset BioLab operational data")
    parser.add_argument("--yes", action="store_true", help="confirm the reset")
    args = parser.parse_args()
    backup, counts, restored = reset_cycle(confirm=args.yes)
    print(f"BACKUP={backup}")
    print(f"RESTORED_OUTSTANDING_QUANTITY={restored}")
    for table, count in counts.items():
        print(f"CLEARED_{table.upper()}={count}")
