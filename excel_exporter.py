"""
BioLab Manager - Excel Exporter Module
Tạo và xuất các báo cáo Excel chuẩn hóa (định dạng XML Spreadsheet .xls / UTF-8 CSV)
Tương thích 100% với Microsoft Excel, Google Sheets, LibreOffice, không bị lỗi font tiếng Việt.
"""

import sqlite3
import html
import json
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
        "PENDING_ACCEPTANCE": "Chờ đợi xác nhận",
        "REDO_5S": "Yêu cầu thực hiện lại",
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
    """2. Xuất Báo cáo Tổng hợp Thiết bị đã được sử dụng theo"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT 
        e.code, e.name, e.category, e.available_qty, e.unit,
        COUNT(be.id) as times_used,
        e.status
    FROM equipment e
    LEFT JOIN equipment_borrow_events be ON e.id = be.equipment_id
    GROUP BY e.id
    ORDER BY times_used DESC, e.code ASC
    """)
    rows = cursor.fetchall()
    conn.close()

    headers = ["STT", "Mã thiết bị", "Tên thiết bị / Dụng cụ", "Loại", "Tổng có", "Đơn vị", "Số lượt mượn", "Tình trạng"]
    data_rows = []
    for idx, r in enumerate(rows, 1):
        data_rows.append([
            idx,
            r["code"],
            r["name"],
            r["category"],
            r["available_qty"],
            r["unit"],
            r["times_used"],
            "Tốt" if r["status"] == "GOOD" else "Cần bảo trì"
        ])

    return generate_excel_xml("Tổng Hợp Tần Suất Sử Dụng Thiết Bị", headers, data_rows)

def export_breakages_report() -> str:
    """3. Xuất danh sách thiết bị vỡ, hỏng và trạng thái xác nhận sự cố."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT 
        b.id, s.session_date, s.period_slot, s.title, s.class_name,
        s.requested_location, s.approved_location, b.group_number,
        e.code as eq_code, e.name as eq_name, e.zone,
        b.quantity, e.unit, b.reason, b.is_resolved,
        u.full_name as teacher_name
    FROM breakage_reports b
    JOIN lab_sessions s ON b.session_id = s.id
    JOIN equipment e ON b.equipment_id = e.id
    JOIN users u ON s.teacher_id = u.id
    ORDER BY s.session_date DESC, b.id DESC
    """)
    rows = cursor.fetchall()
    conn.close()

    headers = ["STT", "Ngày xảy ra", "Tiết học", "Tên bài học", "Lớp Chuyên", "Giáo viên", "Địa điểm", "Bàn / Nhóm", "Mã thiết bị", "Tên thiết bị hỏng/vỡ", "Số lượng", "Đơn vị", "Nguyên nhân / Mô tả sự cố", "Trạng thái xác nhận"]
    data_rows = []
    for idx, r in enumerate(rows, 1):
        data_rows.append([
            idx,
            r["session_date"],
            r["period_slot"],
            r["title"],
            r["class_name"],
            r["teacher_name"],
            "Phòng thực hành" if r["approved_location"] == "LAB" else "Lớp học" if r["approved_location"] == "CLASS" else "Đề nghị tại lớp" if r["requested_location"] == "CLASS" else "Đề nghị phòng thực hành",
            f"Nhóm {r['group_number']}" if r["group_number"] else "Toàn lớp",
            r["eq_code"],
            r["eq_name"],
            r["quantity"],
            r["unit"],
            r["reason"],
            "Đã xác nhận và trừ kiểm kê" if r["is_resolved"] else "Chờ cán bộ xác nhận"
        ])

    return generate_excel_xml("Báo Cáo Sự Cố Thiết Bị", headers, data_rows)

def export_teacher_usage_summary() -> str:
    """Mỗi dòng là một phiếu trong toàn bộ lịch sử sử dụng phòng thí nghiệm."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT s.session_date, u.id AS teacher_id, u.full_name AS teacher_name,
           s.class_name, s.title, s.period_start, s.period_end, s.status,
           s.requested_location, s.approved_location, s.planned_items
    FROM lab_sessions s
    JOIN users u ON u.id = s.teacher_id
    WHERE u.role = 'TEACHER'
    ORDER BY u.full_name ASC, s.session_date ASC, s.period_start ASC
    """)
    lessons = cursor.fetchall()
    equipment_names = {row["code"]: row["name"] for row in cursor.execute("SELECT code, name FROM equipment")}
    headers = ["STT", "Ngày", "Giáo viên", "Lớp", "Bài thực hành", "Thiết bị/dụng cụ đăng ký", "Địa điểm", "Tiết học", "Trạng thái"]
    status_map = {
        "PENDING": "Chờ duyệt",
        "APPROVED_LAB": "Đã duyệt - Phòng thực hành",
        "APPROVED_CLASS": "Đã duyệt - Dạy tại lớp",
        "IN_PROGRESS": "Đang thực hiện",
        "PENDING_ACCEPTANCE": "Chờ đợi xác nhận",
        "REDO_5S": "Cần bổ sung 5S",
        "COMPLETED": "Đã nghiệm thu và hoàn tất",
        "REJECTED": "Không đồng ý",
        "CANCELLED": "Đã hủy"
    }
    data_rows = []
    row_no = 1
    for lesson in lessons:
        location = "Phòng thực hành" if lesson["approved_location"] == "LAB" else "Lớp học" if lesson["approved_location"] == "CLASS" else "Đề nghị tại lớp" if lesson["requested_location"] == "CLASS" else "Đề nghị phòng thực hành"
        planned_items = json.loads(lesson["planned_items"] or "[]")
        equipment_text = "; ".join(
            f"{equipment_names.get(item if isinstance(item, str) else item.get('code'), item if isinstance(item, str) else item.get('code'))} × {1 if isinstance(item, str) else item.get('quantity', 1)}"
            for item in planned_items
        ) or "Không đăng ký"
        data_rows.append([row_no, lesson["session_date"], lesson["teacher_name"], lesson["class_name"], lesson["title"], equipment_text, location, f"Tiết {lesson['period_start']}–{lesson['period_end']}", status_map.get(lesson["status"], lesson["status"])])
        row_no += 1

    conn.close()
    return generate_excel_xml("Lịch Sử Dùng Phòng Thí Nghiệm", headers, data_rows)
