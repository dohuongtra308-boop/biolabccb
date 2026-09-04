"""
BioLab Manager - Excel Exporter Module
Tạo và xuất các báo cáo Excel chuẩn hóa (định dạng XML Spreadsheet .xls / UTF-8 CSV)
Tương thích 100% với Microsoft Excel, Google Sheets, LibreOffice, không bị lỗi font tiếng Việt.
"""

import sqlite3
import html
from database import get_db

def generate_excel_xml(title: str, headers: list, rows: list) -> str:
    """Tạo file XML Excel Spreadsheet 2003 chuẩn, hỗ trợ định dạng màu sắc, viền, font tiếng Việt"""
    header_cells = "".join([f'<Cell ss:StyleID="HeaderStyle"><Data ss:Type="String">{html.escape(str(h))}</Data></Cell>' for h in headers])
    
    row_elements = []
    for row in rows:
        cells = []
        for cell in row:
            val = str(cell) if cell is not None else ""
            try:
                if isinstance(cell, (int, float)) and not isinstance(cell, bool):
                    cells.append(f'<Cell ss:StyleID="NumberStyle"><Data ss:Type="Number">{cell}</Data></Cell>')
                else:
                    cells.append(f'<Cell ss:StyleID="DataStyle"><Data ss:Type="String">{html.escape(val)}</Data></Cell>')
            except:
                cells.append(f'<Cell ss:StyleID="DataStyle"><Data ss:Type="String">{html.escape(val)}</Data></Cell>')
        row_elements.append(f'<Row>{"".join(cells)}</Row>')
    
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="11" ss:Color="#000000"/>
  </Style>
  <Style ss:ID="TitleStyle">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="16" ss:Bold="1" ss:Color="#0D9488"/>
  </Style>
  <Style ss:ID="HeaderStyle">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#94A3B8"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#94A3B8"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#94A3B8"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#94A3B8"/>
   </Borders>
   <Font ss:FontName="Segoe UI" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#0F766E" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="DataStyle">
   <Alignment ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
   </Borders>
   <Font ss:FontName="Segoe UI" ss:Size="10"/>
  </Style>
  <Style ss:ID="NumberStyle">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
   </Borders>
   <Font ss:FontName="Segoe UI" ss:Size="10"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="{html.escape(title[:30])}">
  <Table>
   {''.join('<Column ss:Width="140"/>' for _ in headers)}
   <Row ss:Height="30">
    <Cell ss:MergeAcross="{len(headers)-1}" ss:StyleID="TitleStyle"><Data ss:Type="String">{html.escape(title.upper())}</Data></Cell>
   </Row>
   <Row ss:Height="10"/>
   <Row ss:Height="25">
    {header_cells}
   </Row>
   {"".join(row_elements)}
  </Table>
 </Worksheet>
</Workbook>"""
    return xml

def export_sessions_schedule() -> str:
    """1. Xuất Lịch sử dụng phòng thực hành của các Giáo viên"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT 
        s.id, s.session_date, s.period_slot, s.class_name, s.grade_level,
        s.title, u.full_name as teacher_name, s.status, s.created_at
    FROM lab_sessions s
    JOIN users u ON s.teacher_id = u.id
    ORDER BY s.session_date DESC, s.period_slot ASC
    """)
    rows = cursor.fetchall()
    conn.close()

    headers = ["STT", "Ngày thực hành", "Buổi & Tiết học", "Lớp Chuyên", "Khối", "Tên bài thực hành", "Giáo viên hướng dẫn", "Trạng thái ca"]
    status_map = {
        "PENDING": "Chờ duyệt",
        "APPROVED_LAB": "Đã duyệt - Phòng thực hành",
        "APPROVED_CLASS": "Đã duyệt - Dạy tại lớp",
        "IN_PROGRESS": "Đang thực hiện",
        "PENDING_ACCEPTANCE": "Chờ nghiệm thu sau tiết học",
        "REDO_5S": "Yêu cầu bổ sung 5S",
        "COMPLETED": "Đã nghiệm thu và hoàn tất",
        "REJECTED": "Không đồng ý",
        "CANCELLED": "Đã hủy"
    }

    data_rows = []
    for idx, r in enumerate(rows, 1):
        data_rows.append([
            idx,
            r["session_date"],
            r["period_slot"],
            r["class_name"],
            f"Khối {r['grade_level']}",
            r["title"],
            r["teacher_name"],
            status_map.get(r["status"], r["status"])
        ])

    return generate_excel_xml("Lịch Sử Dụng Phòng Thực Hành Sinh Học", headers, data_rows)

def export_equipment_usage() -> str:
    """2. Xuất Báo cáo Tổng hợp Thiết bị đã được sử dụng theo 5 Phân khu"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT 
        e.code, e.name, e.zone, e.category, e.total_qty, e.unit,
        COUNT(bi.id) as times_used,
        COALESCE(SUM(bi.quantity), 0) as total_qty_borrowed,
        e.status
    FROM equipment e
    LEFT JOIN session_borrow_items bi ON e.id = bi.equipment_id
    GROUP BY e.id
    ORDER BY e.zone ASC, times_used DESC
    """)
    rows = cursor.fetchall()
    conn.close()

    zone_map = {
        "ZONE_A": "Khu A: Đo lường & Điện tử",
        "ZONE_B": "Khu B: Thủy tinh & Thao tác",
        "ZONE_C": "Khu C: Hóa chất & Dung dịch",
        "ZONE_D": "Khu D: Bộ Kit & Mô hình",
        "ZONE_E": "Khu E: Học liệu & Tranh ảnh"
    }

    headers = ["STT", "Mã thiết bị", "Tên thiết bị / Dụng cụ", "Phân khu 5S", "Loại", "Tổng có", "Đơn vị", "Số lượt mượn", "Tổng SL đã dùng", "Tình trạng"]
    data_rows = []
    for idx, r in enumerate(rows, 1):
        data_rows.append([
            idx,
            r["code"],
            r["name"],
            zone_map.get(r["zone"], r["zone"]),
            r["category"],
            r["total_qty"],
            r["unit"],
            r["times_used"],
            r["total_qty_borrowed"],
            "Tốt" if r["status"] == "GOOD" else "Cần bảo trì"
        ])

    return generate_excel_xml("Tổng Hợp Tần Suất Sử Dụng Thiết Bị 5 Phân Khu", headers, data_rows)

def export_breakages_report() -> str:
    """3. Xuất Danh sách Thiết bị vỡ, hỏng, mất mát để quản lý bồi hoàn"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT 
        b.id, s.session_date, s.class_name, b.group_number,
        e.code as eq_code, e.name as eq_name, e.zone,
        b.quantity, e.unit, b.reason, b.cost_estimate, b.is_resolved,
        u.full_name as teacher_name
    FROM breakage_reports b
    JOIN lab_sessions s ON b.session_id = s.id
    JOIN equipment e ON b.equipment_id = e.id
    JOIN users u ON s.teacher_id = u.id
    ORDER BY s.session_date DESC, b.id DESC
    """)
    rows = cursor.fetchall()
    conn.close()

    headers = ["STT", "Ngày xảy ra", "Lớp Chuyên", "Bàn / Nhóm", "Mã thiết bị", "Tên thiết bị hỏng/vỡ", "Số lượng", "Đơn vị", "Nguyên nhân / Mô tả sự cố", "Dự toán đền bù (VNĐ)", "Giáo viên đứng lớp", "Trạng thái bồi hoàn"]
    data_rows = []
    for idx, r in enumerate(rows, 1):
        data_rows.append([
            idx,
            r["session_date"],
            r["class_name"],
            f"Nhóm {r['group_number']}" if r["group_number"] else "Toàn lớp",
            r["eq_code"],
            r["eq_name"],
            r["quantity"],
            r["unit"],
            r["reason"],
            f"{int(r['cost_estimate']):,} đ" if r["cost_estimate"] else "0 đ",
            r["teacher_name"],
            "Đã xử lý / Bồi thường xong" if r["is_resolved"] else "Chưa xử lý"
        ])

    return generate_excel_xml("Báo Cáo Thiết Bị Hỏng Vỡ & Theo Dõi Bồi Hoàn", headers, data_rows)

def export_teacher_usage_summary(period_filter: str = "YEAR", time_val: str = "") -> str:
    """4. Mỗi dòng là một bài thực hành đã dạy tại phòng Lab, kèm tổng số tiết theo giáo viên."""
    conn = get_db()
    cursor = conn.cursor()
    period_filter = (period_filter or "YEAR").upper()
    date_condition = ""
    if period_filter == "WEEK":
        date_condition = "AND date(s.session_date) >= date('now', '-6 days')"
    elif period_filter == "MONTH":
        date_condition = "AND strftime('%Y-%m', s.session_date) = strftime('%Y-%m', 'now')"

    cursor.execute(f"""
    SELECT s.session_date, u.id AS teacher_id, u.full_name AS teacher_name,
           s.class_name, s.title, s.period_start, s.period_end, s.status
    FROM lab_sessions s
    JOIN users u ON u.id = s.teacher_id
    WHERE u.role = 'TEACHER'
      AND s.approved_location = 'LAB'
      AND s.status IN ('IN_PROGRESS','PENDING_ACCEPTANCE','REDO_5S','COMPLETED')
      {date_condition}
    ORDER BY u.full_name ASC, s.session_date ASC, s.period_start ASC
    """)
    lessons = cursor.fetchall()
    headers = ["STT", "Ngày", "Giáo viên", "Lớp", "Bài thực hành đã dạy", "Tiết học", "Số tiết", "Trạng thái"]
    status_map = {"IN_PROGRESS": "Đang thực hiện", "PENDING_ACCEPTANCE": "Chờ nghiệm thu", "REDO_5S": "Cần bổ sung 5S", "COMPLETED": "Đã hoàn tất"}
    data_rows = []
    current_teacher = None
    teacher_name = ""
    total_periods = total_lessons = 0
    row_no = 1
    for lesson in lessons:
        if current_teacher is not None and current_teacher != lesson["teacher_id"]:
            data_rows.append(["", "", f"TỔNG CỘNG {teacher_name}", "", f"{total_lessons} bài thực hành", "", total_periods, ""])
            total_periods = total_lessons = 0
        periods = max(1, (lesson["period_end"] or 1) - (lesson["period_start"] or 1) + 1)
        data_rows.append([row_no, lesson["session_date"], lesson["teacher_name"], lesson["class_name"], lesson["title"], f"Tiết {lesson['period_start']}–{lesson['period_end']}", periods, status_map.get(lesson["status"], lesson["status"])])
        current_teacher = lesson["teacher_id"]
        teacher_name = lesson["teacher_name"]
        total_periods += periods
        total_lessons += 1
        row_no += 1
    if current_teacher is not None:
        data_rows.append(["", "", f"TỔNG CỘNG {teacher_name}", "", f"{total_lessons} bài thực hành", "", total_periods, ""])

    conn.close()
    filter_label = {"YEAR": "Cả năm học", "MONTH": "Tháng hiện tại", "WEEK": "7 ngày gần nhất"}.get(period_filter, period_filter)
    return generate_excel_xml(f"Bảng Tổng Kết Giáo Viên Dạy Phòng Lab ({filter_label})", headers, data_rows)
