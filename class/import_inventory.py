import json
import re
import sqlite3
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "biolab.db"
JSON_PATH = ROOT / "inventory_rows.json"


def normalized_name(value):
    text = unicodedata.normalize("NFC", value).lower().strip()
    text = re.sub(r"\s+", " ", text)
    aliases = {
        "máy cất nước 1 lần": "máy cất nước một lần",
        "tủ bảo quản hóa chất": "tủ bảo quản hóa chất",
        "bộ học liệu điện tử hỗ trợ giáo viên sinh học cấp thpt":
            "bộ học liệu điện tử hỗ trợ giáo viên sinh học cấp trung học phổ thông",
    }
    return aliases.get(text, text)


def classify(row):
    name = normalized_name(row["name"])
    category = row["category"]
    consumable_words = ("ethanol", "nacl", "phân bón", "giấy thấm", "găng tay")
    stock_type = "CONSUMABLE" if category == "Hóa chất" or any(x in name for x in consumable_words) else "REUSABLE"
    lab_only_words = ("tủ hút", "tủ bảo quản", "máy cất nước", "hóa chất", "ethanol", "nacl")
    usage_scope = "LAB_ONLY" if category == "Hóa chất" or any(x in name for x in lab_only_words) else "BOTH"
    status = "MAINTENANCE" if "chưa sd" in row["condition"].lower() else "GOOD"
    return stock_type, usage_scope, status


raw_rows = json.loads(JSON_PATH.read_text(encoding="utf-8"))
deduped = {}
for row in raw_rows:
    key = normalized_name(row["name"])
    if key not in deduped:
        deduped[key] = row
    else:
        current = deduped[key]
        if row["sourceSheet"] == "Sinh TSCĐ":
            current["brand"] = row["brand"] or current["brand"]
            current["condition"] = row["condition"] or current["condition"]
            current["note"] = row["note"] or current["note"]
            current["category"] = "Tài sản cố định"

records = []
for index, row in enumerate(deduped.values(), start=1):
    stock_type, usage_scope, status = classify(row)
    note_parts = [
        f"Nguồn: {row['sourceSheet']}",
        f"Năm đưa vào sử dụng: {row['year']}" if row["year"] else None,
        f"Nhãn hiệu: {row['brand']}" if row["brand"] else None,
        f"Tình trạng kiểm kê: {row['condition']}" if row["condition"] else None,
        row["note"] or None,
    ]
    records.append((
        f"KK-{index:03d}", row["name"], "GENERAL", row["category"], row["quantity"],
        row["quantity"] if status == "GOOD" else 0, row["unit"], row["gradeLevel"],
        status, "; ".join(x for x in note_parts if x), usage_scope, stock_type,
    ))

conn = sqlite3.connect(DB_PATH)
try:
    conn.execute("BEGIN IMMEDIATE")
    conn.execute("DELETE FROM equipment")
    conn.executemany("""
        INSERT INTO equipment(code,name,zone,category,total_qty,available_qty,unit,grade_level,status,notes,usage_scope,stock_type)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    """, records)
    conn.commit()
finally:
    conn.close()

print(json.dumps({"raw_rows": len(raw_rows), "imported_unique": len(records)}, ensure_ascii=False))
