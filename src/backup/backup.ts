import { validateSnapshot, type Snapshot } from "../domain/task";
export function encodeBackup(data: Snapshot): Uint8Array {
  validateSnapshot(data);
  return new TextEncoder().encode(
    JSON.stringify(
      {
        format: "kar-schedule-backup",
        format_version: 1,
        app_version: "2.0.2",
        schema_version: 1,
        exported_at: new Date().toISOString(),
        tasks: data.tasks,
        task_month_layout: data.task_month_layout,
        custom_colors: data.custom_colors,
        portable_settings: {},
      },
      null,
      2,
    ),
  );
}
export function decodeBackup(bytes: Uint8Array): Snapshot {
  if (bytes.length > 30 * 1024 * 1024)
    throw new Error("백업 파일은 30MB 이내여야 합니다.");
  const x = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (
    x.format !== "kar-schedule-backup" ||
    x.format_version !== 1 ||
    x.schema_version !== 1
  )
    throw new Error("지원하지 않는 백업 형식 또는 버전입니다.");
  const s = {
    tasks: x.tasks,
    task_month_layout: x.task_month_layout,
    custom_colors: x.custom_colors,
  };
  validateSnapshot(s);
  return s;
}
