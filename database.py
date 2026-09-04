"""
BioLab Manager - Database Layer (Trường THPT Chuyên)
Quản lý cơ sở dữ liệu SQLite cho Hệ thống Quản trị Phòng thí nghiệm Sinh học
"""

import sqlite3
import hashlib
import json
import os
from datetime import datetime

DB_FILE = os.environ.get(
    "BIOLAB_DB_FILE",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "biolab.db"),
)

def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()

def init_db(force_reset=False):
    if force_reset and os.path.exists(DB_FILE):
        try:
            os.remove(DB_FILE)
            print("[INFO] Da xoa co so du lieu cu de nap du lieu that.")
        except Exception as e:
            print("[WARN] Khong the xoa file db:", e)

    conn = get_db()
    cursor = conn.cursor()

    # 1. Bảng Users (Cán bộ quản lý và Giáo viên)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL, -- 'LAB_MANAGER', 'TEACHER'
        class_name TEXT,    -- '10 Toán', '11 Sinh', '12 Hóa'...
        phone TEXT,
        must_change_password INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # Phiên đăng nhập được lưu trong SQLite để vẫn còn hiệu lực khi WSGI reload.
    # Chỉ lưu SHA-256 của token; token gốc chỉ được gửi cho trình duyệt một lần.
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    """)
    cursor.execute("""
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id
    ON auth_sessions(user_id)
    """)
    cursor.execute("""
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at
    ON auth_sessions(expires_at)
    """)

    # 2. Bảng Equipment ( A, B, C, D, E)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS equipment (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        zone TEXT NOT NULL,          -- 'ZONE_A', 'ZONE_B', 'ZONE_C', 'ZONE_D', 'ZONE_E'
        category TEXT NOT NULL,      -- 'Đo lường', 'Thủy tinh', 'Hóa chất', 'Kit thí nghiệm', 'Học liệu'
        total_qty INTEGER NOT NULL DEFAULT 1,
        available_qty INTEGER NOT NULL DEFAULT 1,
        unit TEXT NOT NULL DEFAULT 'Cái', -- 'Cái', 'Bộ', 'Hộp', 'Ống', 'ml', 'kg'
        grade_level INTEGER,         -- 10, 11, 12 hoặc NULL (dùng chung)
        status TEXT DEFAULT 'GOOD',  -- 'GOOD', 'DAMAGED', 'MAINTENANCE'
        notes TEXT,
        usage_scope TEXT DEFAULT 'BOTH', -- 'LAB_ONLY', 'CLASS_ONLY', 'BOTH'
        stock_type TEXT DEFAULT 'REUSABLE', -- 'REUSABLE', 'CONSUMABLE'
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # 3. Bảng Lab Sessions (Ca thực hành)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS lab_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        grade_level INTEGER NOT NULL,
        class_name TEXT NOT NULL,
        teacher_id INTEGER NOT NULL,
        session_date TEXT NOT NULL, -- YYYY-MM-DD
        period_slot TEXT NOT NULL,  -- 'Tiết 1-2', 'Tiết 3-4', 'Tiết 5-6', 'Ca chiều'
        status TEXT DEFAULT 'PENDING', -- 'PENDING', 'IN_PROGRESS', 'SUBMITTED', 'COMPLETED', 'CANCELLED'
        planned_items TEXT,         -- JSON mảng các thiết bị GV dự kiến sử dụng
        started_at TIMESTAMP,
        asset_approved_at TIMESTAMP,
        asset_approved_by INTEGER,
        completed_at TIMESTAMP,
        shift TEXT DEFAULT 'MORNING',
        period_start INTEGER DEFAULT 1,
        period_end INTEGER DEFAULT 1,
        student_count INTEGER DEFAULT 0,
        requested_location TEXT DEFAULT 'LAB',
        approved_location TEXT,
        approval_note TEXT,
        approved_at TIMESTAMP,
        approved_by INTEGER,
        request_notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (teacher_id) REFERENCES users(id),
        FOREIGN KEY (asset_approved_by) REFERENCES users(id)
    )
    """)

    # 4. Bảng Session Borrow Items (Dụng cụ từng Nhóm tự lấy tại phân khu)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS session_borrow_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        group_number INTEGER NOT NULL, -- 1 đến 4
        equipment_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        condition_note TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES lab_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (equipment_id) REFERENCES equipment(id)
    )
    """)

    # Mỗi thiết bị trong một phiếu đã duyệt chỉ được tính là một lượt mượn.
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS equipment_borrow_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        equipment_id INTEGER NOT NULL,
        approved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES lab_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (equipment_id) REFERENCES equipment(id),
        UNIQUE(session_id, equipment_id)
    )
    """)

    # 5. Bảng Group Submissions (Sổ tay ảnh + Check-list 5S + Nhận xét chấm điểm)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS group_submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        group_number INTEGER NOT NULL,
        result_images TEXT,          -- JSON mảng các URL ảnh hoặc data-url
        experiment_note TEXT,
        status TEXT DEFAULT 'IN_PROGRESS', -- 'IN_PROGRESS', 'SUBMITTED', 'REVIEWED'
        s1_seiri_done INTEGER DEFAULT 0,
        s2_seiton_done INTEGER DEFAULT 0,
        s3_seiso_done INTEGER DEFAULT 0,
        s4_seiketsu_done INTEGER DEFAULT 0,
        s5_shitsuke_done INTEGER DEFAULT 0,
        bench_photo_url TEXT,
        zone_photo_url TEXT,
        teacher_score REAL,
        teacher_rating TEXT,         -- 'Xuất sắc', 'Đạt', 'Cần rút kinh nghiệm'
        teacher_comment TEXT,
        teacher_5s_approved INTEGER DEFAULT 0,
        submitted_at TIMESTAMP,
        reviewed_at TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES lab_sessions(id) ON DELETE CASCADE,
        UNIQUE(session_id, group_number)
    )
    """)

    # Lightweight migrations for databases created by earlier versions.
    def add_column_if_missing(table, column, definition):
        columns = {row[1] for row in cursor.execute(f"PRAGMA table_info({table})")}
        if column not in columns:
            cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

    add_column_if_missing("lab_sessions", "started_at", "TIMESTAMP")
    add_column_if_missing("lab_sessions", "asset_approved_at", "TIMESTAMP")
    add_column_if_missing("lab_sessions", "asset_approved_by", "INTEGER")
    add_column_if_missing("lab_sessions", "completed_at", "TIMESTAMP")
    add_column_if_missing("group_submissions", "status", "TEXT DEFAULT 'IN_PROGRESS'")
    add_column_if_missing("users", "must_change_password", "INTEGER DEFAULT 1")
    user_columns = {row[1] for row in cursor.execute("PRAGMA table_info(users)")}
    for obsolete_column in ("failed_login_attempts", "locked_until"):
        if obsolete_column in user_columns:
            cursor.execute(f"ALTER TABLE users DROP COLUMN {obsolete_column}")
    add_column_if_missing("equipment", "usage_scope", "TEXT DEFAULT 'BOTH'")
    add_column_if_missing("equipment", "stock_type", "TEXT DEFAULT 'REUSABLE'")
    add_column_if_missing("lab_sessions", "shift", "TEXT DEFAULT 'MORNING'")
    add_column_if_missing("lab_sessions", "period_start", "INTEGER DEFAULT 1")
    add_column_if_missing("lab_sessions", "period_end", "INTEGER DEFAULT 1")
    add_column_if_missing("lab_sessions", "student_count", "INTEGER DEFAULT 0")
    add_column_if_missing("lab_sessions", "requested_location", "TEXT DEFAULT 'LAB'")
    add_column_if_missing("lab_sessions", "approved_location", "TEXT")
    add_column_if_missing("lab_sessions", "approval_note", "TEXT")
    add_column_if_missing("lab_sessions", "approved_at", "TIMESTAMP")
    add_column_if_missing("lab_sessions", "approved_by", "INTEGER")
    add_column_if_missing("lab_sessions", "request_notes", "TEXT")

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS classes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        grade_level INTEGER NOT NULL,
        active INTEGER DEFAULT 1
    )
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS lesson_catalog (
        id INTEGER PRIMARY KEY,
        class_type TEXT NOT NULL,
        grade_level INTEGER NOT NULL,
        curriculum_period TEXT NOT NULL,
        title TEXT NOT NULL,
        activity TEXT,
        suggested_equipment TEXT DEFAULT '[]',
        UNIQUE(class_type, curriculum_period, title)
    )
    """)
    add_column_if_missing("lab_sessions", "lesson_catalog_id", "INTEGER")
    add_column_if_missing("lab_sessions", "curriculum_period", "TEXT")
    add_column_if_missing("lab_sessions", "lesson_activity", "TEXT")
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS academic_terms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        school_year TEXT NOT NULL,
        semester TEXT NOT NULL,
        start_date TEXT,
        end_date TEXT,
        active INTEGER DEFAULT 0,
        UNIQUE(school_year, semester)
    )
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS lab_manager_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        manager_name TEXT NOT NULL,
        school_year TEXT NOT NULL,
        semester TEXT NOT NULL,
        start_date TEXT,
        end_date TEXT,
        decision_number TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS session_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER UNIQUE NOT NULL,
        status TEXT DEFAULT 'DRAFT',
        usage_items TEXT DEFAULT '[]',
        damage_items TEXT DEFAULT '[]',
        notes TEXT,
        s1_done INTEGER DEFAULT 0,
        s2_done INTEGER DEFAULT 0,
        s3_done INTEGER DEFAULT 0,
        s4_done INTEGER DEFAULT 0,
        s5_done INTEGER DEFAULT 0,
        submitted_at TIMESTAMP,
        review_note TEXT,
        reviewed_at TIMESTAMP,
        inventory_applied_at TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES lab_sessions(id) ON DELETE CASCADE
    )
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS inventory_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        equipment_id INTEGER NOT NULL,
        transaction_type TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        note TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(session_id, equipment_id, transaction_type)
    )
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT NOT NULL,
        entity_type TEXT,
        entity_id INTEGER,
        detail TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    class_names = ['10 Toán','10 Hóa','10 Sinh','10 Ghép','11 Toán','11 Hóa','11 Sinh','11 Chuyên đề','11 Ghép','12 Toán','12 Hóa','12 Sinh','12 Chuyên đề','12 Ghép']
    cursor.executemany(
        "INSERT OR IGNORE INTO classes(name, grade_level) VALUES (?, ?)",
        [(name, int(name[:2])) for name in class_names]
    )
    cursor.execute("INSERT OR IGNORE INTO academic_terms(school_year, semester, active) VALUES ('2026-2027', 'Học kỳ 1', 1)")

    catalog_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lesson_catalog.json")
    if os.path.exists(catalog_path):
        with open(catalog_path, "r", encoding="utf-8") as catalog_file:
            catalog_rows = json.load(catalog_file)
        cursor.execute("DELETE FROM lesson_catalog")
        cursor.executemany("""
            INSERT INTO lesson_catalog(id, class_type, grade_level, curriculum_period, title, activity, suggested_equipment)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                class_type=excluded.class_type,
                grade_level=excluded.grade_level,
                curriculum_period=excluded.curriculum_period,
                title=excluded.title,
                activity=excluded.activity,
                suggested_equipment=excluded.suggested_equipment
        """, [(
            row["id"], row["class_type"], int(row.get("grade_level") or str(row["class_type"])[:2]),
            row["curriculum_period"], row["title"], row.get("activity", ""),
            json.dumps(row.get("suggested_equipment", []), ensure_ascii=False)
        ) for row in catalog_rows])

    # Normalize legacy lifecycle values without destroying existing data.
    cursor.execute("UPDATE lab_sessions SET status = 'PENDING' WHERE status = 'SCHEDULED'")
    cursor.execute("""
        UPDATE lab_sessions
        SET teacher_id = (SELECT id FROM users WHERE role = 'TEACHER' ORDER BY id LIMIT 1)
        WHERE NOT EXISTS (SELECT 1 FROM users WHERE users.id = lab_sessions.teacher_id)
    """)

    # Remove legacy class accounts and normalize official staff logins.
    cursor.execute("DELETE FROM users WHERE role = 'CLASS_ACCOUNT'")
    official_accounts = [
        ('gvphutrach', 'Cán bộ phụ trách phòng thực hành', 'LAB_MANAGER', 'admin'),
        ('dthtra', 'Đỗ Thị Hương Trà', 'TEACHER', 'gv_huongtra'),
        ('lhtham', 'Lục Hồng Thắm', 'TEACHER', 'gv_hongtham'),
        ('ctbngoc', 'Chu Thị Bích Ngọc', 'TEACHER', 'gv_bichngoc'),
        ('dhson', 'Đoàn Hồng Sơn', 'TEACHER', 'gv_hongson'),
        ('mtktuyen', 'Mã Thị Kim Tuyến', 'TEACHER', 'gv_kimtuyen'),
    ]
    for username, full_name, role, legacy_username in official_accounts:
        cursor.execute("""
            UPDATE users SET username = ?, full_name = ?, role = ?
            WHERE username = ?
        """, (username, full_name, role, legacy_username))
    cursor.execute("""
        UPDATE group_submissions
        SET status = CASE
            WHEN reviewed_at IS NOT NULL THEN 'REVIEWED'
            WHEN submitted_at IS NOT NULL THEN 'SUBMITTED'
            ELSE 'IN_PROGRESS'
        END
        WHERE status IS NULL OR status NOT IN ('IN_PROGRESS', 'SUBMITTED', 'REVIEWED')
    """)

    # Đồng bộ các phiếu đã duyệt trước khi bảng đếm lượt mượn được bổ sung.
    approved_sessions = cursor.execute("""
        SELECT id, planned_items FROM lab_sessions
        WHERE status IN ('APPROVED_LAB','APPROVED_CLASS','IN_PROGRESS',
                         'PENDING_ACCEPTANCE','REDO_5S','COMPLETED')
    """).fetchall()
    for approved_session in approved_sessions:
        try:
            planned_items = json.loads(approved_session["planned_items"] or "[]")
        except (TypeError, json.JSONDecodeError):
            planned_items = []
        codes = {
            item if isinstance(item, str) else item.get("code")
            for item in planned_items
            if (isinstance(item, str) and item) or (isinstance(item, dict) and item.get("code"))
        }
        for code in codes:
            equipment = cursor.execute("SELECT id FROM equipment WHERE code = ?", (code,)).fetchone()
            if equipment:
                cursor.execute("""
                    INSERT OR IGNORE INTO equipment_borrow_events(session_id, equipment_id)
                    VALUES (?, ?)
                """, (approved_session["id"], equipment["id"]))

    # 6. Bảng Breakage Reports (thiết bị hỏng/vỡ chờ cán bộ xác nhận)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS breakage_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        equipment_id INTEGER NOT NULL,
        group_number INTEGER,
        quantity INTEGER NOT NULL DEFAULT 1,
        reason TEXT NOT NULL,
        is_resolved INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES lab_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (equipment_id) REFERENCES equipment(id)
    )
    """)
    breakage_columns = {row[1] for row in cursor.execute("PRAGMA table_info(breakage_reports)")}
    if "cost_estimate" in breakage_columns:
        cursor.execute("ALTER TABLE breakage_reports DROP COLUMN cost_estimate")

    # 7. Bảng Notifications (Thông báo Real-time)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        type TEXT NOT NULL, -- 'SESSION_REGISTERED', '5S_SUBMITTED', 'BREAKAGE_ALERT'
        is_read INTEGER DEFAULT 0,
        target_role TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    conn.commit()
    conn.close()

def seed_real_data():
    conn = get_db()
    cursor = conn.cursor()

    # Seed only a brand-new database. Never erase operational records on restart.
    if cursor.execute("SELECT COUNT(*) FROM users").fetchone()[0] > 0:
        conn.close()
        return

    # Xóa sạch dữ liệu cũ để nạp dữ liệu thật mới
    cursor.execute("DELETE FROM group_submissions")
    cursor.execute("DELETE FROM session_borrow_items")
    cursor.execute("DELETE FROM breakage_reports")
    cursor.execute("DELETE FROM lab_sessions")
    cursor.execute("DELETE FROM notifications")
    cursor.execute("DELETE FROM equipment")
    cursor.execute("DELETE FROM users")

    print("[INFO] Dang nap du lieu that cua Truong THPT Chuyen...")

    # 1. NẠP TÀI KHOẢN CÁN BỘ & GIÁO VIÊN BỘ MÔN (5 GV + 1 Admin)
    bootstrap_passwords = {
        username: os.environ.get(f"BIOLAB_INITIAL_PASSWORD_{username.upper()}")
        for username in ('gvphutrach', 'dthtra', 'lhtham', 'ctbngoc', 'dhson', 'mtktuyen')
    }
    missing_passwords = [name for name, password in bootstrap_passwords.items() if not password]
    if missing_passwords:
        conn.close()
        raise RuntimeError(
            "Database moi chua co tai khoan. Hay dat bien moi truong BIOLAB_INITIAL_PASSWORD_* "
            "cho: " + ", ".join(missing_passwords)
        )

    teachers_data = [
        # Cán bộ quản lý phòng TH (Admin)
        ("gvphutrach", hash_password(bootstrap_passwords["gvphutrach"]), "Cán bộ phụ trách phòng thực hành", "LAB_MANAGER", None, "0901234567"),
        
        # 5 Giáo viên Bộ môn Sinh học
        ("dthtra", hash_password(bootstrap_passwords["dthtra"]), "Đỗ Thị Hương Trà", "TEACHER", None, "0912345671"),
        ("lhtham", hash_password(bootstrap_passwords["lhtham"]), "Lục Hồng Thắm", "TEACHER", None, "0912345672"),
        ("ctbngoc", hash_password(bootstrap_passwords["ctbngoc"]), "Chu Thị Bích Ngọc", "TEACHER", None, "0912345673"),
        ("dhson", hash_password(bootstrap_passwords["dhson"]), "Đoàn Hồng Sơn", "TEACHER", None, "0912345674"),
        ("mtktuyen", hash_password(bootstrap_passwords["mtktuyen"]), "Mã Thị Kim Tuyến", "TEACHER", None, "0912345675"),
    ]
    cursor.executemany("""
    INSERT INTO users (username, password_hash, full_name, role, class_name, phone)
    VALUES (?, ?, ?, ?, ?, ?)
    """, teachers_data)

    # 2. NẠP TOÀN BỘ DANH MỤC THIẾT BỊ (A, B, C, D, E)
    equipment_data = [
        # PHÂN KHU A: Thiết bị điện tử & Cảm biến đo lường
        ("KHV-01", "Kính hiển vi quang học 2 mắt", "ZONE_A", "Thiết bị quan sát", 7, 7, "Cái", None, "GOOD", "Độ phóng đại 40x-1000x"),
        ("CAN-01", "Cân kỹ thuật điện tử (0.01g)", "ZONE_A", "Thiết bị đo lường", 2, 2, "Cái", None, "GOOD", "Kèm lồng kính chắn gió"),
        ("CB-PH", "Cảm biến đo độ pH kỹ thuật số", "ZONE_A", "Cảm biến", 7, 7, "Cái", None, "GOOD", "Kèm dung dịch bảo quản điện cực"),
        ("CB-AM", "Cảm biến độ ẩm", "ZONE_A", "Cảm biến", 7, 7, "Cái", None, "GOOD", "Đo độ ẩm đất/không khí"),
        ("DAT-01", "Bộ thu nhận số liệu cảm biến", "ZONE_A", "Thiết bị đo lường", 1, 1, "Bộ", None, "GOOD", "Kết nối máy tính phòng lab"),
        ("HLD-01", "Bộ học liệu điện tử hỗ trợ giáo viên", "ZONE_A", "Học liệu số", 1, 1, "Bộ", None, "GOOD", "Phần mềm mô phỏng sinh học"),
        ("MCN-01", "Máy cắt nước cất 1 lần", "ZONE_A", "Thiết bị hệ thống", 1, 1, "Bộ", None, "GOOD", "Đang kết nối hệ thống nước"),
        ("THUT-01", "Tủ hút khí độc chuyên dụng", "ZONE_A", "Thiết bị hệ thống", 1, 1, "Cái", None, "GOOD", "Tủ xử lý bay hơi hóa chất"),
        ("TBQ-KHV", "Tủ bảo quản kính hiển vi chống ẩm", "ZONE_A", "Thiết bị bảo quản", 1, 1, "Cái", None, "GOOD", "Tủ kính có sấy nhiệt"),
        ("TBQ-HC", "Tủ bảo quản hóa chất có khóa an toàn", "ZONE_A", "Thiết bị bảo quản", 1, 1, "Cái", None, "GOOD", "Chống cháy nổ"),

        # PHÂN KHU B: Dụng cụ thủy tinh, Thao tác & Vật tư vệ sinh
        ("ON-01", "Ống nghiệm thủy tinh chịu nhiệt", "ZONE_B", "Thủy tinh", 50, 50, "Ống", None, "GOOD", "Kích thước 15x150mm"),
        ("GON-01", "Giá cắm để ống nghiệm bằng gỗ/nhựa", "ZONE_B", "Dụng cụ chứa", 10, 10, "Cái", None, "GOOD", "10 lỗ cắm"),
        ("COC-250", "Cốc thủy tinh chia vạch 250ml", "ZONE_B", "Thủy tinh", 7, 7, "Cái", None, "GOOD", "Chịu nhiệt Borosilicate"),
        ("PETRI-01", "Đĩa Petri thủy tinh có nắp", "ZONE_B", "Thủy tinh", 7, 7, "Cái", None, "GOOD", "Đường kính 90mm"),
        ("DONGHO-01", "Đĩa đồng hồ thủy tinh", "ZONE_B", "Thủy tinh", 7, 7, "Cái", None, "GOOD", "Đựng mẫu vật"),
        ("COI-01", "Cối và chày sứ thí nghiệm", "ZONE_B", "Thao tác", 3, 3, "Bộ", None, "GOOD", "Nghiền mẫu mô thực vật"),
        ("LO-NHOGIOT", "Lọ thủy tinh kèm ống nhỏ giọt", "ZONE_B", "Thủy tinh", 7, 7, "Cái", None, "GOOD", "Dung tích 30ml"),
        ("LO-NHAM", "Lọ thủy tinh có nút nhám kín", "ZONE_B", "Thủy tinh", 7, 7, "Cái", None, "GOOD", "Bảo quản dung dịch"),
        ("BINH-TIA", "Bình tia nước cất bằng nhựa", "ZONE_B", "Dụng cụ rửa", 5, 5, "Cái", None, "GOOD", "Dung tích 500ml"),
        ("DEN-CON", "Đèn cồn thí nghiệm bằng thủy tinh", "ZONE_B", "Gia nhiệt", 7, 7, "Cái", None, "GOOD", "Kèm bấc đèn"),
        ("DOMO-01", "Bộ đồ mổ sinh học cao cấp", "ZONE_B", "Dụng cụ mổ", 7, 7, "Bộ", None, "GOOD", "Kéo, kim nhọn, kẹp cong"),
        ("DAO-CB", "Dao cắt tiêu bản vi phẫu", "ZONE_B", "Thao tác", 7, 7, "Cái", None, "GOOD", "Lưỡi bén"),
        ("KIM-MAC", "Kim mũi mác kim loại", "ZONE_B", "Thao tác", 2, 2, "Cái", None, "GOOD", "Tách mẫu vi mô"),
        ("PANH-01", "Panh kẹp gắp y tế thẳng", "ZONE_B", "Thao tác", 2, 2, "Cái", None, "GOOD", "Thép không gỉ"),
        ("KEP-ON", "Kẹp ống nghiệm bằng gỗ", "ZONE_B", "Thao tác", 7, 7, "Cái", None, "GOOD", "Kẹp ống khi đun"),
        ("LAM-01", "Hộp Lam kính (Slide tiêu bản)", "ZONE_B", "Vật tư tiêu hao", 7, 7, "Hộp", None, "GOOD", "Hộp 72 miếng"),
        ("LAMEN-01", "Hộp Lamen (Lá kính đậy tiêu bản)", "ZONE_B", "Vật tư tiêu hao", 3, 3, "Hộp", None, "GOOD", "Hộp 100 miếng 18x18mm"),
        ("PIPET-TT", "Ống hút nhỏ giọt Pipet thủy tinh", "ZONE_B", "Thao tác", 7, 7, "Cái", None, "GOOD", "Chia vạch"),
        ("PIPET-N", "Pipet nhựa Pasteur dùng 1 lần (3ml)", "ZONE_B", "Vật tư tiêu hao", 15, 15, "Cái", None, "GOOD", "Chia vạch 3ml"),
        ("QUA-BOP", "Quả bóp cao su cho Pipet", "ZONE_B", "Thao tác", 7, 7, "Cái", None, "GOOD", "Màu đỏ"),
        ("DUA-TT", "Đũa thủy tinh khuấy dung dịch", "ZONE_B", "Thao tác", 12, 12, "Cái", None, "GOOD", "Dài 20cm"),
        ("BUT-KINH", "Bút dạ viết kính chuyên dụng", "ZONE_B", "Đánh dấu", 7, 7, "Cái", None, "GOOD", "Không phai nước"),
        ("CHOI-RUA", "Chổi lông rửa ống nghiệm", "ZONE_B", "Vệ sinh", 3, 3, "Cái", None, "GOOD", "Đầu chổi mềm"),
        ("GIAY-THAM", "Cuộn giấy thấm phòng thí nghiệm", "ZONE_B", "Vệ sinh", 7, 7, "Cuộn", None, "GOOD", "Thấm hút nhanh"),
        ("GANG-TAY", "Hộp găng tay cao su y tế", "ZONE_B", "Bảo hộ", 2, 2, "Hộp", None, "GOOD", "Hộp 100 chiếc (Size M)"),

        # PHÂN KHU C: Hóa chất & Dung dịch thực hành
        ("HC-ETH96", "Cồn tuyệt đối Ethanol 96°", "ZONE_C", "Hóa chất chung", 10, 10, "Chai", None, "GOOD", "Chai 100ml"),
        ("HC-NACL", "Dung dịch muối sinh lý NaCl 0.65%", "ZONE_C", "Dung dịch chung", 5, 5, "Chai", None, "GOOD", "Chai 500ml"),
        ("HC-DD", "Bộ dung dịch dinh dưỡng khoáng Knop", "ZONE_C", "Dung dịch chung", 1, 1, "Bộ", None, "GOOD", "Nuôi cấy thủy canh"),
        ("HC-PB", "Phân bón hóa học NPK thí nghiệm", "ZONE_C", "Hóa chất chung", 15, 15, "kg", None, "GOOD", "Túi 1kg"),
        ("HC-K10-TP", "Bộ hóa chất xác định thành phần hóa học tế bào", "ZONE_C", "Hóa chất Khối 10", 7, 7, "Bộ", 10, "GOOD", "Thuốc thử Lugol, Benedict, Biuret"),
        ("HC-K10-TB", "Bộ hóa chất làm tiêu bản, quan sát cấu trúc tế bào", "ZONE_C", "Hóa chất Khối 10", 7, 7, "Bộ", 10, "GOOD", "Xanh Methylene, Axit Axetic"),
        ("HC-K10-EZ", "Bộ hóa chất xác định ảnh hưởng đến hoạt tính enzyme", "ZONE_C", "Hóa chất Khối 10", 7, 7, "Bộ", 10, "GOOD", "Amylase, cơ chất tinh bột"),
        ("HC-K10-NST", "Bộ hóa chất nhuộm NST (Nguyên phân & Giảm phân)", "ZONE_C", "Hóa chất Khối 10", 7, 7, "Bộ", 10, "GOOD", "Phẩm nhuộm Giemsa, Acetocarmine"),
        ("HC-K10-VSV", "Bộ hóa chất thực hành vi sinh vật", "ZONE_C", "Hóa chất Khối 10", 7, 7, "Bộ", 10, "GOOD", "Môi trường thạch đĩa Agar"),
        ("HC-K11-ST", "Bộ hóa chất tách chiết sắc tố & quang hợp", "ZONE_C", "Hóa chất Khối 11", 7, 7, "Bộ", 11, "GOOD", "Acetone, Cồn, Benzen"),
        ("HC-K12-DNA", "Bộ hóa chất tách chiết DNA mẫu mô thực vật", "ZONE_C", "Hóa chất Khối 12", 7, 7, "Bộ", 12, "GOOD", "Nước rửa chén, Muối, Cồn lạnh"),

        # PHÂN KHU D: Bộ thí nghiệm chuyên đề & Mô hình học tập
        ("MH-TBDV", "Mô hình cấu tạo tế bào động vật 3D", "ZONE_D", "Mô hình", 5, 5, "Bộ", 10, "GOOD", "Hiển thị rõ nhân và bào quan"),
        ("MH-TBTV", "Mô hình cấu tạo tế bào thực vật 3D", "ZONE_D", "Mô hình", 5, 5, "Bộ", 10, "GOOD", "Có lục lạp và không bào lớn"),
        ("MH-TIM", "Mô hình giải phẫu tim người 3D", "ZONE_D", "Mô hình", 5, 5, "Bộ", 11, "GOOD", "Tách rời được 4 ngăn tim"),
        ("MH-DNA", "Mô hình xoắn kép cấu trúc phân tử DNA", "ZONE_D", "Mô hình", 5, 5, "Bộ", 12, "GOOD", "Cao 60cm xoay được"),
        ("KIT-K10-TP", "Bộ dụng cụ thực hành thành phần hóa học tế bào", "ZONE_D", "Kit Khối 10", 7, 7, "Bộ", 10, "GOOD", "7 bộ tương ứng các nhóm"),
        ("KIT-K10-TB", "Bộ thí nghiệm quan sát cấu trúc tế bào", "ZONE_D", "Kit Khối 10", 7, 7, "Bộ", 10, "GOOD", "Kèm mẫu tế bào củ hành"),
        ("KIT-K10-NP", "Bộ thí nghiệm làm tiêu bản nguyên phân - giảm phân", "ZONE_D", "Kit Khối 10", 7, 7, "Bộ", 10, "GOOD", "Mẫu rễ hành / tinh hoàn châu chấu"),
        ("KIT-K10-VSV", "Bộ thí nghiệm phương pháp nghiên cứu vi sinh vật", "ZONE_D", "Kit Khối 10", 7, 7, "Bộ", 10, "GOOD", "Que cấy, đèn cồn, đĩa petri"),
        ("KIT-K11-TC", "Bộ thiết bị khảo sát sinh trưởng khi trồng cây", "ZONE_D", "Kit Khối 11", 7, 7, "Bộ", 11, "GOOD", "Khay trồng và giá đo chiều cao"),
        ("KIT-K11-TN", "Bộ thiết bị định tính sự trao đổi nước ở thực vật", "ZONE_D", "Kit Khối 11", 7, 7, "Bộ", 11, "GOOD", "Ống đo thoát hơi nước"),
        ("KIT-K11-ST", "Bộ thiết bị quan sát lục lạp & tách chiết sắc tố lá", "ZONE_D", "Kit Khối 11", 7, 7, "Bộ", 11, "GOOD", "Phễu lọc, giấy sắc ký"),
        ("KIT-K11-O2", "Bộ thiết bị đo Oxygen trong quang hợp", "ZONE_D", "Kit Khối 11", 7, 7, "Bộ", 11, "GOOD", "Bình kín và cảm biến O2"),
        ("KIT-K11-HH", "Bộ thiết bị khảo sát hô hấp ở thực vật hạt nảy mầm", "ZONE_D", "Kit Khối 11", 7, 7, "Bộ", 11, "GOOD", "Nước vôi trong, nhiệt kế"),
        ("KIT-K11-TH", "Bộ thiết bị khảo sát chỉ số hệ tuần hoàn", "ZONE_D", "Kit Khối 11", 2, 2, "Bộ", 11, "GOOD", "Huyết áp kế và ống nghe"),
        ("KIT-K12-DNA", "Bộ thiết bị thí nghiệm tách chiết DNA tế bào", "ZONE_D", "Kit Khối 12", 7, 7, "Bộ", 12, "GOOD", "Khay đầy đủ dụng cụ"),
        ("KIT-K12-DB", "Bộ thiết bị làm tiêu bản quan sát đột biến NST", "ZONE_D", "Kit Khối 12", 7, 7, "Bộ", 12, "GOOD", "Tiêu bản cố định chuẩn"),
        ("KIT-K12-QT", "Bộ thiết bị khảo sát đặc trưng quần thể, quần xã", "ZONE_D", "Kit Khối 12", 7, 7, "Bộ", 12, "GOOD", "Khung lấy mẫu 1m2"),
        ("KIT-K12-MT", "Bộ thiết bị đo chỉ tiêu môi trường hệ sinh thái", "ZONE_D", "Kit Khối 12", 7, 7, "Bộ", 12, "GOOD", "Đo nhiệt độ, ánh sáng, pH đất"),

        # PHÂN KHU E: Học liệu số & Tranh ảnh lý thuyết
        ("TRANH-K10", "Bộ Tranh sơ đồ lý thuyết Sinh học Khối 10", "ZONE_E", "Tranh ảnh", 5, 5, "Bộ", 10, "GOOD", "Cấu trúc tế bào, phân bào, virus"),
        ("TRANH-K11", "Bộ Tranh sơ đồ sinh lý Thực vật & Động vật Khối 11", "ZONE_E", "Tranh ảnh", 5, 5, "Bộ", 11, "GOOD", "Tuần hoàn, hô hấp, quang hợp"),
        ("TRANH-K12", "Bộ Tranh cơ chế Di truyền & Tiến hóa Khối 12", "ZONE_E", "Tranh ảnh", 5, 5, "Bộ", 12, "GOOD", "Tái bản DNA, phiên mã, dịch mã"),
        ("VID-K10", "Thư viện Video bài giảng thực hành vi sinh & tế bào", "ZONE_E", "Video học liệu", 1, 1, "Bộ", 10, "GOOD", "Clip kỹ thuật chuẩn"),
        ("VID-K12", "Thư viện Video tách chiết DNA & đột biến nhiễm sắc thể", "ZONE_E", "Video học liệu", 1, 1, "Bộ", 12, "GOOD", "Mô phỏng 3D phân tử"),
    ]
    cursor.executemany("""
    INSERT INTO equipment (code, name, zone, category, total_qty, available_qty, unit, grade_level, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, equipment_data)

    # Hóa chất là vật tư tiêu hao và chỉ được sử dụng trong phòng thí nghiệm.
    # Thiết lập ngay trong dữ liệu khởi tạo để database mới có cùng quy tắc với
    # database đang vận hành.
    cursor.execute("""
        UPDATE equipment
        SET stock_type = 'CONSUMABLE', usage_scope = 'LAB_ONLY'
        WHERE code LIKE 'HC-%'
    """)

    # Thêm thông báo chào mừng
    cursor.execute("""
    INSERT INTO notifications (title, message, type, is_read, target_role)
    VALUES 
    ('Chào mừng năm học mới', 'Hệ thống Quản trị Phòng Thực hành Sinh học đã sẵn sàng phục vụ 14 lớp Chuyên và các Thầy/Cô bộ môn.', 'SESSION_REGISTERED', 0, 'LAB_MANAGER')
    """)

    conn.commit()
    conn.close()
    print("[SUCCESS] Da nap thanh cong toan bo 14 lop Chuyen, 5 Giao vien va 48 thiet bi!")

if __name__ == "__main__":
    init_db()
    seed_real_data()
