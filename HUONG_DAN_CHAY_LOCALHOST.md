# Hướng dẫn chạy BioLab Manager trên localhost

Tài liệu này dùng cho Windows và PowerShell.

Địa chỉ website sau khi khởi động:

```text
http://localhost:8080
```

## 1. Yêu cầu

Máy tính cần cài Python 3.

Kiểm tra bằng PowerShell:

```powershell
python --version
```

Nếu lệnh trên không hoạt động, hãy cài Python từ <https://www.python.org/downloads/> và chọn **Add Python to PATH** trong khi cài đặt.

## 2. Mở PowerShell tại thư mục dự án

Thư mục dự án hiện tại:

```text
C:\Users\Admin\Desktop\Document\AgenticCode\class
```

Có thể mở thư mục này trong File Explorer, nhấn vào thanh địa chỉ, nhập `powershell` rồi nhấn Enter.

Hoặc mở PowerShell và chạy:

```powershell
Set-Location -LiteralPath "C:\Users\Admin\Desktop\Document\AgenticCode\class"
```

Kiểm tra đúng thư mục:

```powershell
Get-ChildItem
```

Cần nhìn thấy các file như `app.py`, `server.py`, `database.py` và `biolab.db`.

## 3. Cài thư viện lần đầu

Chỉ cần thực hiện phần này lần đầu hoặc sau khi `requirements.txt` thay đổi.

```powershell
python -m pip install -r requirements.txt
```

Kiểm tra Flask:

```powershell
python -c "import flask; print(flask.__version__)"
```

## 4. Khởi động localhost

Trong PowerShell đang mở tại thư mục dự án, chạy:

```powershell
python -u app.py
```

Kết quả đúng có dạng:

```text
* Serving Flask app 'app'
* Running on http://127.0.0.1:8080
Press CTRL+C to quit
```

Không đóng cửa sổ PowerShell này trong lúc sử dụng website.

Mở trình duyệt và truy cập:

<http://localhost:8080>

Nếu trình duyệt hiển thị giao diện cũ, nhấn:

```text
Ctrl + F5
```

## 5. Đăng nhập

Sử dụng tài khoản BioLab được lưu trong file `TAI_KHOAN_MAT_KHAU.txt` trên máy cá nhân.

Không upload hoặc chia sẻ file mật khẩu này lên Internet.

Có thể nhập tài khoản, mật khẩu rồi nhấn Enter để đăng nhập.

## 6. Dừng localhost

Quay lại cửa sổ PowerShell đang chạy Flask và nhấn:

```text
Ctrl + C
```

Chờ dấu nhắc PowerShell xuất hiện trở lại rồi mới đóng cửa sổ.

## 7. Khởi động lại sau khi sửa code

Flask đang chạy ở chế độ không tự reload. Sau khi sửa code Python, cần:

1. Nhấn `Ctrl + C` tại cửa sổ đang chạy Flask.
2. Chạy lại:

```powershell
python -u app.py
```

3. Nhấn `Ctrl + F5` trong trình duyệt.

Nếu chỉ sửa HTML hoặc JavaScript, vẫn nên khởi động lại để tránh trình duyệt hoặc tiến trình cũ giữ nội dung trước đó.

## 8. Xử lý lỗi cổng 8080 đã được sử dụng

Các biểu hiện thường gặp:

- Báo lỗi cổng 8080 đang được sử dụng.
- Giao diện mới nhưng API trả về `API endpoint not found`.
- Một chức năng lúc chạy được, lúc báo lỗi.
- Có nhiều tiến trình Python cũ cùng chạy.

### Bước 1: tìm PID đang nghe cổng 8080

```powershell
netstat -ano | Select-String "127.0.0.1:8080.*LISTENING"
```

Ví dụ:

```text
TCP  127.0.0.1:8080  0.0.0.0:0  LISTENING  12345
```

Số cuối dòng là PID. Trong ví dụ trên, PID là `12345`.

### Bước 2: kiểm tra tiến trình

Thay `12345` bằng PID thực tế:

```powershell
Get-Process -Id 12345
```

Chỉ tiếp tục nếu đó đúng là tiến trình Python chạy localhost của dự án.

### Bước 3: dừng đúng tiến trình

```powershell
Stop-Process -Id 12345
```

Nếu có nhiều dòng `LISTENING`, kiểm tra và dừng từng PID của các localhost cũ. Không dừng tiến trình không xác định.

### Bước 4: chạy lại duy nhất một server

```powershell
python -u app.py
```

## 9. Kiểm tra localhost bằng PowerShell

Khi server đang chạy, mở một cửa sổ PowerShell thứ hai và chạy:

```powershell
curl.exe --noproxy "*" -s -o NUL -w "HTTP=%{http_code}" http://127.0.0.1:8080/
```

Kết quả đúng:

```text
HTTP=200
```

Kiểm tra API có tồn tại:

```powershell
curl.exe --noproxy "*" -s http://127.0.0.1:8080/api/equipment
```

Khi chưa đăng nhập, API trả về thông báo cần đăng nhập là bình thường. Điều quan trọng là không trả về `API endpoint not found` cho endpoint hợp lệ.

## 10. Kiểm tra database

Đảm bảo database không bị lỗi:

```powershell
python -c "import sqlite3; c=sqlite3.connect('biolab.db'); print(c.execute('PRAGMA integrity_check').fetchone()[0]); c.close()"
```

Kết quả đúng:

```text
ok
```

Nên sao lưu database trước khi thử nghiệm thay đổi lớn:

```powershell
Copy-Item -LiteralPath ".\biolab.db" -Destination ".\biolab-backup.db"
```

File sao lưu `*.db` đã được `.gitignore` loại trừ, nhưng vẫn không nên gửi file này lên nơi công khai.

## 11. Một số lỗi thường gặp

### `ModuleNotFoundError: No module named 'flask'`

Chạy:

```powershell
python -m pip install -r requirements.txt
```

### `Address already in use` hoặc lỗi liên quan cổng 8080

Thực hiện phần **Xử lý lỗi cổng 8080 đã được sử dụng** ở trên.

### Trang không mở được

Kiểm tra cửa sổ PowerShell chạy Flask còn mở và có dòng:

```text
Running on http://127.0.0.1:8080
```

### Giao diện chưa cập nhật

Nhấn `Ctrl + F5`. Nếu vẫn chưa cập nhật, dừng Flask bằng `Ctrl + C`, chạy lại `python -u app.py`, rồi tải lại trang.

### API trả `401` hoặc “Bạn cần đăng nhập”

Phiên đăng nhập đã hết hạn hoặc chưa đăng nhập. Hãy đăng xuất, đăng nhập lại và thử chức năng một lần nữa.

## 12. Quy trình ngắn gọn cho những lần chạy sau

```powershell
Set-Location -LiteralPath "C:\Users\Admin\Desktop\Document\AgenticCode\class"
python -u app.py
```

Sau đó mở:

<http://localhost:8080>

Khi dùng xong, quay lại PowerShell và nhấn `Ctrl + C`.
