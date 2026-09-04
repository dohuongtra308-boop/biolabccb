# Hướng dẫn đưa BioLab Manager lên PythonAnywhere

Tài liệu này áp dụng cho tài khoản PythonAnywhere có username **`nghe486443`**.

Địa chỉ website dự kiến:

```text
https://nghe486443.pythonanywhere.com
```

## 1. Đăng nhập PythonAnywhere

1. Truy cập <https://www.pythonanywhere.com/>.
2. Chọn **Log in**.
3. Nhập username `nghe486443` và mật khẩu PythonAnywhere.
4. Không chia sẻ mật khẩu PythonAnywhere hoặc API token cho người khác.

> Mật khẩu PythonAnywhere khác với mật khẩu đăng nhập vào BioLab Manager.

## 2. File dùng để triển khai

Sử dụng file:

```text
biolab_pythonanywhere_nghe486443.zip
```

Gói này chứa:

- Mã nguồn Python và Flask/WSGI.
- Giao diện trong `templates` và `static`.
- Database vận hành `biolab.db`.
- Danh mục bài thực hành.
- File cấu hình WSGI mẫu.

Không upload file `TAI_KHOAN_MAT_KHAU.txt` lên PythonAnywhere và không đưa file này lên GitHub.

## 3. Upload mã nguồn

1. Trên thanh điều hướng PythonAnywhere, mở tab **Files**.
2. Đi tới thư mục `/home/nghe486443`.
3. Tại mục **Upload a file**, chọn `biolab_pythonanywhere_nghe486443.zip`.
4. Chờ quá trình upload hoàn thành.
5. Mở tab **Consoles**.
6. Chọn **Bash** để tạo Bash Console.
7. Giải nén bằng lệnh:

```bash
unzip ~/biolab_pythonanywhere_nghe486443.zip -d ~/biolab
```

Kiểm tra các file đã giải nén:

```bash
ls -la ~/biolab
```

Cần nhìn thấy tối thiểu:

```text
app.py
server.py
database.py
excel_exporter.py
requirements.txt
lesson_catalog.json
biolab.db
static
templates
```

## 4. Tạo môi trường Python

Kiểm tra phiên bản Python:

```bash
python3 --version
```

Tạo virtual environment:

```bash
python3 -m venv ~/biolab-venv
```

Cài thư viện của dự án:

```bash
~/biolab-venv/bin/pip install -r ~/biolab/requirements.txt
```

Kiểm tra ứng dụng có thể import:

```bash
cd ~/biolab
BIOLAB_DB_FILE=/home/nghe486443/biolab/biolab.db ~/biolab-venv/bin/python -c "from app import app; print('WSGI_OK:', app.name)"
```

Kết quả đúng:

```text
WSGI_OK: app
```

## 5. Tạo Web App

1. Mở tab **Web**.
2. Chọn **Add a new web app**.
3. Nhấn **Next**.
4. Chọn **Manual configuration**.
5. Chọn đúng phiên bản Python tương ứng với kết quả của `python3 --version`.
6. Hoàn thành trình hướng dẫn.

## 6. Khai báo virtual environment

Trong trang cấu hình Web App, tìm mục **Virtualenv** và nhập:

```text
/home/nghe486443/biolab-venv
```

Nếu PythonAnywhere xác nhận đường dẫn virtualenv hợp lệ thì chuyển sang bước tiếp theo.

## 7. Cấu hình WSGI

1. Trong tab **Web**, tìm mục **Code**.
2. Nhấn vào đường dẫn **WSGI configuration file**.
3. Xóa nội dung mẫu đang có.
4. Dán nội dung sau:

```python
import os
import sys

PROJECT_DIR = "/home/nghe486443/biolab"

if PROJECT_DIR not in sys.path:
    sys.path.insert(0, PROJECT_DIR)

os.environ["BIOLAB_DB_FILE"] = os.path.join(PROJECT_DIR, "biolab.db")

from app import app as application
```

5. Nhấn **Save**.
6. Quay lại tab **Web**.
7. Nhấn nút xanh **Reload nghe486443.pythonanywhere.com**.

## 8. Mở và đăng nhập BioLab Manager

Truy cập:

<https://nghe486443.pythonanywhere.com>

Đăng nhập bằng tài khoản BioLab được lưu riêng trong `TAI_KHOAN_MAT_KHAU.txt` trên máy cá nhân.

Sau khi đăng nhập, kiểm tra:

1. Đăng nhập được bằng cách nhấn Enter.
2. Giáo viên xem được giao diện giáo viên.
3. Cán bộ quản lý xem được Danh mục kiểm kê.
4. Có thể chuyển tình trạng thiết bị giữa **Tốt** và **Bảo trì**.
5. Có thể tạo và duyệt một phiếu thử nghiệm.
6. Có thể xuất báo cáo Excel.

## 9. Cập nhật website khi có bản code mới

Upload lại file ZIP mới vào `/home/nghe486443`, sau đó chạy:

```bash
unzip -o ~/biolab_pythonanywhere_nghe486443.zip -d ~/biolab
```

Quay lại tab **Web** và nhấn **Reload**.

Không cần tạo lại Web App, virtualenv hoặc WSGI khi chỉ cập nhật mã nguồn.

### Cảnh báo về database khi cập nhật

File ZIP hiện có chứa `biolab.db`. Lệnh giải nén với `-o` sẽ ghi đè database trên máy chủ bằng database trong file ZIP.

Nếu website đã có dữ liệu sử dụng thực tế, hãy sao lưu trước:

```bash
cp ~/biolab/biolab.db ~/biolab/biolab-backup-$(date +%Y%m%d-%H%M%S).db
```

Khi chỉ muốn cập nhật code mà giữ nguyên dữ liệu online, có thể giải nén nhưng bỏ qua database:

```bash
unzip -o ~/biolab_pythonanywhere_nghe486443.zip -d ~/biolab -x biolab.db
```

## 10. Xem lỗi khi website không hoạt động

Trong tab **Web**, mở các đường dẫn:

- **Error log**: lỗi Python, import, database hoặc WSGI.
- **Server log**: lịch sử request tới website.
- **Access log**: mã trạng thái HTTP của từng request.

Sau khi sửa code hoặc WSGI, luôn quay lại tab **Web** và nhấn **Reload**.

Một số kiểm tra hữu ích trong Bash Console:

```bash
ls -la ~/biolab
```

```bash
~/biolab-venv/bin/pip show Flask
```

```bash
cd ~/biolab
BIOLAB_DB_FILE=/home/nghe486443/biolab/biolab.db ~/biolab-venv/bin/python -c "from app import app; print(app.name)"
```

Kiểm tra database:

```bash
cd ~/biolab
BIOLAB_DB_FILE=/home/nghe486443/biolab/biolab.db ~/biolab-venv/bin/python -c "import sqlite3; c=sqlite3.connect('biolab.db'); print(c.execute('PRAGMA integrity_check').fetchone()[0]); c.close()"
```

Kết quả đúng là:

```text
ok
```

## 11. Gia hạn gói miễn phí

Web App thuộc gói miễn phí có thể yêu cầu gia hạn định kỳ. Hãy đăng nhập PythonAnywhere, mở tab **Web** và thực hiện gia hạn trước ngày hết hạn hiển thị trên trang.

Nên đặt nhắc lịch trên điện thoại hoặc lịch cá nhân để website không bị tạm ngừng.

## 12. Nguyên tắc bảo mật

- Không upload `TAI_KHOAN_MAT_KHAU.txt`.
- Không công khai `biolab.db` trên GitHub vì database chứa thông tin tài khoản đã băm và dữ liệu vận hành.
- Đổi các mật khẩu BioLab đã từng dùng làm mật khẩu mẫu.
- Không gửi ảnh chứa mật khẩu, API token hoặc nội dung database lên nơi công khai.
- Chỉ cấp tài khoản cán bộ quản lý cho người có thẩm quyền.
- Sao lưu database trước mỗi lần cập nhật lớn.
