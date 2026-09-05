# Hướng dẫn triển khai và cập nhật BioLab cho người mới

Tài liệu này dành cho người không biết lập trình. Chỉ cần thực hiện lần lượt từng bước và không bỏ qua phần **Kiểm tra kết quả**.

## Mô hình hoạt động

BioLab sử dụng ba dịch vụ:

- **GitHub**: lưu mã nguồn.
- **Supabase**: lưu dữ liệu lâu dài (tài khoản, thiết bị, ca dạy, sự cố...).
- **Render**: chạy website và kết nối tới Supabase.

Nên chọn **Singapore** cho cả Render và Supabase để giảm độ trễ tại Việt Nam.

## Những thông tin tuyệt đối không gửi công khai

Không đăng lên GitHub, ảnh chụp màn hình, nhóm chat hoặc đưa vào câu hỏi cho AI:

- Mật khẩu Supabase.
- Chuỗi `DATABASE_URL`.
- Mật khẩu tài khoản BioLab.
- API key hoặc access token.

Nếu đã để lộ, hãy đổi mật khẩu ngay. Không ghi các thông tin trên vào file mã nguồn.
---

# PHẦN A — THỰC HIỆN MỘT LẦN KHI TRIỂN KHAI MỚI

## Bước 1: Chuẩn bị tài khoản

Cần có tài khoản miễn phí tại:

1. GitHub: <https://github.com>
2. Supabase: <https://supabase.com>
3. Render: <https://render.com>
4. UptimeRobot: <https://uptimerobot.com>

Repository mã nguồn:

```text
https://github.com/dohuongtra308-boop/biolabccb.git
```

## Bước 2: Tạo database Supabase

1. Đăng nhập Supabase.
2. Chọn **New project**.
3. Đặt tên, ví dụ `biolabccb`.
4. Tạo một mật khẩu database mạnh và lưu ở nơi riêng tư.
5. Chọn region **Southeast Asia (Singapore)**.
6. Chọn gói **Free** rồi tạo project.
7. Chờ project khởi tạo hoàn tất.

### Bước 2.1 Lấy địa chỉ kết nối

1. Mở project Supabase.
2. Chọn **Connect**.
3. Chọn **Session pooler**.
4. Chọn kiểu **URI**.
5. Sao chép chuỗi bắt đầu bằng `postgresql://`.
6. Thay phần mật khẩu mẫu bằng mật khẩu database ở bước 2.

Chuỗi này được gọi là `DATABASE_URL`. Không gửi chuỗi thật cho người khác.

## Bước 3: Cài công cụ trong máy Windows

Mở thư mục dự án trong VS Code, sau đó chọn **Terminal → New Terminal**.

Nếu terminal bắt đầu bằng `(venv)`, chuyển sang bước cài thư viện.
Nếu chưa có `(venv)`, chạy:

```cmd
python -m venv venv
venv\Scripts\activate
```

Nếu có rồi thì chạy :
venv\Scripts\activate
Cài thư viện:

```cmd
python -m pip install -r requirements.txt
```

## Bước 4: Đưa dữ liệu local lên Supabase

Chỉ làm bước này khi muốn lấy dữ liệu từ `biolab.db` trong máy làm dữ liệu ban đầu.

Trong **Command Prompt (CMD)** chạy:

```cmd
set "DATABASE_URL=DÁN_CHUOI_KET_NOI_COPPY_Ở_BƯỚC_2.1.5"
python migrate_sqlite_to_supabase.py --source biolab.db --yes
set DATABASE_URL=
```

Kết quả đúng có nhiều dòng `[OK]` và kết thúc bằng `[SUCCESS]`.

> Cảnh báo: lệnh này thay toàn bộ dữ liệu đang có trong Supabase bằng dữ liệu từ `biolab.db`. Không chạy lại khi website đã phát sinh dữ liệu mới, trừ khi thực sự muốn ghi đè.

## Bước 5: Tạo website Render bằng Blueprint

1. Đăng nhập Render bằng GitHub.
2. Chọn **New → Blueprint**.
3. Chọn repository `biolabccb`.
4. Render sẽ đọc file `render.yaml`.
5. Kiểm tra region hiển thị là **Singapore**.
6. Nhập các biến bí mật khi Render yêu cầu.

Biến quan trọng nhất Ở bước 2.5.1 :

```text
DATABASE_URL
```

Giá trị là Session pooler URI lấy từ Supabase.

Các biến mật khẩu khởi tạo cũng phải được nhập:

```text
BIOLAB_INITIAL_PASSWORD_GVPHUTRACH
BIOLAB_INITIAL_PASSWORD_DTHTRA
BIOLAB_INITIAL_PASSWORD_LHTHAM
BIOLAB_INITIAL_PASSWORD_CTBNGOC
BIOLAB_INITIAL_PASSWORD_DHSON
BIOLAB_INITIAL_PASSWORD_MTKTUYEN
```

Không nhập giá trị bí mật trực tiếp vào `render.yaml`.

## Bước 6: Kiểm tra website

Khi Render báo **Live**, mở:

```text
https://TEN-SERVICE.onrender.com/api/health
```

Kết quả đúng:

```json
{"status":"ok","database":"connected"}
```

Sau đó mở trang chủ, đăng nhập và kiểm tra:

1. Danh mục kiểm kê hiển thị đủ thiết bị.
2. Giáo viên tạo được phiếu đăng ký.
3. Cán bộ duyệt được phiếu.
4. Giáo viên gửi được báo cáo cuối ca.
5. Cán bộ nghiệm thu được ca học.
6. Xuất được báo cáo Excel.

## Bước 7: Cấu hình UptimeRobot

1. Đăng nhập UptimeRobot.
2. Chọn **Add New Monitor**.
3. Monitor type: **HTTP(s)**.
4. URL:

```text
https://TEN-SERVICE.onrender.com/api/health
```

5. Interval: **5 minutes**.
6. Lưu monitor.

UptimeRobot giúp hạn chế việc Render Free ngủ do không có truy cập. Gói miễn phí không đảm bảo website hoạt động 100% mọi thời điểm.
---

# PHẦN B — NHỜ AI SỬA CODE VÀ CẬP NHẬT WEBSITE

## Bước 1: Mô tả yêu cầu cho AI

Nêu rõ:
- Đang lỗi ở vai trò Giáo viên hay Cán bộ.
- Đang ở màn hình hoặc tab nào.
- Đã bấm nút nào.
- Kết quả hiện tại.
- Kết quả mong muốn.
- Ảnh lỗi và dòng Console nếu có.

Ví dụ:

```text
Ở vai trò Cán bộ, khi bấm Duyệt phòng thực hành thì nút quay lâu.
Tôi muốn cập nhật trạng thái ngay sau khi duyệt và không tải lại toàn bộ trang.
Hãy kiểm tra, sửa code, chạy test, nhưng hỏi tôi trước khi push GitHub.
```

Không gửi cho AI `DATABASE_URL`, mật khẩu hoặc token.

## Bước 2: Yêu cầu AI kiểm thử

Sau khi AI sửa xong, yêu cầu:

```text
Hãy chạy kiểm thử local, kiểm tra các thay đổi và báo rõ file nào đã sửa.
Không được xóa hoặc ghi đè các thay đổi không liên quan của tôi.
```

## Bước 3: Cho phép AI commit và push

Sau khi kiểm thử thành công, nói rõ:

```text
Tôi đồng ý. Hãy commit đúng các file vừa sửa và push lên nhánh main.
Không commit database, file mật khẩu, .env hoặc file ZIP.
```

AI sẽ thực hiện tương đương các lệnh:

```cmd
git add TEN_FILE_DA_SUA
git commit -m "Mo ta thay doi"
git push origin main
```

Không nên tự chạy `git add .` vì có thể đưa nhầm file bí mật lên GitHub.

## Bước 4: Kiểm tra Render sau khi push

1. Mở Render Dashboard.
2. Chọn service BioLab.
3. Mở **Events**.
4. Kiểm tra commit mới đang được deploy.
5. Chờ trạng thái **Live**.

Nếu Auto-Deploy không chạy:

```text
Manual Deploy → Deploy latest commit
```

Nếu nghi ngờ cache hoặc thư viện cũ:

```text
Manual Deploy → Clear build cache & deploy
```

Sau đó mở website và nhấn `Ctrl + F5`.

---

# PHẦN C — CÔNG VIỆC VẬN HÀNH THƯỜNG GẶP

## Website báo database disconnected

Mở `/api/health`. Nếu nhận:

```json
{"status":"error","database":"disconnected"}
```

Thực hiện:

1. Render → service BioLab → **Environment**.
2. Kiểm tra `DATABASE_URL`.
3. Lấy lại Session pooler URI từ Supabase nếu cần.
4. Lưu biến và deploy lại.

## Website trắng hoặc không hiện dữ liệu
1. Nhấn `Ctrl + F5`.
2. Đăng xuất rồi đăng nhập lại.
3. Kiểm tra `/api/health`.
4. Nhấn `F12 → Console` và chụp lỗi màu đỏ cho AI.
5. Mở Render → **Logs** và gửi phần traceback, nhưng che mọi mật khẩu/token.

## Bắt đầu năm học hoặc chu kỳ mới

Chỉ reset local khi đã xác nhận muốn xóa lịch sử vận hành:

```cmd
python reset_operational_cycle.py --yes
```

Script tạo file sao lưu trước khi reset, refill toàn bộ kiểm kê và xóa ca dạy, sự cố, báo cáo, mượn–trả cùng thông báo.

Không chạy script này trực tiếp với `DATABASE_URL` Supabase.

## Sao lưu định kỳ

- Giữ một bản `biolab.db` local trước khi nạp dữ liệu lần đầu.
- Xuất báo cáo Excel định kỳ.
- Trước migration/reset, tạo bản sao lưu database.
- Không lưu bản sao database hoặc file mật khẩu trong repository công khai.

## Checklist ngắn trước mỗi lần cập nhật

- [ ] AI đã nói rõ những file được sửa.
- [ ] Kiểm thử local đã thành công.
- [ ] Không có `.env`, database hoặc mật khẩu trong commit.
- [ ] Đã push đúng nhánh `main`.
- [ ] Render đã deploy đúng commit mới.
- [ ] `/api/health` trả `status: ok`.
- [ ] Đã thử lại chức năng vừa sửa trên website.
