import "./styles/legacy.css";
import { connectionPlan } from "./services/excel-connection";
import {
  connectionInfo,
  connectExcel,
  disconnectExcel,
  type ExcelLink,
} from "./adapters/native";
import "./styles/app.css";
import { TaskService, type Repository } from "./services/task-service";
import { repository, native, appInfo, openRecovery } from "./adapters/native";
import { documents } from "./services/documents";
import { emptySnapshot, type Task, type Snapshot } from "./domain/task";
import {
  addDays,
  monthRange,
  months,
  ordinal,
  shiftMonth,
  today,
  weekday,
  weekRange,
  WEEKDAYS,
} from "./domain/date";
import { layout, type Segment } from "./calendar/layout";
import type { ExcelSource } from "./excel/excel";

const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const input = (id: string) => el<HTMLInputElement>(id);
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const preview =
  import.meta.env.DEV &&
  !native &&
  new URLSearchParams(location.search).has("preview");
let mock = { ...emptySnapshot(), revision: 0 };
const previewRepo: Repository = {
  load: async () => structuredClone(mock),
  commit: async (s, r) => {
    if (r !== mock.revision) throw Error("revision");
    mock = { ...structuredClone(s), revision: r + 1 };
    return structuredClone(mock);
  },
};
const service = new TaskService(preview ? previewRepo : repository);
let currentMonth = today().slice(0, 7),
  selectedWeek = 0,
  focused: string | null = null,
  editingId: string | undefined,
  modalColor: string | null = null,
  selectedDone = false,
  working = false,
  ready = false;
let connection: ExcelLink | null = null;
function refreshStatus() {
  const name = connection?.path.split(/[\\/]/).at(-1);
  status(
    preview
      ? "미리보기 · 저장 안 됨"
      : connection
        ? `${connection.saved_revision === service.state.revision ? "저장됨" : "Excel 저장 필요"} · ${name}`
        : "Excel 미연결 · 이 컴퓨터에 저장됨",
  );
  el("file-status").title =
    connection?.path ?? "Excel 연결을 눌러 본인 업무 파일을 지정하세요.";
}
let toastTimer: ReturnType<typeof setTimeout>;
function toast(message: string, error = false) {
  const t = el("toast");
  t.textContent = message;
  t.className = `toast is-visible is-${error ? "error" : "success"}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => t.classList.remove("is-visible"),
    error ? 6000 : 2600,
  );
}
function status(message: string) {
  el("file-status").textContent = message;
}
async function run(action: () => Promise<unknown>, success?: string) {
  if (working) return;
  working = true;
  status("처리 중…");
  document
    .querySelectorAll<HTMLButtonElement>(
      ".header-actions button,#modal-save-btn,#modal-delete-btn,#import-confirm",
    )
    .forEach((b) => (b.disabled = true));
  try {
    await action();
    render();
    refreshStatus();
    if (success) toast(success);
  } catch (e) {
    status("작업 실패 · 다시 시도");
    toast(e instanceof Error ? e.message : String(e), true);
  } finally {
    working = false;
    document
      .querySelectorAll<HTMLButtonElement>(
        ".header-actions button,#modal-save-btn,#modal-delete-btn,#import-confirm",
      )
      .forEach((b) => (b.disabled = false));
    el<HTMLButtonElement>("import-confirm").disabled =
      importData === null || (!connectionToken && !importData.tasks.length);
    if (preview) disableFiles();
  }
}
function disableFiles() {
  for (const id of [
    "btn-import",
    "btn-connect",
    "btn-save",
    "btn-disconnect",
    "btn-export",
    "btn-backup",
    "btn-restore",
    "btn-v1",
    "btn-recovery",
  ])
    el<HTMLButtonElement>(id).disabled = true;
}
async function decide(
  title: string,
  message: string,
  text?: string,
): Promise<string | null> {
  const d = el<HTMLDialogElement>("decision");
  if (d.open) return null;
  el("decision-title").textContent = title;
  el("decision-message").textContent = message;
  input("decision-input").hidden = text === undefined;
  input("decision-input").value = text ?? "";
  d.returnValue = "cancel";
  d.showModal();
  if (text !== undefined) input("decision-input").focus();
  return new Promise((resolve) =>
    d.addEventListener(
      "close",
      () =>
        resolve(
          d.returnValue === "ok"
            ? text === undefined
              ? "ok"
              : input("decision-input").value
            : null,
        ),
      { once: true },
    ),
  );
}
function contrast(color: string) {
  const rgb = [0, 2, 4].map((i) => parseInt(color.slice(i, i + 2), 16));
  return (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 >= 150
    ? "#1a1814"
    : "#ffffff";
}
function showTip(bar: HTMLElement) {
  const tip = el("cal-tip");
  tip.textContent = bar.dataset.tip ?? "";
  tip.classList.add("is-visible");
  const r = bar.getBoundingClientRect(),
    b = tip.getBoundingClientRect();
  tip.style.left = `${Math.max(8, Math.min(innerWidth - b.width - 8, r.left + r.width / 2 - b.width / 2))}px`;
  tip.style.top = `${Math.max(8, r.top > b.height + 12 ? r.top - b.height - 8 : Math.min(innerHeight - b.height - 8, r.bottom + 8))}px`;
}
const hideTip = () => el("cal-tip").classList.remove("is-visible");
function render() {
  if (!ready) return;
  const [y, m] = currentMonth.split("-");
  el("month-title").textContent = `${y}년 ${Number(m)}월`;
  el("month-label").textContent =
    currentMonth === today().slice(0, 7) ? "이번 달" : "업무 계획";
  const week = weekRange(today(), selectedWeek);
  el("tw-range").textContent = `${week[0]} — ${week[1]}`;
  el("tw-badge").textContent = ["지난주 업무", "이번주 업무", "다음주 업무"][
    selectedWeek + 1
  ];
  document.querySelectorAll<HTMLElement>("[data-week]").forEach((b) => {
    b.classList.toggle("is-active", Number(b.dataset.week) === selectedWeek);
    b.setAttribute(
      "aria-selected",
      String(Number(b.dataset.week) === selectedWeek),
    );
  });
  renderGrid("calendar", monthRange(currentMonth), false);
  renderGrid("weekly-calendar", week, true);
}
function renderGrid(
  id: string,
  [start, end]: [string, string],
  weekly: boolean,
) {
  const grid = el(id),
    wrap = grid.parentElement!,
    scroll = wrap.scrollLeft,
    segments = layout(service.state, start, end),
    count = ordinal(end) - ordinal(start) + 1;
  const rows = Math.max(1, ...segments.map((x) => x.row + 1)),
    offset = weekly ? 1 : 2;
  grid.classList.toggle("is-expanded", weekly);
  grid.classList.toggle("is-week-panel", weekly);
  grid.style.gridTemplateColumns = weekly
    ? `repeat(7,minmax(110px,1fr))`
    : `56px repeat(${count},minmax(26px,1fr))`;
  grid.style.gridTemplateRows = `auto auto repeat(${rows},auto)`;
  grid.replaceChildren();
  const make = (text: string, css: string, col: number, row: number) => {
    const e = document.createElement("div");
    e.textContent = text;
    e.className = css;
    e.style.gridColumn = String(col);
    e.style.gridRow = String(row);
    grid.append(e);
    return e;
  };
  if (!weekly) {
    make("   일\n달", "cal-corner", 1, 1);
    const label = make(
      `${Number(currentMonth.slice(5))}월`,
      "cal-corner",
      1,
      2,
    );
    label.style.gridRow = `2 / span ${rows + 1}`;
  }
  const [thisStart, thisEnd] = weekRange(today());
  for (let i = 0; i < count; i++) {
    const d = addDays(start, i),
      w = weekday(d),
      highlight = weekly || (d >= thisStart && d <= thisEnd),
      isToday = d === today();
    make(
      String(Number(d.slice(8))),
      `cal-day-num${isToday ? " is-today" : highlight ? " is-highlight" : ""}`,
      i + offset,
      1,
    );
    make(
      WEEKDAYS[w],
      `cal-weekday${w === 0 ? " is-sun" : w === 6 ? " is-sat" : ""}${isToday ? " is-today" : highlight ? " is-highlight" : ""}`,
      i + offset,
      2,
    );
    for (let r = 0; r < rows; r++) {
      const bg = make(
        "",
        `cal-bg${w === 0 ? " is-sunday" : w === 6 ? " is-weekend" : ""}${highlight ? " is-highlight" : ""}`,
        i + offset,
        r + 3,
      );
      bg.dataset.date = d;
      bg.dataset.row = String(r);
    }
  }
  for (const seg of segments) {
    const t = seg.task,
      bar = make(
        "",
        `cal-task-bar${t.done ? " is-done" : ""}${t.color ? " has-custom-color" : ""}${focused === t.id ? " is-focused" : ""}`,
        seg.startCol + offset,
        seg.row + 3,
      );
    bar.style.gridColumn = `${seg.startCol + offset} / ${seg.endCol + offset + 1}`;
    bar.dataset.taskId = t.id;
    bar.dataset.row = String(seg.row);
    bar.tabIndex = 0;
    bar.setAttribute("role", "button");
    bar.setAttribute(
      "aria-label",
      `${t.title || "제목 없음"}, ${t.start_date}부터 ${t.end_date}`,
    );
    if (t.color) {
      bar.style.backgroundColor = "#" + t.color;
      bar.style.color = contrast(t.color);
    }
    const span = document.createElement("span");
    span.className = "cal-task-text";
    span.textContent = t.title || "(제목 없음)";
    bar.append(span);
    bar.dataset.tip = `${t.title || "(제목 없음)"}${t.done ? " [완료]" : ""}\n${weekly ? t.start_date : seg.start} ~ ${weekly ? t.end_date : seg.end}${t.notes ? "\n\n" + t.notes : ""}`;
    bar.addEventListener("mouseenter", () => {
      if (!drag) showTip(bar);
    });
    bar.addEventListener("mouseleave", hideTip);
    bar.addEventListener("click", () => {
      if (Date.now() < suppressUntil || working) return;
      openTask(t);
    });
    bar.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        openTask(t);
      }
    });
    bar.addEventListener("pointerdown", (e) => startDrag(e, seg, grid, weekly));
  }
  wrap.scrollLeft = scroll;
}

const presets = [
  ["FAA4B0", "핑크"],
  ["FFC000", "주황"],
  ["F9DB6F", "노랑"],
  ["A9D18E", "초록"],
  ["B4C7E7", "파랑"],
];
function swatches() {
  const wrap = el("task-modal-swatches");
  wrap.replaceChildren();
  for (const [hex, label] of [
    ["", "색 없음"],
    ...presets,
    ...(modalColor && !presets.some((p) => p[0] === modalColor)
      ? [[modalColor, "선택한 색"]]
      : []),
  ]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `color-swatch${hex ? "" : " is-none"}${(modalColor ?? "") === hex ? " is-active" : ""}`;
    b.title = label;
    b.setAttribute("aria-label", label);
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String((modalColor ?? "") === hex));
    if (hex) b.style.backgroundColor = "#" + hex;
    b.onclick = () => {
      modalColor = hex || null;
      swatches();
    };
    wrap.append(b);
  }
  input("task-modal-color-custom").value = "#" + (modalColor ?? "FFFFFF");
  const list = el("task-modal-custom-list");
  list.replaceChildren();
  for (const c of service.state.custom_colors) {
    const r = document.createElement("div");
    r.className = "custom-color-row";
    const b = document.createElement("button");
    b.className = "color-swatch";
    b.style.backgroundColor = "#" + c.hex;
    b.setAttribute("aria-label", c.label);
    b.onclick = () => {
      modalColor = c.hex;
      swatches();
    };
    const label = document.createElement("button");
    label.className = "custom-color-label";
    label.textContent = c.label;
    label.onclick = b.onclick;
    const edit = document.createElement("button");
    edit.className = "cc-action-btn";
    edit.textContent = "✎";
    edit.title = "색상 이름 변경";
    edit.onclick = async () => {
      const name = await decide(
        "색상 이름 변경",
        "새 이름을 입력하세요.",
        c.label,
      );
      if (name?.trim())
        await run(async () => {
          await service.palette(
            service.state.custom_colors.map((x) =>
              x.hex === c.hex ? { ...x, label: name.trim() } : x,
            ),
          );
          swatches();
        });
    };
    const del = document.createElement("button");
    del.className = "cc-action-btn is-delete";
    del.textContent = "×";
    del.title = "색상 삭제";
    del.onclick = async () => {
      if (
        await decide(
          "색상 삭제",
          `${c.label}을 팔레트에서 삭제할까요? 기존 업무의 색은 유지됩니다.`,
        )
      )
        await run(async () => {
          await service.palette(
            service.state.custom_colors.filter((x) => x.hex !== c.hex),
          );
          swatches();
        });
    };
    r.append(b, label, edit, del);
    list.append(r);
  }
  if (!list.childElementCount) list.textContent = "저장된 색상이 없습니다.";
}
function done() {
  el("modal-done-row").classList.toggle("is-checked", selectedDone);
  el("modal-done-toggle").classList.toggle("is-checked", selectedDone);
  el("modal-done-toggle").setAttribute("aria-checked", String(selectedDone));
}
function modalDates() {
  try {
    const a = input("modal-start-input").value,
      b = input("modal-end-input").value;
    el("modal-dates-display").textContent =
      `총 ${ordinal(b) - ordinal(a) + 1}일`;
  } catch {
    el("modal-dates-display").textContent = "날짜를 확인하세요.";
  }
}
function openTask(task?: Task) {
  if (!ready || working) return;
  hideTip();
  editingId = task?.id;
  focused = task?.id ?? null;
  render();
  let [a, b] = monthRange(currentMonth);
  b = a;
  const week = weekRange(today());
  if (currentMonth === week[0].slice(0, 7)) {
    a = week[0];
    b =
      week[1] < monthRange(currentMonth)[1]
        ? week[1]
        : monthRange(currentMonth)[1];
  } else if (currentMonth === today().slice(0, 7)) a = b = today();
  input("modal-title-input").value = task?.title ?? "";
  input("modal-start-input").value = task?.start_date ?? a;
  input("modal-end-input").value = task?.end_date ?? b;
  input("modal-notes-input").value = task?.notes ?? "";
  input("modal-title-input").maxLength = 1000;
  input("modal-notes-input").maxLength = 100000;
  modalColor = task?.color ?? null;
  selectedDone = task?.done ?? false;
  done();
  swatches();
  modalDates();
  input("task-modal-color-name").value = "";
  el("modal-title-text").textContent = task ? "업무 상세" : "새 업무 추가";
  el("modal-delete-btn").hidden = !task;
  el("task-modal-custom-dropdown").classList.remove("is-open");
  el("task-modal").classList.add("is-open");
  input("modal-title-input").focus();
}
function closeTask() {
  if (working) return;
  el("task-modal").classList.remove("is-open");
  editingId = undefined;
}
el("modal-close-btn").onclick = closeTask;
el("modal-done-row").onclick = (e) => {
  e.preventDefault();
  selectedDone = !selectedDone;
  done();
};
el("modal-done-toggle").onkeydown = (e) => {
  if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    selectedDone = !selectedDone;
    done();
  }
};
for (const id of ["modal-start-input", "modal-end-input"])
  input(id).onchange = () => {
    if (input("modal-end-input").value < input("modal-start-input").value)
      input("modal-end-input").value = input("modal-start-input").value;
    modalDates();
  };
async function saveDraft() {
  if (!el("task-modal").classList.contains("is-open")) return;
  await service.save(
    {
      title: input("modal-title-input").value,
      start_date: input("modal-start-input").value,
      end_date: input("modal-end-input").value,
      notes: input("modal-notes-input").value,
      color: modalColor,
      done: selectedDone,
    },
    editingId,
  );
  el("task-modal").classList.remove("is-open");
  editingId = undefined;
}
async function saveAll() {
  if (!ready || working) return;
  if (document.querySelector("dialog[open]")) {
    toast("열려 있는 대화상자를 먼저 닫아주세요.");
    return;
  }
  await run(async () => {
    await saveDraft();
    if (connection) {
      connection = await documents.saveConnected(
        service.state,
        service.state.revision,
      );
      toast("연결된 Excel에 저장했습니다.");
    } else
      toast(
        "이 컴퓨터에 저장했습니다. Excel에 반영하려면 먼저 Excel을 연결하세요.",
      );
  });
}
el("modal-save-btn").onclick = saveAll;
el("btn-save").onclick = saveAll;
el("modal-delete-btn").onclick = async () => {
  if (
    editingId &&
    (await decide(
      "업무 삭제",
      "여러 달에 걸친 기간을 포함하여 이 업무를 삭제할까요?",
    ))
  )
    await run(async () => {
      await service.remove(editingId!);
      el("task-modal").classList.remove("is-open");
      editingId = undefined;
    }, "삭제되었습니다");
};
el("task-modal-custom-btn").onclick = () =>
  el("task-modal-custom-dropdown").classList.toggle("is-open");
document.addEventListener("click", (e) => {
  if (!(e.target as Element).closest(".color-custom-dropdown-wrap"))
    el("task-modal-custom-dropdown").classList.remove("is-open");
});
input("task-modal-color-custom").oninput = () => {
  modalColor = input("task-modal-color-custom").value.slice(1).toUpperCase();
  swatches();
};
el("task-modal-color-add").onclick = () =>
  run(async () => {
    const hex = input("task-modal-color-custom").value.slice(1).toUpperCase(),
      label = input("task-modal-color-name").value.trim();
    if (!label) throw new Error("색상 이름을 입력하세요.");
    if (!presets.some((x) => x[0] === hex)) {
      const colors = service.state.custom_colors.filter((c) => c.hex !== hex);
      colors.push({ hex, label, sort_order: colors.length });
      await service.palette(colors);
    }
    modalColor = hex;
    swatches();
  }, "색상을 저장했습니다");
input("task-modal-color-name").onkeydown = (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    el("task-modal-color-add").click();
  }
};

type Drag = {
  seg: Segment;
  grid: HTMLElement;
  weekly: boolean;
  x: number;
  y: number;
  active: boolean;
  ghost?: HTMLElement;
  delta: number;
  row: number;
  target?: HTMLElement;
  swap?: { id: string; row: number };
};
let drag: Drag | null = null,
  suppressUntil = 0;
function startDrag(
  e: PointerEvent,
  seg: Segment,
  grid: HTMLElement,
  weekly: boolean,
) {
  if (e.button !== 0 || working) return;
  drag = {
    seg,
    grid,
    weekly,
    x: e.clientX,
    y: e.clientY,
    active: false,
    delta: 0,
    row: seg.row,
  };
}
function dragTarget(e: PointerEvent, d: Drag) {
  const cells = [...d.grid.querySelectorAll<HTMLElement>(".cal-bg")];
  const cell = cells.find((c) => {
    const r = c.getBoundingClientRect();
    return (
      e.clientX >= r.left &&
      e.clientX <= r.right &&
      e.clientY >= r.top &&
      e.clientY <= r.bottom
    );
  });
  const hit = document
    .elementFromPoint(e.clientX, e.clientY)
    ?.closest<HTMLElement>(".cal-task-bar");
  if (!cell) return;
  d.target = cell;
  d.row = Number(cell.dataset.row);
  d.swap = undefined;
  const width = cell.getBoundingClientRect().width;
  d.delta = d.weekly
    ? ordinal(cell.dataset.date!) - ordinal(d.seg.start)
    : Math.round((e.clientX - d.x) / width);
  if (
    !d.weekly &&
    d.seg.task.start_date.slice(0, 7) === d.seg.task.end_date.slice(0, 7)
  ) {
    const [a, b] = monthRange(currentMonth);
    d.delta = Math.max(
      ordinal(a) - ordinal(d.seg.task.start_date),
      Math.min(d.delta, ordinal(b) - ordinal(d.seg.task.end_date)),
    );
  }
  if (
    !d.weekly &&
    hit &&
    hit.closest(".calendar") === d.grid &&
    hit.dataset.taskId !== d.seg.task.id &&
    Number(hit.dataset.row) !== d.seg.row
  )
    d.swap = { id: hit.dataset.taskId!, row: d.seg.row };
  const a = addDays(d.seg.task.start_date, d.delta),
    b = addDays(d.seg.task.end_date, d.delta);
  for (const c of cells)
    if (
      Number(c.dataset.row) === d.row &&
      c.dataset.date! >= a &&
      c.dataset.date! <= b
    )
      c.classList.add("is-drop-target");
}
document.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const d = drag;
  if (
    !d.active &&
    Math.abs(e.clientX - d.x) < 5 &&
    Math.abs(e.clientY - d.y) < 5
  )
    return;
  if (!d.active) {
    d.active = true;
    hideTip();
    const bar = d.grid.querySelector<HTMLElement>(
      `[data-task-id="${d.seg.task.id}"]`,
    )!;
    d.ghost = bar.cloneNode(true) as HTMLElement;
    d.ghost.classList.add("cal-task-ghost");
    d.ghost.style.width = bar.getBoundingClientRect().width + "px";
    d.ghost.style.gridArea = "auto";
    document.body.append(d.ghost);
    bar.classList.add("is-dragging");
  }
  e.preventDefault();
  d.ghost!.style.left = e.clientX + 12 + "px";
  d.ghost!.style.top = e.clientY + 12 + "px";
  document
    .querySelectorAll(".is-drop-target")
    .forEach((x) => x.classList.remove("is-drop-target"));
  d.target = undefined;
  try {
    dragTarget(e, d);
  } catch {
    d.target = undefined;
  }
});
function clearDrag() {
  document
    .querySelectorAll(".is-drop-target,.is-dragging")
    .forEach((x) => x.classList.remove("is-drop-target", "is-dragging"));
  drag?.ghost?.remove();
  drag = null;
}
document.addEventListener("pointerup", () => {
  const d = drag;
  if (!d) return;
  if (d.active) suppressUntil = Date.now() + 250;
  clearDrag();
  if (d.active && d.target)
    void run(() =>
      service.move(
        d.seg.task.id,
        d.delta,
        d.row,
        d.weekly ? "weekly" : "monthly",
        currentMonth,
        d.swap,
      ),
    );
});
document.addEventListener("pointercancel", clearDrag);
window.addEventListener("blur", () => {
  clearDrag();
  hideTip();
});
let scrollDrag: { x: number; left: number } | null = null;
el("monthly-wrap").onpointerdown = (e) => {
  if (e.button === 0 && !(e.target as Element).closest(".cal-task-bar"))
    scrollDrag = { x: e.clientX, left: el("monthly-wrap").scrollLeft };
};
document.addEventListener("pointermove", (e) => {
  if (scrollDrag && Math.abs(e.clientX - scrollDrag.x) >= 5) {
    el("monthly-wrap").scrollLeft =
      scrollDrag.left - (e.clientX - scrollDrag.x);
    e.preventDefault();
  }
});
document.addEventListener("pointerup", () => (scrollDrag = null));
window.addEventListener("blur", () => (scrollDrag = null));
el("prev-month").onclick = () => {
  try {
    currentMonth = shiftMonth(currentMonth, -1);
    focused = null;
    render();
  } catch (e) {
    toast(String(e), true);
  }
};
el("next-month").onclick = () => {
  try {
    currentMonth = shiftMonth(currentMonth, 1);
    focused = null;
    render();
  } catch (e) {
    toast(String(e), true);
  }
};
el("add-log-btn").onclick = () => openTask();
document.querySelectorAll<HTMLElement>("[data-week]").forEach(
  (b) =>
    (b.onclick = () => {
      selectedWeek = Number(b.dataset.week);
      render();
    }),
);

let connectionToken: string | null = null;
let excelSource: ExcelSource | null = null,
  importData: Snapshot | null = null;
function previewImport() {
  try {
    if (!excelSource) return;
    const p = documents.previewExcel(
      excelSource,
      el<HTMLSelectElement>("import-sheet").value,
      Number(input("import-year").value),
    );
    importData = p.data;
    const dates = p.data.tasks
      .flatMap((t) => [t.start_date, t.end_date])
      .sort();
    el("import-summary").textContent =
      `업무 ${p.data.tasks.length}개 · ${dates[0] ?? "기간 없음"} ~ ${dates.at(-1) ?? ""}\n${connectionToken ? "연결 후 저장 버튼 또는 Ctrl+S / ⌘S를 누르면 이 파일의 선택한 일정 시트가 업데이트됩니다." : "원본 파일은 변경하지 않습니다."}`;
    el("import-warnings").textContent = p.warnings.join("\n");
    el<HTMLButtonElement>("import-confirm").disabled =
      !connectionToken && !p.data.tasks.length;
  } catch (e) {
    importData = null;
    el("import-summary").textContent = String(e);
    el<HTMLButtonElement>("import-confirm").disabled = true;
  }
}
async function chooseExcel(link: boolean) {
  await run(async () => {
    const f = link
      ? await documents.selectExcel()
      : await documents.openExcel();
    if (!f) return;
    connectionToken =
      "token" in f && typeof f.token === "string" ? f.token : null;
    excelSource = f.source;
    el("import-title").textContent = link ? "Excel 연결" : "Excel 가져오기";
    el("import-confirm").textContent = link ? "연결" : "가져오기";
    el("import-name").textContent = f.name;
    el("import-sheet").innerHTML = f.source.candidates
      .map((s) => `<option value="${esc(s)}">${esc(s)}</option>`)
      .join("");
    input("import-year").value = today().slice(0, 4);
    el<HTMLSelectElement>("import-mode").value = link ? "replace" : "append";
    el("import-mode").closest("label")!.hidden = link;
    el<HTMLDialogElement>("more-dialog").close();
    el<HTMLDialogElement>("import-dialog").showModal();
    previewImport();
  });
}
el("btn-import").onclick = () => chooseExcel(false);
el("btn-connect").onclick = () => chooseExcel(true);
el("btn-disconnect").onclick = () =>
  run(async () => {
    await disconnectExcel();
    connection = null;
    toast("Excel 연결을 해제했습니다. 일정과 파일은 유지됩니다.");
  });
el("import-sheet").onchange = previewImport;
el("import-year").onchange = previewImport;
el("import-cancel").onclick = () =>
  el<HTMLDialogElement>("import-dialog").close();
el("import-confirm").onclick = async () => {
  if (!importData) return;
  const linking = !!connectionToken;
  const plan = linking ? connectionPlan(service.state, importData) : null;
  const replace =
    !!connectionToken ||
    el<HTMLSelectElement>("import-mode").value === "replace";
  if (
    (linking ? plan!.needsConfirmation : true) &&
    !(await decide(
      connectionToken ? "Excel 연결" : replace ? "전체 일정 교체" : "일정 추가",
      linking
        ? "현재 일정과 파일 내용이 다릅니다. 현재 일정을 파일 내용으로 바꿀까요?"
        : `업무 ${importData.tasks.length}개를 ${replace ? `기존 ${service.state.tasks.length}개 일정 대신 저장할까요?` : "추가합니다. 같은 파일을 다시 가져오면 업무가 중복될 수 있습니다."}`,
    ))
  )
    return;
  await run(
    async () => {
      if (connectionToken) {
        service.state = await connectExcel(
          connectionToken,
          el<HTMLSelectElement>("import-sheet").value,
          plan!.snapshot,
          service.state.revision,
        );
        connection = await connectionInfo();
        connectionToken = null;
      } else await service.import(importData!, replace);
      el<HTMLDialogElement>("import-dialog").close();
      navigateImported();
    },
    linking ? "Excel을 연결했습니다." : "가져왔습니다",
  );
};
function navigateImported() {
  const keys = service.state.tasks.map((t) => t.start_date.slice(0, 7)).sort();
  currentMonth = keys.includes(today().slice(0, 7))
    ? today().slice(0, 7)
    : (keys[0] ?? today().slice(0, 7));
}
el("btn-export").onclick = () =>
  run(async () => {
    const p = await documents.exportExcel(service.state);
    if (p) toast("새 Excel 파일로 저장했습니다.");
  });
el("btn-backup").onclick = () =>
  run(async () => {
    const p = await documents.backup(service.state);
    if (p) toast("백업 파일을 저장했습니다.");
  });
async function restore(legacy = false) {
  const f = await documents.openJson(legacy);
  if (!f) return;
  if (
    !(await decide(
      legacy ? "V1 일정 추가" : "백업 복원",
      `${f.name}\n업무 ${f.data.tasks.length}개\n${legacy ? "기존 일정에 추가합니다." : "현재 일정을 교체합니다. 복구용 DB 사본을 먼저 남깁니다."}`,
    ))
  )
    return;
  await service.import(f.data, !legacy);
  navigateImported();
  toast(legacy ? "V1 일정을 가져왔습니다." : "백업을 복원했습니다.");
}
el("btn-restore").onclick = () => run(() => restore());
el("btn-more").onclick = () => el<HTMLDialogElement>("more-dialog").showModal();
el("btn-v1").onclick = () => run(() => restore(true));
el("btn-recovery").onclick = () =>
  run(async () => {
    const f = await openRecovery();
    if (!f) return;
    if (
      !(await decide(
        "자동 복구 사본 복원",
        `${f.name}\n업무 ${f.data.tasks.length}개로 현재 일정을 교체합니다. 현재 DB도 사전 백업됩니다.`,
      ))
    )
      return;
    await service.import(f.data, true);
    navigateImported();
    toast("복구 사본을 복원했습니다.");
  });
el("btn-info").onclick = async () => {
  if (preview) {
    await decide("미리보기", "브라우저 미리보기는 저장하지 않습니다.");
    return;
  }
  const info = await appInfo();
  await decide(
    "저장 위치",
    `일정 DB\n${info.database}\n\n자동 복구 백업\n${info.backup_directory}`,
  );
};
el("btn-reset").onclick = async () => {
  if (
    await decide(
      "전체 일정 초기화",
      `업무 ${service.state.tasks.length}개를 삭제합니다. 사용자 색상은 유지하고 복구용 DB 사본을 남깁니다.`,
    )
  )
    await run(() => service.reset(), "초기화되었습니다");
};
window.addEventListener("keydown", (e) => {
  if (
    (e.ctrlKey || e.metaKey) &&
    !e.shiftKey &&
    !e.altKey &&
    (e.code === "KeyS" || e.key.toLowerCase() === "s")
  ) {
    e.preventDefault();
    void saveAll();
  }
});
let lastToday = today();
const refreshDate = () => {
  if (today() !== lastToday) {
    lastToday = today();
    render();
  }
};
setInterval(refreshDate, 30000);
window.addEventListener("focus", refreshDate);
async function start() {
  try {
    if (!native && !preview)
      throw new Error(
        "KAR Schedule 데스크톱 앱에서 열어주세요. 개발 미리보기는 ?preview 주소에서 사용할 수 있으며 저장되지 않습니다.",
      );
    await service.load();
    if (native) connection = await connectionInfo();
    ready = true;
    refreshStatus();
    render();
    if (preview) {
      el("storage-hint").textContent =
        "개발 미리보기입니다. 데이터는 창을 닫으면 사라집니다. 실제 저장·파일 기능은 데스크톱 앱에서 테스트하세요.";
      disableFiles();
    }
    if (native) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().onCloseRequested(async (event) => {
        if (working) {
          event.preventDefault();
          toast("진행 중인 작업이 끝난 후 닫아주세요.");
        } else if (
          el("task-modal").classList.contains("is-open") ||
          (connection && connection.saved_revision !== service.state.revision)
        ) {
          event.preventDefault();
          if (
            await decide(
              "앱 닫기",
              el("task-modal").classList.contains("is-open")
                ? "입력 중인 내용은 사라집니다. 저장하지 않고 닫을까요?"
                : "연결 Excel에 아직 반영하지 않은 변경이 있습니다. 일정은 이 컴퓨터에 보관됩니다. 닫을까요?",
            )
          ) {
            el("task-modal").classList.remove("is-open");
            await getCurrentWindow().destroy();
          }
        }
      });
    }
  } catch (e) {
    el("startup-message").hidden = false;
    el("startup-message").textContent = String(e);
    status("저장소 연결 실패");
    document
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => (b.disabled = true));
  }
}
void start();
