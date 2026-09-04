import json
import sqlite3
from pathlib import Path

conn = sqlite3.connect(Path(__file__).resolve().parent / "biolab.db")
checks = {
    "total": conn.execute("SELECT COUNT(*) FROM equipment").fetchone()[0],
    "good": conn.execute("SELECT COUNT(*) FROM equipment WHERE status='GOOD'").fetchone()[0],
    "unavailable": conn.execute("SELECT COUNT(*) FROM equipment WHERE status='MAINTENANCE'").fetchone()[0],
    "consumable": conn.execute("SELECT COUNT(*) FROM equipment WHERE stock_type='CONSUMABLE'").fetchone()[0],
    "purchase_proposals": conn.execute("SELECT COUNT(*) FROM equipment WHERE notes LIKE '%mua thêm%'").fetchone()[0],
    "duplicate_codes": conn.execute("SELECT COUNT(*) FROM (SELECT code FROM equipment GROUP BY code HAVING COUNT(*) > 1)").fetchone()[0],
}
print(json.dumps(checks, ensure_ascii=False))
