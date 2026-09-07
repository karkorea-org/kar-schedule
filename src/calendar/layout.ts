import { ordinal, overlaps } from "../domain/date";
import type { Task, Snapshot } from "../domain/task";
export interface Segment {
  task: Task;
  start: string;
  end: string;
  startCol: number;
  endCol: number;
  row: number;
  pin: number | null;
  order: number;
}
export function layout(s: Snapshot, start: string, end: string): Segment[] {
  const items = s.tasks
    .filter((t) => overlaps(t.start_date, t.end_date, start, end))
    .map((t) => {
      const a = t.start_date > start ? t.start_date : start,
        b = t.end_date < end ? t.end_date : end;
      const o = s.task_month_layout.find(
        (l) => l.task_id === t.id && l.month_key === a.slice(0, 7),
      );
      return {
        task: t,
        start: a,
        end: b,
        startCol: ordinal(a) - ordinal(start),
        endCol: ordinal(b) - ordinal(start),
        row: 0,
        pin: o ? o.display_row : t.display_row,
        order: o ? o.sort_order : t.sort_order,
      };
    })
    .sort(
      (a, b) =>
        a.order - b.order ||
        a.startCol - b.startCol ||
        a.endCol - b.endCol ||
        a.task.id.localeCompare(b.task.id),
    );
  const rows: Segment[][] = [];
  for (const x of [
    ...items.filter((x) => x.pin !== null),
    ...items.filter((x) => x.pin === null),
  ]) {
    let r = x.pin ?? 0;
    while (
      rows[r]?.some((y) => x.startCol <= y.endCol && x.endCol >= y.startCol)
    )
      r++;
    (rows[r] ??= []).push(x);
    x.row = r;
  }
  return items;
}
