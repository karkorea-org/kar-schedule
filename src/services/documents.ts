import * as files from "../adapters/native";
import {
  readExcel,
  parseExcel,
  exportExcel,
  type ExcelSource,
} from "../excel/excel";
import { encodeBackup, decodeBackup } from "../backup/backup";
import { importV1 } from "../migration/v1";
import type { Snapshot } from "../domain/task";
import { updateLinkedWorkbook } from "../excel/linked-workbook";
export const documents = {
  async selectExcel() {
    const f = await files.selectExcel();
    return f
      ? {
          name: f.name,
          token: f.token,
          source: readExcel(new Uint8Array(f.bytes)),
        }
      : null;
  },
  async saveConnected(snapshot: Snapshot, revision: number) {
    const f = await files.readLinkedExcel();
    const bytes = updateLinkedWorkbook(
      new Uint8Array(f.bytes),
      f.info.sheet,
      snapshot,
      f.info.template_year,
    );
    return files.saveLinkedExcel(bytes, revision);
  },
  async openExcel() {
    const f = await files.selectExcel();
    return f
      ? {
          name: f.name,
          token: f.token,
          source: readExcel(new Uint8Array(f.bytes)),
        }
      : null;
  },
  previewExcel: (source: ExcelSource, sheet: string, year: number) =>
    parseExcel(source, sheet, year),
  exportExcel: (data: Snapshot) =>
    files.saveDocument(
      "excel",
      "업무일정.xlsx",
      new Uint8Array(exportExcel(data)),
    ),
  backup: (data: Snapshot) =>
    files.saveDocument(
      "json",
      `KAR-Schedule-Backup-${new Date().toISOString().slice(0, 10)}.json`,
      encodeBackup(data),
    ),
  async openJson(legacy = false) {
    const f = await files.openDocument("json");
    return f
      ? {
          name: f.name,
          data: legacy
            ? importV1(new TextDecoder().decode(new Uint8Array(f.bytes)))
            : decodeBackup(new Uint8Array(f.bytes)),
        }
      : null;
  },
};
