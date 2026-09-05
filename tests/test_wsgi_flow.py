"""End-to-end smoke test for the Flask/WSGI application.

Run only with BIOLAB_DB_FILE pointing to a disposable copy of biolab.db.
"""

import json
import hashlib
import os
import sqlite3
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


db_path = os.environ.get("BIOLAB_DB_FILE", "")
if not db_path or os.path.basename(db_path).lower() == "biolab.db":
    raise RuntimeError("BIOLAB_DB_FILE must point to a disposable database copy")

project_root = str(Path(__file__).resolve().parent.parent)
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from app import app  # noqa: E402
from database import hash_password  # noqa: E402


TEST_PASSWORD = "wsgi-test-password"
TEST_DATE = "2099-12-31"
TEST_TITLE = "Kiểm thử tích hợp WSGI"


def expect(response, status, label):
    assert response.status_code == status, (
        f"{label}: expected HTTP {status}, got {response.status_code}: "
        f"{response.get_data(as_text=True)[:300]}"
    )
    return response


def login(client, username):
    response = expect(
        client.post(
            "/api/auth/login",
            json={"username": username, "password": TEST_PASSWORD},
        ),
        200,
        f"login {username}",
    )
    token = response.get_json()["token"]
    return {"Authorization": f"Bearer {token}"}


def main():
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute(
        "UPDATE users SET password_hash=?, must_change_password=0 "
        "WHERE username IN ('gvphutrach','dthtra')",
        (hash_password(TEST_PASSWORD),),
    )
    conn.execute("DELETE FROM lab_sessions WHERE session_date=?", (TEST_DATE,))
    teacher_id = conn.execute(
        "SELECT id FROM users WHERE username='dthtra'"
    ).fetchone()["id"]
    class_row = conn.execute(
        "SELECT name, grade_level FROM classes WHERE active=1 ORDER BY id LIMIT 1"
    ).fetchone()
    reusable = conn.execute(
        "SELECT id,code,total_qty,available_qty,stock_type FROM equipment "
        "WHERE available_qty>=3 AND stock_type='REUSABLE' ORDER BY id LIMIT 1"
    ).fetchone()
    consumable = conn.execute(
        "SELECT id,code,total_qty,available_qty,stock_type FROM equipment "
        "WHERE available_qty>=1 AND stock_type='CONSUMABLE' ORDER BY id LIMIT 1"
    ).fetchone()
    assert reusable and consumable, "Test requires reusable and consumable inventory"
    equipment_rows = [reusable, consumable]
    conn.commit()
    conn.close()

    teacher = app.test_client()
    manager = app.test_client()
    anonymous = app.test_client()
    teacher_headers = login(teacher, "dthtra")
    manager_headers = login(manager, "gvphutrach")

    # A fresh WSGI client can authenticate from SQLite without process memory.
    persisted_token = teacher_headers["Authorization"][7:]
    conn = sqlite3.connect(db_path)
    stored_session = conn.execute(
        "SELECT token_hash FROM auth_sessions WHERE token_hash=?",
        (hashlib.sha256(persisted_token.encode("utf-8")).hexdigest(),),
    ).fetchone()
    raw_token_stored = conn.execute(
        "SELECT 1 FROM auth_sessions WHERE token_hash=?", (persisted_token,)
    ).fetchone()
    conn.close()
    assert stored_session is not None and raw_token_stored is None
    expect(app.test_client().get("/api/equipment", headers=teacher_headers), 200,
           "persisted SQLite session")

    expect(anonymous.get("/"), 200, "landing page")
    static_response = expect(anonymous.get("/static/js/app.js"), 200, "static JS")
    assert static_response.content_type.startswith("application/javascript")
    health = expect(anonymous.get("/api/health"), 200, "public database health check").get_json()
    assert health == {"status": "ok", "database": "connected"}
    expect(anonymous.get("/api/equipment"), 401, "anonymous API guard")

    equipment_id = equipment_rows[0]["id"]
    expect(
        teacher.put(
            f"/api/equipment/{equipment_id}/status",
            headers=teacher_headers,
            json={"status": "MAINTENANCE"},
        ),
        403,
        "teacher cannot change equipment status",
    )
    expect(
        manager.put(
            f"/api/equipment/{equipment_id}/status",
            headers=manager_headers,
            json={"status": "INVALID"},
        ),
        400,
        "invalid equipment status is rejected",
    )
    expect(
        manager.put(
            f"/api/equipment/{equipment_id}/status",
            headers=manager_headers,
            json={"status": "MAINTENANCE"},
        ),
        200,
        "manager sets equipment to maintenance",
    )
    expect(
        manager.put(
            f"/api/equipment/{equipment_id}/status",
            headers=manager_headers,
            json={"status": "GOOD"},
        ),
        200,
        "manager restores equipment to good",
    )
    conn = sqlite3.connect(db_path)
    assert conn.execute("SELECT status FROM equipment WHERE id=?", (equipment_id,)).fetchone()[0] == "GOOD"
    assert conn.execute(
        "SELECT COUNT(*) FROM audit_logs WHERE action='CHANGE_EQUIPMENT_STATUS' AND entity_id=?",
        (equipment_id,),
    ).fetchone()[0] >= 2
    conn.close()

    registration = {
        "title": TEST_TITLE,
        "grade_level": class_row["grade_level"],
        "class_name": class_row["name"],
        "session_date": TEST_DATE,
        "period_slot": "Tiết 1-2 (Sáng)",
        "shift": "MORNING",
        "period_start": 1,
        "period_end": 2,
        "student_count": 20,
        "requested_location": "LAB",
        "planned_items": [
            {"code": equipment_rows[0]["code"], "quantity": 3},
            {"code": equipment_rows[1]["code"], "quantity": 1},
        ],
    }
    classroom_registration = dict(registration)
    classroom_registration["requested_location"] = "CLASS"
    expect(
        teacher.post("/api/sessions", headers=teacher_headers, json=classroom_registration),
        409,
        "consumable equipment cannot be requested for classroom teaching",
    )
    created = expect(
        teacher.post("/api/sessions", headers=teacher_headers, json=registration),
        200,
        "teacher creates registration",
    ).get_json()
    session_id = created["session_id"]

    overlapping_registration = dict(registration)
    overlapping_registration["title"] = TEST_TITLE + " - overlapping pending"
    overlapping_registration["planned_items"] = []
    overlapping_session_id = expect(
        teacher.post("/api/sessions", headers=teacher_headers, json=overlapping_registration),
        200,
        "teacher creates overlapping pending registration",
    ).get_json()["session_id"]

    expect(
        teacher.post(
            f"/api/sessions/{session_id}/approve",
            headers=teacher_headers,
            json={"decision": "APPROVE_LAB"},
        ),
        403,
        "teacher cannot approve",
    )
    expect(
        manager.post(
            f"/api/sessions/{session_id}/approve",
            headers=manager_headers,
            json={"decision": "APPROVE_CLASS"},
        ),
        409,
        "manager cannot approve consumable equipment for classroom teaching",
    )
    expect(
        manager.post(
            f"/api/sessions/{session_id}/approve",
            headers=manager_headers,
            json={"decision": "APPROVE_LAB"},
        ),
        200,
        "manager approves registration",
    )

    conn = sqlite3.connect(db_path)
    event_count = conn.execute(
        "SELECT COUNT(*) FROM equipment_borrow_events WHERE session_id=?",
        (session_id,),
    ).fetchone()[0]
    assert event_count == 2, "Each distinct registered equipment must count as one borrow"
    checked_out = conn.execute(
        "SELECT id,available_qty FROM equipment WHERE id IN (?,?) ORDER BY id",
        (equipment_rows[0]["id"], equipment_rows[1]["id"]),
    ).fetchall()
    checked_out_by_id = {row[0]: row[1] for row in checked_out}
    assert checked_out_by_id[equipment_rows[0]["id"]] == equipment_rows[0]["available_qty"] - 3
    assert checked_out_by_id[equipment_rows[1]["id"]] == equipment_rows[1]["available_qty"] - 1
    conn.close()

    expect(
        manager.post(
            f"/api/sessions/{session_id}/approve",
            headers=manager_headers,
            json={"decision": "APPROVE_LAB"},
        ),
        409,
        "repeat approval is rejected",
    )
    conn = sqlite3.connect(db_path)
    assert conn.execute(
        "SELECT COUNT(*) FROM equipment_borrow_events WHERE session_id=?",
        (session_id,),
    ).fetchone()[0] == 2
    conn.close()

    expect(
        teacher.put(
            f"/api/sessions/{session_id}/status",
            headers=teacher_headers,
            json={"status": "IN_PROGRESS"},
        ),
        200,
        "teacher starts session",
    )
    incomplete_report = {"notes": "test", **{f"s{i}": i < 5 for i in range(1, 6)}}
    expect(
        teacher.post(
            f"/api/sessions/{session_id}/report",
            headers=teacher_headers,
            json=incomplete_report,
        ),
        400,
        "incomplete 5S is rejected",
    )
    complete_report = {
        "notes": "Báo cáo kiểm thử",
        "usage_items": [{"code": equipment_rows[1]["code"], "used_quantity": 1}],
        "damage_items": [{
            "equipment_id": equipment_rows[0]["id"],
            "quantity": 1,
            "reason": "Sự cố được giáo viên ghi trong báo cáo cuối ca",
        }],
        **{f"s{i}": True for i in range(1, 6)},
    }
    expect(
        teacher.post(
            f"/api/sessions/{session_id}/report",
            headers=teacher_headers,
            json=complete_report,
        ),
        200,
        "teacher submits 5S report",
    )
    conn = sqlite3.connect(db_path)
    teacher_damage_count = conn.execute(
        "SELECT COUNT(*) FROM breakage_reports WHERE session_id=? AND source='TEACHER_REPORT'",
        (session_id,),
    ).fetchone()[0]
    conn.close()
    assert teacher_damage_count == 1, "Teacher report damage must appear in breakage management"
    expect(
        manager.post(
            f"/api/sessions/{session_id}/accept-report",
            headers=manager_headers,
            json={"action": "REDO_5S", "reason": "Kiểm tra lại", "failed_items": ["5S"]},
        ),
        200,
        "manager requests 5S redo",
    )
    expect(
        teacher.post(
            f"/api/sessions/{session_id}/report",
            headers=teacher_headers,
            json=complete_report,
        ),
        200,
        "teacher resubmits 5S",
    )
    expect(
        manager.post(
            f"/api/sessions/{session_id}/accept-report",
            headers=manager_headers,
            json={"action": "ACCEPT", "reason": "Đạt"},
        ),
        200,
        "manager accepts report",
    )

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    completed = conn.execute(
        "SELECT status FROM lab_sessions WHERE id=?", (session_id,)
    ).fetchone()
    accepted = conn.execute(
        "SELECT status FROM session_reports WHERE session_id=?", (session_id,)
    ).fetchone()
    assert completed["status"] == "COMPLETED"
    assert accepted["status"] == "ACCEPTED"
    returned_reusable = conn.execute(
        "SELECT total_qty,available_qty FROM equipment WHERE id=?", (equipment_rows[0]["id"],)
    ).fetchone()
    consumed_chemical = conn.execute(
        "SELECT total_qty,available_qty FROM equipment WHERE id=?", (equipment_rows[1]["id"],)
    ).fetchone()
    assert tuple(returned_reusable) == (equipment_rows[0]["total_qty"], equipment_rows[0]["available_qty"])
    assert tuple(consumed_chemical) == (equipment_rows[1]["total_qty"] - 1, equipment_rows[1]["available_qty"] - 1)
    conn.close()

    # A pending overlapping booking must not block completion above. Once the
    # first booking is completed, rejecting another booking must not leave the
    # room slot locked for a later registration.
    expect(
        manager.post(
            f"/api/sessions/{overlapping_session_id}/approve",
            headers=manager_headers,
            json={"decision": "REJECT", "reason": ""},
        ),
        400,
        "rejection reason is required",
    )
    expect(
        manager.post(
            f"/api/sessions/{overlapping_session_id}/approve",
            headers=manager_headers,
            json={"decision": "REJECT", "reason": "Kiểm thử từ chối ca trùng"},
        ),
        200,
        "manager rejects overlapping registration",
    )
    common_schedule = expect(
        teacher.get("/api/schedule/common", headers=teacher_headers),
        200,
        "teacher views common schedule",
    ).get_json()
    assert all(item["id"] != overlapping_session_id for item in common_schedule)
    later_registration = dict(overlapping_registration)
    later_registration["title"] = TEST_TITLE + " - after completed and rejected"
    later_session_id = expect(
        teacher.post("/api/sessions", headers=teacher_headers, json=later_registration),
        200,
        "teacher creates registration after completed and rejected sessions",
    ).get_json()["session_id"]
    expect(
        manager.post(
            f"/api/sessions/{later_session_id}/approve",
            headers=manager_headers,
            json={"decision": "APPROVE_LAB"},
        ),
        200,
        "completed and rejected sessions do not lock the room slot",
    )

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    before_qty = conn.execute(
        "SELECT total_qty,available_qty FROM equipment WHERE id=?",
        (equipment_rows[0]["id"],),
    ).fetchone()
    conn.close()

    expect(
        teacher.post(
            "/api/breakages",
            headers=teacher_headers,
            json={
                "session_id": session_id,
                "equipment_id": equipment_rows[0]["id"],
                "quantity": 1,
                "reason": "Sự cố kiểm thử",
            },
        ),
        200,
        "teacher reports breakage",
    )
    conn = sqlite3.connect(db_path)
    breakage_id = conn.execute(
        "SELECT id FROM breakage_reports WHERE session_id=? ORDER BY id DESC LIMIT 1",
        (session_id,),
    ).fetchone()[0]
    conn.close()
    expect(
        manager.post(
            f"/api/breakages/{breakage_id}/resolve",
            headers=manager_headers,
            json={},
        ),
        200,
        "manager resolves breakage",
    )
    expect(
        manager.post(
            f"/api/breakages/{breakage_id}/resolve",
            headers=manager_headers,
            json={},
        ),
        409,
        "repeat breakage resolution is rejected",
    )
    conn = sqlite3.connect(db_path)
    after_qty = conn.execute(
        "SELECT total_qty,available_qty FROM equipment WHERE id=?",
        (equipment_rows[0]["id"],),
    ).fetchone()
    assert after_qty[0] == before_qty["total_qty"] - 1
    assert after_qty[1] == before_qty["available_qty"] - 1
    assert after_qty[0] >= 0 and after_qty[1] >= 0
    conn.close()

    history = expect(
        manager.get("/api/stats/teachers-summary", headers=manager_headers),
        200,
        "usage history",
    ).get_json()
    assert any(item["id"] == session_id for item in history)

    export_paths = [
        "/api/export/sessions-excel",
        "/api/export/equipment-excel",
        "/api/export/breakages-excel",
        "/api/export/teachers-summary-excel",
    ]
    for export_path in export_paths:
        response = expect(
            manager.get(export_path, headers=manager_headers),
            200,
            f"Excel export {export_path}",
        )
        assert response.content_type.startswith("application/vnd.ms-excel")
        ET.fromstring(response.data)

    equipment_xml = manager.get(
        "/api/export/equipment-excel", headers=manager_headers
    ).data.decode("utf-8")
    assert "Phân khu 5S" not in equipment_xml
    assert "Tổng SL đã dùng" not in equipment_xml
    assert "Số lượt mượn" in equipment_xml

    breakages_xml = manager.get(
        "/api/export/breakages-excel", headers=manager_headers
    ).data.decode("utf-8")
    for heading in ("Tiết học", "Tên bài học", "Giáo viên", "Địa điểm"):
        assert heading in breakages_xml
    assert TEST_TITLE in breakages_xml

    expect(manager.get("/api/not-found", headers=manager_headers), 404, "unknown API")
    expect(teacher.post("/api/auth/logout", headers=teacher_headers), 200, "logout")
    expect(teacher.get("/api/equipment", headers=teacher_headers), 401,
           "revoked session is rejected")
    print("PASS: complete Flask/WSGI teacher-manager workflow")
    print("PASS: SQLite login persistence, hashed token, and logout revocation")
    print(f"PASS: session={session_id}, borrow_events=2, breakage={breakage_id}")
    print("PASS: 4 Excel exports are valid XML workbooks")


if __name__ == "__main__":
    main()
