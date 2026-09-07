import { layout } from "../calendar/layout";
import { monthRange, months } from "../domain/date";
import type { Snapshot } from "../domain/task";

// Excel has no stable task IDs, timestamps or multi-month group IDs.
// Compare visible monthly content and placement, retaining duplicate entries.
function comparable(snapshot: Snapshot): string {
  const keys = [
    ...new Set(snapshot.tasks.flatMap((t) => months(t.start_date, t.end_date))),
  ].sort();
  const tasks = keys
    .flatMap((key) => {
      const [start, end] = monthRange(key);
      return layout(snapshot, start, end).map((s) =>
        JSON.stringify([
          s.start,
          s.end,
          s.row,
          s.task.title,
          s.task.notes,
          s.task.done,
          s.task.color ?? "FFFFFF",
        ]),
      );
    })
    .sort();
  const colors = snapshot.custom_colors
    .map((c) => JSON.stringify([c.hex, c.label]))
    .sort();
  return JSON.stringify([tasks, colors]);
}
export function connectionPlan(current: Snapshot, incoming: Snapshot) {
  const same = comparable(current) === comparable(incoming);
  return {
    needsConfirmation:
      !same && (current.tasks.length > 0 || current.custom_colors.length > 0),
    // Reconnecting an equivalent file must not split existing multi-month tasks or replace IDs.
    snapshot: same ? current : incoming,
  };
}
