import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import XLSX from "xlsx-js-style";
import { unzipSync, strFromU8 } from "fflate";
import { exportExcel, readExcel, parseExcel } from "../src/excel/excel";
import { updateLinkedWorkbook } from "../src/excel/linked-workbook";
import { connectionPlan } from "../src/services/excel-connection";
import type { Snapshot } from "../src/domain/task";

beforeAll(() => {
  const dom = new JSDOM("").window;
  globalThis.DOMParser = dom.DOMParser;
  globalThis.XMLSerializer = dom.XMLSerializer;
});
const original = () =>
  new Uint8Array(readFileSync("tests/fixtures/v2.0.3-schedule.xlsx"));
const data = (): Snapshot =>
  JSON.parse(readFileSync("tests/fixtures/v2.0.3-snapshot.json", "utf8"));
const read = (bytes: Uint8Array) =>
  parseExcel(readExcel(bytes), "Sheet2", 2026);
const xml = (bytes: Uint8Array) =>
  new DOMParser().parseFromString(strFromU8(bytes), "application/xml");

it("adds day numbers in place for short months, year rollover and leap day without changing the task layout", () => {
  const before = read(original());
  const bytes = new Uint8Array(exportExcel(data()));
  const after = read(bytes);
  expect(after.warnings).toEqual([]);
  expect(connectionPlan(before.data, after.data).needsConfirmation).toBe(false);
  const ws = readExcel(bytes).workbook.Sheets.Sheet2;
  for (const [label, day, expected] of [
    ["2026년 9월", 1, "1(화)"],
    ["2026년 9월", 30, "30(수)"],
    ["2026년 9월", 31, ""],
    ["2026년 12월", 31, "31(목)"],
    ["2027년 1월", 1, "1(금)"],
    ["2028년 2월", 29, "29(화)"],
    ["2028년 2월", 30, ""],
  ] as const) {
    const address = Object.keys(ws).find(
      (a) => /^A\d+$/.test(a) && ws[a].v === label,
    )!;
    const row = XLSX.utils.decode_cell(address).r;
    expect(ws[XLSX.utils.encode_cell({ r: row, c: day })]?.v ?? "").toBe(
      expected,
    );
  }
  expect(ws.B2.v).toBe(1);
  expect(ws.AF2.v).toBe(31);
  expect(ws["!merges"]).toEqual(
    readExcel(original()).workbook.Sheets.Sheet2["!merges"],
  );
});

it("hides every exported note while keeping all detailed text readable by the app", () => {
  const bytes = new Uint8Array(exportExcel(data()));
  const zip = unzipSync(bytes);
  const drawings = Object.entries(zip).filter(([p]) => p.endsWith(".vml"));
  expect(drawings.length).toBeGreaterThan(0);
  for (const [, bytes] of drawings) {
    const doc = xml(bytes);
    const shapes = [
      ...doc.getElementsByTagNameNS("urn:schemas-microsoft-com:vml", "shape"),
    ];
    expect(shapes.length).toBeGreaterThan(0);
    for (const shape of shapes)
      expect(shape.getAttribute("style")).toContain("visibility:hidden");
    expect(
      doc.getElementsByTagNameNS(
        "urn:schemas-microsoft-com:office:excel",
        "Visible",
      ),
    ).toHaveLength(0);
  }
  for (const task of read(bytes).data.tasks)
    expect(task.notes).toBe(data().tasks[0].notes);
});

it("updates an existing 2.0.3 file repeatedly without changing its tasks, source snapshot or unrelated worksheet", () => {
  const input = original(),
    snapshot = read(input).data;
  const snapshotBefore = JSON.stringify(snapshot);
  const once = updateLinkedWorkbook(input, "Sheet2", snapshot);
  const twice = updateLinkedWorkbook(once, "Sheet2", snapshot);
  expect(JSON.stringify(snapshot)).toBe(snapshotBefore);
  for (const bytes of [once, twice]) {
    expect(connectionPlan(snapshot, read(bytes).data).needsConfirmation).toBe(
      false,
    );
    const zip = unzipSync(bytes);
    expect(zip["xl/worksheets/sheet3.xml"]).toEqual(
      unzipSync(input)["xl/worksheets/sheet3.xml"],
    );
    const relationships = xml(zip["xl/worksheets/_rels/sheet1.xml.rels"]);
    const rel = [...relationships.getElementsByTagName("Relationship")].find(
      (r) => r.getAttribute("Type")?.endsWith("/vmlDrawing"),
    )!;
    const vml = strFromU8(zip[rel.getAttribute("Target")!.slice(1)]);
    expect(vml).toContain("visibility:hidden");
    expect(vml).not.toContain("<x:Visible/>");
  }
});
