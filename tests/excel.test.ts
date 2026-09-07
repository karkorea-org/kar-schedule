import { beforeAll, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import XLSX from "xlsx-js-style";
import { readExcel, parseExcel, exportExcel } from "../src/excel/excel";
import { emptySnapshot, type Task } from "../src/domain/task";
import { readFileSync, readdirSync } from "node:fs";
beforeAll(() => {
  globalThis.DOMParser = new JSDOM("").window.DOMParser;
});
it("round trips year, completed state, multiline notes, fill, month rows and ColorDB", () => {
  const t: Task = {
    id: crypto.randomUUID(),
    title: "완료 업무",
    start_date: "2027-09-28",
    end_date: "2027-10-03",
    notes: "메모\n둘째 줄",
    done: true,
    color: "112233",
    sort_order: 0,
    display_row: 2,
    created_at: "2026-09-07T00:00:00Z",
    updated_at: "2026-09-07T00:00:00Z",
  };
  const bytes = new Uint8Array(
    exportExcel({
      ...emptySnapshot(),
      tasks: [t],
      custom_colors: [{ hex: "112233", label: "검토", sort_order: 0 }],
    }),
  );
  const source = readExcel(bytes),
    result = parseExcel(source, "Sheet2", 2026);
  expect(result.data.tasks).toHaveLength(2);
  expect(result.data.tasks[0]).toMatchObject({
    start_date: "2027-09-28",
    end_date: "2027-09-30",
    done: true,
    title: t.title,
    notes: t.notes,
    color: t.color,
  });
  expect(result.data.tasks[1].end_date).toBe("2027-10-03");
  expect(result.data.custom_colors[0].label).toBe("검토");
  const ws = source.workbook.Sheets.Sheet2;
  expect(ws["!merges"]?.[0]).toEqual({ s: { r: 0, c: 0 }, e: { r: 0, c: 31 } });
});
it.skipIf(!readdirSync(".").some((f) => f.endsWith(".xlsx")))(
  "finds real monthly sheets without classifying numeric-header Sheet1 as schedules",
  () => {
    for (const file of readdirSync(".").filter((f) => f.endsWith(".xlsx"))) {
      const s = readExcel(new Uint8Array(readFileSync(file)));
      expect(s.candidates).not.toContain("Sheet1");
      expect(s.candidates).toContain("Sheet2");
      const p = parseExcel(s, "Sheet2", 2026);
      expect(p.data.tasks.length).toBeGreaterThan(0);
    }
  },
);
it("does not reinterpret invalid month-day cells or arbitrary workbooks", () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["2026년"],
      ["일", ...Array.from({ length: 31 }, (_, i) => i + 1)],
      ["2월"],
      Array.from({ length: 32 }, (_, i) => (i === 31 ? "invalid" : "")),
    ]),
    "Sheet2",
  );
  const s = readExcel(
    new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" })),
  );
  const p = parseExcel(s, "Sheet2", 2026);
  expect(p.data.tasks).toHaveLength(0);
  expect(p.warnings.some((w) => w.includes("제외"))).toBe(true);
});
