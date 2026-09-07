import { describe, it, expect } from "vitest";
import { addDays, ordinal, weekRange } from "../src/domain/date";
import { layout } from "../src/calendar/layout";
import {
  emptySnapshot,
  validateSnapshot,
  type Task,
  type Snapshot,
} from "../src/domain/task";
import { TaskService, type Repository } from "../src/services/task-service";
import { encodeBackup, decodeBackup } from "../src/backup/backup";
import { importV1 } from "../src/migration/v1";
const task = (extra: Partial<Task> = {}): Task => ({
  id: crypto.randomUUID(),
  title: "업무",
  start_date: "2026-09-28",
  end_date: "2026-10-03",
  notes: "메모\n다음 줄",
  color: "A9D18E",
  done: false,
  sort_order: 0,
  display_row: null,
  created_at: "2026-09-07T00:00:00Z",
  updated_at: "2026-09-07T00:00:00Z",
  ...extra,
});
function service(initial: Snapshot = { ...emptySnapshot(), tasks: [task()] }) {
  let state = { ...structuredClone(initial), revision: 0 };
  const repo: Repository = {
    load: async () => structuredClone(state),
    commit: async (s, r) => {
      expect(r).toBe(state.revision);
      state = { ...structuredClone(s), revision: r + 1 };
      return state;
    },
  };
  return new TaskService(repo);
}
describe("date-only and layout", () => {
  it("handles leap years, DST and year boundary without local time conversion", () => {
    expect(addDays("2028-02-28", 2)).toBe("2028-03-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(() => ordinal("2026-02-30")).toThrow();
    expect(addDays("0001-01-01", 1)).toBe("0001-01-02");
    expect(weekRange("2026-09-07")).toEqual(["2026-09-07", "2026-09-13"]);
  });
  it("projects one DB task into two months and one weekly segment", () => {
    const t = task(),
      s = { ...emptySnapshot(), tasks: [t] };
    expect(layout(s, "2026-09-01", "2026-09-30")[0].end).toBe("2026-09-30");
    expect(layout(s, "2026-10-01", "2026-10-31")[0].start).toBe("2026-10-01");
    expect(layout(s, "2026-09-28", "2026-10-04")).toHaveLength(1);
    expect(s.tasks).toHaveLength(1);
  });
  it("preserves month overrides and resolves overlapping pins without changing DB", () => {
    const a = task({ display_row: 3 }),
      b = task({ display_row: 3 }),
      s = {
        ...emptySnapshot(),
        tasks: [a, b],
        task_month_layout: [
          {
            task_id: a.id,
            month_key: "2026-09",
            display_row: 0,
            sort_order: 0,
          },
        ],
      };
    expect(
      layout(s, "2026-09-01", "2026-09-30").find((x) => x.task.id === a.id)
        ?.row,
    ).toBe(0);
    const rows = layout(s, "2026-10-01", "2026-10-31").map((x) => x.row);
    expect(new Set(rows).size).toBe(2);
    expect(a.display_row).toBe(3);
  });
});
describe("transaction service", () => {
  it("keeps identity and layout when editing notes", async () => {
    const s = service();
    await s.load();
    const t = s.state.tasks[0];
    await s.save({ ...t, notes: "새 메모" }, t.id);
    expect(s.state.tasks[0].id).toBe(t.id);
    expect(s.state.tasks[0].notes).toBe("새 메모");
  });
  it("clamps single month move but shifts entire weekly range", async () => {
    const t = task({ start_date: "2026-09-28", end_date: "2026-09-30" }),
      s = service({ ...emptySnapshot(), tasks: [t] });
    await s.load();
    await s.move(t.id, 3, 0, "monthly", "2026-09");
    expect(s.state.tasks[0].start_date).toBe("2026-09-28");
    await s.move(t.id, 3, 0, "weekly", "2026-09");
    expect(s.state.tasks[0].end_date).toBe("2026-10-03");
    expect(s.state.tasks[0].id).toBe(t.id);
  });
  it("changes only selected month for vertical monthly move", async () => {
    const s = service();
    await s.load();
    const t = s.state.tasks[0];
    await s.move(t.id, 0, 2, "monthly", "2026-09");
    expect(s.state.task_month_layout).toHaveLength(1);
    expect(layout(s.state, "2026-10-01", "2026-10-31")[0].row).toBe(0);
  });
  it("does not publish failed saves", async () => {
    const initial = { ...emptySnapshot(), tasks: [task()], revision: 0 },
      s = new TaskService({
        load: async () => initial,
        commit: async () => {
          throw new Error("disk full");
        },
      });
    await s.load();
    await expect(s.remove(initial.tasks[0].id)).rejects.toThrow();
    expect(s.state.tasks).toHaveLength(1);
    expect(s.busy).toBe(false);
  });
  it("reset clears tasks and layout but retains palette", async () => {
    const s = service({
      ...emptySnapshot(),
      tasks: [task()],
      custom_colors: [{ hex: "112233", label: "분류", sort_order: 0 }],
    });
    await s.load();
    await s.reset();
    expect(s.state.tasks).toHaveLength(0);
    expect(s.state.custom_colors).toHaveLength(1);
  });
});
describe("backup and V1 migration", () => {
  it("round trips all fields and month layout, rejects future versions and duplicate IDs", () => {
    const t = task(),
      s = {
        ...emptySnapshot(),
        tasks: [t],
        task_month_layout: [
          {
            task_id: t.id,
            month_key: "2026-10",
            display_row: 3,
            sort_order: 2,
          },
        ],
      };
    expect(decodeBackup(encodeBackup(s))).toEqual(s);
    const bad = JSON.parse(new TextDecoder().decode(encodeBackup(s)));
    bad.format_version = 2;
    expect(() =>
      decodeBackup(new TextEncoder().encode(JSON.stringify(bad))),
    ).toThrow();
    expect(() => validateSnapshot({ ...s, tasks: [t, t] })).toThrow();
  });
  it("merges verified groups while preserving different month pins", () => {
    const p = {
      groupId: "g",
      title: "업무",
      notes: "메모",
      color: null,
      done: true,
      fullStart: "2026-09-28",
      fullEnd: "2026-10-03",
      sortIndex: 0,
    };
    const result = importV1(
      JSON.stringify({
        "2026-09": { tasks: [{ ...p, id: "a", start: 28, end: 30, row: 1 }] },
        "2026-10": { tasks: [{ ...p, id: "b", start: 1, end: 3, row: 3 }] },
      }),
    );
    expect(result.tasks).toHaveLength(1);
    expect(result.task_month_layout.map((l) => l.display_row)).toEqual([1, 3]);
  });
  it("refuses missing pieces and never merges independent equal titles", () => {
    const p = {
      title: "업무",
      notes: "",
      color: null,
      done: false,
      start: 1,
      end: 2,
    };
    expect(
      importV1(
        JSON.stringify({
          "2026-09": {
            tasks: [
              { ...p, id: "a" },
              { ...p, id: "b" },
            ],
          },
        }),
      ).tasks,
    ).toHaveLength(2);
    expect(() =>
      importV1(
        JSON.stringify({
          "2026-09": {
            tasks: [
              {
                ...p,
                groupId: "g",
                fullStart: "2026-09-01",
                fullEnd: "2026-10-02",
              },
            ],
          },
        }),
      ),
    ).toThrow();
  });
});
