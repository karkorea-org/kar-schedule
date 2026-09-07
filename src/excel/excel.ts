import XLSX from "xlsx-js-style";
import { unzipSync } from "fflate";
import { buildMceStyleMap, sanitizeWorkbookForXlsxRead } from "./legacy-style";
import { buildMonthlySheet } from "./legacy-report";
import {
  emptySnapshot,
  validateSnapshot,
  type Snapshot,
  type Task,
} from "../domain/task";
import { months, monthRange, WEEKDAYS } from "../domain/date";
import { layout } from "../calendar/layout";
export interface ExcelSource {
  workbook: XLSX.WorkBook;
  colors: Record<string, Record<string, string>> | null;
  candidates: string[];
  blankSheets: string[];
}
// Formatting alone is allowed, but formulas, notes, links and drawings are content.
function isBlankSheet(ws: XLSX.WorkSheet): boolean {
  return (
    !ws["!merges"]?.length &&
    Object.entries(ws).every(
      ([key, cell]) =>
        key.startsWith("!") ||
        (!cell.f &&
          !cell.c?.length &&
          !cell.l &&
          (cell.v === undefined || cell.v === null || cell.v === "")),
    )
  );
}
const value = (ws: XLSX.WorkSheet, r: number, c: number) =>
  ws[XLSX.utils.encode_cell({ r, c })]?.v;
export function readExcel(bytes: Uint8Array): ExcelSource {
  if (bytes.length > 30 * 1024 * 1024)
    throw new Error("Excel 파일은 30MB 이내로 선택하세요.");
  let total = 0,
    count = 0;
  unzipSync(bytes, {
    filter(entry) {
      total += entry.originalSize;
      count++;
      if (
        total > 80 * 1024 * 1024 ||
        count > 5000 ||
        entry.originalSize > 30 * 1024 * 1024
      )
        throw new Error("Excel 압축 해제 크기가 너무 큽니다.");
      return false;
    },
  });
  const safe = sanitizeWorkbookForXlsxRead(bytes);
  const workbook = XLSX.read(safe, { type: "array", cellStyles: true });
  const candidates = workbook.SheetNames.filter((name) => {
    const ws = workbook.Sheets[name];
    if (!ws["!ref"]) return false;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    if (range.e.r > 20000) return false;
    for (let r = range.s.r; r <= range.e.r; r++)
      if (/(?:^|\s)\d{1,2}\s*월/.test(String(value(ws, r, 0) ?? "")))
        return true;
    return false;
  });
  // A drawing or other sheet relationship must not be mistaken for a new blank file.
  const archive = unzipSync(bytes);
  const hasSheetObjects = Object.keys(archive).some(
    (p) =>
      /^xl\/(drawings|charts|tables|pivotTables|comments|threadedComments|media|embeddings)\//.test(
        p,
      ) ||
      /^xl\/worksheets\/_rels\//.test(p) ||
      p.startsWith("_xmlsignatures/"),
  );
  const blankSheets = hasSheetObjects
    ? []
    : workbook.SheetNames.filter(
        (name) => name !== "ColorDB" && isBlankSheet(workbook.Sheets[name]),
      );
  if (!candidates.length && !blankSheets.length)
    throw new Error(
      "업무일지 양식을 찾지 못했습니다. 기존 업무일지 파일 또는 내용이 없는 새 .xlsx 파일을 선택하세요. 일반 표 형식은 아직 지원하지 않습니다.",
    );
  return {
    workbook,
    colors: buildMceStyleMap(safe),
    candidates: [...candidates, ...blankSheets],
    blankSheets,
  };
}
export function parseExcel(
  source: ExcelSource,
  sheet: string,
  baseYear: number,
): {
  data: Snapshot;
  warnings: string[];
  notices: string[];
  incomplete: boolean;
  blank: boolean;
} {
  if (!Number.isInteger(baseYear) || baseYear < 1900 || baseYear > 9999)
    throw new Error("기준 연도를 확인하세요.");
  const ws = source.workbook.Sheets[sheet],
    data = emptySnapshot(),
    warnings: string[] = [],
    notices: string[] = [];
  if (!source.candidates.includes(sheet))
    throw new Error("일정 시트를 선택하세요.");
  if (source.blankSheets.includes(sheet))
    return { data, warnings, notices, incomplete: false, blank: true };
  let incomplete = false;
  const range = XLSX.utils.decode_range(ws["!ref"]!),
    merges = ws["!merges"] ?? [];
  if (range.e.r > 20000 || range.e.c > 2000)
    throw new Error("시트의 행/열 범위가 너무 큽니다.");
  let year = baseYear,
    explicit = false;
  for (let r = 0; r <= Math.min(5, range.e.r); r++)
    for (let c = 0; c <= Math.min(range.e.c, 31); c++) {
      const match = String(value(ws, r, c) ?? "").match(/(\d{4})\s*년/);
      if (match) {
        year = Number(match[1]);
        explicit = true;
        break;
      }
      if (explicit) break;
    }
  if (!explicit)
    notices.push(
      `연도 표시가 없어 ${baseYear}년을 기준으로 읽었습니다. 실제 연도를 확인하세요.`,
    );
  const blocks: { row: number; month: number; year?: number }[] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const text = String(value(ws, r, 0) ?? ""),
      m = text.match(/(?:^|\s)(\d{1,2})\s*월/),
      y = text.match(/(\d{4})\s*년/);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12)
      blocks.push({
        row: r,
        month: Number(m[1]),
        year: y ? Number(y[1]) : undefined,
      });
  }
  let previous = 0;
  const now = new Date().toISOString();
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.year) year = b.year;
    else if (b.month < previous) year++;
    previous = b.month;
    const key = `${year}-${String(b.month).padStart(2, "0")}`,
      lastDay = Number(monthRange(key)[1].slice(8));
    const merge = merges.find((m) => m.s.r === b.row && m.s.c === 0);
    const nextEnd = blocks[i + 1] ? blocks[i + 1].row - 1 : range.e.r;
    const endRow = Math.min(merge?.e.r ?? nextEnd, nextEnd);
    for (let r = b.row + 1; r <= endRow; r++) {
      let headerMatches = 0;
      for (let c = 1; c <= 31; c++) if (value(ws, r, c) === c) headerMatches++;
      if (headerMatches >= 20) continue;
      for (let c = 1; c <= 31; c++) {
        const addr = XLSX.utils.encode_cell({ r, c }),
          cell = ws[addr];
        if (
          !cell ||
          cell.v === null ||
          cell.v === undefined ||
          String(cell.v).trim() === ""
        )
          continue;
        if (
          merges.some(
            (m) =>
              m.s.r <= r &&
              m.e.r >= r &&
              m.s.c <= c &&
              m.e.c >= c &&
              (m.s.r !== r || m.s.c !== c),
          )
        )
          continue;
        const title = String(cell.v).trim();
        if (WEEKDAYS.includes(title)) continue;
        const m = merges.find((m) => m.s.r === r && m.s.c === c),
          end = m?.e.c ?? c;
        if (c > lastDay || end > lastDay || end < c || (m && m.e.r !== r)) {
          incomplete = true;
          warnings.push(
            `${addr}: 월 일수 또는 병합 범위가 잘못되어 제외했습니다.`,
          );
          continue;
        }
        const style = cell.s as
          | {
              fgColor?: { rgb?: string };
              fill?: { fgColor?: { rgb?: string } };
            }
          | undefined;
        let color =
          source.colors?.[sheet]?.[addr] ??
          style?.fgColor?.rgb ??
          style?.fill?.fgColor?.rgb ??
          null;
        if (color?.length === 8) color = color.slice(2);
        if (color && !/^[0-9a-f]{6}$/i.test(color)) {
          warnings.push(`${addr}: 지원하지 않는 색상입니다.`);
          color = null;
        }
        const t: Task = {
          id: crypto.randomUUID(),
          title: title.startsWith("✓ ") ? title.slice(2) : title,
          start_date: `${key}-${String(c).padStart(2, "0")}`,
          end_date: `${key}-${String(end).padStart(2, "0")}`,
          notes: (cell.c ?? [])
            .map((x: { t?: string }) => x.t ?? "")
            .join("\n"),
          done: title.startsWith("✓ "),
          color: color?.toUpperCase() ?? null,
          sort_order: data.tasks.length,
          display_row: null,
          created_at: now,
          updated_at: now,
        };
        data.tasks.push(t);
        data.task_month_layout.push({
          task_id: t.id,
          month_key: key,
          display_row: r - b.row - 1,
          sort_order: t.sort_order,
        });
      }
    }
  }
  const colors = source.workbook.Sheets.ColorDB;
  if (colors?.["!ref"]) {
    const r = XLSX.utils.decode_range(colors["!ref"]);
    for (let i = 0; i <= Math.min(r.e.r, 512); i++) {
      const hex = String(value(colors, i, 0) ?? "")
          .replace("#", "")
          .toUpperCase(),
        label = String(value(colors, i, 1) ?? "커스텀").trim() || "커스텀";
      if (
        /^[0-9A-F]{6}$/.test(hex) &&
        !data.custom_colors.some((c) => c.hex === hex)
      )
        data.custom_colors.push({ hex, label, sort_order: i });
    }
  }
  validateSnapshot(data);
  return { data, warnings, notices, incomplete, blank: false };
}
export function exportExcel(
  snapshot: Snapshot,
  emptyMonths: string[] = [],
): Uint8Array {
  validateSnapshot(snapshot);
  if (!snapshot.tasks.length && !emptyMonths.length)
    throw new Error("내보낼 업무가 없습니다.");
  const keys = new Set([
      ...emptyMonths,
      ...snapshot.tasks.flatMap((t) => months(t.start_date, t.end_date)),
    ]),
    monthData: Record<string, { tasks: unknown[] }> = {};
  for (const key of [...keys].sort()) {
    const [a, b] = monthRange(key);
    monthData[key] = {
      tasks: layout(snapshot, a, b).map((x) => ({
        title: x.task.title,
        start: Number(x.start.slice(8)),
        end: Number(x.end.slice(8)),
        notes: x.task.notes,
        color: x.task.color,
        done: x.task.done,
        sortIndex: x.order,
        row: x.row,
      })),
    };
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    buildMonthlySheet(monthData, true),
    "Sheet2",
  );
  if (snapshot.custom_colors.length)
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(
        snapshot.custom_colors.map((c) => [c.hex, c.label]),
      ),
      "ColorDB",
    );
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
}
