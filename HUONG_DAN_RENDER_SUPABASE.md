# Triển khai BioLab trên Render + Supabase PostgreSQL

## 1. Tạo Supabase

1. Tạo một project tại Supabase.
2. Vào **Connect** và chọn connection string của **Session pooler**.
3. Sao chép URI dạng `postgresql://...` và thay `[YOUR-PASSWORD]` bằng mật khẩu database.
4. Không ghi URI này vào file hoặc GitHub.

## 2. Chuyển dữ liệu SQLite hiện tại

Trong PowerShell tại thư mục dự án:

```powershell
python -m pip install -r requirements.txt
$env:DATABASE_URL="postgresql://CONNECTION_STRING_CUA_SUPABASE"
python migrate_sqlite_to_supabase.py --source biolab.db --yes
Remove-Item Env:DATABASE_URL
```

Script sẽ tạo schema PostgreSQL, xóa dữ liệu đích và sao chép dữ liệu từ `biolab.db`.
Chỉ chạy `--yes` sau khi đã kiểm tra đúng project Supabase.

## 3. Deploy Render

1. Push code lên GitHub.
2. Trong Render chọn **New > Blueprint** và chọn repository BioLab.
3. Render đọc `render.yaml` để tạo Web Service.
4. Nhập `DATABASE_URL` bằng Session pooler URI của Supabase.
5. Nhập sáu biến `BIOLAB_INITIAL_PASSWORD_*` được Render yêu cầu. Với database đã chuyển dữ liệu, các giá trị này chỉ là phương án khởi tạo dự phòng; không ghi chúng vào GitHub.
6. Chờ deploy thành công rồi mở:

```text
https://TEN-DICH-VU.onrender.com/api/health
```

Kết quả đúng:

```json
{"status":"ok","database":"connected"}
```

## 4. Cấu hình UptimeRobot

- Monitor type: `HTTP(s)`
- URL: `https://TEN-DICH-VU.onrender.com/api/health`
- Interval: 5 phút
- Trạng thái mong đợi: HTTP 200

Endpoint thực hiện `SELECT 1`, vừa kiểm tra Render vừa tạo hoạt động thực trong Supabase.

## 5. Cập nhật ứng dụng

Sau mỗi lần sửa code:

```powershell
git add .
git commit -m "Update BioLab"
git push origin main
```

Render sẽ tự deploy commit mới. Dữ liệu nằm ở Supabase nên không bị mất khi Render deploy lại.

## Lưu ý an toàn

- Không commit `DATABASE_URL`, mật khẩu Supabase hoặc service key.
- Không đưa `biolab.db` và `TAI_KHOAN_MAT_KHAU.txt` lên GitHub.
- Render/Supabase Free không có bảo đảm uptime 100%.
- Nên xuất hoặc sao lưu dữ liệu định kỳ trước các thay đổi lớn.
