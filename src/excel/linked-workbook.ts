import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import XLSX from "xlsx-js-style";
import { exportExcel } from "./excel";
import { buildMonthlySheet } from "./legacy-report";
import { today } from "../domain/date";
import type { Snapshot } from "../domain/task";

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
type Archive = Record<string, Uint8Array>;
function xml(bytes: Uint8Array | undefined): Document {
  if (!bytes) throw new Error("Excel 구성 파일이 없습니다.");
  const d = new DOMParser().parseFromString(
    strFromU8(bytes),
    "application/xml",
  );
  if (d.getElementsByTagName("parsererror").length)
    throw new Error("Excel XML이 손상되었습니다.");
  return d;
}
const bytes = (d: Document) =>
  strToU8(new XMLSerializer().serializeToString(d));
const children = (e: Element) => Array.from(e.children);
const elements = (d: Document | Element, ns: string, tag: string) =>
  Array.from(d.getElementsByTagNameNS(ns, tag));
function pathFrom(base: string, target: string): string {
  const parts: string[] = [];
  for (const part of (target.startsWith("/")
    ? target.slice(1)
    : base.slice(0, base.lastIndexOf("/") + 1) + target
  ).split("/")) {
    if (part === "..") {
      if (!parts.pop()) throw new Error("Excel 내부 경로가 잘못되었습니다.");
    } else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}
const relPath = (path: string) => path.replace(/([^/]+)$/, "_rels/$1.rels");
function sheetPaths(z: Archive) {
  const wb = xml(z["xl/workbook.xml"]),
    rels = xml(z["xl/_rels/workbook.xml.rels"]);
  const result = new Map<string, { path: string; id: string }>();
  for (const sheet of elements(wb, MAIN, "sheet")) {
    const rel = elements(rels, PKG, "Relationship").find(
      (r) => r.getAttribute("Id") === sheet.getAttributeNS(REL, "id"),
    );
    if (!rel || rel.getAttribute("TargetMode") === "External")
      throw new Error("지원하지 않는 Excel 시트 연결입니다.");
    result.set(sheet.getAttribute("name")!, {
      path: pathFrom("xl/workbook.xml", rel.getAttribute("Target")!),
      id: sheet.getAttribute("sheetId")!,
    });
  }
  return { wb, rels, sheets: result };
}
// Compare structures without incidental namespace declarations or attribute ordering.
function signature(e: Element): string {
  return JSON.stringify([
    e.namespaceURI,
    e.localName,
    Array.from(e.attributes)
      .filter((a) => a.namespaceURI !== "http://www.w3.org/2000/xmlns/")
      .map((a) => [a.namespaceURI, a.localName, a.value])
      .sort(),
    Array.from(e.childNodes)
      .filter(
        (n) => n.nodeType === 1 || (n.nodeType === 3 && n.textContent?.trim()),
      )
      .map((n) => (n.nodeType === 1 ? signature(n as Element) : n.textContent)),
  ]);
}
function mergeStyles(original: Document, generated: Document): number[] {
  const root = original.documentElement;
  const order = [
    "numFmts",
    "fonts",
    "fills",
    "borders",
    "cellStyleXfs",
    "cellXfs",
    "cellStyles",
    "dxfs",
    "tableStyles",
    "colors",
    "extLst",
  ];
  function collection(name: string) {
    let c = children(root).find((e) => e.localName === name);
    if (!c) {
      c = original.createElementNS(MAIN, name);
      root.insertBefore(
        c,
        children(root).find(
          (e) => order.indexOf(e.localName) > order.indexOf(name),
        ) ?? null,
      );
    }
    return c;
  }
  function append(
    name: string,
    change: (e: Element) => void = () => {},
  ): number[] {
    const target = collection(name),
      source = children(generated.documentElement).find(
        (e) => e.localName === name,
      );
    const known = new Map(children(target).map((e, i) => [signature(e), i]));
    const map = (source ? children(source) : []).map((e) => {
      const copy = original.importNode(e, true) as Element;
      change(copy);
      const key = signature(copy);
      let index = known.get(key);
      if (index === undefined) {
        index = target.children.length;
        target.append(copy);
        known.set(key, index);
      }
      return index;
    });
    target.setAttribute("count", String(target.children.length));
    return map;
  }
  const fmts = collection("numFmts"),
    fmtMap = new Map<number, number>();
  for (const fmt of elements(generated, MAIN, "numFmt")) {
    const old = Number(fmt.getAttribute("numFmtId")),
      code = fmt.getAttribute("formatCode");
    const found = children(fmts).find(
      (e) => e.getAttribute("formatCode") === code,
    );
    const id = found
      ? Number(found.getAttribute("numFmtId"))
      : Math.max(
          163,
          ...children(fmts).map((e) => Number(e.getAttribute("numFmtId"))),
        ) + 1;
    if (!found) {
      const copy = original.importNode(fmt, true) as Element;
      copy.setAttribute("numFmtId", String(id));
      fmts.append(copy);
    }
    fmtMap.set(old, id);
  }
  fmts.setAttribute("count", String(fmts.children.length));
  const fonts = append("fonts"),
    fills = append("fills"),
    borders = append("borders");
  const adjust = (e: Element) => {
    for (const [attr, map] of [
      ["fontId", fonts],
      ["fillId", fills],
      ["borderId", borders],
    ] as const)
      if (e.hasAttribute(attr))
        e.setAttribute(attr, String(map[Number(e.getAttribute(attr))]));
    const n = Number(e.getAttribute("numFmtId"));
    if (fmtMap.has(n)) e.setAttribute("numFmtId", String(fmtMap.get(n)));
  };
  const bases = append("cellStyleXfs", adjust);
  return append("cellXfs", (e) => {
    adjust(e);
    if (e.hasAttribute("xfId"))
      e.setAttribute("xfId", String(bases[Number(e.getAttribute("xfId"))]));
  });
}

/** Patch only the selected schedule and ColorDB; unrelated ZIP parts remain byte-identical. */
export function updateLinkedWorkbook(
  originalBytes: Uint8Array,
  sheet: string,
  snapshot: Snapshot,
): Uint8Array {
  let expanded = 0;
  const original = unzipSync(originalBytes, {
    filter: (e) => {
      expanded += e.originalSize;
      if (expanded > 80 * 1024 * 1024 || e.originalSize > 30 * 1024 * 1024)
        throw new Error("Excel 압축 크기가 너무 큽니다.");
      return true;
    },
  });
  if (Object.keys(original).some((p) => p.startsWith("_xmlsignatures/")))
    throw new Error(
      "전자 서명된 Excel은 연결 저장을 지원하지 않습니다. 사본으로 내보내세요.",
    );
  const out: Archive = { ...original },
    meta = sheetPaths(original),
    destination = meta.sheets.get(sheet);
  if (!destination || sheet === "ColorDB")
    throw new Error("연결한 일정 시트를 찾을 수 없습니다. 다시 연결하세요.");
  let generatedBytes: Uint8Array;
  if (snapshot.tasks.length)
    generatedBytes = new Uint8Array(exportExcel(snapshot));
  else {
    const w = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      w,
      buildMonthlySheet({ [today().slice(0, 7)]: { tasks: [] } }, true),
      "Sheet2",
    );
    generatedBytes = new Uint8Array(
      XLSX.write(w, { type: "array", bookType: "xlsx" }),
    );
  }
  const generated = unzipSync(generatedBytes),
    genMeta = sheetPaths(generated);
  const palette = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    palette,
    XLSX.utils.aoa_to_sheet(
      snapshot.custom_colors.map((c) => [c.hex, c.label]),
    ),
    "ColorDB",
  );
  const paletteZip = unzipSync(
    new Uint8Array(XLSX.write(palette, { type: "array", bookType: "xlsx" })),
  );
  const styles = xml(original["xl/styles.xml"]),
    styleMap = mergeStyles(styles, xml(generated["xl/styles.xml"]));
  out["xl/styles.xml"] = bytes(styles);
  const types = xml(original["[Content_Types].xml"]);
  function addType(part: string, type: string) {
    let e = elements(types, CT, "Override").find(
      (e) => e.getAttribute("PartName") === "/" + part,
    );
    if (!e) {
      e = types.createElementNS(CT, "Override");
      e.setAttribute("PartName", "/" + part);
      types.documentElement.append(e);
    }
    e.setAttribute("ContentType", type);
  }
  function replace(
    source: Archive,
    from: string,
    to: string,
    map: number[] | null,
    prefix: string,
  ) {
    const doc = xml(source[from]);
    if (elements(doc, MAIN, "c").some((c) => c.getAttribute("t") === "s"))
      throw new Error("공유 문자열이 포함된 출력은 지원하지 않습니다.");
    for (const c of elements(doc, MAIN, "c"))
      if (c.hasAttribute("s")) {
        if (map) c.setAttribute("s", String(map[Number(c.getAttribute("s"))]));
        else c.removeAttribute("s");
      }
    out[to] = bytes(doc);
    const sourceRels = source[relPath(from)];
    if (sourceRels) {
      const rels = xml(sourceRels),
        sourceTypes = xml(source["[Content_Types].xml"]);
      for (const rel of elements(rels, PKG, "Relationship")) {
        const kind = rel.getAttribute("Type")!;
        if (!kind.endsWith("/comments") && !kind.endsWith("/vmlDrawing"))
          throw new Error("지원하지 않는 일정 출력 관계입니다.");
        const old = pathFrom(from, rel.getAttribute("Target")!),
          next = prefix + "/" + old.split("/").at(-1)!;
        if (!source[old] || source[relPath(old)])
          throw new Error("일정 메모 관계를 보존할 수 없습니다.");
        out[next] = source[old];
        rel.setAttribute("Target", "/" + next);
        const content =
          elements(sourceTypes, CT, "Override")
            .find((e) => e.getAttribute("PartName") === "/" + old)
            ?.getAttribute("ContentType") ??
          elements(sourceTypes, CT, "Default")
            .find((e) => e.getAttribute("Extension") === old.split(".").at(-1))
            ?.getAttribute("ContentType");
        if (!content) throw new Error("메모 파일 형식을 확인할 수 없습니다.");
        addType(next, content);
      }
      out[relPath(to)] = bytes(rels);
    } else delete out[relPath(to)];
  }
  replace(
    generated,
    genMeta.sheets.get("Sheet2")!.path,
    destination.path,
    styleMap,
    `xl/kar-schedule-${destination.id}`,
  );
  let colorTarget = meta.sheets.get("ColorDB");
  if (!colorTarget) {
    const id = String(
      Math.max(...[...meta.sheets.values()].map((s) => Number(s.id))) + 1,
    );
    let rid = "karColorDB";
    while (
      elements(meta.rels, PKG, "Relationship").some(
        (r) => r.getAttribute("Id") === rid,
      )
    )
      rid += "_";
    let path = "xl/worksheets/kar-colors.xml";
    while (out[path]) path = path.replace(".xml", "_.xml");
    const r = meta.rels.createElementNS(PKG, "Relationship");
    r.setAttribute("Id", rid);
    r.setAttribute("Type", REL + "/worksheet");
    r.setAttribute("Target", "/" + path);
    meta.rels.documentElement.append(r);
    const s = meta.wb.createElementNS(MAIN, "sheet");
    s.setAttribute("name", "ColorDB");
    s.setAttribute("sheetId", id);
    s.setAttributeNS(REL, "r:id", rid);
    elements(meta.wb, MAIN, "sheets")[0].append(s);
    colorTarget = { path, id };
    addType(
      path,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
    );
  }
  replace(
    paletteZip,
    sheetPaths(paletteZip).sheets.get("ColorDB")!.path,
    colorTarget.path,
    null,
    `xl/kar-colors-${colorTarget.id}`,
  );
  // Calculation chains are derived caches; invalidate them after replacing the schedule.
  for (const r of elements(meta.rels, PKG, "Relationship"))
    if (r.getAttribute("Type")?.endsWith("/calcChain")) {
      const p = pathFrom("xl/workbook.xml", r.getAttribute("Target")!);
      delete out[p];
      r.remove();
      elements(types, CT, "Override")
        .find((e) => e.getAttribute("PartName") === "/" + p)
        ?.remove();
    }
  let calc = elements(meta.wb, MAIN, "calcPr")[0];
  if (!calc) {
    calc = meta.wb.createElementNS(MAIN, "calcPr");
    const following = [
      "oleSize",
      "customWorkbookViews",
      "pivotCaches",
      "smartTagPr",
      "smartTagTypes",
      "webPublishing",
      "fileRecoveryPr",
      "webPublishObjects",
      "extLst",
    ];
    meta.wb.documentElement.insertBefore(
      calc,
      children(meta.wb.documentElement).find((e) =>
        following.includes(e.localName),
      ) ?? null,
    );
  }
  calc.setAttribute("fullCalcOnLoad", "1");
  calc.setAttribute("forceFullCalc", "1");
  out["xl/workbook.xml"] = bytes(meta.wb);
  out["xl/_rels/workbook.xml.rels"] = bytes(meta.rels);
  out["[Content_Types].xml"] = bytes(types);
  return zipSync(out, { level: 6 });
}
