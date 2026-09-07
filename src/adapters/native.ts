import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Repository } from "../services/task-service";
import type { Snapshot, VersionedSnapshot } from "../domain/task";
export const native = isTauri();
export const repository: Repository = {
  load: () => invoke<VersionedSnapshot>("load_snapshot"),
  commit: (snapshot: Snapshot, revision: number, protect: boolean) =>
    invoke<VersionedSnapshot>("commit_snapshot", {
      snapshot,
      revision,
      protect,
    }),
};
export interface OpenedFile {
  name: string;
  bytes: number[];
}
export const openDocument = (kind: "excel" | "json") =>
  invoke<OpenedFile | null>("open_document", { kind });
export const saveDocument = (
  kind: "excel" | "json",
  name: string,
  bytes: Uint8Array,
) =>
  invoke<string | null>("save_document", {
    kind,
    name,
    bytes: Array.from(bytes),
  });
export const appInfo = () =>
  invoke<{ database: string; backup_directory: string }>("app_info");
export const openRecovery = () =>
  invoke<{ name: string; data: Snapshot } | null>("open_recovery");
export interface ExcelLink {
  path: string;
  sheet: string;
  hash: string;
  saved_revision: number;
}
export const connectionInfo = () => invoke<ExcelLink | null>("connection_info");
export const selectExcel = () =>
  invoke<(OpenedFile & { token: string }) | null>("select_excel");
export const connectExcel = (
  token: string,
  sheet: string,
  snapshot: Snapshot,
  revision: number,
) =>
  invoke<VersionedSnapshot>("connect_excel", {
    token,
    sheet,
    snapshot,
    revision,
  });
export const readLinkedExcel = () =>
  invoke<{ info: ExcelLink; bytes: number[] }>("read_linked_excel");
export const saveLinkedExcel = (bytes: Uint8Array, revision: number) =>
  invoke<ExcelLink>("save_linked_excel", {
    bytes: Array.from(bytes),
    revision,
  });
export const disconnectExcel = () => invoke<void>("disconnect_excel");
