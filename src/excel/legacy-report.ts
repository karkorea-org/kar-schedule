// @ts-nocheck
// Preserved V1 worksheet dimensions, merges, comments and styling.
import XLSX from "xlsx-js-style";
const WEEKDAYS_KR=["일","월","화","수","목","금","토"];
function daysInMonth(y,m){return new Date(y,m+1,0).getDate();}
function weekdayOf(y,m,d){return new Date(y,m,d).getDay();}
  function assignRows(tasks){
    // 엑셀 export도 동일한 세그먼트 기반 하이브리드: pinned 고정, 나머지 bin-pack
    const sorted = [...tasks].sort((a,b) =>
      ((a.sortIndex ?? 0) - (b.sortIndex ?? 0)) ||
      a.start - b.start ||
      a.end - b.end
    );
    const rows = []; // rows[i] = [[s, e], ...]
    function fitsRow(segs, ts, te){
      for (const [ss, se] of segs){ if (ts <= se && te >= ss) return false; }
      return true;
    }
    sorted.forEach(t => {
      if (typeof t.row !== 'number') return;
      let row = t.row;
      while (rows.length <= row) rows.push([]);
      while (!fitsRow(rows[row], t.start, t.end)){
        row++;
        while (rows.length <= row) rows.push([]);
      }
      rows[row].push([t.start, t.end]);
      t._row = row;
    });
    sorted.forEach(t => {
      if (typeof t.row === 'number') return;
      let placed = false;
      for (let i = 0; i < rows.length; i++){
        if (fitsRow(rows[i], t.start, t.end)){
          t._row = i;
          rows[i].push([t.start, t.end]);
          placed = true;
          break;
        }
      }
      if (!placed){ t._row = rows.length; rows.push([[t.start, t.end]]); }
    });
    return { rowCount: Math.max(1, rows.length), ordered: sorted };
  }

export function buildMonthlySheet(monthData, includeEmpty=false){
    const MAX_DAYS = 31;
    const monthKeys = Object.keys(monthData).filter(k => includeEmpty || (monthData[k].tasks || []).length > 0).sort();

    const rows = [];
    const merges = [];
    const cellNotesToAdd = [];
    const cellStylesToAdd = [];

    const title = (monthKeys[0]?.slice(0,4) || '') + '년 업무 일정 및 계획';
    const titleRow = [title];
    for (let i = 0; i < MAX_DAYS; i++) titleRow.push('');
    rows.push(titleRow);
    merges.push({s:{r:0,c:0},e:{r:0,c:MAX_DAYS}});

    const header = ['        일\n달'];
    for (let d = 1; d <= MAX_DAYS; d++) header.push(d);
    rows.push(header);

    monthKeys.forEach(key => {
      const parts = key.split('-');
      const y = parseInt(parts[0],10);
      const m = parseInt(parts[1],10) - 1;
      const days = daysInMonth(y,m);
      const { rowCount, ordered } = assignRows([...monthData[key].tasks]);

      const monthStartRowIdx = rows.length;

      const wdRow = [`${y}년 ${m+1}월`];
      for (let d = 1; d <= MAX_DAYS; d++){
        wdRow.push(d <= days ? `${d}(${WEEKDAYS_KR[weekdayOf(y,m,d)]})` : '');
      }
      rows.push(wdRow);

      const taskRows = [];
      for (let r = 0; r < rowCount; r++){
        const row = [''];
        for (let d = 0; d < MAX_DAYS; d++) row.push('');
        taskRows.push(row);
      }
      ordered.forEach(t => { taskRows[t._row][t.start] = (t.done ? '✓ ' : '') + (t.title || ''); });
      taskRows.forEach(r => rows.push(r));

      merges.push({s:{r:monthStartRowIdx,c:0},e:{r:monthStartRowIdx + rowCount, c:0}});
      ordered.forEach(t => {
        if (t.end > t.start){
          merges.push({
            s:{r: monthStartRowIdx + 1 + t._row, c: t.start},
            e:{r: monthStartRowIdx + 1 + t._row, c: t.end}
          });
        }
        if (t.notes && t.notes.trim()){
          cellNotesToAdd.push({
            r: monthStartRowIdx + 1 + t._row,
            c: t.start,
            text: t.notes
          });
        }
        if (t.color){
          cellStylesToAdd.push({
            r: monthStartRowIdx + 1 + t._row,
            c: t.start,
            color: t.color
          });
        }
      });
    });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!merges'] = merges;

    // 컬럼 너비 — A열은 월 라벨/날짜 헤더 제목, 나머지는 일별
    const cols = [{wch:10}];
    for (let i = 0; i < MAX_DAYS; i++) cols.push({wch:7});
    ws['!cols'] = cols;

    // 행 높이 (pt) — 데이터 행은 3줄 고정(54pt). wrapText로 셀 폭 안에서 줄바꿈하되 행 높이는 고정.
    const lastRow = rows.length - 1;
    const lastCol = MAX_DAYS;
    const rowHeights = [
      { hpt: 38 }, // R1 제목
      { hpt: 22 }  // R2 일자 헤더
    ];
    for (let r = 2; r <= lastRow; r++) rowHeights.push({ hpt: 54 });
    ws['!rows'] = rowHeights;

    // 빈 셀은 stub cell ({t:'z'})로 만들어 엑셀이 "값 없는 빈 셀"로 인식하게 함.
    // 이렇게 하면 옆 task 셀의 글자가 길 때 자연스럽게 오버플로하여 표시됨.
    // (빈 문자열 ''로 채우면 "값 있음"으로 인식돼 오버플로가 차단되는 문제)
    for (let r = 0; r <= lastRow; r++){
      for (let c = 0; c <= lastCol; c++){
        const addr = XLSX.utils.encode_cell({r, c});
        if (!ws[addr]) ws[addr] = { t: 'z' };
      }
    }
    ws['!ref'] = XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:lastRow, c:lastCol} });

    const thinBorder = {
      top:    { style: 'thin', color: { rgb: '000000' } },
      bottom: { style: 'thin', color: { rgb: '000000' } },
      left:   { style: 'thin', color: { rgb: '000000' } },
      right:  { style: 'thin', color: { rgb: '000000' } }
    };
    const setStyle = (r, c, s) => {
      const addr = XLSX.utils.encode_cell({r, c});
      if (!ws[addr]) ws[addr] = { t: 'z' };
      ws[addr].s = Object.assign({}, ws[addr].s || {}, s);
    };
    const FONT = '맑은 고딕';

    // R1 제목 — 28pt 굵게 가운데
    for (let c = 0; c <= lastCol; c++){
      setStyle(0, c, {
        font: { name: FONT, sz: 28, bold: true, color: { rgb: '000000' } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: thinBorder,
        fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFF' }, bgColor: { rgb: 'FFFFFF' } }
      });
    }

    // R2 일자 헤더 — 좌측 셀("    일\n달")은 줄바꿈
    for (let c = 0; c <= lastCol; c++){
      setStyle(1, c, {
        font: { name: FONT, sz: 12, bold: true, color: { rgb: '000000' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: c === 0 },
        border: thinBorder
      });
    }

    // R3+ 모든 데이터 행 — 가운데, 굵게, 테두리.
    // wrapText:true → 셀 너비를 넘는 글자는 줄바꿈, 행 높이도 콘텐츠에 맞춰 자동 확장.
    for (let r = 2; r <= lastRow; r++){
      for (let c = 0; c <= lastCol; c++){
        setStyle(r, c, {
          font: { name: FONT, sz: 11, bold: true, color: { rgb: '000000' } },
          alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
          border: thinBorder
        });
      }
    }

    cellNotesToAdd.forEach(({r, c, text}) => {
      const addr = XLSX.utils.encode_cell({r, c});
      if (ws[addr]){
        ws[addr].c = [{ a: 'KAR Schedule', t: text }];
        ws[addr].c.hidden = true;
      }
    });

    // 바 배경색 — 위에서 적용한 일반 스타일 위에 fill만 덮어씀 (테두리/폰트 유지)
    cellStylesToAdd.forEach(({ r, c, color }) => {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (ws[addr]){
        const prev = ws[addr].s || {};
        ws[addr].s = Object.assign({}, prev, {
          fill: { patternType: 'solid', fgColor: { rgb: color }, bgColor: { rgb: color } },
          patternType: 'solid',
          fgColor: { rgb: color },
          bgColor: { rgb: color }
        });
      }
    });

    return ws;
  }
