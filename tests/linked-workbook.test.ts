import { beforeAll, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import XLSX from "xlsx-js-style";
import { unzipSync, zipSync, strFromU8 } from "fflate";
import { readFileSync, readdirSync } from "node:fs";
import { updateLinkedWorkbook } from "../src/excel/linked-workbook";
import { readExcel, parseExcel, exportExcel } from "../src/excel/excel";
import { emptySnapshot, type Snapshot } from "../src/domain/task";
beforeAll(() => {
  const w = new JSDOM("").window;
  globalThis.DOMParser = w.DOMParser;
  globalThis.XMLSerializer = w.XMLSerializer;
});
function data(): Snapshot {
  return {
    ...emptySnapshot(),
    tasks: [
      {
        id: crypto.randomUUID(),
        title: "변경된 일정",
        start_date: "2026-09-07",
        end_date: "2026-09-13",
        notes: "메모 첫 줄\n둘째 줄",
        color: "123456",
        done: true,
        sort_order: 0,
        display_row: null,
        created_at: "2026-09-07T00:00:00Z",
        updated_at: "2026-09-07T00:00:00Z",
      },
    ],
    custom_colors: [{ hex: "123456", label: "분류", sort_order: 0 }],
  };
}
function workbook() {
  const w = XLSX.read(exportExcel(data()), { type: "array", cellStyles: true });
  const other = XLSX.utils.aoa_to_sheet([["다른 시트", 7], ["계산"]]);
  other.B2 = {
    t: "n",
    f: "B1*3",
    v: 21,
    s: { font: { bold: true, color: { rgb: "ABCDEF" } } },
  };
  other.A1.c = [{ a: "Someone", t: "보존할 메모" }];
  XLSX.utils.book_append_sheet(w, other, "원본 수식");
  w.Workbook = { Names: [{ Name: "KeepName", Ref: "'원본 수식'!$B$1" }] };
  return new Uint8Array(
    XLSX.write(w, { type: "array", bookType: "xlsx", bookSST: true }),
  );
}
it("patches the connected schedule, preserves unrelated sheet bytes/formulas/comments and replaces ColorDB", () => {
  const source = workbook(),
    original = unzipSync(source),
    out = updateLinkedWorkbook(source, "Sheet2", data()),
    parts = unzipSync(out);
  for (const [p, b] of Object.entries(original))
    if (
      ![
        "xl/worksheets/sheet1.xml",
        "xl/worksheets/sheet2.xml",
        "xl/worksheets/_rels/sheet1.xml.rels",
        "xl/worksheets/_rels/sheet2.xml.rels",
        "xl/styles.xml",
        "xl/workbook.xml",
        "xl/_rels/workbook.xml.rels",
        "[Content_Types].xml",
      ].includes(p)
    )
      expect(parts[p], p).toEqual(b);
  const w = XLSX.read(out, { type: "array", cellStyles: true });
  expect(w.Sheets["원본 수식"].B2.f).toBe("B1*3");
  expect(w.Sheets["원본 수식"].A1.c?.[0].t).toBe("보존할 메모");
  expect(w.Workbook?.Names?.[0].Name).toBe("KeepName");
  const parsed = parseExcel(readExcel(out), "Sheet2", 2026);
  expect(parsed.data.tasks[0]).toMatchObject({
    title: "변경된 일정",
    done: true,
    color: "123456",
    notes: "메모 첫 줄\n둘째 줄",
  });
  expect(parsed.data.custom_colors[0].label).toBe("분류");
});
it("does not grow style tables with repeated saves and can save an empty schedule", () => {
  const once = updateLinkedWorkbook(workbook(), "Sheet2", data()),
    twice = updateLinkedWorkbook(once, "Sheet2", data());
  const styles = (b: Uint8Array) =>
    new DOMParser().parseFromString(
      strFromU8(unzipSync(b)["xl/styles.xml"]),
      "application/xml",
    );
  for (const name of ["fonts", "fills", "borders", "cellStyleXfs", "cellXfs"])
    expect(styles(twice).getElementsByTagName(name)[0].children.length).toBe(
      styles(once).getElementsByTagName(name)[0].children.length,
    );
  const empty = updateLinkedWorkbook(twice, "Sheet2", emptySnapshot());
  const parsed = parseExcel(readExcel(empty), "Sheet2", 2026);
  expect(parsed.data.tasks).toHaveLength(0);
  expect(parsed.data.custom_colors).toHaveLength(0);
});
it.skipIf(!readdirSync(".").some((f) => f.endsWith(".xlsx")))(
  "preserves every unrelated ZIP part in the two real workbooks, including oversized themes",
  () => {
    for (const name of readdirSync(".").filter((f) => f.endsWith(".xlsx"))) {
      const source = new Uint8Array(readFileSync(name)),
        before = unzipSync(source),
        out = updateLinkedWorkbook(source, "Sheet2", data()),
        after = unzipSync(out);
      const wb = new DOMParser().parseFromString(
        strFromU8(before["xl/workbook.xml"]),
        "application/xml",
      );
      const rels = new DOMParser().parseFromString(
        strFromU8(before["xl/_rels/workbook.xml.rels"]),
        "application/xml",
      );
      const targets = [...wb.getElementsByTagName("sheet")]
        .filter((s) => ["Sheet2", "ColorDB"].includes(s.getAttribute("name")!))
        .map((s) =>
          [...rels.getElementsByTagName("Relationship")]
            .find((r) => r.getAttribute("Id") === s.getAttribute("r:id"))!
            .getAttribute("Target")!,
        )
        .map((p) => (p.startsWith("/") ? p.slice(1) : "xl/" + p));
      const changed = new Set([
        ...targets,
        ...targets.map((p) => p.replace(/([^/]+)$/, "_rels/$1.rels")),
        "xl/styles.xml",
        "xl/workbook.xml",
        "xl/_rels/workbook.xml.rels",
        "[Content_Types].xml",
        "xl/calcChain.xml",
      ]);
      for (const [p, b] of Object.entries(before))
        if (!changed.has(p)) expect(after[p], `${name}: ${p}`).toEqual(b);
      expect(
        parseExcel(readExcel(out), "Sheet2", 2026).data.tasks[0].title,
      ).toBe("변경된 일정");
    }
  },
);
it("refuses signed packages and missing schedule targets", () => {
  const source = workbook();
  expect(() => updateLinkedWorkbook(source, "missing", data())).toThrow();
  const z = unzipSync(source);
  z["_xmlsignatures/sig1.xml"] = new Uint8Array();
  expect(() => updateLinkedWorkbook(zipSync(z), "Sheet2", data())).toThrow(
    "전자 서명",
  );
});
