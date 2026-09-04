import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const input = await FileBlob.load("C:/Users/Admin/Desktop/class/inventory-import-source.xlsx");
const workbook = await SpreadsheetFile.importXlsx(input);
const rows = [];
for (let si = 0; si < workbook.worksheets.items.length; si++) {
  const sheet = workbook.worksheets.getItemAt(si);
  const used = sheet.getUsedRange();
  const values = used.values;
  let category = si === 1 ? "Tài sản cố định" : "Thiết bị dùng chung";
  let gradeLevel = null;
  for (const row of values) {
    const [stt, rawName, brand, year, unit, rawQty, condition, note] = row;
    const name = String(rawName ?? "").replace(/\s+/g, " ").trim();
    const qty = Number(String(rawQty ?? "").replace(/^0+/, "") || 0);
    if (!name) continue;
    if (!Number.isFinite(qty) || qty <= 0 || !unit) {
      const upper = name.toUpperCase();
      if (/^LỚP\s*10$/.test(upper)) gradeLevel = 10;
      else if (/^LỚP\s*11$/.test(upper)) gradeLevel = 11;
      else if (/^LỚP\s*12$/.test(upper)) gradeLevel = 12;
      else if (upper.includes("TRANH")) category = "Tranh ảnh";
      else if (upper.includes("MÔ HÌNH") || upper.includes("MẪU VẬT")) category = "Mô hình, mẫu vật";
      else if (upper === "DỤNG CỤ") category = "Dụng cụ thí nghiệm";
      else if (upper.includes("HOÁ CHẤT") || upper.includes("HÓA CHẤT")) category = "Hóa chất";
      else if (upper.includes("VIDEO")) category = "Học liệu điện tử";
      else if (upper.includes("THIẾT BỊ DÙNG CHUNG")) { category = "Thiết bị dùng chung"; gradeLevel = null; }
      continue;
    }
    rows.push({
      sourceSheet: sheet.name.trim(), name, brand: brand ? String(brand).trim() : "",
      year: Number(year) || null, unit: String(unit).trim(), quantity: qty,
      condition: condition ? String(condition).replace(/\s+/g, " ").trim() : "",
      note: note ? String(note).replace(/\s+/g, " ").trim() : "",
      category, gradeLevel
    });
  }
}
await fs.writeFile("C:/Users/Admin/Desktop/class/inventory_rows.json", JSON.stringify(rows, null, 2), "utf8");
console.log(JSON.stringify({extractedRows: rows.length, sheets: workbook.worksheets.items.map(s => s.name)}));
