export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
export function ordinal(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("날짜 형식이 올바르지 않습니다.");
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(y, m - 1, d);
  if (
    y < 1 ||
    y > 9999 ||
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  )
    throw new Error("존재하지 않는 날짜입니다: " + value);
  return date.getTime() / 86400000;
}
export function fromOrdinal(n: number): string {
  const date = new Date(n * 86400000);
  const y = date.getUTCFullYear();
  if (y < 1 || y > 9999) throw new Error("지원하는 날짜 범위를 벗어났습니다.");
  return `${String(y).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
export const addDays = (date: string, delta: number) =>
  fromOrdinal(ordinal(date) + delta);
export const weekday = (date: string) =>
  new Date(ordinal(date) * 86400000).getUTCDay();
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function monthRange(key: string): [string, string] {
  const start = key + "-01";
  ordinal(start);
  const [y, m] = key.split("-").map(Number);
  const days =
    m === 2
      ? y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
        ? 29
        : 28
      : [4, 6, 9, 11].includes(m)
        ? 30
        : 31;
  return [start, `${key}-${days}`];
}
export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number),
    index = y * 12 + m - 1 + delta;
  const result = `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
  monthRange(result);
  return result;
}
export function weekRange(date: string, offset = 0): [string, string] {
  const start = addDays(date, (-(weekday(date) + 6) % 7) + offset * 7);
  return [start, addDays(start, 6)];
}
export function months(start: string, end: string): string[] {
  ordinal(start);
  ordinal(end);
  if (start > end) throw new Error("종료일은 시작일 이후여야 합니다.");
  const out: string[] = [];
  let key = start.slice(0, 7);
  while (key <= end.slice(0, 7)) {
    out.push(key);
    if (key === end.slice(0, 7)) break;
    key = shiftMonth(key, 1);
  }
  return out;
}
export const overlaps = (a: string, b: string, c: string, d: string) =>
  a <= d && b >= c;
