import { emptySnapshot, validateSnapshot, type Task } from "../domain/task";
import { monthRange, months, ordinal } from "../domain/date";
export function importV1(text: string) {
  const x = JSON.parse(text),
    raw = x.monthData ?? x.kar_monthly_schedule_v1 ?? x;
  const data = typeof raw === "string" ? JSON.parse(raw) : raw,
    out = emptySnapshot(),
    groups = new Map<string, { key: string; piece: any }[]>();
  for (const [key, value] of Object.entries(data)) {
    if (!/^\d{4}-\d{2}$/.test(key))
      throw new Error("V1 월별 JSON 형식을 확인하세요.");
    const [a, b] = monthRange(key),
      tasks = (value as any)?.tasks;
    if (!Array.isArray(tasks)) throw new Error("V1 tasks 배열이 없습니다.");
    for (let i = 0; i < tasks.length; i++) {
      const p = { ...tasks[i] };
      p.sortIndex ??= i;
      if (
        !Number.isInteger(p.start) ||
        !Number.isInteger(p.end) ||
        p.start < 1 ||
        p.end < p.start ||
        p.end > Number(b.slice(8))
      )
        throw new Error(`${key}에 잘못된 업무 날짜가 있습니다.`);
      const id = p.groupId ? `g:${p.groupId}` : `p:${key}:${i}`;
      (groups.get(id) ?? (groups.set(id, []), groups.get(id)!)).push({
        key,
        piece: p,
      });
    }
  }
  const now = new Date().toISOString();
  for (const pieces of groups.values()) {
    pieces.sort((a, b) => a.key.localeCompare(b.key));
    const p = pieces[0].piece;
    const date = (k: string, d: number) => `${k}-${String(d).padStart(2, "0")}`;
    const start = p.fullStart ?? date(pieces[0].key, p.start),
      end = p.fullEnd ?? date(pieces.at(-1)!.key, pieces.at(-1)!.piece.end);
    const expected = months(start, end);
    if (expected.length !== pieces.length)
      throw new Error(
        "V1 업무의 월별 조각이 누락되었습니다. 원본 데이터를 확인하세요.",
      );
    for (let i = 0; i < pieces.length; i++) {
      const q = pieces[i].piece,
        key = pieces[i].key,
        [a, b] = monthRange(key);
      if (
        expected[i] !== key ||
        date(key, q.start) !== (start > a ? start : a) ||
        date(key, q.end) !== (end < b ? end : b)
      )
        throw new Error("V1 업무 전체 기간과 월별 조각이 일치하지 않습니다.");
      for (const f of [
        "title",
        "notes",
        "color",
        "done",
        "fullStart",
        "fullEnd",
      ])
        if ((q[f] ?? null) !== (p[f] ?? null))
          throw new Error(
            "같은 그룹의 업무 내용이 다릅니다. 자동 병합하지 않았습니다.",
          );
    }
    ordinal(start);
    ordinal(end);
    const t: Task = {
      id: crypto.randomUUID(),
      title: p.title ?? "",
      start_date: start,
      end_date: end,
      notes: p.notes ?? "",
      color: p.color ? String(p.color).replace("#", "").toUpperCase() : null,
      done: !!p.done,
      sort_order: out.tasks.length,
      display_row: null,
      created_at: now,
      updated_at: now,
    };
    out.tasks.push(t);
    for (const { key, piece } of pieces)
      out.task_month_layout.push({
        task_id: t.id,
        month_key: key,
        sort_order: piece.sortIndex,
        display_row: piece.row ?? null,
      });
  }
  const colors = x.customColorsDB ?? x.KAR_CUSTOM_COLORS ?? [];
  (typeof colors === "string" ? JSON.parse(colors) : colors).forEach(
    (c: any, i: number) =>
      out.custom_colors.push({
        hex: String(typeof c === "string" ? c : c.hex)
          .replace("#", "")
          .toUpperCase(),
        label: typeof c === "string" ? "커스텀" : c.label || "커스텀",
        sort_order: i,
      }),
  );
  validateSnapshot(out);
  return out;
}
