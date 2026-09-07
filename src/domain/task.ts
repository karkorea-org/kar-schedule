import { ordinal, overlaps, monthRange } from "./date";
export interface Task {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  notes: string;
  color: string | null;
  done: boolean;
  sort_order: number;
  display_row: number | null;
  created_at: string;
  updated_at: string;
}
export interface MonthLayout {
  task_id: string;
  month_key: string;
  display_row: number | null;
  sort_order: number;
}
export interface Color {
  hex: string;
  label: string;
  sort_order: number;
}
export interface Snapshot {
  tasks: Task[];
  task_month_layout: MonthLayout[];
  custom_colors: Color[];
}
export interface VersionedSnapshot extends Snapshot {
  revision: number;
}
export const emptySnapshot = (): Snapshot => ({
  tasks: [],
  task_month_layout: [],
  custom_colors: [],
});
export function validateSnapshot(s: Snapshot): void {
  if (
    !s ||
    !Array.isArray(s.tasks) ||
    !Array.isArray(s.task_month_layout) ||
    !Array.isArray(s.custom_colors)
  )
    throw new Error("일정 데이터 형식이 올바르지 않습니다.");
  if (
    s.tasks.length > 20000 ||
    s.task_month_layout.length > 100000 ||
    s.custom_colors.length > 512
  )
    throw new Error("일정 또는 색상 개수가 너무 많습니다.");
  const ids = new Set<string>();
  for (const t of s.tasks) {
    if (
      !t ||
      typeof t.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        t.id,
      ) ||
      ids.has(t.id)
    )
      throw new Error("업무 ID가 잘못되었거나 중복되었습니다.");
    ids.add(t.id);
    const duration = ordinal(t.end_date) - ordinal(t.start_date);
    if (duration < 0 || duration > 36600)
      throw new Error("업무 기간은 시작일 이후 100년 이내여야 합니다.");
    if (
      typeof t.title !== "string" ||
      t.title.length > 1000 ||
      typeof t.notes !== "string" ||
      t.notes.length > 100000 ||
      typeof t.done !== "boolean"
    )
      throw new Error("업무 제목·메모·완료 값을 확인하세요.");
    if (t.color !== null && !/^[0-9A-F]{6}$/.test(t.color))
      throw new Error("색상 형식이 올바르지 않습니다.");
    checkOrder(t.sort_order);
    checkRow(t.display_row);
    for (const v of [t.created_at, t.updated_at])
      if (
        typeof v !== "string" ||
        !/^\d{4}-.*Z$/.test(v) ||
        !Number.isFinite(Date.parse(v))
      )
        throw new Error("업무 기록 시각이 올바르지 않습니다.");
  }
  const keys = new Set<string>();
  for (const l of s.task_month_layout) {
    const t = s.tasks.find((t) => t.id === l.task_id),
      key = l.task_id + "/" + l.month_key;
    if (!t || keys.has(key))
      throw new Error("월별 배치 정보가 잘못되었습니다.");
    const [a, b] = monthRange(l.month_key);
    if (!overlaps(t.start_date, t.end_date, a, b))
      throw new Error("업무 기간 밖의 월별 배치입니다.");
    checkOrder(l.sort_order);
    checkRow(l.display_row);
    keys.add(key);
  }
  const colors = new Set<string>();
  for (const c of s.custom_colors) {
    if (
      !/^[0-9A-F]{6}$/.test(c.hex) ||
      colors.has(c.hex) ||
      typeof c.label !== "string" ||
      !c.label.trim() ||
      c.label.length > 100
    )
      throw new Error("사용자 색상을 확인하세요.");
    checkOrder(c.sort_order);
    colors.add(c.hex);
  }
}
function checkOrder(n: number) {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("정렬 순서가 올바르지 않습니다.");
}
function checkRow(n: number | null) {
  if (n !== null && (!Number.isInteger(n) || n < 0 || n > 500))
    throw new Error("표시 행은 0~500이어야 합니다.");
}
