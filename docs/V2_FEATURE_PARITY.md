# KAR 업무 일정 V2 기능 보존 및 회귀 체크리스트

> 후속 구현 진행: 현재 실행 파일과 실제 검증 결과는 [구현·검증 기록](V2_IMPLEMENTATION_STATUS.md), 사용 방법은 [테스트 안내](V2_TEST_GUIDE.md)를 참고하세요. 아래 내용은 분석 당시 기준선입니다.
기준: `legacy/kar-schedule-v1.html` v1.0.49, SHA-256 `79c5fab62fbf5ecfd9340275134f9a774f1a6bd15e22186e3a842b56b072e0f5`. 분석일 2026-09-07.

**모든 체크박스는 V2 미검증 상태다.** 이번 작업은 V1 정적 분석이며 V1/V2 UI나 Excel round-trip 시험을 완료한 것이 아니다. `L번호`는 기준선 행이다. Yes=기능 유지, 변경=저장 구조/정책에 맞춰 명시적으로 대체, No=요구된 V2 범위에서 제외. 위험 Low/Medium/High는 구현 시 회귀 위험이다.

각 행을 완료할 때 Windows 11, macOS arm64, macOS Intel 결과와 실행한 fixture, 앱 버전, 기대/실제 차이를 기록한다. 한 OS 통과만으로 체크하지 않는다. 자동화 가능한 domain/Excel 검증과 실제 native UI 검증을 구분한다.

## A. Calendar

| ID/체크 | V1 실제 기능·근거 | V2 유지 | V2 구현·검증 기준 | 위험 |
|---|---|---|---|---|
| C01 [ ] | 월간 가로 1–말일 일정표, 월 라벨 및 일자/요일 2행 (L1114, L1728) | Yes | Monthly Renderer. 7열 달력으로 redesign하지 않음; 28/29/30/31일 비교 | Medium |
| C02 [ ] | 월간 아래 주간 캘린더 동시 표시, 월–일 7일 (L1129, L1942) | Yes | Weekly Renderer, 주가 두 월/두 해를 걸치는 경우 포함 | Medium |
| C03 [ ] | 이전 달/다음 달, 12월↔1월 이동 (L3007) | Yes | DateOnly 기반 월 이동, 선택 task 강조 초기화 | Low |
| C04 [ ] | 지난주/이번주/다음주, 배지·날짜 범위 변경 (L761, L3090) | Yes | 실제 오늘 기준 3주; 선택 월과 독립 | Medium |
| C05 [ ] | 오늘 헤더 빨강, 이번 주 및 선택 주간 강조 (L1810 이후) | Yes | 오늘이 토/일이어도 우선순위 일치. 자정/절전 갱신은 개선 | Medium |
| C06 [ ] | 토요일 파랑, 일요일 빨강·배경 (L1847 이후) | Yes | V1 CSS cascade 포함 비교. 공휴일 표시로 확대하지 않음 | Low |
| C07 [ ] | 다일 업무를 가로 바·grid span으로 표시 (L1890 이후) | Yes | 양끝 포함, 하루 업무, 월말 종료 | Medium |
| C08 [ ] | 월간 piece 표시 및 주간 group 중복 제거 (L1149, L1745) | Yes | Task 1행→ViewSegment; 9/28–10/3이 주간에 한 번 표시 | High |
| C09 [ ] | 빈 달도 최소 업무 1행, 자동 bin-pack (L1760 이후) | Yes | 빈 배열과 서로 겹치지 않는 기간의 행 공유 | Medium |
| C10 [ ] | pin 우선, 충돌 시 아래 행 fallback (L1779 이후) | Yes | display_row와 computed_row 구별. sort 동률 결정적 결과 | High |
| C11 [ ] | 월간 가로 overflow, 배경 드래그 스크롤 (L3021) | Yes | 첫 월간 wrap에 실제 바인딩. task drag와 충돌 없음 | Medium |
| C12 [ ] | 주간 재렌더 후 scrollLeft 복원 (L1734, L1936) | Yes | 클릭/저장/drop 후 스크롤 유지; 월간 복원은 DOM/브라우저 동작도 확인 | Medium |
| C13 [ ] | 760px 이하 좁은 창 CSS, modal 내부 스크롤 (L388, L240) | Yes | 데스크톱 창 크기 변경으로 입력 요소 접근 확인 | Medium |

## B. Task / Modal / Colors

| ID/체크 | V1 실제 기능·근거 | V2 유지 | V2 구현·검증 기준 | 위험 |
|---|---|---|---|---|
| T01 [ ] | 업무 일지 추가, 선택 월 맥락의 기본 날짜 (L1991) | Yes | 이번 주 월요일의 월/오늘 월/다른 월 세 경우 비교 | Medium |
| T02 [ ] | 제목·시작일·종료일·메모 수정 (L2566, L2774) | Yes | 평문·개행·한글·빈 제목. 제목 없음은 UI 표시만 | Medium |
| T03 [ ] | 저장 전 업무 draft 유지, X는 미저장 닫기 (L2607, L2633) | Yes | X 후 다시 열면 이전 값. 신규 취소는 DB row 0개 | High |
| T04 [ ] | 바깥 클릭/Esc로 모달 닫지 않음 (L2839, L3118) | Yes | 두 경로에서 draft 유지. X 또는 저장으로 닫음 | Low |
| T05 [ ] | 날짜 change 시 종료를 시작으로 보정, 기간 일수 표기 (L2618, L2641) | Yes | 윤년·월경계·한 날짜·DST 시간대에서 포함 일수 | High |
| T06 [ ] | 저장 handler의 역전 날짜 swap 및 빈 날짜 오류 (L2778) | 변경 | UI 보정 유지, API 역전 입력은 오류로 거부. 무음 rollover 금지 | Medium |
| T07 [ ] | 그룹 전체 수정·삭제 (L2703, L2798, L2823) | Yes | canonical id 1개 수정/삭제; 양 월/주간 모두 반영 | High |
| T08 [ ] | 삭제 전 업무 제목 포함 confirm, 신규는 삭제 숨김 (L2587, L2823) | Yes | 취소 무변경, 빈 제목 안내, 삭제 결과와 DB 일치 | Medium |
| T09 [ ] | 모달 완료 클릭/Space/Enter, 저장 시 적용 (L2593, L2765) | Yes | aria 상태 및 실제 boolean 일치. 저장 전 cancel은 되돌림 | Medium |
| T10 [ ] | 완료 바 취소선·그레이·opacity; 편집/drag 가능 (L159, L1892) | Yes | 완료를 read-only로 바꾸지 않음; bar checkbox 새로 추가하지 않음 | Low |
| T11 [ ] | 모달 저장 시 id 재생성, sortIndex 유지하지만 row는 유실 (L2800) | 변경 | id·sort_order·display_row 유지. 날짜만 바꿔도 식별자 동일 | High |
| U01 [ ] | 바 클릭 강조, 모달 열기 및 제목 focus (L1920, L2591) | Yes | 안정 task id로 양 화면 강조; 다른 월 segment도 같은 업무 | Medium |
| U02 [ ] | tooltip 제목·완료·기간·notes; 월간 조각/주간 전체 기간 (L1184, L1903) | Yes | 기간 표시 맥락 및 긴 메모 줄바꿈 비교 | Medium |
| U03 [ ] | tooltip 화면 가장자리 위치 보정, modal/drag 시 숨김 (L1194, L1582, L2567) | Yes | overflow 밖에 표시, 창 모서리·좁은 창에서 잔상 없음 | Low |
| U04 [ ] | 색 없음 + 핑크/주황/노랑/초록/파랑 (L2843, L2883) | Yes | 5 hex 정확 일치, null 색 구분 | Low |
| U05 [ ] | native color input·사용자 색 선택, 현재 색 스와치 (L2659, L2906) | Yes | 두 WebView에서 취소/선택 및 모달 저장 확인 | Medium |
| U06 [ ] | hex/이름 검증, 같은 hex 이름 갱신, 프리셋 중복 방지 (L2851) | Yes | PaletteService + SQLite; Enter 추가 포함 | Medium |
| U07 [ ] | 사용자 색 이름 변경 및 삭제 confirm (L2949 이후) | Yes | 업무에 이미 적용된 색 유지, 팔레트 재시작 보존 | Medium |
| U08 [ ] | 팔레트는 업무 draft와 독립 즉시 저장; 새 업무 색 자동 등록 (L2789, L2876) | Yes | 업무 취소 시 팔레트 변경까지 되돌리지 않음. Excel 즉시 저장은 제거 | Medium |
| U09 [ ] | 사용자 색 dropdown 토글/외부 클릭 닫기 (L3137) | Yes | 모달 외부 닫기 정책과 혼동 없음 | Low |
| U10 [ ] | YIQ 기반 글자색·custom hover 색 유지 (L2339, L1895) | Yes | 어두운/밝은 hex 및 완료 상태 조합 | Low |

## C. Drag & Drop

| ID/체크 | V1 실제 기능·근거 | V2 유지 | V2 구현·검증 기준 | 위험 |
|---|---|---|---|---|
| D01 [ ] | 좌클릭 5px 임계값; 가로/세로/대각선 (L1557–1582) | Yes | 작은 클릭은 모달, 5px 이상 이동은 drag | High |
| D02 [ ] | ghost 따라가기·원본 opacity·drop preview (L1463–1508, L1584) | Yes | 좌표 스케일/trackpad/창 이동, 정상 종료·취소 시 잔상 없음 | Medium |
| D03 [ ] | 월간 단일 월 날짜 이동, 월말 clamp·기간 유지 (L1311, L1698) | Yes | 1일 이전/말일 이후 이동 시 기존 월에 clamp. preview도 같은 계산 | High |
| D04 [ ] | 월간 multi-month 가로 이동은 전체 기간 재분산 (L1669 이후) | Yes | 단일 Task 전체 날짜 이동, 12/31 넘어가기. V1 preview의 dayDelta=0 불일치는 개선 | High |
| D05 [ ] | 월간 multi-month 순수 세로 이동은 해당 월 pin/교환 (L1686) | Yes | task_month_layout으로 해당 월 pin/교환만 저장. 다른 월 row 불변 | High |
| D06 [ ] | 월간 빈 배경 drop은 희망 행 pin, 충돌 pin 해제 (L1263, L1448) | Yes | 같은 날짜 겹침 pin 해제를 Task batch transaction으로 처리 | High |
| D07 [ ] | 월간 다른 bar 위 drop은 시각적 row 교환 (L1283, L1699) | Yes | 같은 row는 no-op; 두 pin 및 영향을 받은 pin 원자 변경 | High |
| D08 [ ] | 주간은 좌표의 날짜 셀 우선, visible segment 시작 anchor (L1239, L1249) | Yes | 주 이전에 시작한 업무를 중간 부분에서 잡아도 기대 delta 계산 | High |
| D09 [ ] | 주간 날짜 이동은 전체 기간, delta=0은 그룹 row 변경 (L1420, L1667) | Yes | 월·연 경계 넘는 이동에도 duration/id/notes/color/done 유지 | High |
| D10 [ ] | drop target 없으면 변경 없음 (L1659), 뒤따르는 click 억제 (L1653) | Yes | 영역 밖 drop/cancel 후 DB 무변경·모달 오픈 없음 | High |
| D11 [ ] | 변경 후 local 저장 및 월/주 갱신, FLIP animation (L1713) | 변경 | DB commit 후 갱신; 실패 rollback; stable id로 animation 대상 유지 | High |
| D12 [ ] | 날짜 이동 중 sortIndex 보존 (L1432) | Yes | sort_order 유지; 수동 행 pin과 자동 정렬을 혼동하지 않음 | Medium |

## D. Local persistence / File interaction

| ID/체크 | V1 실제 기능·근거 | V2 유지 | V2 구현·검증 기준 | 위험 |
|---|---|---|---|---|
| P01 [ ] | Excel 미연결 상태도 업무 로컬 저장·재열기 (L630–705) | 변경 | SQLite 재시작 복구. localStorage에는 업무 저장하지 않음 | High |
| P02 [ ] | 누락 sortIndex 보정 및 piece full range 정규화 (L639–671) | 변경 | V1 importer에서만 검증·변환. canonical Task 중복 날짜 필드 없음 | High |
| P03 [ ] | 현재 파일 handle/마지막 폴더 IndexedDB 복원 (L772, L867) | 변경 | 연결 handle 제거. last directory hint는 local settings만 | Medium |
| P04 [ ] | `.xlsx` 연결 시 업무 교체·표시 월 선택 (L835–863) | 변경 | Import preview 뒤 추가/명시적 교체. 오늘 월 우선/없으면 earliest 표시 이식 | High |
| P05 [ ] | 이전 파일 위치 hint 및 유효하지 않은 hint 재시도 (L807–830) | Yes | Native dialog default directory, 실패 시 기본 경로 | Medium |
| P06 [ ] | 연결 파일 수동 저장 및 Ctrl/Cmd+S (L946, L3103) | 변경 | DB pending 저장 확인. 모달 draft 암묵 저장/Excel 덮어쓰기 금지 | High |
| P07 [ ] | 변경 1.5초 뒤 연결 파일 자동 덮어쓰기 (L695) | No | Task 변경은 DB commit, 외부 XLSX 쓰기 0회 | High |
| P08 [ ] | 연결 해제 시 전체 일정 삭제, 팔레트/마지막 폴더는 남음 (L895) | 변경 | 명시적 전체 일정 초기화 + 건수 확인/사전 snapshot. Import 취소로 초기화 금지 | High |
| P09 [ ] | 연결/변경/동기화/저장중 상태·시각 토스트 (L1044) | 변경 | DB 저장중/저장됨/실패, Excel export는 별도 결과 | Medium |
| P10 [ ] | FS 미지원 브라우저에서 연결/저장 숨김 (L1048) | No | Windows/macOS 모두 native file 기능 제공 | Medium |
| P11 [ ] | permission query/request 및 쓰기 실패 알림 (L935–993) | 변경 | Native 경로 scope·OS 오류 매핑; cancel은 오류 토스트가 아님 | Medium |
| P12 [ ] | isDirty+fileHandle일 때 종료 경고 (L3126) | 변경 | Tauri close 요청에서 pending DB 기다림·실패 보호. 연결 여부 무관 | High |

## E. Excel

| ID/체크 | V1 실제 기능·근거 | V2 유지 | V2 구현·검증 기준 | 위험 |
|---|---|---|---|---|
| E01 [ ] | 새 XLSX 파일 Export, 기본명 `업무일정.xlsx`, 업무 없으면 거부 (L999) | Yes | Native Save dialog, 빈 데이터 정책 유지. 취소 시 파일/DB 무변경 | Medium |
| E02 [ ] | 브라우저 Blob download fallback (L1035) | 변경 | Native writeAtomic으로 통일 | Low |
| E03 [ ] | 모든 비어 있지 않은 월을 키순으로 Sheet2에 출력 (L2350, L2522) | Yes | 1년/연말/빈 월 건너뜀 및 Sheet2_2 이름 충돌 처리 | High |
| E04 [ ] | A–AF 표·제목/월/기간 병합·열 너비·행 높이 (L2350–2452) | Yes | 32열, wch 10/7, hpt 38/22/54와 merge 범위 비교 | High |
| E05 [ ] | 글꼴·글자 크기·굵게·테두리·중앙·줄바꿈 (L2453–2498) | Yes | 맑은 고딕 28/12/11, 스타일 필드 비교 + Excel 실제 열기 | High |
| E06 [ ] | task 색은 시작 셀 fill (L2500), UI YIQ는 Excel 미적용 | Yes | RGB fill과 병합 시 표시 비교. custom dark fill은 개선 필요 시 별도 제안 | High |
| E07 [ ] | ✓ 접두사로 완료 Export/Import (L2300, L2390) | Yes | 완료 왕복, 원제목이 ✓로 시작하는 모호성은 Import preview에서 처리 | Medium |
| E08 [ ] | 시작 셀 코멘트 notes, 작성자 KAR 일정 (L2294, L2493) | Yes | 한글·여러 줄·여러 comment 합침 검증; V1 trim 손실은 진단 | High |
| E09 [ ] | ColorDB hex/label, header 없음 (L2188, L2549) | Yes | 빈/중복/프리셋/invalid hex 및 이름 수정·삭제 왕복. 빈 팔레트가 과거 색 DB를 부활시키지 않음 | High |
| E10 [ ] | MCE Choice/Fallback 및 fill 상속·ARGB 변환 (L2010) | Yes | 실제 MCE fixture 추가; theme/indexed/tint 미지원은 명시 경고 | High |
| E11 [ ] | 2 MiB 초과 theme 치환 후 read (L2144) | Yes | 메모리 복사에만 적용, 원본 hash 불변. 큰 theme/손상 ZIP fixture | High |
| E12 [ ] | 상단 numeric signature로 monthly 판별 (L2165) | 변경 | 월 블록·사용자 시트 선택으로 오탐 방지. 실제 Sheet1 삭제 위험 회귀 | High |
| E13 [ ] | 최대 업무 수 한 시트 선택; 나머지 미수입 (L2210) | 변경 | 모든 후보를 보여주고 선택. 헤더 16행 시트 경고/수동 선택 경로 | High |
| E14 [ ] | 연도 없음은 실행 연도, 월 감소 시 연도+1 (L2228, L2275) | 변경 | 수입 연도 확인, 연말/빠진 연도/동일 월 반복 모호성 검증 | High |
| E15 [ ] | V1 Export 연도·groupId/id·row 메타데이터 미기록 (L2350) | 변경 | 제목/연도 전환 월 라벨에 연도 표시. metadata 시트 없음; JSON에 Task/layout 전체 보존 | High |
| E16 [ ] | 연결 workbook 다시 읽어 모든 monthly 삭제 후 재작성 (L2515) | No | 자동 overwrite 제거. 선택 시트만 바꾼 별도 사본 옵션은 보존 수준 결정 후 | High |
| E17 [ ] | 타 시트 객체를 남기려는 workbook 보존 (L2515) | 변경 | 별도 사본의 대상 외 값·수식·서식·병합·메모·도형·관계·이름 검증. 보존 실패 시 사본 쓰기를 중단하고 새 보고서 Export 제공 | High |
| E18 [ ] | 파싱 에러도 빈 결과, 0개 연결 시 기존 업무 유지 (L2220, L838) | 변경 | empty/unsupported/error 구별, 실패나 취소 중 DB/팔레트 무변경 | High |
| E19 [ ] | Import 새 id 및 엑셀 순서 sortIndex, row/group 정보 소실 (L845) | 변경 | source cell 위치→row 후보, 그룹 없는 동일 제목 자동 병합 금지 | High |
| E20 [ ] | 재수입 공백 trim/요일 문자열 제외/월말 검증 부족 (L2283) | 변경 | 데이터 진단. 유효 Task를 조용히 버리지 않고 처리 건수 대조 | High |

## F. 잔존 코드·미구현 기능: 실제 parity로 오인 금지

| 항목 | V1 상태/근거 | V2 방침 |
|---|---|---|
| 날짜/제목 정렬 asc/desc 선택 UI | sortTasks/sortResults/bindSortSelects만 정의, DOM·호출 없음 (L599, L611, L3063) | 활성 기능으로 추가하지 않음. 내부 sortIndex 배치는 별도 보존 |
| sortIndex 기반 위/아래 끼워넣기 | reorderInMonth 정의만 있음 (L1542). 실제 drop은 pin/교환 | 함수 이름으로 드래그 동작을 추정하지 않음 |
| 주간 인라인 목록 제목/날짜 수정·완료·삭제 | 관련 CSS/함수/상태 잔존. renderThisWeek는 캘린더만 렌더 (L1983) | UI 복원은 별도 요청 사항 |
| 캘린더 bar의 완료 체크박스 | 명시적으로 만들지 않음 (L1898) | 모달 완료만 보존 |
| 주간 접기/월간 펼치기/오늘로 복귀 | DOM 없음, calendarExpanded=false, scrollToThisWeek no-op (L543, L1946) | 미구현 상태 명시, 새 기능으로 추가 금지 |
| weekly 배경 drag-scroll | setupCalendarDragScroll은 첫 `.calendar-wrap`에만 연결 (L3022) | 주간 일반 가로 스크롤과 구별 |
| .xls Import 및 file input fallback | hidden input만 존재, change 핸들러 없음 (L428) | 초기 지원 .xlsx |
| 업무 신규 저장 후 주간 자동 펼침 | inTw 계산 이후 실행 동작 없음 (L2804–2818) | 주석만을 근거로 기능 있다고 주장하지 않음 |
| 월간 인접 월 셀·continuation 표시 | 관련 CSS/flag는 있으나 날짜 생성이 인접 월을 넣지 않음 | 현재 보이는 UI를 보존 |
| 캘린더 빈 칸 추가 / 끝점 resize | 이벤트 구현 없음 | 범위 밖 |
| 검색/반복/공휴일 데이터/주간 별도 Excel/전용 인쇄 | 활성 구현 없음 | 범위 밖 |

## G. V2 신규 필수 회귀 항목

| ID/체크 | 항목 | 합격 기준 |
|---|---|---|
| N01 [ ] | 완전 오프라인 설치/기동 | 런타임 미설치 Windows, 깨끗한 macOS에서 첫 설치·실행; 브라우저/개발 도구 미설치 |
| N02 [ ] | 외부 요청 0 | 배포 번들 검사 + 실제 앱/포함 runtime 요청 관찰, font/Excel/backup 포함 |
| N03 [ ] | 단일 Task 데이터 | 9/28–10/3 DB count=1, 두 달 및 주간 표시, 수정·이동 후 id 동일 |
| N04 [ ] | 저장 실패 및 종료 | 디스크 부족/잠금/권한/프로세스 종료, 마지막 commit 보존 및 실패 안내 |
| N05 [ ] | transaction 원자성 | Import/Restore/초기화/pin 교환 중간 오류 시 부분 데이터 없음 |
| N06 [ ] | V1 이전 진단 | 유효 그룹 병합·독립 동일 제목 유지·누락 월/속성 충돌 보고·월별 row/정렬 보존 |
| N07 [ ] | JSON 교차 OS 복원 | Windows→macOS→Windows; 모든 Task 필드·월별 layout·팔레트 같음, OS 절대경로 복원 안 함 |
| N08 [ ] | backup 실패·버전 | 잘림/손상/미래 format/중복 id 거부. 현재 DB 무변경, 사전 snapshot 확인 |
| N09 [ ] | schema upgrade 및 앱 update | 이전 schema 변환 성공/실패 rollback, future schema 거부, AppData 유지 |
| N10 [ ] | 원본 보호 | 두 원본 XLSX와 HTML hash 유지. Import·실패 Export가 원본을 덮지 않음 |
| N11 [ ] | WebView 상호작용 | 한국어 IME/date/color input, Ctrl/⌘S, drag·scroll·폰트·모달을 두 OS에서 확인 |
| N12 [ ] | 동시 실행 | 두 번째 앱이 별도 writer를 만들지 않고 기존 창 활성화 또는 안내 |

## 테스트 fixture 및 기록 형식

필수 fixture는 빈 데이터, 단일 날짜, 겹침/인접 기간, 월별 pin 차이 그룹, 2026-09-28~10-03, 2026-12-28~2027-01-03, 2028-02-28~03-01, 잘못된 2026-02-30, 긴 한국어 제목·여러 줄 메모, 다섯 프리셋/어두운 사용자 색, 완료 접두사 제목, MCE Choice/Fallback/상속, 대형 theme, ColorDB 비움, 원본 여러 시트/헤더 위치 차이, 연도 없는 파일이다. 실제 업무 제목을 fixture로 복제할 필요는 없다.

| 항목 ID | Fixture/앱 버전 | Windows 11 결과 | macOS arm64 결과 | macOS Intel 결과 | 근거/의도적 차이 |
|---|---|---|---|---|---|
| 작성 예시 | 미실행 | 미검증 | 미검증 | 미검증 | 구현 단계에서 기록 |

의도적으로 변경하는 동작도 검증해야 한다. No 항목은 V2에서 해당 동작이 발생하지 않음을 확인한다. [migration 기본값](V2_MIGRATION_PLAN.md)을 기준으로 구현하고, 체크는 실제 시험 후에만 한다. 기존 HTML은 어떤 회귀 결과가 나와도 이 작업 흐름에서 수정하지 않는다.
