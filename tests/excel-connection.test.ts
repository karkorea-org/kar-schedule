import { it, expect } from "vitest";
import { emptySnapshot, type Snapshot, type Task } from "../src/domain/task";
import { connectionPlan } from "../src/services/excel-connection";
const task = (patch: Partial<Task> = {}): Task => ({
  id: crypto.randomUUID(),
  title: "일정",
  start_date: "2026-09-28",
  end_date: "2026-10-03",
  notes: "메모",
  color: null,
  done: false,
  sort_order: 0,
  display_row: null,
  created_at: "2026-09-07T00:00:00Z",
  updated_at: "2026-09-07T00:00:00Z",
  ...patch,
});
const data = (tasks: Task[]): Snapshot => ({ ...emptySnapshot(), tasks });
it("does not prompt on equal content with regenerated IDs and keeps existing task identity", () => {
  const current = data([task()]);
  const incoming = data([task({ updated_at: "2026-09-08T00:00:00Z" })]);
  const result = connectionPlan(current, incoming);
  expect(result.needsConfirmation).toBe(false);
  expect(result.snapshot).toBe(current);
});
it("compares monthly Excel pieces with one multi-month task without losing its group", () => {
  const current = data([task()]);
  const incoming = data([
    task({ end_date: "2026-09-30", color: "FFFFFF" }),
    task({ start_date: "2026-10-01", sort_order: 1, color: "FFFFFF" }),
  ]);
  expect(connectionPlan(current, incoming)).toEqual({
    needsConfirmation: false,
    snapshot: current,
  });
});
it("requires confirmation for changed notes, dates, colors, completion, row, palette or duplicate count", () => {
  const current = data([task()]);
  for (const patch of [
    { notes: "다른 메모" },
    { start_date: "2026-09-29" },
    { color: "112233" },
    { done: true },
    { display_row: 2 },
  ])
    expect(connectionPlan(current, data([task(patch)])).needsConfirmation).toBe(
      true,
    );
  expect(
    connectionPlan(current, data([task(), task()])).needsConfirmation,
  ).toBe(true);
  const palette = {
    ...current,
    custom_colors: [{ hex: "112233", label: "분류", sort_order: 0 }],
  };
  expect(connectionPlan(current, palette).needsConfirmation).toBe(true);
});
it("connects the first file without a replacement prompt and protects a nonempty current schedule from an empty file", () => {
  expect(
    connectionPlan(emptySnapshot(), data([task()])).needsConfirmation,
  ).toBe(false);
  expect(
    connectionPlan(data([task()]), emptySnapshot()).needsConfirmation,
  ).toBe(true);
});
