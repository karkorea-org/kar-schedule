// @vitest-environment jsdom
import { it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import XLSX from "xlsx-js-style";
import { emptySnapshot } from "../src/domain/task";
import { parseExcel, readExcel } from "../src/excel/excel";

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: bridge.invoke,
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested: async () => {} }),
}));

it("connects a blank Excel from Import, rejects an invalid year, and initializes the file with Ctrl+S", async () => {
  document.documentElement.innerHTML = readFileSync("index.html", "utf8");
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  const w = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet([]), "Sheet1");
  let file = new Uint8Array(XLSX.write(w, { type: "array", bookType: "xlsx" }));
  let state = { ...emptySnapshot(), revision: 0 };
  let link: any = null;
  bridge.invoke.mockImplementation(async (command, args) => {
    if (command === "load_snapshot") return state;
    if (command === "connection_info") return link;
    if (command === "select_excel")
      return { name: "신입.xlsx", token: "selection", bytes: [...file] };
    if (command === "connect_excel") {
      state = { ...args.snapshot, revision: args.revision + 1 };
      link = {
        path: "신입.xlsx",
        sheet: args.sheet,
        hash: "initial",
        saved_revision: args.revision,
        template_year: args.templateYear,
      };
      return state;
    }
    if (command === "read_linked_excel")
      return { bytes: [...file], info: link };
    if (command === "save_linked_excel") {
      file = new Uint8Array(args.bytes);
      link = { ...link, saved_revision: args.revision };
      return link;
    }
    throw Error("Unexpected command " + command);
  });
  await import("../src/main");
  const el = <T extends HTMLElement = HTMLElement>(id: string) =>
    document.getElementById(id) as T;
  await vi.waitFor(() =>
    expect(el("file-status").textContent).toContain("미연결"),
  );
  el("btn-import").click();
  await vi.waitFor(() =>
    expect(el<HTMLDialogElement>("import-dialog").open).toBe(true),
  );
  expect(el("import-title").textContent).toBe("새 업무일지 연결");
  const year = el<HTMLInputElement>("import-year");
  year.value = "0";
  year.dispatchEvent(new Event("input"));
  expect(el<HTMLButtonElement>("import-confirm").disabled).toBe(true);
  year.value = "2028";
  year.dispatchEvent(new Event("input"));
  expect(el<HTMLButtonElement>("import-confirm").disabled).toBe(false);
  expect(el("import-warnings").textContent).toBe("");
  el("import-confirm").click();
  await vi.waitFor(() =>
    expect(el("file-status").textContent).toContain("Excel 저장 필요"),
  );
  expect(readExcel(file).blankSheets).toEqual(["Sheet1"]);
  expect(link.template_year).toBe(2028);
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "s", code: "KeyS", ctrlKey: true }),
  );
  await vi.waitFor(() =>
    expect(el("file-status").textContent).toContain("저장됨"),
  );
  const source = readExcel(file);
  expect(source.workbook.Sheets.Sheet1.A1.v).toContain("2028년");
  expect(source.blankSheets).toEqual([]);
  expect(parseExcel(source, "Sheet1", 2026).data.tasks).toEqual([]);
});
