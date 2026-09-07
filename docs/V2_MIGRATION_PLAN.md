# KAR 업무 일정 V2 마이그레이션 계획

> 후속 구현 진행: 현재 실행 파일과 실제 검증 결과는 [구현·검증 기록](V2_IMPLEMENTATION_STATUS.md), 사용 방법은 [테스트 안내](V2_TEST_GUIDE.md)를 참고하세요. 아래 내용은 분석 당시 기준선입니다.
분석일: 2026-09-07. 상태: **분석 완료 / 구현 전 설계안**.

## 1. 범위와 증거

- 기준선: `legacy/kar-schedule-v1.html`, 표시 버전 v1.0.49, 3,154행.
- SHA-256: `79c5fab62fbf5ecfd9340275134f9a774f1a6bd15e22186e3a842b56b072e0f5`.
- HTML/CSS/JavaScript 전체를 읽고 DOM, 이벤트 연결, 호출 경로를 정적 분석했다. 아래 `L번호`는 이 기준선의 행 번호다. 주석의 설명보다 실행되는 코드와 실제 DOM을 우선했다.
- 프로젝트의 Excel 두 파일은 ZIP/XML을 읽어 시트, 날짜 헤더, 병합, 메모, 스타일 구조를 확인했다. Excel 애플리케이션 렌더링 및 V1 브라우저 동작 시험은 이번에 수행하지 않았다. 따라서 런타임 재현 결과와 정적 분석상 위험을 구별한다.
- 기존 HTML, Excel, Git 상태를 변경하지 않는다. 시작 시 기존 루트 HTML 삭제 표시와 `legacy/` 미추적 상태가 이미 있었다. 이번 작업의 변경은 `docs/`의 다섯 Markdown 문서뿐이다.
- Tauri scaffold, 패키지 설치, Rust/SQLite 구현, UI 및 Excel 코드 변경은 이번 범위 밖이다.

관련 문서: [요구사항](V2_REQUIREMENTS.md), [데이터 모델](V2_DATA_MODEL.md), [아키텍처](V2_ARCHITECTURE.md), [기능 보존 체크리스트](V2_FEATURE_PARITY.md).

## 2. V1 전체 구조

| 구역 | 실제 책임 | 근거 |
|---|---|---|
| 문서 헤더·CDN | 웹 폰트 및 세 라이브러리 전역 로딩 | L1–11 |
| 인라인 CSS | 녹색 Excel 계열 테마, Grid, 업무 바, 모달, 반응형, 드래그 표시. 후반 CSS가 앞부분을 덮어쓴다 | L12–405 |
| HTML | 파일 버튼, 월간·주간 패널, 신규/상세 모달, 사용자 색상, 토스트 | L409–532 |
| 단일 IIFE | 모든 상태, 도메인, 파일 접근, 렌더링, 이벤트가 같은 클로저에 결합 | L534–3151 |
| 상태·로컬 저장·행 배치 | `monthData`, 날짜, 정렬, localStorage, 자동 저장 예약 | L537–768 |
| 파일 연결·저장 | 핸들 복원, Import, 연결 파일 덮어쓰기, 새 파일 Export | L772–1090 |
| 캘린더·드래그 | 월/주 날짜 투영, 그룹 병합, 행 pin, 날짜 이동, ghost, FLIP | L1093–2005 |
| Excel | MCE 색상 복구, theme 전처리, 판별·파싱·시트 생성 | L2010–2559 |
| 모달·색상·이벤트 | 저장 때 월별 재분산, 그룹 삭제, 팔레트 CRUD, 키보드·종료 이벤트 | L2566–3151 |

현재 실제 저장 흐름은 `UI → monthData → localStorage → 1.5초 debounce → 연결 Excel 재작성`이다. Excel을 연결하지 않아도 일정 편집과 localStorage 저장은 가능하다. 즉 V1은 Excel 단독 저장소가 아니라 브라우저 데이터와 Excel 복제본을 수동으로 연결한 구조다. 파일 감시, Excel에서 바뀐 업무의 실시간 역동기화는 없다. 시작할 때 핸들만 복원하며 Excel 내용을 자동 재수입하지 않는다.

## 3. 현재 사용 가능한 핵심 기능

- 월간은 보통의 7열 달력이 아니라 **일자 1–28/29/30/31을 가로로 놓은 일정표**다. 월 이름 열, 날짜/요일 헤더, 업무 행이 있다. 주간은 월요일–일요일 7열이며 월간 아래에 동시에 표시된다.
- 이전/다음 달, 실제 오늘 표시, 이번 주 강조, 토/일 색상, 지난주/이번주/다음주 선택을 제공한다. 월 선택과 주 선택은 독립이다. 오늘·주 기준은 실행 시 계산하여 자정 후 자동 갱신하지 않는다.
- 추가 모달의 기본 기간은 선택 월이 이번 주 월요일의 월이면 이번 주 월요일부터 일요일 또는 월말, 그 외 현재 월이면 오늘, 나머지 월이면 1일이다.
- 제목(빈 제목 허용), 시작/종료일, 평문 세부 내용, 색상, 완료 상태를 저장한다. 저장 전 변경은 모달 DOM에만 있으며 X로 닫으면 업무 수정이 적용되지 않는다. 팔레트 관리 작업은 별도로 즉시 저장된다.
- 완료 업무는 취소선·흑백·투명도로 표시한다. 바에 완료 체크박스는 없다. 완료 상태는 모달에서 바꾸며 완료 업무도 모달 수정·삭제 및 드래그가 가능하다.
- 업무 클릭은 강조 표시 및 모달 열기, hover는 제목·완료·기간·메모 툴팁이다. 월간 툴팁은 월 조각 기간, 주간 툴팁은 전체 기간을 사용한다.
- 좌클릭 5px 드래그 임계값, ghost, drop 표시, 행 이동/교환, 날짜 이동, 드래그 직후 클릭 억제, 재배치 애니메이션이 구현되어 있다. 세부 규칙은 기능 보존 문서의 D 항목 참조.
- 색 없음, 프리셋 다섯 색, 사용자 색 선택/이름 지정/추가/이름 변경/삭제. 프리셋은 `FAA4B0`, `FFC000`, `F9DB6F`, `A9D18E`, `B4C7E7`. UI는 YIQ 150을 기준으로 글자색을 결정한다.
- Excel 연결/교체, 연결 해제와 일정 초기화, 새 XLSX Export, 연결 XLSX 수동·자동 덮어쓰기, Ctrl/Cmd+S, 변경 상태·저장 결과·오류 알림이 있다.

### 잔존 코드와 실제 기능의 구별

`sortTasks`, `sortResults`, `bindSortSelects`, `reorderInMonth`, `getTasksOverlappingRange`, `syncTaskTitleInGroup`, `toggleTaskDone`은 정의만 있고 호출되지 않는다. 정렬 선택창, 인라인 주간 업무 목록, 접기/펼치기 버튼, 월간 확대 버튼, 오늘로 돌아가기 버튼은 현재 DOM에 없다. `twCollapsed`, `editingTwIds`, 정렬 localStorage 키 및 관련 CSS가 남아 있어도 현재 사용자 기능으로 계산하지 않는다. `calendarExpanded`는 false로 고정되어 `scrollToThisWeek`는 즉시 종료한다. 숨겨진 `.xls/.xlsx` file input도 change 핸들러가 없어 Import fallback이 아니다. 캘린더 빈 칸 클릭으로 추가, 바 끝 resize, 공휴일 데이터, 검색, 반복 일정, 인쇄 전용 화면은 구현되지 않았다.

## 4. Excel 처리와 호환성 계약

### 가져오기

1. 연결 대화상자는 `.xlsx` 하나만 받는다. `getFile().arrayBuffer()`로 읽는다.
2. `sanitizeWorkbookForXlsxRead`는 ZIP 내 `xl/theme/themeN.xml`이 2 MiB 초과이면 메모리에서 간단한 Office theme로 교체·재압축한다. 원본 파일을 직접 수정하는 단계는 아니다.
3. `XLSX.read(..., {type:'array', cellStyles:true})` 후 MCE 색상 맵과 `ColorDB`를 읽는다.
4. `detectSheetKind`는 used range 시작부터 최대 7행에서 B–AF의 열 위치와 같은 숫자 1–31이 20개 이상이면 monthly로 분류한다. 엄밀한 연속성·월 블록 검사는 없다.
5. monthly 시트 중 **파싱 업무 수가 가장 많은 한 시트**만 선택한다. 동률이면 앞 시트다. 모든 월간 시트를 합치지 않는다.
6. `parseMonthlyCalendar`는 상단 최대 6행의 `YYYY년`으로 연도를 찾고, 없으면 실행 연도다. 날짜 헤더 이후 A열의 `N월`과 A열 세로 병합으로 월 블록을 구한다. 월 번호가 줄어들면 연도를 1 올린다.
7. 월 라벨의 다음 행부터 스캔한다. B–AF 열 번호가 시작일, 수평 병합 끝이 종료일이다. 빈 값·요일 문자열·병합 내부 값은 건너뛴다. 월 실제 일수 검증은 없다.
8. 시작 셀 코멘트 텍스트를 개행 결합·trim해 notes로, 제목 앞 `✓ `를 done으로, fill을 color로 읽는다. 제목과 메모의 앞뒤 공백은 보존되지 않는다.
9. 연결 단계는 결과가 1개 이상이면 기존 `monthData` 전체를 교체한다. 새 id와 배열 순서 기반 sortIndex만 부여하며 groupId/fullStart/fullEnd/고정 row는 복원하지 않는다. 파싱 실패도 빈 결과로 반환되어 파일이 연결될 수 있고, 0개이면 기존 일정이 남는다.

### 색상 복구와 전처리의 범위

`buildMceStyleMap`는 fflate로 OOXML을 열고 DOMParser로 `styles.xml`의 fills, cellStyleXfs, cellXfs를 읽는다. `mc:AlternateContent`의 Choice를 우선하고 Fallback을 다음으로 읽으며 applyFill/fillId, xfId 상속으로 RGB fill을 찾는다. workbook.xml 및 관계 파일을 통해 시트 이름을 XML 경로에 연결한 뒤 셀 style index를 해석한다. ARGB는 앞 두 글자를 제거한다. MCE 맵 우선, 실패 시 `cell.s.fgColor/bgColor` 또는 중첩 fill RGB를 사용한다. **theme/indexed/tint 색 전체를 해결하는 엔진이 아니며, 모든 Excel 스타일을 복구하지 않는다.** 현재 두 샘플에는 AlternateContent와 2 MiB 초과 theme가 없어 이 분기들을 시험할 fixture가 추가로 필요하다.

### 내보내기

| 요소 | V1 실제 출력 |
|---|---|
| 시트 | 모든 비어 있지 않은 월을 키 순으로 한 `Sheet2`에 쌓음. 충돌 시 `Sheet2_2`, `_3`… |
| 제목/헤더 | A1:AF1 병합, `업무 일정 및 계획`; A2 일/달, B2:AF2 숫자 1–31 |
| 월 블록 | A열 `N월`을 요일행+업무행에 세로 병합. 해당 월의 유효 일자만 요일 표시 |
| 기간/행 | `assignRows`로 pin 우선 및 빈 구간 배치. 시작일 셀에 제목, 기간만큼 수평 병합. row 필드를 별도 데이터로 저장하지 않음 |
| 완료 | 제목 앞 `✓ `; 완료 스타일·별도 boolean 셀 없음 |
| 메모 | 시작 셀 legacy comment, 작성자 `KAR 일정` |
| 색 | 업무 시작 셀 fill만 덮어씀. 검정 글씨 기본; UI의 YIQ 글자색을 Excel에 적용하지 않음 |
| 규격 | A열 wch 10, 일자 열 wch 7; 제목 38pt, 헤더 22pt, 나머지 54pt 고정 행 높이 |
| 스타일 | 맑은 고딕; 제목 28pt, 헤더 12pt, 데이터 11pt; 굵게·중앙·검정 thin 테두리, 데이터 wrapText |
| 빈 셀 | 없는 셀에만 t:'z' stub 부여. 초기 배열의 빈 문자열 셀 전부를 stub으로 교체한다고 단정할 수 없음 |
| 팔레트 | `ColorDB`: 헤더 없이 A열 hex/B열 label. 팔레트가 있을 때만 생성/교체. hidden 설정 없음 |
| 연도 | 출력 제목과 월 라벨에 연도 및 Task 메타데이터를 기록하지 않음 |

주석에 행 높이 자동 확대 설명이 있지만 실제로는 54pt를 지정한다. 긴 제목이 모두 보인다는 보장은 없다. 별도 주간 Excel Export는 없다. 내보내기 라이브러리를 바꾸기 전에 위 규격을 fixture로 고정한다.

### 연결 workbook 보존의 실제 한계

`saveToConnectedFile`은 저장 때 연결 파일을 다시 읽고 `buildExcelBuffer({baseArrayBuffer})`로 workbook 전체를 파싱·재직렬화한다. monthly로 판별된 **모든 시트**를 삭제하고 새 월간 시트를 뒤에 추가한다. 다른 시트 객체를 남기려는 구조지만 ZIP part를 그대로 보존하는 것은 아니므로 도형·서식·관계·정의 이름·수식 참조 보존을 보장할 수 없다. 원본 읽기 실패 시 새 workbook으로 덮어쓸 수 있다. 팔레트가 비면 기존 ColorDB가 남는다. Import의 한 시트 선택과 Export의 모든 monthly 삭제가 비대칭이다.

### 프로젝트 내 실제 XLSX 구조 확인

업무 제목/메모 원문은 문서에 복제하지 않았다. 아래는 raw OOXML 관찰과 V1 판별식에 근거한 결과이며 브라우저 파싱 실행 결과는 아니다.

| 파일 | 관찰 | 마이그레이션 영향 |
|---|---|---|
| `5.최종민_주임_업무내용.xlsx` | Sheet1 A1:BA16, 날짜 헤더 4행, 병합 32개, A열 월 블록 없음. Sheet2 A1:AF28, 날짜 헤더 2행, 병합 33개, 4–12월, `✓ ` 셀 30개, comments2.xml 존재 | Sheet1도 monthly 오탐 → 연결 저장 시 삭제 위험. Sheet2에 연도가 없어 해당 시트 파서는 현재 연도로 추정 |
| `6.장수현_연구원_업무내용.xlsx` | Sheet1 A1:BA17, 헤더 4행·병합 32개·A열 월 블록 없음. Sheet2 A1:AI35, 숫자 헤더 16행·병합 40개·4–7월. Sheet2_2 A1:AF4, 헤더 2행·병합 3개·6월 | Sheet2는 상단 7행 탐지에 걸리지 않아 수입 후보에서 빠질 위험. 작은 Sheet2_2가 선택될 수 있음. Sheet1은 동일 삭제 위험 |

첫 파일 theme는 1,487 bytes, 둘째 9,891 bytes. 두 파일 모두 ColorDB·차트 part·externalLinks·VBA part는 없으며 첫 파일에는 drawings 경로의 part가 하나 있다. 따라서 ColorDB, MCE, 대형 theme, 다양한 원본 workbook 보존 시험을 이 두 파일만으로 완료할 수 없다.

## 5. 인터넷 및 브라우저 의존성

| 외부 의존성 | V1 용도 | V2 제안 |
|---|---|---|
| jsDelivr preconnect | CDN 연결 사전 준비 | 제거 |
| Pretendard CSS / 그 CSS의 font 파일 | UI 한국어 폰트 | 라이선스 확인 후 필요한 woff2 및 CSS를 앱 asset으로 동봉. 원격 @import/src 제거 |
| xlsx-js-style 1.2.0 | XLSX 읽기/쓰기 및 fill/font/border/alignment 생성 | Excel adapter 내부 npm 로컬 bundle 우선. 버전 고정 및 샘플 round-trip 검증 |
| fflate 0.8.2 | ZIP 해제, MCE 분석, theme 치환 재압축 | npm 로컬 bundle 유지 |
| idb-keyval major 6 | IndexedDB에 파일 핸들 저장/복원 | 연결 구조와 함께 제거. 마지막 폴더는 로컬 설정 |
| OOXML `http://schemas...` 문자열 | XML namespace 식별자 | 유지 가능. 네트워크 URL 요청이 아님 |
| JetBrains Mono/SF Mono/system-ui | 로컬 font-family fallback | 자체 다운로드 코드 없음. OS별 폭 차이 검증 |

명시적 `fetch`, XHR, WebSocket, beacon, 원격 이미지, CSS `url()` 요청은 V1 자체 코드에서 발견되지 않았다. 실제 네트워크 의존은 헤더 CDN과 그 종속 font다. 다운로드한 라이브러리 내부/원격 CSS의 모든 내부 URL을 이번에 감사한 것은 아니다. V2 배포 번들 검사와 네트워크 관찰을 별도 합격 조건으로 둔다. 라이브러리의 로컬 사용 근거: [xlsx-js-style 공식 저장소](https://github.com/gitbrent/xlsx-js-style), [fflate 공식 저장소](https://github.com/101arrowz/fflate).

| Browser API / 상태 | 실제 사용 | V2 대체 |
|---|---|---|
| showOpenFilePicker / showSaveFilePicker | .xlsx 선택, 이름·폴더 hint | Tauri dialog의 open/save를 FileGateway로 감쌈 |
| FileSystemFileHandle에 해당하는 handle, getFile / arrayBuffer | 파일 내용 및 name 읽기. 타입 이름은 JS에 직접 선언되지 않음 | Native byte read + filename DTO |
| createWritable / write / close | 연결 파일·새 파일 쓰기 | Native writeAtomic, 명시적 Export 때만 호출 |
| queryPermission / requestPermission | readwrite 권한 재확인 | 선택 경로의 native 접근 및 Tauri capability/scope; 저장된 경로는 권한이 아님 |
| IndexedDB / idbKeyval | 현재 핸들·마지막 위치 핸들 persistence | 제거. lastImportDirectory/lastExportDirectory 설정만 저장 |
| Blob / createObjectURL / a.download / revokeObjectURL | FS API 없는 브라우저에서 Export fallback | 동일 native Save dialog + write; 브라우저 download 제거 |
| hidden input type=file | DOM에만 있음; .xls 표시도 미연결 | 제거. V2도 우선 .xlsx 명시 지원 |
| localStorage | 월별 업무·팔레트·잔존 정렬 옵션 | SQLite tasks/custom_colors/app_settings |
| alert / confirm / prompt | 오류, 삭제, 초기화, 색 이름 변경 | Tauri dialog message/confirm 및 기존 스타일의 텍스트 입력 모달 |
| beforeunload | 연결 파일 dirty일 때만 경고 | Tauri window close 요청에서 DB 대기·실패 처리 |
| Date/DOMParser/TextEncoder/Uint8Array/DOM Grid/mouse/rAF | UI·문자열·XML·메모리 처리 | 유지 가능. 파일 시스템 API와 구별하며 두 WebView에서 검증 |

## 6. 재사용과 재작성

| 재사용 수준 | 대상 | 조건 |
|---|---|---|
| 이식 우선 | 최종 CSS cascade, DOM 구조, 한국어 라벨, 프리셋, 토스트·툴팁·모달 표현 | V1 원본을 고치지 않고 V2 파일로 복사. 폰트만 로컬화 |
| 순수화 후 재사용 | 날짜 열 생성, 구간 겹침, pin/빈 구간 배치, 색 정규화·명암, Excel 표 생성 규칙 | 전역 상태와 객체 mutation 제거, 엄격한 날짜 검증, 공통 layout 함수 |
| 표현만 재사용 | 드래그 ghost/drop/FLIP | 날짜 이동·행 이동 결과를 Service command로 전달; 월 piece 조작 제거 |
| 어댑터로 격리 후 재사용 | MCE 색상 추출, theme 전처리, XLSX 스타일 생성 | 원본 보존, 실패 명시화, ZIP 크기 제한, 손실 진단 추가 |
| 재작성 필수 | localStorage/핸들/자동 Excel 저장, 월별 piece CRUD, 그룹 재분산, dirty bool | 안정 id의 단일 Task + 트랜잭션 SQLite |
| 재작성 필수 | Import 선택·연도 추정·원본 workbook 전체 덮어쓰기 | Import preview, 검증, source 보호 및 명시적 export |

기술 부채: 날짜·업무·시각 배치의 혼합, 월별 중복 필드, 편집 때 id 재생성, 모달 저장 시 row 미전달로 pin 손실(L2802), 전체 스캔, 렌더러/Exporter 행 알고리즘 중복, 무시하는 저장 오류, 저장 중 새 변경을 dirty=false로 덮는 경쟁 가능성, 마지막 원본 읽기 실패 처리, 실행 중 날짜 고정, 잔존 UI 코드, 파서의 약한 입력 검증이 있다. 취약점 확정 보고가 아닌 이전 시 검증할 코드 품질 위험이다.

## 7. V2 구현 기본값

| 항목 | 기본값 | 적용 원칙 |
|---|---|---|
| 저장/도메인 | SQLite primary, 안정 id의 단일 기간 Task, UI와 DB 표시 구조 분리 | 이 문서의 기본 설계 |
| DB 접근 | TS Service → Repository port → Tauri IPC → Rust SQLite repository. Rust 한 트랜잭션으로 bulk/restore/pin 처리 | 구현 전 아키텍처 기준 |
| 백업 | versioned JSON 사용자 이관 백업 + SQLite 안전 snapshot 자동 복구 지점 | 기본 설계 |
| 월별 row 차이 | Task는 1행, 월별 pin·정렬 차이는 task_month_layout에 보존 | 기존 표시 정보를 버리지 않음. 기간·제목·메모는 중복 저장하지 않음 |
| Excel 제공 방식 | 원본 읽기 전용 Import + 새 파일 Export 기본 | workbook 활용은 별도 사본만 허용. 대상 외 내용 보존 검증 실패 시 기존 파일 쓰기를 중단하고 새 보고서 Export 제공 |
| 연도/업무 식별 | 새 보고서 제목에 시작 연도 명시, 연도 없는 입력은 Import 시 확인 | V1에 없는 안정 id를 추정하지 않음. 별도 metadata 시트는 초기 구현에서 제외, 완전 백업은 JSON |
| 기존 브라우저 데이터 | V1 JSON 또는 Excel을 파일로 받는 importer | 실제 브라우저 접근은 자동화하지 않음. 실데이터 확보 전에도 생성 fixture로 개발 가능 |
| 배포 | Windows 11 x64, macOS arm64+Intel; macOS 최소 버전은 장비 확인 후 결정 | UI/배포 시험 전; x64 외 Windows architecture 추가는 별도 결정 |

**위 기본값으로 V2 구현을 시작할 수 있다.** 월별 표시 정보와 원본 파일을 보존하는 방향으로 결정했으므로 별도의 설계 답변을 기다릴 필요가 없다. Import 중 출처에 연도가 없거나 데이터가 충돌하면 그 파일을 가져오는 시점에만 확인한다. 이는 개발 착수의 선행 조건이 아니다. 실제 OS/Excel 호환성은 구현 과정의 검증 항목으로 관리한다.

## 8. 단계별 migration plan

| 단계 | 다음 개발 단계의 작업 | 완료 기준 |
|---|---|---|
| 0 | 위 기본값을 기준으로 V1 회귀 fixture 확보 | HTML·샘플 해시 유지, 업무 값 공개 없이 회귀 예제 정의 |
| 1 | 순수 TypeScript Task/date/range/layout 계약 | 윤년·연말·멀티월·충돌·stable id 검증 |
| 2 | Tauri 2/Vite/Vanilla TS shell, 로컬 asset, native 경계 | 두 OS에서 오프라인 빈 창 기동, framework/CDN 없음 |
| 3 | Rust SQLite repository/migration + Task Service | CRUD/원자적 batch/실패 rollback/재시작 복구 |
| 4 | 기존 DOM/CSS 및 월간·주간 renderer/모달 이식 | 기능 표 C/T/U 통과; DB 저장 실패가 UI 성공으로 보이지 않음 |
| 5 | 날짜·행 DnD | 주간 anchor·월말 clamp·그룹 이동·pin 충돌 통과 |
| 6 | JSON backup/restore 및 이전 전 SQLite snapshot | 교차 OS, 손상/미래 버전 거부, 실패 시 기존 데이터 유지 |
| 7 | Excel Import/Export + V1 데이터 이전 | 원본 불변, 연도·시트 preview, 색/메모/완료/병합 비교 |
| 8 | Windows/macOS packaging 및 회귀 확인 | 깨끗한 오프라인 설치/첫 실행/재시작, 실제 WebView·Excel 확인 |

설계 확인만을 위한 별도 대기 단계는 두지 않는다. 원래 분석 작업에서는 문서만 작성하며, 다음 구현 작업은 위 순서로 진행한다. V1은 전체 기간 병행 비교 기준이며 자동 데이터 동기화 대상이 아니다.

## 9. 가장 큰 migration risk 5개

1. **Excel 손실과 연도 오인:** 오탐 시트 삭제, 후보 누락, 한 시트만 수입, 연도 없는 출력. 시트/연도 preview와 원본 read-only, 별도 사본, 차등 비교로 방어한다.
2. **월별 조각을 잘못 합치거나 누락:** Excel에는 groupId가 없고 동일 제목은 같은 업무의 증거가 아니다. 유효한 그룹만 병합하고 모호성 보고서를 남긴다.
3. **행 위치·드래그 의미 변경:** 기본 display_row와 월별 override의 우선순위, 주간 잘린 시작 anchor, 월간 clamp. 월별 정보를 보존하고 결정적 layout과 OS별 상호작용 시험을 한다.
4. **저장·Import·Restore 도중 부분 데이터:** async 저장 경쟁, 디스크 부족, 종료, schema 변화. 한 writer/transaction, commit 후 성공 표시, snapshot, rollback이 필요하다.
5. **오프라인 설치와 WebView 차이:** Windows 런타임 패키징, macOS 서명/공증·Intel 지원, font/IME/date input/DnD 차이. 실제 OS 오프라인 설치와 기능 표 전 항목을 통과해야 한다.

회귀 우선순위는 Excel 색/병합/연도, multi-month CRUD/DnD, pin/compact layout, 모달 draft, 재시작·백업이다. 각 기능의 상태는 `V2_FEATURE_PARITY.md`에서 추적하고 이번 분석으로 기능 시험을 통과 처리하지 않는다.

## 10. 다음 Codex 작업에서 할 단 하나의 작업

**V2의 순수 TypeScript Task/date/월별 표시 layout 모듈과 회귀 테스트를 구현한다.** 이 문서의 기본값을 사용하고 V1 HTML 및 실제 업무 파일을 변경하지 않는다. 추가 설계 승인 단계를 만들지 않는다.

## 11. 이번 문서 작업 검증 기록

다섯 문서 생성, 문서 내부 상대 링크, Markdown 표 열 수, JSON 예시 문법을 확인했다. 기능 보존표는 중복 ID 없는 90개 회귀 항목이며 모두 미검증으로 남겼다. 기준 HTML 및 두 원본 XLSX의 작업 전후 SHA-256이 동일하다. 샘플 XLSX의 해시는 파일명 선두 5번이 `ba62fa402ffcb681a837e4c1afe816e620e4f5b7cdebc6fe35a2f4c2e1acc1e6`, 6번이 `46911287517a941b0675901ac2d5468e14f83b64df772126a3c420ad939e76f2`다. 앱 실행·빌드·SQLite 실행·Excel 재저장은 수행하지 않았다.
