"""
BioLab Manager - Web Server & REST API Engine
Chạy trực tiếp bằng Python chuẩn (không cần cài đặt thêm thư viện cồng kềnh)
Hỗ trợ đầy đủ REST API, Database SQLite, Giao diện SPA và Xuất file Excel chuẩn hóa
"""

import http.server
import socketserver
import json
import urllib.parse
import os
import mimetypes
import hashlib
import secrets
import re
import unicodedata
from datetime import datetime, timedelta

from database import get_db, init_db, seed_real_data, hash_password
from excel_exporter import export_sessions_schedule, export_equipment_usage, export_breakages_report, export_teacher_usage_summary

PORT = 8080
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
AUTH_SESSIONS = {}

def normalize_text(value):
    value = unicodedata.normalize('NFD', str(value or '').lower())
    value = ''.join(ch for ch in value if unicodedata.category(ch) != 'Mn')
    return re.sub(r'[^a-z0-9]+', ' ', value).strip()

class BioLabHTTPHandler(http.server.BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        # Avoid blocking the long-running desktop server on an unattended stdout pipe.
        return

    def current_user(self):
        auth = self.headers.get('Authorization', '')
        token = auth[7:] if auth.startswith('Bearer ') else ''
        session_auth = AUTH_SESSIONS.get(token)
        if not session_auth or session_auth['expires_at'] < datetime.now():
            AUTH_SESSIONS.pop(token, None)
            return None
        user_id = session_auth['user_id']
        conn = get_db()
        row = conn.execute(
            "SELECT id, username, full_name, role, class_name FROM users WHERE id = ?",
            (user_id,)
        ).fetchone()
        conn.close()
        return dict(row) if row else None

    def require_roles(self, *roles):
        user = self.current_user()
        if not user:
            self.send_json({"success": False, "error": "Bạn cần đăng nhập"}, status=401)
            return None
        if roles and user['role'] not in roles:
            self.send_json({"success": False, "error": "Bạn không có quyền thực hiện thao tác này"}, status=403)
            return None
        return user

    def can_access_session(self, user, session_id):
        conn = get_db()
        session = conn.execute("SELECT * FROM lab_sessions WHERE id = ?", (session_id,)).fetchone()
        conn.close()
        if not session:
            return False
        return (
            user['role'] == 'LAB_MANAGER' or
            (user['role'] == 'TEACHER' and session['teacher_id'] == user['id']) or
            (user['role'] == 'CLASS_ACCOUNT' and session['class_name'] == user['class_name'])
        )

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()
        self.wfile.write(body)

    def send_excel_file(self, content_xml: str, filename: str):
        body = content_xml.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/vnd.ms-excel; charset=utf-8')
        self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body_json(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                return {}
            body = self.rfile.read(content_length).decode('utf-8')
            return json.loads(body)
        except Exception as e:
            print("Error reading body json:", e)
            return {}

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    # ================= GET REQUESTS =================
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # 1. Trang chủ SPA
        if path == '/' or path == '/login' or path == '/student' or path == '/teacher' or path == '/admin':
            index_path = os.path.join(BASE_DIR, 'templates', 'index.html')
            if os.path.exists(index_path):
                with open(index_path, 'rb') as f:
                    content = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)
                return
            else:
                self.send_error(404, "Template not found")
                return

        if path.startswith('/api/'):
            user = self.require_roles('CLASS_ACCOUNT', 'TEACHER', 'LAB_MANAGER')
            if not user:
                return

        # 2. File tĩnh (CSS / JS / Images)
        if path.startswith('/static/'):
            rel_path = path[len('/static/'):]
            file_path = os.path.join(BASE_DIR, 'static', rel_path)
            if os.path.exists(file_path) and os.path.isfile(file_path):
                mime, _ = mimetypes.guess_type(file_path)
                with open(file_path, 'rb') as f:
                    content = f.read()
                self.send_response(200)
                self.send_header('Content-Type', mime or 'application/octet-stream')
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)
                return

        # 3. API Xuất File Excel
        if path == '/api/export/sessions-excel':
            if user['role'] != 'LAB_MANAGER':
                self.send_json({"success": False, "error": "Chỉ cán bộ quản lý được xuất báo cáo"}, status=403)
                return
            xml = export_sessions_schedule()
            self.send_excel_file(xml, "Lich_Su_Dung_Phong_Lab.xls")
            return
        if path == '/api/export/equipment-excel':
            if user['role'] != 'LAB_MANAGER':
                self.send_json({"success": False, "error": "Chỉ cán bộ quản lý được xuất báo cáo"}, status=403)
                return
            xml = export_equipment_usage()
            self.send_excel_file(xml, "Tong_Hop_Thiet_Bi_5_Phan_Khu.xls")
            return
        if path == '/api/export/breakages-excel':
            if user['role'] != 'LAB_MANAGER':
                self.send_json({"success": False, "error": "Chỉ cán bộ quản lý được xuất báo cáo"}, status=403)
                return
            xml = export_breakages_report()
            self.send_excel_file(xml, "Bao_Cao_Hong_Vo_Boi_Hoan.xls")
            return
        if path == '/api/export/teachers-summary-excel':
            if user['role'] != 'LAB_MANAGER':
                self.send_json({"success": False, "error": "Chỉ cán bộ quản lý được xuất báo cáo"}, status=403)
                return
            p_filter = query.get('period', ['YEAR'])[0]
            xml = export_teacher_usage_summary(p_filter)
            self.send_excel_file(xml, f"Tong_Ket_Giao_Vien_{p_filter}.xls")
            return

        # 3.1. API Thống kê Tổng kết Giáo viên (Tuần / Tháng / Năm)
        if path == '/api/stats/teachers-summary':
            if user['role'] != 'LAB_MANAGER':
                self.send_json({"success": False, "error": "Không có quyền xem thống kê này"}, status=403)
                return
            conn = get_db()
            cursor = conn.cursor()
            p_filter = query.get('period', ['YEAR'])[0].upper()
            date_condition = ""
            if p_filter == 'WEEK':
                date_condition = "AND date(s.session_date) >= date('now', '-6 days')"
            elif p_filter == 'MONTH':
                date_condition = "AND strftime('%Y-%m', s.session_date) = strftime('%Y-%m', 'now')"

            cursor.execute(f"""
            SELECT s.id, s.session_date, s.class_name, s.title,
                   s.period_start, s.period_end, s.status,
                   u.id AS teacher_id, u.full_name AS teacher_name
            FROM lab_sessions s
            JOIN users u ON u.id = s.teacher_id
            WHERE u.role = 'TEACHER'
              AND s.approved_location = 'LAB'
              AND s.status IN ('IN_PROGRESS','PENDING_ACCEPTANCE','REDO_5S','COMPLETED')
              {date_condition}
            ORDER BY u.full_name ASC, s.session_date ASC, s.period_start ASC
            """)
            lessons = [dict(r) for r in cursor.fetchall()]
            totals = {}
            for lesson in lessons:
                lesson['total_periods'] = max(1, (lesson['period_end'] or 1) - (lesson['period_start'] or 1) + 1)
                totals.setdefault(lesson['teacher_id'], {'total_lessons': 0, 'total_periods': 0})
                totals[lesson['teacher_id']]['total_lessons'] += 1
                totals[lesson['teacher_id']]['total_periods'] += lesson['total_periods']
            for lesson in lessons:
                lesson.update(totals[lesson['teacher_id']])

            conn.close()
            self.send_json(lessons)
            return

        # 4. API Equipment
        if path == '/api/equipment':
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM equipment ORDER BY zone ASC, code ASC")
            rows = [dict(r) for r in cursor.fetchall()]
            conn.close()
            self.send_json(rows)
            return

        if path == '/api/classes':
            conn = get_db()
            rows = [dict(r) for r in conn.execute("SELECT * FROM classes WHERE active = 1 ORDER BY grade_level, name")]
            conn.close()
            self.send_json(rows)
            return

        if path == '/api/lesson-catalog':
            if user['role'] != 'TEACHER':
                self.send_json({"success": False, "error": "Chỉ giáo viên được xem danh mục bài dạy"}, status=403)
                return
            grade = int(query.get('grade', ['10'])[0])
            class_name = query.get('class_name', [''])[0]
            class_type = f"Khối {grade}"
            conn = get_db()
            lessons = [dict(row) for row in conn.execute("""
                SELECT id, class_type, grade_level, curriculum_period, title, activity, suggested_equipment
                FROM lesson_catalog WHERE grade_level = ? ORDER BY id
            """, (grade,))]
            equipment = [dict(row) for row in conn.execute("SELECT id, code, name, zone, unit, available_qty FROM equipment ORDER BY name")]
            conn.close()
            normalized_equipment = [(item, normalize_text(item['name'])) for item in equipment]
            for lesson in lessons:
                suggestions = json.loads(lesson.pop('suggested_equipment') or '[]')
                matched, unmatched = [], []
                used_codes = set()
                for suggestion in suggestions:
                    key = normalize_text(suggestion)
                    candidates = [(item, item_key) for item, item_key in normalized_equipment if item_key == key]
                    if not candidates:
                        candidates = [(item, item_key) for item, item_key in normalized_equipment if len(key) >= 5 and (key in item_key or item_key in key)]
                    if candidates:
                        item = min(candidates, key=lambda pair: abs(len(pair[1]) - len(key)))[0]
                        if item['code'] not in used_codes:
                            matched.append(item)
                            used_codes.add(item['code'])
                    else:
                        unmatched.append(suggestion)
                lesson['suggested_items'] = matched
                lesson['unmatched_suggestions'] = unmatched
            self.send_json({"class_type": class_type, "lessons": lessons})
            return

        if path.startswith('/api/sessions/') and path.endswith('/report'):
            session_id = int(path.split('/')[3])
            if not self.can_access_session(user, session_id):
                self.send_json({"success": False, "error": "Không có quyền xem báo cáo này"}, status=403)
                return
            conn = get_db()
            row = conn.execute("SELECT * FROM session_reports WHERE session_id = ?", (session_id,)).fetchone()
            conn.close()
            self.send_json(dict(row) if row else {})
            return

        # 5. API Sessions
        if path == '/api/sessions':
            conn = get_db()
            cursor = conn.cursor()
            sql = """
            SELECT s.*, u.full_name as teacher_name 
            FROM lab_sessions s
            JOIN users u ON s.teacher_id = u.id
            """
            params = []
            if user['role'] == 'CLASS_ACCOUNT':
                sql += " WHERE s.class_name = ?"
                params.append(user['class_name'])
            elif user['role'] == 'TEACHER':
                sql += " WHERE s.teacher_id = ?"
                params.append(user['id'])
            sql += " ORDER BY s.session_date DESC, s.id DESC"
            cursor.execute(sql, params)
            rows = [dict(r) for r in cursor.fetchall()]
            conn.close()
            self.send_json(rows)
            return

        # 6. API Session Submissions
        if path.startswith('/api/sessions/') and path.endswith('/submissions'):
            parts = path.split('/')
            session_id = int(parts[3])
            if not self.can_access_session(user, session_id):
                self.send_json({"success": False, "error": "Không có quyền xem ca học này"}, status=403)
                return
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM group_submissions WHERE session_id = ? ORDER BY group_number ASC", (session_id,))
            rows = [dict(r) for r in cursor.fetchall()]
            conn.close()
            self.send_json(rows)
            return

        # 7. API Single Submission query by session_id & group_number
        if path == '/api/submissions':
            s_id = query.get('session_id', [None])[0]
            g_num = query.get('group_number', [None])[0]
            if s_id and g_num:
                if not self.can_access_session(user, int(s_id)):
                    self.send_json({"success": False, "error": "Không có quyền xem bài nộp này"}, status=403)
                    return
                conn = get_db()
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM group_submissions WHERE session_id = ? AND group_number = ?", (int(s_id), int(g_num)))
                row = cursor.fetchone()
                conn.close()
                self.send_json(dict(row) if row else {})
                return

        # 8. API Breakages
        if path == '/api/breakages':
            if user['role'] != 'LAB_MANAGER':
                self.send_json({"success": False, "error": "Không có quyền xem báo cáo hỏng vỡ"}, status=403)
                return
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("""
            SELECT b.*, s.session_date, s.class_name, e.code as equipment_code, e.name as equipment_name, e.zone
            FROM breakage_reports b
            JOIN lab_sessions s ON b.session_id = s.id
            JOIN equipment e ON b.equipment_id = e.id
            ORDER BY b.id DESC
            """)
            rows = [dict(r) for r in cursor.fetchall()]
            conn.close()
            self.send_json(rows)
            return

        # 9. API Notifications
        if path == '/api/notifications':
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM notifications WHERE target_role IS NULL OR target_role = ? ORDER BY id DESC LIMIT 20",
                (user['role'],)
            )
            rows = [dict(r) for r in cursor.fetchall()]
            conn.close()
            self.send_json(rows)
            return

        self.send_error(404, "API endpoint not found")

    # ================= POST REQUESTS =================
    def do_POST(self):
        path = self.path
        body = self.read_body_json()

        # 1. Login
        if path == '/api/auth/login':
            username = body.get('username', '').strip()
            password = body.get('password', '').strip()
            pw_hash = hash_password(password)

            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT id, username, password_hash, full_name, role, class_name, phone, must_change_password, failed_login_attempts, locked_until FROM users WHERE username = ?", (username,))
            user = cursor.fetchone()
            if user and user['locked_until'] and datetime.fromisoformat(user['locked_until']) > datetime.now():
                conn.close()
                self.send_json({"success": False, "error": "Tài khoản tạm khóa do đăng nhập sai nhiều lần"}, status=429)
                return
            if user and user['password_hash'] == pw_hash:
                cursor.execute("UPDATE users SET failed_login_attempts=0, locked_until=NULL WHERE id=?", (user['id'],))
                conn.commit(); conn.close()
                token = secrets.token_urlsafe(32)
                AUTH_SESSIONS[token] = {'user_id': user['id'], 'expires_at': datetime.now() + timedelta(hours=8)}
                public_user = {k: user[k] for k in ('id','username','full_name','role','class_name','phone','must_change_password')}
                self.send_json({"success": True, "user": public_user, "token": token})
            else:
                if user:
                    attempts = user['failed_login_attempts'] + 1
                    locked_until = (datetime.now() + timedelta(minutes=15)).isoformat() if attempts >= 5 else None
                    cursor.execute("UPDATE users SET failed_login_attempts=?, locked_until=? WHERE id=?", (attempts, locked_until, user['id']))
                    conn.commit()
                conn.close()
                self.send_json({"success": False, "error": "Sai tên đăng nhập hoặc mật khẩu"}, status=401)
            return

        if path == '/api/auth/change-password':
            user = self.require_roles('TEACHER', 'LAB_MANAGER')
            if not user:
                return
            new_password = body.get('new_password', '')
            if len(new_password) < 8:
                self.send_json({"success": False, "error": "Mật khẩu mới phải có ít nhất 8 ký tự"}, status=400)
                return
            conn = get_db()
            conn.execute("UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?", (hash_password(new_password), user['id']))
            conn.execute("INSERT INTO audit_logs(user_id,action,entity_type,entity_id) VALUES (?,'CHANGE_PASSWORD','USER',?)", (user['id'], user['id']))
            conn.commit(); conn.close()
            self.send_json({"success": True})
            return

        # 2. Register Session (Teacher)
        if path == '/api/sessions':
            user = self.require_roles('TEACHER')
            if not user:
                return
            title = body.get('title')
            lesson_catalog_id = body.get('lesson_catalog_id')
            grade = body.get('grade_level', 10)
            class_name = body.get('class_name')
            session_date = body.get('session_date')
            period_slot = body.get('period_slot')
            shift = body.get('shift', 'MORNING')
            period_start = int(body.get('period_start', 1))
            period_end = int(body.get('period_end', period_start))
            student_count = int(body.get('student_count', 0))
            requested_location = body.get('requested_location', 'LAB')
            request_notes = body.get('request_notes', '')
            requested_items = body.get('planned_items', [])
            normalized_items = []
            for item in requested_items:
                if isinstance(item, str):
                    normalized_items.append({'code': item, 'quantity': 1})
                else:
                    normalized_items.append({'code': item.get('code'), 'quantity': int(item.get('quantity', 1))})
            planned_items = json.dumps(normalized_items, ensure_ascii=False)
            teacher_id = user['id']

            if shift not in ('MORNING', 'AFTERNOON') or period_start < 1 or period_end < period_start or (shift == 'MORNING' and period_end > 5) or (shift == 'AFTERNOON' and period_end > 2):
                self.send_json({"success": False, "error": "Khung tiết không hợp lệ"}, status=400)
                return

            conn = get_db()
            cursor = conn.cursor()
            valid_class = cursor.execute("SELECT 1 FROM classes WHERE name = ? AND active = 1", (class_name,)).fetchone()
            if not valid_class:
                conn.close()
                self.send_json({"success": False, "error": "Lớp không thuộc danh mục được phép"}, status=400)
                return
            curriculum_period = None
            lesson_activity = None
            if lesson_catalog_id:
                lesson = cursor.execute("SELECT * FROM lesson_catalog WHERE id = ?", (lesson_catalog_id,)).fetchone()
                if not lesson or lesson['grade_level'] != grade:
                    conn.close()
                    self.send_json({"success": False, "error": "Bài thực hành không phù hợp với lớp đã chọn"}, status=400)
                    return
                title = lesson['title']
                curriculum_period = lesson['curriculum_period']
                lesson_activity = lesson['activity']
            if not title:
                conn.close()
                self.send_json({"success": False, "error": "Vui lòng chọn bài thực hành"}, status=400)
                return
            for item in normalized_items:
                equipment = cursor.execute("SELECT * FROM equipment WHERE code = ?", (item['code'],)).fetchone()
                if not equipment or item['quantity'] < 1 or item['quantity'] > equipment['available_qty']:
                    conn.close()
                    self.send_json({"success": False, "error": f"Số lượng thiết bị không hợp lệ: {item['code']}"}, status=400)
                    return
            cursor.execute("""
            INSERT INTO lab_sessions (title, grade_level, class_name, teacher_id, session_date, period_slot,
                status, planned_items, shift, period_start, period_end, student_count, requested_location, request_notes,
                lesson_catalog_id, curriculum_period, lesson_activity)
            VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (title, grade, class_name, teacher_id, session_date, period_slot, planned_items,
                  shift, period_start, period_end, student_count, requested_location, request_notes,
                  lesson_catalog_id, curriculum_period, lesson_activity))
            session_id = cursor.lastrowid

            # Thêm thông báo
            cursor.execute("""
            INSERT INTO notifications (title, message, type, target_role)
            VALUES (?, ?, 'SESSION_REGISTERED', 'LAB_MANAGER')
            """, (
                f"Ca thực hành mới: Lớp {class_name}",
                f"Đã đăng ký ca: {title} vào {session_date} ({period_slot})"
            ))

            conn.commit()
            conn.close()
            self.send_json({"success": True, "session_id": session_id})
            return

        # 3. Student Self-Service Quick Check-in
        if path == '/api/borrow-items':
            user = self.require_roles('CLASS_ACCOUNT')
            if not user:
                return
            session_id = body.get('session_id')
            group_number = body.get('group_number')
            items = body.get('items', [])

            conn = get_db()
            cursor = conn.cursor()
            session = cursor.execute("SELECT * FROM lab_sessions WHERE id = ?", (session_id,)).fetchone()
            if not session or session['class_name'] != user['class_name']:
                conn.close()
                self.send_json({"success": False, "error": "Ca học không thuộc lớp của bạn"}, status=403)
                return
            if session['status'] not in ('PENDING', 'IN_PROGRESS'):
                conn.close()
                self.send_json({"success": False, "error": "Ca học không còn nhận thao tác"}, status=409)
                return
            cursor.execute("UPDATE lab_sessions SET status = 'IN_PROGRESS', started_at = COALESCE(started_at, CURRENT_TIMESTAMP) WHERE id = ?", (session_id,))
            # Xóa các item cũ của nhóm này trong ca nếu có
            cursor.execute("DELETE FROM session_borrow_items WHERE session_id = ? AND group_number = ?", (session_id, group_number))
            
            for it in items:
                cursor.execute("""
                INSERT INTO session_borrow_items (session_id, group_number, equipment_id, quantity)
                VALUES (?, ?, ?, ?)
                """, (session_id, group_number, it['equipment_id'], it['quantity']))

            conn.commit()
            conn.close()
            self.send_json({"success": True})
            return

        # 4. Save Student Experiment Note & Photos
        if path == '/api/submissions/note':
            user = self.require_roles('CLASS_ACCOUNT')
            if not user:
                return
            session_id = body.get('session_id')
            group_number = body.get('group_number')
            note = body.get('experiment_note', '')
            images = json.dumps(body.get('result_images', []))

            conn = get_db()
            cursor = conn.cursor()
            session = cursor.execute("SELECT * FROM lab_sessions WHERE id = ?", (session_id,)).fetchone()
            existing = cursor.execute("SELECT status FROM group_submissions WHERE session_id = ? AND group_number = ?", (session_id, group_number)).fetchone()
            if not session or session['class_name'] != user['class_name']:
                conn.close()
                self.send_json({"success": False, "error": "Ca học không thuộc lớp của bạn"}, status=403)
                return
            if session['status'] != 'IN_PROGRESS' or (existing and existing['status'] in ('SUBMITTED', 'REVIEWED')):
                conn.close()
                self.send_json({"success": False, "error": "Bài đã nộp hoặc ca học không cho phép chỉnh sửa"}, status=409)
                return
            cursor.execute("""
            INSERT INTO group_submissions (session_id, group_number, experiment_note, result_images, status)
            VALUES (?, ?, ?, ?, 'IN_PROGRESS')
            ON CONFLICT(session_id, group_number) DO UPDATE SET
                experiment_note = excluded.experiment_note,
                result_images = excluded.result_images
            """, (session_id, group_number, note, images))
            conn.commit()
            conn.close()
            self.send_json({"success": True})
            return

        # 5. Submit 5S Checklist & Photos (Student)
        if path in ('/api/submissions/5s', '/api/reports/submit'):
            user = self.require_roles('CLASS_ACCOUNT')
            if not user:
                return
            s_id = body.get('session_id')
            g_num = body.get('group_number')
            s1 = body.get('s1', 0)
            s2 = body.get('s2', 0)
            s3 = body.get('s3', 0)
            s4 = body.get('s4', 0)
            s5 = body.get('s5', 0)
            bench_photo = body.get('bench_photo_url')
            zone_photo = body.get('zone_photo_url')
            images = json.dumps(body.get('result_images', []))
            note = body.get('experiment_note', '')

            conn = get_db()
            cursor = conn.cursor()
            session = cursor.execute("SELECT * FROM lab_sessions WHERE id = ?", (s_id,)).fetchone()
            existing = cursor.execute("SELECT status FROM group_submissions WHERE session_id = ? AND group_number = ?", (s_id, g_num)).fetchone()
            if not session or session['class_name'] != user['class_name']:
                conn.close()
                self.send_json({"success": False, "error": "Ca học không thuộc lớp của bạn"}, status=403)
                return
            if session['status'] != 'IN_PROGRESS' or (existing and existing['status'] in ('SUBMITTED', 'REVIEWED')):
                conn.close()
                self.send_json({"success": False, "error": "Bài đã nộp và đang ở chế độ chỉ xem"}, status=409)
                return
            if not all((s1, s2, s3, s4, s5)) or not bench_photo or not zone_photo:
                conn.close()
                self.send_json({"success": False, "error": "Cần hoàn tất 5S và đủ hai ảnh minh chứng"}, status=400)
                return
            cursor.execute("""
            INSERT INTO group_submissions (
                session_id, group_number, s1_seiri_done, s2_seiton_done, s3_seiso_done, s4_seiketsu_done, s5_shitsuke_done,
                bench_photo_url, zone_photo_url, result_images, experiment_note, status, submitted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', CURRENT_TIMESTAMP)
            ON CONFLICT(session_id, group_number) DO UPDATE SET
                s1_seiri_done = excluded.s1_seiri_done,
                s2_seiton_done = excluded.s2_seiton_done,
                s3_seiso_done = excluded.s3_seiso_done,
                s4_seiketsu_done = excluded.s4_seiketsu_done,
                s5_shitsuke_done = excluded.s5_shitsuke_done,
                bench_photo_url = excluded.bench_photo_url,
                zone_photo_url = excluded.zone_photo_url,
                result_images = excluded.result_images,
                experiment_note = excluded.experiment_note,
                status = 'SUBMITTED',
                submitted_at = CURRENT_TIMESTAMP
            """, (s_id, g_num, s1, s2, s3, s4, s5, bench_photo, zone_photo, images, note))

            # Thông báo chuông cho GV và Cán bộ
            cursor.execute("""
            INSERT INTO notifications (title, message, type, target_role)
            VALUES (?, ?, '5S_SUBMITTED', 'TEACHER')
            """, (
                f"Nhóm {g_num} đã hoàn thành 5S",
                f"Đã nộp ảnh bàn học sạch sẽ và ảnh phân khu, sẵn sàng nghiệm thu."
            ))

            # Session becomes SUBMITTED only when all four groups have submitted.
            submitted_count = cursor.execute(
                "SELECT COUNT(*) FROM group_submissions WHERE session_id = ? AND status IN ('SUBMITTED', 'REVIEWED')",
                (s_id,)
            ).fetchone()[0]
            if submitted_count >= 4:
                cursor.execute("UPDATE lab_sessions SET status = 'SUBMITTED' WHERE id = ?", (s_id,))

            conn.commit()
            conn.close()
            self.send_json({"success": True})
            return

        # 6. Teacher Grade & Comment
        if path in ('/api/submissions/grade', '/api/reports/review'):
            user = self.require_roles('TEACHER')
            if not user:
                return
            s_id = body.get('session_id')
            g_num = body.get('group_number')
            score = body.get('teacher_score')
            rating = body.get('teacher_rating')
            comment = body.get('teacher_comment')
            approved_5s = body.get('teacher_5s_approved', 0)

            conn = get_db()
            cursor = conn.cursor()
            session = cursor.execute("SELECT * FROM lab_sessions WHERE id = ?", (s_id,)).fetchone()
            submission = cursor.execute("SELECT * FROM group_submissions WHERE session_id = ? AND group_number = ?", (s_id, g_num)).fetchone()
            if not session or session['teacher_id'] != user['id']:
                conn.close()
                self.send_json({"success": False, "error": "Bạn không phụ trách ca học này"}, status=403)
                return
            if not submission or submission['status'] != 'SUBMITTED':
                conn.close()
                self.send_json({"success": False, "error": "Chỉ được duyệt bài đã nộp"}, status=409)
                return
            try:
                score = float(score)
            except (TypeError, ValueError):
                conn.close()
                self.send_json({"success": False, "error": "Điểm phải là số từ 0 đến 10"}, status=400)
                return
            if score < 0 or score > 10 or not comment or not rating:
                conn.close()
                self.send_json({"success": False, "error": "Cần nhập đủ nhận xét, xếp loại và điểm 0-10"}, status=400)
                return
            cursor.execute("""
            UPDATE group_submissions SET
                teacher_score = ?,
                teacher_rating = ?,
                teacher_comment = ?,
                teacher_5s_approved = ?,
                status = 'REVIEWED',
                reviewed_at = CURRENT_TIMESTAMP
            WHERE session_id = ? AND group_number = ?
            """, (score, rating, comment, approved_5s, s_id, g_num))
            conn.commit()
            conn.close()
            self.send_json({"success": True})
            return

        # Lab manager approves the booking location or rejects/requests changes.
        if path.startswith('/api/sessions/') and path.endswith('/approve'):
            user = self.require_roles('LAB_MANAGER')
            if not user:
                return
            s_id = int(path.split('/')[3])
            conn = get_db()
            cursor = conn.cursor()
            session = cursor.execute("SELECT * FROM lab_sessions WHERE id = ?", (s_id,)).fetchone()
            if not session:
                conn.close()
                self.send_json({"success": False, "error": "Không tìm thấy ca học"}, status=404)
                return
            decision = body.get('decision', 'APPROVE_LAB')
            note = (body.get('reason') or body.get('note') or '').strip()
            if decision not in ('APPROVE_LAB', 'APPROVE_CLASS', 'REJECT', 'REQUEST_CHANGES'):
                conn.close()
                self.send_json({"success": False, "error": "Quyết định không hợp lệ"}, status=400)
                return
            if decision in ('REJECT', 'REQUEST_CHANGES') and not note:
                conn.close()
                self.send_json({"success": False, "error": "Cần nhập lý do"}, status=400)
                return
            approved_location = 'LAB' if decision == 'APPROVE_LAB' else 'CLASS' if decision == 'APPROVE_CLASS' else None
            if approved_location == 'CLASS':
                items = json.loads(session['planned_items'] or '[]')
                codes = [i if isinstance(i, str) else i.get('code') for i in items]
                if codes:
                    marks = ','.join('?' for _ in codes)
                    restricted = cursor.execute(f"SELECT name FROM equipment WHERE code IN ({marks}) AND usage_scope = 'LAB_ONLY'", codes).fetchall()
                    if restricted:
                        conn.close()
                        self.send_json({"success": False, "error": "Phiếu có thiết bị chỉ được dùng trong phòng thực hành"}, status=409)
                        return
            if approved_location == 'LAB':
                conflict = cursor.execute("""
                    SELECT id FROM lab_sessions WHERE id <> ? AND session_date = ? AND shift = ?
                      AND approved_location = 'LAB' AND status NOT IN ('REJECTED','CANCELLED')
                      AND period_start <= ? AND period_end >= ? LIMIT 1
                """, (s_id, session['session_date'], session['shift'], session['period_end'], session['period_start'])).fetchone()
                if conflict:
                    conn.close()
                    self.send_json({"success": False, "error": "Phòng đã được duyệt cho phiếu khác trong khung tiết này"}, status=409)
                    return
            next_status = {'APPROVE_LAB':'APPROVED_LAB','APPROVE_CLASS':'APPROVED_CLASS','REJECT':'REJECTED','REQUEST_CHANGES':'NEEDS_CHANGES'}[decision]
            cursor.execute("""
                UPDATE lab_sessions SET status = ?, approved_location = ?, approval_note = ?,
                    approved_at = CURRENT_TIMESTAMP, approved_by = ? WHERE id = ? AND status IN ('PENDING','NEEDS_CHANGES')
            """, (next_status, approved_location, note, user['id'], s_id))
            cursor.execute("INSERT INTO audit_logs(user_id, action, entity_type, entity_id, detail) VALUES (?, ?, 'BOOKING', ?, ?)",
                           (user['id'], decision, s_id, note))
            conn.commit()
            conn.close()
            self.send_json({"success": True, "status": next_status})
            return

        # Teacher submits the post-session usage/5S report.
        if path.startswith('/api/sessions/') and path.endswith('/report'):
            user = self.require_roles('TEACHER')
            if not user:
                return
            s_id = int(path.split('/')[3])
            conn = get_db(); cursor = conn.cursor()
            session = cursor.execute("SELECT * FROM lab_sessions WHERE id = ?", (s_id,)).fetchone()
            if not session or session['teacher_id'] != user['id']:
                conn.close(); self.send_json({"success": False, "error": "Bạn không phụ trách phiếu này"}, status=403); return
            if session['status'] not in ('APPROVED_LAB','APPROVED_CLASS','IN_PROGRESS','REDO_5S'):
                conn.close(); self.send_json({"success": False, "error": "Phiếu chưa ở trạng thái cho phép báo cáo"}, status=409); return
            checks = [int(bool(body.get(f's{i}'))) for i in range(1, 6)]
            if session['approved_location'] == 'LAB' and not all(checks):
                conn.close(); self.send_json({"success": False, "error": "Cần xác nhận đủ 5 mục 5S"}, status=400); return
            cursor.execute("""
                INSERT INTO session_reports(session_id,status,usage_items,damage_items,notes,s1_done,s2_done,s3_done,s4_done,s5_done,submitted_at)
                VALUES (?, 'SUBMITTED', ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(session_id) DO UPDATE SET status='SUBMITTED', usage_items=excluded.usage_items,
                  damage_items=excluded.damage_items, notes=excluded.notes, s1_done=excluded.s1_done,
                  s2_done=excluded.s2_done, s3_done=excluded.s3_done, s4_done=excluded.s4_done,
                  s5_done=excluded.s5_done, submitted_at=CURRENT_TIMESTAMP
            """, (s_id, json.dumps(body.get('usage_items', []), ensure_ascii=False),
                  json.dumps(body.get('damage_items', []), ensure_ascii=False), body.get('notes',''), *checks))
            cursor.execute("UPDATE lab_sessions SET status = 'PENDING_ACCEPTANCE' WHERE id = ?", (s_id,))
            conn.commit(); conn.close(); self.send_json({"success": True, "status": "PENDING_ACCEPTANCE"}); return

        # Lab manager accepts the report or asks the teacher to redo 5S.
        if path.startswith('/api/sessions/') and path.endswith('/accept-report'):
            user = self.require_roles('LAB_MANAGER')
            if not user:
                return
            s_id = int(path.split('/')[3]); action = body.get('action', 'ACCEPT'); reason = (body.get('reason') or '').strip()
            conn = get_db(); cursor = conn.cursor()
            session = cursor.execute("SELECT * FROM lab_sessions WHERE id = ?", (s_id,)).fetchone()
            report = cursor.execute("SELECT * FROM session_reports WHERE session_id = ?", (s_id,)).fetchone()
            if not session or not report or session['status'] != 'PENDING_ACCEPTANCE':
                conn.close(); self.send_json({"success": False, "error": "Chưa có báo cáo chờ nghiệm thu"}, status=409); return
            if action == 'REDO_5S':
                failed = body.get('failed_items', [])
                if not failed or not reason:
                    conn.close(); self.send_json({"success": False, "error": "Cần chọn mục 5S chưa đạt và nhập lý do"}, status=400); return
                cursor.execute("UPDATE session_reports SET status='REDO_5S', review_note=? WHERE session_id=?", (json.dumps({'failed_items':failed,'reason':reason}, ensure_ascii=False), s_id))
                cursor.execute("UPDATE lab_sessions SET status='REDO_5S' WHERE id=?", (s_id,))
                result_status = 'REDO_5S'
            else:
                if report['inventory_applied_at'] is None:
                    for item in json.loads(report['usage_items'] or '[]'):
                        eq = cursor.execute("SELECT * FROM equipment WHERE code=?", (item.get('code'),)).fetchone()
                        qty = int(item.get('used_quantity', 0))
                        if eq and eq['stock_type'] == 'CONSUMABLE' and qty > 0:
                            cursor.execute("UPDATE equipment SET available_qty = MAX(0, available_qty - ?) WHERE id=?", (qty, eq['id']))
                            cursor.execute("INSERT OR IGNORE INTO inventory_transactions(session_id,equipment_id,transaction_type,quantity,note) VALUES (?,?,'CONSUME',?,?)", (s_id, eq['id'], qty, 'Nghiệm thu cuối ca'))
                    cursor.execute("UPDATE session_reports SET inventory_applied_at=CURRENT_TIMESTAMP WHERE session_id=?", (s_id,))
                cursor.execute("UPDATE session_reports SET status='ACCEPTED', reviewed_at=CURRENT_TIMESTAMP, review_note=? WHERE session_id=?", (reason, s_id))
                cursor.execute("UPDATE lab_sessions SET status='COMPLETED', completed_at=CURRENT_TIMESTAMP, asset_approved_at=CURRENT_TIMESTAMP, asset_approved_by=? WHERE id=?", (user['id'], s_id))
                result_status = 'COMPLETED'
            cursor.execute("INSERT INTO audit_logs(user_id,action,entity_type,entity_id,detail) VALUES (?,?,'SESSION_REPORT',?,?)", (user['id'], action, s_id, reason))
            conn.commit(); conn.close(); self.send_json({"success": True, "status": result_status}); return

        # 7. Add Equipment (Admin)
        if path == '/api/equipment':
            user = self.require_roles('LAB_MANAGER')
            if not user:
                return
            code = body.get('code')
            name = body.get('name')
            zone = body.get('zone')
            cat = body.get('category', 'Dụng cụ')
            qty = body.get('total_qty', 1)
            unit = body.get('unit', 'Cái')
            notes = body.get('notes', '')

            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("""
            INSERT INTO equipment (code, name, zone, category, total_qty, available_qty, unit, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (code, name, zone, cat, qty, qty, unit, notes))
            conn.commit()
            conn.close()
            self.send_json({"success": True})
            return

        # 8. Record Breakage Report (Admin)
        if path == '/api/breakages':
            user = self.require_roles('LAB_MANAGER', 'TEACHER')
            if not user:
                return
            s_id = body.get('session_id')
            eq_id = body.get('equipment_id')
            g_num = body.get('group_number')
            qty = body.get('quantity', 1)
            reason = body.get('reason')
            cost = body.get('cost_estimate', 0)

            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("""
            INSERT INTO breakage_reports (session_id, equipment_id, group_number, quantity, reason, cost_estimate)
            VALUES (?, ?, ?, ?, ?, ?)
            """, (s_id, eq_id, g_num, qty, reason, cost))
            conn.commit()
            conn.close()
            self.send_json({"success": True})
            return

        # 9. Mark Breakage Resolved
        if path.startswith('/api/breakages/') and path.endswith('/resolve'):
            b_id = int(path.split('/')[3])
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("UPDATE breakage_reports SET is_resolved = 1 WHERE id = ?", (b_id,))
            conn.commit()
            conn.close()
            self.send_json({"success": True})
            return

        # 10. Mark all notifications read
        if path == '/api/notifications/read-all':
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("UPDATE notifications SET is_read = 1")
            conn.commit()
            conn.close()
            self.send_json({"success": True})
            return

        self.send_error(404, "API endpoint not found")

    # ================= PUT REQUESTS =================
    def do_PUT(self):
        path = self.path
        body = self.read_body_json()

        # Explicit lifecycle transition; direct completion is forbidden.
        if path.startswith('/api/sessions/') and path.endswith('/status'):
            user = self.require_roles('TEACHER')
            if not user:
                return
            s_id = int(path.split('/')[3])
            status = body.get('status')
            if status != 'IN_PROGRESS':
                self.send_json({"success": False, "error": "Chuyển trạng thái không hợp lệ"}, status=400)
                return
            conn = get_db()
            cursor = conn.cursor()
            session = cursor.execute("SELECT * FROM lab_sessions WHERE id = ?", (s_id,)).fetchone()
            if not session or session['teacher_id'] != user['id']:
                conn.close()
                self.send_json({"success": False, "error": "Bạn không phụ trách ca học này"}, status=403)
                return
            if session['status'] not in ('APPROVED_LAB', 'APPROVED_CLASS'):
                conn.close()
                self.send_json({"success": False, "error": "Phiếu phải được cán bộ duyệt trước khi bắt đầu"}, status=409)
                return
            cursor.execute("UPDATE lab_sessions SET status = ?, started_at = CURRENT_TIMESTAMP WHERE id = ?", (status, s_id))
            conn.commit()
            conn.close()
            self.send_json({"success": True})
            return

        self.send_error(404, "API endpoint not found")

    # ================= DELETE REQUESTS =================
    def do_DELETE(self):
        path = self.path
        if path.startswith('/api/equipment/'):
            user = self.require_roles('LAB_MANAGER')
            if not user:
                return
            eq_id = int(path.split('/')[3])
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("DELETE FROM equipment WHERE id = ?", (eq_id,))
            conn.commit()
            conn.close()
            self.send_json({"success": True})
            return

        self.send_error(404, "API endpoint not found")

def run_server():
    init_db()
    seed_real_data()
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("", PORT), BioLabHTTPHandler) as httpd:
        print("==================================================")
        print("[OK] BioLab Manager Server dang chay tai:")
        print(f"--> http://localhost:{PORT}")
        print("==================================================")
        httpd.serve_forever()

if __name__ == "__main__":
    run_server()
