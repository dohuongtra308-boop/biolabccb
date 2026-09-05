"""Reset every local TEACHER account to a unique temporary password."""

import argparse
import os
import re
import secrets
import shutil
import string
from datetime import datetime

from database import DATABASE_URL, DB_FILE, get_db, hash_password


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PASSWORD_FILE = os.path.join(BASE_DIR, "TAI_KHOAN_MAT_KHAU.txt")
PASSWORD_ALPHABET = string.ascii_letters + string.digits + "!@#%"


def create_temporary_password(length=14):
    while True:
        password = "".join(secrets.choice(PASSWORD_ALPHABET) for _ in range(length))
        if (
            any(ch.islower() for ch in password)
            and any(ch.isupper() for ch in password)
            and any(ch.isdigit() for ch in password)
            and any(ch in "!@#%" for ch in password)
        ):
            return password


def build_updated_password_file(credentials):
    content = ""
    if os.path.exists(PASSWORD_FILE):
        with open(PASSWORD_FILE, "r", encoding="utf-8") as file:
            content = file.read()

    missing = []
    for username, password in credentials.items():
        pattern = re.compile(
            rf"(Tên đăng nhập:\s*{re.escape(username)}\s*\r?\n"
            rf"Mật khẩu hiện tại:\s*)[^\r\n]*",
            re.IGNORECASE,
        )
        content, replacements = pattern.subn(rf"\g<1>{password}", content, count=1)
        if not replacements:
            missing.append((username, password))

    if missing:
        content = content.rstrip() + "\n\nTÀI KHOẢN GIÁO VIÊN ĐƯỢC RESET\n"
        for username, password in missing:
            content += (
                f"Tên đăng nhập: {username}\n"
                f"Mật khẩu hiện tại: {password}\n"
                "Yêu cầu đổi mật khẩu lần đầu: Có\n\n"
            )
    return content


def reset_teacher_passwords(confirm=False):
    if not confirm:
        raise RuntimeError("Dùng --yes để xác nhận reset mật khẩu giáo viên")
    if DATABASE_URL:
        raise RuntimeError("Script này chỉ reset database SQLite local, không hỗ trợ Supabase")

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    database_backup = os.path.join(BASE_DIR, f"biolab.before-teacher-password-reset-{timestamp}.db")
    shutil.copy2(os.path.abspath(DB_FILE), database_backup)

    password_backup = None
    if os.path.exists(PASSWORD_FILE):
        password_backup = os.path.join(BASE_DIR, f"TAI_KHOAN_MAT_KHAU.before-reset-{timestamp}.txt")
        shutil.copy2(PASSWORD_FILE, password_backup)

    conn = get_db()
    try:
        teachers = conn.execute(
            "SELECT id, username FROM users WHERE role = 'TEACHER' ORDER BY username"
        ).fetchall()
        credentials = {row["username"]: create_temporary_password() for row in teachers}
        for row in teachers:
            conn.execute(
                "UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?",
                (hash_password(credentials[row["username"]]), row["id"]),
            )
        conn.execute(
            "DELETE FROM auth_sessions WHERE user_id IN "
            "(SELECT id FROM users WHERE role = 'TEACHER')"
        )
        updated_password_file = build_updated_password_file(credentials)
        conn.commit()
        with open(PASSWORD_FILE, "w", encoding="utf-8", newline="\n") as file:
            file.write(updated_password_file)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    return len(teachers), database_backup, password_backup


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Reset local teacher passwords")
    parser.add_argument("--yes", action="store_true", help="xác nhận reset")
    args = parser.parse_args()
    count, database_backup, password_backup = reset_teacher_passwords(args.yes)
    print(f"RESET_TEACHERS={count}")
    print(f"DATABASE_BACKUP={database_backup}")
    if password_backup:
        print(f"PASSWORD_FILE_BACKUP={password_backup}")
    print("PASSWORD_FILE_UPDATED=TAI_KHOAN_MAT_KHAU.txt")
