import { addDays, monthRange, months, ordinal, overlaps } from "../domain/date";
import {
  emptySnapshot,
  validateSnapshot,
  type Snapshot,
  type Task,
  type VersionedSnapshot,
  type Color,
} from "../domain/task";
export interface Repository {
  load(): Promise<VersionedSnapshot>;
  commit(
    snapshot: Snapshot,
    revision: number,
    protect: boolean,
  ): Promise<VersionedSnapshot>;
}
export class TaskService {
  state: VersionedSnapshot = { ...emptySnapshot(), revision: 0 };
  busy = false;
  constructor(private repository: Repository) {}
  async load() {
    this.state = await this.repository.load();
    return this.state;
  }
  async change(edit: (s: Snapshot) => void, protect = false) {
    if (this.busy) throw new Error("저장 중입니다. 잠시 후 다시 시도하세요.");
    this.busy = true;
    try {
      const next = structuredClone(this.state);
      edit(next);
      validateSnapshot(next);
      this.state = await this.repository.commit(
        next,
        this.state.revision,
        protect,
      );
    } finally {
      this.busy = false;
    }
    return this.state;
  }
  async save(
    input: Pick<
      Task,
      "title" | "start_date" | "end_date" | "notes" | "color" | "done"
    >,
    id?: string,
  ) {
    return this.change((s) => {
      const now = new Date().toISOString(),
        old = s.tasks.find((t) => t.id === id);
      if (id && !old) throw new Error("업무를 찾을 수 없습니다.");
      const task: Task = {
        id: old?.id ?? crypto.randomUUID(),
        sort_order:
          old?.sort_order ??
          Math.max(-1, ...s.tasks.map((t) => t.sort_order)) + 1,
        display_row: old?.display_row ?? null,
        created_at: old?.created_at ?? now,
        ...input,
        updated_at: now,
      };
      if (old) s.tasks[s.tasks.indexOf(old)] = task;
      else s.tasks.push(task);
      s.task_month_layout = s.task_month_layout.filter(
        (l) =>
          l.task_id !== task.id ||
          months(task.start_date, task.end_date).includes(l.month_key),
      );
      if (
        task.color &&
        !["FAA4B0", "FFC000", "F9DB6F", "A9D18E", "B4C7E7"].includes(
          task.color,
        ) &&
        !s.custom_colors.some((c) => c.hex === task.color)
      )
        s.custom_colors.push({
          hex: task.color,
          label: task.title.slice(0, 100) || "커스텀",
          sort_order: s.custom_colors.length,
        });
    });
  }
  async remove(id: string) {
    return this.change((s) => {
      s.tasks = s.tasks.filter((t) => t.id !== id);
      s.task_month_layout = s.task_month_layout.filter((l) => l.task_id !== id);
    });
  }
  async palette(colors: Color[]) {
    return this.change((s) => {
      s.custom_colors = colors;
    });
  }
  async import(data: Snapshot, replace: boolean) {
    return this.change((s) => {
      if (replace) {
        Object.assign(s, structuredClone(data));
        return;
      }
      const ids = new Map(data.tasks.map((t) => [t.id, crypto.randomUUID()]));
      const offset = Math.max(-1, ...s.tasks.map((t) => t.sort_order)) + 1;
      s.tasks.push(
        ...data.tasks.map((t) => ({
          ...t,
          id: ids.get(t.id)!,
          sort_order: t.sort_order + offset,
        })),
      );
      s.task_month_layout.push(
        ...data.task_month_layout.map((l) => ({
          ...l,
          task_id: ids.get(l.task_id)!,
          sort_order: l.sort_order + offset,
        })),
      );
      for (const c of data.custom_colors)
        if (!s.custom_colors.some((x) => x.hex === c.hex))
          s.custom_colors.push(c);
    }, replace);
  }
  async reset() {
    return this.change((s) => {
      s.tasks = [];
      s.task_month_layout = [];
    }, true);
  }
  async move(
    id: string,
    delta: number,
    row: number,
    scope: "monthly" | "weekly",
    month: string,
    swap?: { id: string; row: number },
  ) {
    return this.change((s) => {
      const t = s.tasks.find((t) => t.id === id);
      if (!t) throw new Error("업무를 찾을 수 없습니다.");
      if (
        scope === "monthly" &&
        t.start_date.slice(0, 7) === t.end_date.slice(0, 7)
      ) {
        const [a, b] = monthRange(month);
        delta = Math.max(
          ordinal(a) - ordinal(t.start_date),
          Math.min(delta, ordinal(b) - ordinal(t.end_date)),
        );
      }
      t.start_date = addDays(t.start_date, delta);
      t.end_date = addDays(t.end_date, delta);
      t.updated_at = new Date().toISOString();
      const keys = months(t.start_date, t.end_date);
      s.task_month_layout = s.task_month_layout.filter(
        (l) => l.task_id !== id || keys.includes(l.month_key),
      );
      const affected = scope === "weekly" || delta !== 0 ? keys : [month];
      const setPin = (task: Task, key: string, pin: number | null) => {
        let l = s.task_month_layout.find(
          (l) => l.task_id === task.id && l.month_key === key,
        );
        if (!l) {
          l = {
            task_id: task.id,
            month_key: key,
            display_row: pin,
            sort_order: task.sort_order,
          };
          s.task_month_layout.push(l);
        } else l.display_row = pin;
      };
      for (const key of affected) {
        const [a, b] = monthRange(key),
          start = t.start_date > a ? t.start_date : a,
          end = t.end_date < b ? t.end_date : b;
        for (const other of s.tasks) {
          if (
            other.id === id ||
            other.id === swap?.id ||
            !overlaps(other.start_date, other.end_date, start, end)
          )
            continue;
          const pin = s.task_month_layout.find(
            (l) => l.task_id === other.id && l.month_key === key,
          );
          if ((pin ? pin.display_row : other.display_row) === row)
            setPin(other, key, null);
        }
        setPin(t, key, row);
      }
      if (scope === "weekly" || delta !== 0) t.display_row = row;
      if (swap && scope === "monthly") {
        const other = s.tasks.find((t) => t.id === swap.id);
        if (other) {
          const [a, b] = monthRange(month),
            start = other.start_date > a ? other.start_date : a,
            end = other.end_date < b ? other.end_date : b;
          for (const third of s.tasks) {
            if (
              third.id === id ||
              third.id === other.id ||
              !overlaps(third.start_date, third.end_date, start, end)
            )
              continue;
            const pin = s.task_month_layout.find(
              (l) => l.task_id === third.id && l.month_key === month,
            );
            if ((pin ? pin.display_row : third.display_row) === swap.row)
              setPin(third, month, null);
          }
          setPin(other, month, swap.row);
          other.updated_at = new Date().toISOString();
        }
      }
    });
  }
}
