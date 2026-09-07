# KAR 업무 일정 V2 데이터 모델

> 후속 구현 진행: 현재 실행 파일과 실제 검증 결과는 [구현·검증 기록](V2_IMPLEMENTATION_STATUS.md), 사용 방법은 [테스트 안내](V2_TEST_GUIDE.md)를 참고하세요. 아래 내용은 분석 당시 기준선입니다.
기준일: 2026-09-07. **설계 초안이며 아래 SQL/JSON은 문서 예시다. DB를 생성하거나 실행하지 않았다.**

## 1. V1 저장 구조와 필드

`monthData = { 'YYYY-MM': { tasks: [...] } }`를 `kar_monthly_schedule_v1` localStorage에 JSON 직렬화한다. 월 키의 month는 1–12, JavaScript Date의 month는 0–11, task start/end는 해당 월의 1-based 일자다. 데이터 변경마다 전체 JSON을 다시 쓴다. [기준선](../legacy/kar-schedule-v1.html) L578–705, L2721–2762.

| V1 필드/저장소 | 실제 의미·주의 | V2 처리 |
|---|---|---|
| monthData | 월별 task piece 목록; 빈 월은 getMonth 호출로 생기기도 함 | 폐기. 날짜 범위 조회 |
| task | 도메인 업무 또는 월 조각; renderer에서는 spread한 사본도 task로 취급 | canonical Task와 ViewSegment 분리 |
| id | `t_` + Math.random 7자리 문자열, piece마다 발급. 모달 저장/기간 이동으로 새 id 생성 | UUID 안정 id |
| groupId | 같은 업무의 월 조각 연결. 모달로 저장한 단일 월 업무에도 존재할 수 있음 | canonical Task에서 제거. legacy importer 내부 임시 정보만 |
| fullStart/fullEnd | 모든 그룹 조각이 공유하는 전체 ISO 날짜 문자열 | start_date/end_date로 통합 |
| start/end | 월 내부 포함형 구간. full range로 정규화되기도 함 | 계산된 ViewSegment만 사용 |
| title/notes | 평문; 제목 빈 문자열 허용, 메모 자유 텍스트 | 보존. 마크다운/링크 자동 실행 없음 |
| color | 보통 # 없는 대문자 RRGGBB 또는 null | 엄격한 대문자 6자리 또는 null |
| done | boolean. import에서는 `✓ ` 접두사 추론 | domain boolean / DB 0,1 |
| sortIndex | 해당 월 배열 내 우선순위. 신규는 월별 max+1, 수정 시 선택 piece 값을 모든 piece에 복제 | 기본 sort_order + task_month_layout의 월별 sort_order 보존 |
| row | 선택적 0-based pin. 월별 piece마다 다를 수 있음 | 기본 display_row + 월별 override 보존 |
| _row | 실제 충돌 회피 배치 결과. export의 assignRows는 얕은 복사로 원본 task에도 기록 가능 | computed_row, 절대 DB 저장 안 함 |
| _startCol/_endCol/_origY/_origM/_clippedStart/_clippedEnd | renderer 사본의 계산 속성. clipped flag는 생성하지만 별도 continuation UI에 쓰이지 않음 | ViewSegment에만 존재 |
| KAR_CUSTOM_COLORS | hex/label 배열. 예전 문자열 배열을 객체로 보정 | custom_colors 테이블 |
| kar_tw_sort_field_v1 / kar_tw_sort_dir_v1 | 날짜/제목 및 asc/desc 잔존 설정. 현재 정렬 UI와 연결되지 않음 | 활성 요구사항 없음; 이관 원문 보관 대상 |
| IndexedDB / idb-keyval | 현재 및 마지막 Excel 파일 핸들. 업무 데이터 저장소가 아님 | 제거; native path hint는 별도 로컬 설정 |

V1 저장은 실패를 catch 후 무시한다. loadAll 실패는 빈 `{}`가 된다. 정렬 누락은 배열 인덱스로 보정, full range가 존재하고 월과 겹치면 piece start/end를 덮어써 정규화하지만 누락 월의 piece를 재생성하는 기능은 아니다.

## 2. multi-month의 실제 동작과 문제

예를 들어 하나의 업무 `2026-09-28 ~ 2026-10-03`을 모달에서 저장하면 다음 두 조각이 만들어진다. 예시 id는 설명용이다.

```json
{
  "2026-09": {"tasks": [{"id":"t_a","groupId":"g_x","title":"예시 업무","start":28,"end":30,"fullStart":"2026-09-28","fullEnd":"2026-10-03","notes":"","color":null,"done":false,"sortIndex":0}]},
  "2026-10": {"tasks": [{"id":"t_b","groupId":"g_x","title":"예시 업무","start":1,"end":3,"fullStart":"2026-09-28","fullEnd":"2026-10-03","notes":"","color":null,"done":false,"sortIndex":0}]}
}
```

월간은 각 월의 piece를 표시하고, 주간 `collectExpandedTasks`는 주와 겹치는 월을 훑어 groupId 또는 id별로 합친다. 모달 수정은 모든 원본 조각 삭제 후 전체 기간을 다시 분산한다. 그룹 삭제도 모든 달을 순회한다. 주간 드래그는 전체 기간을 이동시켜 재분산한다. 월간 multi-month 업무의 가로 이동도 전체 기간을 옮기지만, 세로 이동은 해당 월 조각만 pin/교환할 수 있다.

문제는 날짜의 진실이 월 키/start/end와 fullStart/fullEnd에 중복되고, 제목·메모·색·완료도 중복된다는 점이다. 부분 손상·그룹 충돌·편집 시 id 변경·행 위치 손실을 다뤄야 한다. Excel은 월별 표만 남기므로 다시 읽으면 원래 groupId를 알아낼 수 없다. 하나의 업무를 DB 한 행으로 저장하면 이 중복을 없앨 수 있다.

## 3. 추천 canonical Task

| 필드 | TypeScript 의미 | DB 표현·규칙 |
|---|---|---|
| id | string UUID | TEXT primary key. 생성 후 수정·이동으로 변경 금지 |
| title | string | TEXT NOT NULL, 빈 제목 허용. 화면 placeholder만 `(제목 없음)` |
| start_date | DateOnly string | YYYY-MM-DD, 실제 달력 유효 날짜 |
| end_date | DateOnly string | 포함형, end_date >= start_date |
| notes | string | TEXT, 개행·Unicode·앞뒤 공백 보존 |
| color | string 또는 null | # 없는 대문자 RRGGBB |
| done | boolean | INTEGER 0 또는 1 |
| sort_order | 정수 | 비음수 안전 정수. 동률은 start_date/end_date/id로 결정 |
| display_row | 정수 또는 null | 0-based 희망 행, null=자동. 실제 배치 행과 다름 |
| created_at | UTC instant | ISO UTC timestamp. V1 원본에는 없으므로 이관 시점 기록 |
| updated_at | UTC instant | 성공한 변경 시 갱신. 정렬 기준/유일 revision 값으로 사용하지 않음 |

공통 DateOnly 유효 연도 범위는 우선 `0001–9999`로 두되, JavaScript Date의 0–99년 특수 동작을 사용하지 않는 날짜 유틸리티가 필요하다. 실제 제품의 더 좁은 범위는 UI 제한이 필요한 경우에만 별도 결정한다. row와 입력 파일 크기 상한은 정수 검증 외에도 자원 보호용 한도를 구현 단계에서 실제 데이터 크기에 맞춰 정한다.

신규 id는 native UUID 생성 또는 안전한 crypto UUID를 사용한다. V1 Math.random id를 canonical id 생성기로 재사용하지 않는다. V1 groupId/fullStart/fullEnd/start/end/monthKey 및 _row는 Task 테이블에 넣지 않는다.

## 4. SQLite schema 초안

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL
    CHECK (length(start_date) = 10 AND
      start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  end_date TEXT NOT NULL
    CHECK (length(end_date) = 10 AND
      end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  notes TEXT NOT NULL DEFAULT '',
  color TEXT CHECK (color IS NULL OR
    (length(color) = 6 AND color NOT GLOB '*[^0-9A-F]*')),
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK
    (typeof(sort_order) = 'integer' AND sort_order >= 0),
  display_row INTEGER CHECK (display_row IS NULL OR
    (typeof(display_row) = 'integer' AND display_row >= 0)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (start_date <= end_date)
);
CREATE INDEX idx_tasks_start_end ON tasks(start_date, end_date);

CREATE TABLE task_month_layout (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  month_key TEXT NOT NULL CHECK
    (length(month_key) = 7 AND month_key GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  display_row INTEGER CHECK (display_row IS NULL OR
    (typeof(display_row) = 'integer' AND display_row >= 0)),
  sort_order INTEGER NOT NULL CHECK
    (typeof(sort_order) = 'integer' AND sort_order >= 0),
  PRIMARY KEY (task_id, month_key)
);

CREATE TABLE custom_colors (
  hex TEXT PRIMARY KEY NOT NULL CHECK
    (length(hex) = 6 AND hex NOT GLOB '*[^0-9A-F]*'),
  label TEXT NOT NULL CHECK (length(trim(label)) > 0),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK
    (typeof(sort_order) = 'integer' AND sort_order >= 0)
);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL
);

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
```

위 SQL의 CHECK는 형식과 기본 제약만 검사한다. 실제 날짜 존재 여부(예: 2026-02-30 거부), UUID 형식, 안전 정수 범위, timestamp 형식, app_settings JSON 허용 키는 Task Service와 native command 경계에서 검증한다. month_key의 월 01–12 및 해당 Task 기간과의 겹침도 검증하고 각 DB 연결에서 foreign_keys를 켠다. 사용자 입력을 SQL 문자열로 합치지 않고 파라미터 바인딩한다. `custom_colors`는 업무의 color에 FK를 걸지 않는다. 팔레트 삭제가 기존 업무 색을 바꾸지 않아야 하기 때문이다.

범위 조회는 `start_date <= :view_end AND end_date >= :view_start`다. `ORDER BY sort_order, start_date, end_date, id`로 안정 순서를 만든다. 작은 로컬 일정 DB에 우선 단순 index를 쓰고, 대량 데이터 성능이 문제일 때 query plan으로 조정한다.

DB 접근은 native 단일 writer에서 관리한다. 멀티 row 변경, 복원, import, pin 교환과 충돌 pin 해제는 하나의 연결/트랜잭션에 묶는다. UI에서 개별 IPC로 BEGIN/여러 write/COMMIT을 따로 보내지 않는다. journal mode는 이 규모에서는 DELETE 기반을 우선 검토하여 운영을 단순화하고, WAL을 선택할 경우 backup/종료의 WAL 일관성 시험을 추가한다. 어느 모드든 live 파일 복사로 snapshot을 만들지 않는다.

## 5. 날짜와 ViewSegment

- 업무 일정은 시간대 없는 날짜다. `new Date('YYYY-MM-DD')`의 UTC 파싱을 표시/이동 기준으로 삼지 않는다. 문자열을 구성 요소로 엄격하게 파싱하고 day ordinal 또는 검증된 civil-date 계산으로 일수 차·이동을 구한다.
- 종료일 포함. 9월 28일부터 10월 3일까지는 6일이다. 윤년 2월, 연말, 월 길이, DST가 있는 OS 시간대에서도 같은 결과를 내야 한다.
- 오늘은 사용자의 OS 로컬 날짜에서 결정한다. 생성·수정 timestamp만 UTC로 기록한다. 기기 시계가 정확하다고 가정해 timestamp를 충돌 해결용 유일 버전으로 쓰지 않는다.
- UI 날짜 change는 V1처럼 종료가 시작보다 앞서면 종료를 시작에 맞출 수 있다. 저장 요청/API 입력은 종료 역전이면 명확한 validation error로 처리한다. V1 저장 handler의 최종 swap과의 차이는 회귀표에서 의도적 변경으로 기록한다.

ViewSegment 예: `{ task_id, view_start, view_end, segment_start, segment_end, start_column, end_column, clipped_start, clipped_end, computed_row }`.

`segment_start=max(task.start_date, view_start)`, `segment_end=min(task.end_date, view_end)`이며 겹침이 없으면 표시하지 않는다. 월간과 주간은 같은 canonical Task를 입력받는다. 9/28–10/3 Task는 DB 한 행에서 9월 segment 9/28–9/30, 10월 segment 10/1–10/3, 9/28–10/4 주간 segment 9/28–10/3으로 계산한다. segment 생성·조회·Export 때문에 DB 쓰기가 발생해서는 안 된다.

## 6. sort/display row 규칙과 보존 한계

1. `sort_order`는 자동 배치의 우선순위, `display_row`는 사용자 pin이다. 두 값은 서로 대체하지 않는다. 날짜/제목 정렬 선택 UI는 현재 V1 활성 기능이 아니므로 새로 추가하지 않는다.
2. pin Task를 안정 순서로 원하는 행에 배치하고 같은 날짜 충돌이면 아래 행으로 임시 fallback한다. 나머지를 위에서부터 겹치지 않는 첫 행에 넣는다. 같은 날을 공유하면 겹침이다. 빈 기간은 같은 행을 공유한다.
3. 실제 row fallback은 DB pin 값을 바꾸지 않는다. 명시적 drop이면 대상 pin 설정 및 해당 날짜가 겹치는 기존 pin 해제를 한 transaction으로 처리한다. 월간 바 위 drop의 행 교환도 원자적으로 수행한다.
4. **구현 기본값:** Task의 display_row/sort_order는 기본 배치이고, `task_month_layout(task_id, month_key, display_row, sort_order)`가 있으면 해당 월 값을 우선한다. override row의 null은 명시적 자동 배치이며 기본 pin으로 fallback하지 않는다. V1의 9월 row=1, 10월 row=3을 그대로 저장한다.
5. 보조 테이블은 제목·기간·메모를 복제하지 않는 표시 정보다. Task는 계속 1행이다. 월간 pin/교환은 해당 월 override만 변경한다. 주간은 화면에 나타나는 가장 이른 월 segment의 override를 대표 배치로 사용하며, 명시적 주간 row 이동은 업무 전체의 기본 row를 갱신하고 모든 해당 업무 override의 row도 같은 값으로 맞춘다. 충돌 pin 해제도 영향을 받는 월에 한정하여 한 transaction으로 처리한다.
6. 모달 제목/메모 수정은 sort_order와 display_row를 보존한다. V1의 편집 시 pin 손실은 호환해야 할 정상 동작으로 취급하지 않는다.
7. 드래그 날짜 정책은 월간 single-month의 월 경계 clamp, 월간 multi-month/주간의 전체 기간 이동을 우선 보존한다. V2에서는 groupId 존재 대신 실제 시작·종료 월로 판단한다. V1 신규 단일 월 Task도 groupId를 가진다는 이유로 multi-month로 취급하지 않는다.
8. 기간 수정으로 더 이상 겹치지 않는 월의 override는 정리하고, 계속 겹치는 월의 override는 유지한다. 새로 겹치는 월은 Task 기본값을 사용한다. 날짜와 row를 함께 지정한 drop은 도착 row를 변경 후 기간 전체에 적용한다. 이 규칙과 override 변경을 Task 변경 transaction에 포함한다.

## 7. V1 → V2 이관 알고리즘

### 입력 확보

가장 정확한 입력은 실제 사용 중인 브라우저 원래 origin의 `kar_monthly_schedule_v1`, `KAR_CUSTOM_COLORS`를 명시적으로 추출한 JSON이다. Tauri가 Chrome/Edge 프로필의 localStorage를 자동으로 읽을 수 있다고 가정하지 않는다. HTML을 복사해 다른 경로에서 열어도 동일 origin 저장소를 읽는다는 보장은 없다. 다음 이관 작업에서 사용자와 추출 방법을 결정하고, V1 HTML 자체는 수정하지 않는다. 이번 분석은 실제 브라우저 저장 데이터를 읽거나 추출하지 않았다.

Excel만 있으면 날짜·제목·메모·색·완료를 수입하되 그룹·원본 pin·생성 시간 복원 한계를 명시한다. 두 입력을 함께 제공하더라도 어느 것이 최신인지 사용자 선택 전 자동 합치지 않는다.

### 변환 절차

1. 입력 원문과 hash를 보존한다. source 종류·파싱 버전·검증 시각을 이관 보고서에 기록한다. 파일은 읽기 전용이고 DB 변경 전 preview를 만든다.
2. 월 키, task 배열, 일수, 실제 월말, 색, boolean, id/groupId 타입 및 숫자 범위를 검증한다. `_row` 등 렌더 캐시는 무시한다. 잘못된 값을 Date rollover로 자동 교정하지 않는다.
3. groupId가 없는 piece는 `monthKey + id + 원본 위치`로 추적한다. id 중복도 조용히 덮어쓰지 않고 진단한다. 각 유효 piece를 기본 독립 Task로 변환한다.
4. groupId가 있는 조각은 title/notes/color/done 및 fullStart/fullEnd 일치를 확인한다. 기간의 월별 교집합과 실제 piece 목록이 정확히 대응할 때만 한 Task로 병합한다.
5. full range가 없지만 조각이 연속하고 속성이 같으면 전체 범위 병합 후보를 preview에 낸다. 누락 월·비연속 구간·서로 다른 notes/done·서로 다른 full range는 자동 선택하지 않는다. 원문을 남기고 사용자 해소 전 해당 batch commit을 중단한다.
6. 단일 월 group도 Task 하나로 바꾼다. 안정 UUID를 새로 발급하고 source piece→canonical id 매핑을 이관 보고서에 남긴다. 이후 수정에서 id는 유지한다.
7. 월별 sortIndex/row를 task_month_layout에 그대로 보존한다. Task 기본값은 가장 이른 월에서 정하고, sortIndex 누락은 그 월의 배열 위치로 보정한다. 동일 우선순위는 원본 배열 순서를 유지하도록 이관 단계에서 안정 순위로 정규화한다. row가 없는 월도 null override로 기록하여 다른 월의 pin이 전파되지 않게 한다. 주간에 여러 달의 pin이 다르면 가장 이른 표시 segment의 월을 사용한다.
8. 팔레트 hex를 정규화하고 중복 hex는 label 선택 경고를 낸다. 업무 색은 팔레트 존재와 무관하게 보존한다. created_at/updated_at은 이관 시각으로 기록하며 원래 시각을 추정하지 않는다.
9. 사용자가 import 계획을 확정하면 SQLite 사전 snapshot 후 모든 Task/색상/이관 완료 설정을 같은 transaction으로 저장한다. 중간 실패 시 전부 rollback한다.
10. 입력 piece 수, 유효 그룹 수, 독립 Task 수, 출력 Task 수, 해결/거부 항목을 대조한다. preview의 병합 그룹별 수식은 `출력 수 = 유효 단독 piece 수 + 승인된 그룹 수`다. 원본을 V2 검증 전 폐기하지 않는다.

동일 V1 source hash의 완료 이관은 app_settings의 제한된 이관 기록으로 탐지하여 경고한다. 일반 Excel 재수입도 입력 fingerprint를 확인하지만, 외부에서 수정된 파일의 같은 제목을 기존 Task id로 간주해 자동 update하지 않는다. 반복 Import의 기본은 추가이며 중복 가능성을 preview에 보여준다. 전체 교체는 사전 백업과 별도 확인이 필요하다.

## 8. Backup/Restore 결정

| 기준 | SQLite snapshot `.db` | Versioned JSON `.json` |
|---|---|---|
| 데이터 충실도 | schema·index 포함 DB의 정확한 복구에 유리 | Task·월별 layout·팔레트 등 명시한 데이터 보존 |
| Windows↔macOS | SQLite 자체 형식은 portable | UTF-8·날짜·필드 기반으로 portable |
| 향후 schema 변경 | 대상 앱이 해당 DB schema를 이해/마이그레이션해야 함 | backup format converter와 현재 repository로 복원 |
| 사용자 검토 | 별도 DB 도구 필요 | 읽을 수 있으나 수동 편집은 엄격 검증 필요 |
| 실행 중 생성 | backup API 등 일관 snapshot 필요 | 한 read transaction에서 domain snapshot 추출 |
| 주요 위험 | live DB만 복사하여 WAL 데이터 누락, schema 불일치 | 필드 누락, 불완전 파일, 대규모 메모리 사용 |
| 추천 용도 | 자동 복구 지점, migration/restore 전 보호 | 사용자 주 백업, PC/OS 이동 |

SQLite 파일도 OS 간 이동 가능하므로 JSON만 이동 가능한 것은 아니다. 추천 이유는 사용자 백업 계약을 내부 DB schema와 분리하기 위함이다. [SQLite 파일 이동성](https://www.sqlite.org/onefile.html), [일관된 SQLite backup API](https://www.sqlite.org/backup.html).

```json
{
  "format": "kar-schedule-backup",
  "format_version": 1,
  "app_version": "2.0.0",
  "schema_version": 1,
  "exported_at": "2026-09-07T00:00:00.000Z",
  "tasks": [{
    "id": "50b076b2-67fc-41ad-bacf-508f6582471f",
    "title": "예시 업무",
    "start_date": "2026-09-28",
    "end_date": "2026-10-03",
    "notes": "세부 내용",
    "color": "A9D18E",
    "done": false,
    "sort_order": 0,
    "display_row": null,
    "created_at": "2026-09-07T00:00:00.000Z",
    "updated_at": "2026-09-07T00:00:00.000Z"
  }],
  "task_month_layout": [],
  "custom_colors": [],
  "portable_settings": {}
}
```

파일명은 `KAR-Schedule-Backup-YYYY-MM-DD.json`; 같은 날에는 시간/번호 suffix로 기본 충돌을 피한다. schema_version은 진단용, format_version은 JSON 변환 계약이다. task_month_layout은 task_id/month_key/display_row/sort_order 객체 배열이며 업무와 함께 복원하고 참조 무결성을 검사한다. 아직 배포된 V2 형식이 없으므로 초기 format_version 1에 포함한다. portable 설정은 명시적 allowlist만 포함하고 초기에는 비어 있어도 된다. 최근 경로·윈도 위치·파일 핸들·OS 이름에 따른 경로는 복원하지 않는다. 백업은 평문이며 암호화·암호 계정 기능은 이번 scope에 넣지 않는다.

JSON 생성은 일관된 DB read snapshot → 완성된 bytes → 대상과 같은 파일 시스템의 임시 파일 → flush/완료 검증 → native replace 흐름이다. native 원자적 교체 보장은 OS/파일 시스템 adapter에서 검증하며 임의의 fs write가 자동 원자적이라고 가정하지 않는다.

복원은 크기/문법/format/version 검증 → 알려진 과거 format 변환 → 모든 Task/팔레트 검증 → 교체 건수 preview → 사용자 확인 → 현재 DB의 안전 snapshot → 한 transaction으로 교체 → commit 후 재조회 순이다. id와 created_at/updated_at을 보존한다. 미래 format/schema나 손상 파일은 기존 데이터에 쓰기 전에 거부한다. 운영 writer를 잠시 막고 실패 시 원래 DB를 유지한다. 일상 복원 UI는 JSON을 우선하며 `.db` snapshot 복구는 native recovery 경로에서 앱 DB 연결을 정리한 후 수행한다.

자동 snapshot은 migration/restore/전체 교체·초기화 전 생성한다. 정상 CRUD마다 전체 파일을 복제할 필요는 없다. 초기 retention 제안은 최근 10개이며, 직전 정상본은 새 snapshot 검증 전에 삭제하지 않는다. 외부 사용자 백업 파일은 자동 retention 대상이 아니다.

## 9. DB schema version 운영

schema_migrations를 유일한 migration 이력으로 삼고 native migration runner가 시작 시 한 번 적용한다. SQL 파일은 향후 `src-tauri/migrations/0001_initial.sql` 등으로 번들에 포함한다. 지금은 이 파일들을 생성하지 않는다.

이미 적용된 migration은 수정하지 않고 새 번호로 추가한다. checksum 불일치 및 더 높은 schema는 정상 실행을 중단하고 복구 안내를 제공한다. migration 전 snapshot → transaction DDL/변환/이력 기록 → 무결성 및 핵심 조회 확인 → 일반 창 활성화 순이다. 실패하면 rollback하고 빈 DB를 자동 생성해 덮지 않는다. 구형 앱으로의 schema downgrade는 자동 지원하지 않는다. `.db`를 되돌리려면 해당 snapshot과 호환되는 앱을 사용한다. JSON 과거 버전 변환은 DB migration과 독립적으로 시험한다.
