# KAR 업무 일정 V2 아키텍처

> 후속 구현 진행: 현재 실행 파일과 실제 검증 결과는 [구현·검증 기록](V2_IMPLEMENTATION_STATUS.md), 사용 방법은 [테스트 안내](V2_TEST_GUIDE.md)를 참고하세요. 아래 내용은 분석 당시 기준선입니다.
기준일: 2026-09-07. 구현 전 설계안. 실제 Tauri 프로젝트, 플러그인, Rust 파일, DB는 생성하지 않았다.

## 1. 결정 요약

Tauri 2 + Vite + Vanilla TypeScript + HTML/CSS를 사용하고, SQLite는 native Rust 경계 안에서 관리한다. React/Vue/Svelte와 런타임 웹 서버는 사용하지 않는다. 화면 디자인은 V1 DOM/CSS를 기준으로 이식한다. 업무는 전체 기간을 가진 단일 Task이고 월/주 표시는 renderer가 계산한다.

과도한 계층을 만들지 않되 UI의 SQL·파일 접근을 막기 위한 Service/Repository/FileGateway 경계는 유지한다. 외부 시스템·로그인·서버·sync는 추가하지 않는다.

```text
Calendar UI / Task Modal / App Toolbar
                 |
      Application services
      TaskService / ImportExportService / BackupService
                 |
          Repository ports
                 |
       Tauri repository adapter (IPC)
                 |
       Native repository + transaction
                 |
               SQLite

Excel input bytes -> ExcelImporter -> ParsedTask / ImportPlan
                    -> ImportExportService -> TaskService -> Repository

SQLite -> Repository -> TaskService.exportSnapshot
       -> ImportExportService -> ExcelExporter -> FileGateway.writeAtomic

SQLite snapshot <-> BackupService <-> versioned JSON / native recovery DB
```

위 도식은 데이터 흐름이다. 정적 의존 방향은 `UI → application services → domain/ports`, `adapters → domain/ports`다. 부트스트랩에서 구체 repository/file adapter를 주입한다. Calendar UI는 Excel module이나 SQLite를 import하지 않는다. Toolbar가 Import/Export Service를 호출하며 필요한 결과와 상태만 UI로 전달한다.

## 2. 책임과 인터페이스

| 계층 | 책임 | 알면 안 되는 것 |
|---|---|---|
| domain | Task/DateOnly, validation, 기간 겹침, 이동, pin 계획 | DOM, Tauri, SQL, workbook, 파일 경로 |
| calendar layout | Task snapshot→ViewSegment→computed_row. month/week/export 공통 순수 배치 규칙 | 데이터 저장, native 권한 |
| UI | DOM 생성, CSS, 모달 draft, tooltip/toast, 입력/drag 감지 | SQL/트랜잭션, XLSX parsing, Excel 파일 handle |
| TaskService | 업무 명령·검증·저장 순서·성공 snapshot 게시 | WebView 구현, OS별 디렉터리 |
| ImportExportService | 파일 선택→parse→preview→확정→TaskService. export snapshot→writer | calendar DOM 조회 및 UI 배치 mutation |
| BackupService | version 검증·직렬화·preview·restore workflow | 임의 SQL 실행과 OS별 rename 세부 |
| Repository port | 범위 조회, batch commit, 일관 snapshot, 데이터 교체 | 화면의 클릭 좌표/Excel merge 주소 |
| Tauri adapter | typed IPC, 오류 변환, native 상태 호출 | 제품 UI 규칙 |
| native repository | DB 연결·SQL·원자적 transaction·migration·backup snapshot | 월별 task piece 생성, DOM |
| FileGateway/PlatformPaths | dialog, byte read, 안전 쓰기, AppData, 최근 폴더 | 업무 필드·업무 병합 판단 |

문서상 서비스 계약:

- `TaskService.listRange(start, end)`, `create(input)`, `update(id, input)`, `delete(id)`, `move(id, deltaDays, rowIntent, viewPolicy)`, `commitImport(plan)`, `exportSnapshot()`.
- `TaskRepository.listOverlapping(range)`, `commitBatch(changes)`, `readSnapshot()`, `replaceSnapshot(snapshot)`; batch는 native 한 transaction이다.
- `FileGateway.chooseOpen(kind)`, `chooseSave(kind, suggestedName)`, `readBytes(selection)`, `writeAtomic(selection, bytes)`; 취소는 정상 결과로 모델링한다.
- `ExcelImporter.parse(bytes)`는 시트 후보·연도 단서·ParsedTask·색상·warning을 반환하고 저장하지 않는다. `ExcelExporter.encode(snapshot, options)`는 bytes와 검증 결과를 반환한다.
- `BackupCodec`은 versioned JSON과 domain snapshot만 다룬다. Excel module을 사용하지 않는다.

업무 검증은 TS에서 빠른 피드백을 주고 native에서 최종 무결성 검사를 한다. Rust/TS 동일 fixture를 사용해 규칙 불일치를 막는다. native에 프런트엔드가 임의 SQL, arbitrary DB path, 검증 없는 대량 변경을 전달하는 인터페이스를 만들지 않는다.

## 3. Frontend 및 Calendar

Vite는 빌드 시 TS/로컬 CSS/font/Excel 라이브러리를 묶는다. release는 빌드된 정적 asset을 Tauri에서 제공한다. Node/Vite dev server는 사용자 앱의 프로세스가 아니다. 별도 React state store도 필요 없다. 간단한 application state와 subscribe 방식으로 commit된 Task snapshot 및 view selection을 전달한다.

월간/주간은 데이터 계산 함수를 공유하고 날짜 열 구성·월 이름 열 유무만 달리한다. `task-layout`은 side effect 없이 pin 우선/충돌 fallback/자동 배치를 수행한다. Excel에는 같은 Task를 월 단위 segment로 투영한 결과를 전달한다. 화면의 DOM 위치를 다시 읽어 Excel 데이터로 쓰지 않는다.

드래그 코드는 pointer 좌표를 `deltaDays`, source task id, target row, 교환 대상, 월간/주간 context로 바꾼다. V1과 같은 주간 visible segment 시작 anchor를 사용하고 전체 기간은 TaskService가 옮긴다. preview와 commit은 같은 날짜 계산을 사용한다. drop 영역은 시작 calendar 안으로 한정하여 다른 패널을 잘못 잡는 것을 막는 방향을 제안한다. pointer capture/취소·창 focus 상실 처리는 두 WebView에서 검증한 뒤 정한다. 취소·DB 오류는 원래 표시로 되돌리고 성공 시 snapshot을 다시 그린다.

모달의 업무 draft와 앱 저장 snapshot을 분리한다. 업무 저장은 한 번의 service 명령이다. 색상 팔레트 이름 변경은 별도의 palette service 명령으로 즉시 commit한다. 업무 제목에 HTML을 넣어도 평문으로 표시하도록 textContent/안전 DOM 생성을 유지한다. Tooltip은 body 직속으로 clipping을 피한다.

V1 최종 CSS cascade, 좁은 창 대응, modal 외부/Esc 닫기 금지, scroll 유지, completed 표시를 보존한다. 접근성 개선이나 추가 정렬/접기 UI는 이번 migration의 자동 범위로 확대하지 않는다.

## 4. SQLite 접근 결정

**추천: Rust SQLite repository(예: bundled SQLite를 사용하는 rusqlite) + typed Tauri commands.** Task 규모에 맞게 한 writer 및 명시적 transaction을 둔다. AppData 하위 `kar-schedule.sqlite3`를 native에서 결정한다. SQLite를 앱 바이너리에 포함하는 빌드로 사용자 OS에 sqlite 실행 파일 설치를 요구하지 않는다. crate/API의 정확한 버전과 feature는 구현 시작 때 공식 문서와 lockfile로 확정한다. [rusqlite API 및 backup/transaction](https://docs.rs/rusqlite/latest/rusqlite/).

대안은 Tauri 공식 SQL plugin의 SQLite 모드다. JS bindings와 migration 지원이 있어 기본 CRUD에는 적절하다. 하지만 문서의 JS 호출 여러 개를 하나의 업무 transaction으로 묶을 수 있다고 가정하면 안 된다. 본 제품은 Import/Restore/행 교환·pin 해제의 원자성, 안전한 DB snapshot이 필요해 native repository로 통일하는 쪽을 추천한다. 두 DB 엔진/연결 관리 방식을 동시에 도입하지 않는다. SQL plugin을 선택한다면 custom native batch 경계 및 단일 연결 transaction 보장을 먼저 확인하고 이 설계를 수정해야 한다. [Tauri SQL plugin](https://v2.tauri.app/plugin/sql/).

저장 성공은 IPC 요청 전이나 optimistic render 시점이 아닌 DB commit 뒤에 표시한다. single writer queue로 수정 순서를 유지하고 in-flight batch 중 새 요청을 유실하지 않는다. 단일 dirty bool로 완료 여부를 표현하지 않고 pending request 수/실패 상태를 관리한다. 창 종료는 대기 명령 완료를 확인하고 실패한 미저장 변경이 있을 때만 사용자에게 안내한다. DB를 열지 못해도 조용히 빈 DB를 생성하지 않는다.

## 5. Excel adapter

Excel 처리는 TS에서 로컬 xlsx-js-style/fflate를 bundle하는 것을 우선 검토한다. 기존 MCE 복구는 DOMParser가 필요하므로 바로 Web Worker로 옮길 수 있다고 가정하지 않는다. 초기에는 상한을 둔 main WebView 처리와 진행 상태를 사용하고, 큰 파일이 UI를 막으면 별도 XML parser를 포함한 worker adapter를 검증한다. worker 도입을 선행 필수 아키텍처로 만들지 않는다.

가져오기 계획에는 source fingerprint, 시트 후보, 선택 시트, 기준 연도, 파싱 건수, invalid rows, 색 복구 경고, 추가/교체 모드, 그룹 병합 근거가 포함된다. preview 후 확정 전에 source가 바뀌었으면 다시 확인한다. V1의 파싱 중 ColorDB 즉시 저장을 제거해 취소가 DB를 변경하지 않게 한다. ZIP 전체 크기/entry 수/확장 크기, XML 오류, 월 일수, 병합 범위 검사를 더한다.

내보내기 모드는 다음과 같이 제안한다.

| 모드 | 흐름 | 상태 |
|---|---|---|
| 새 파일 | DB snapshot → 월별 보고서 → native Save dialog | 기본 |
| 기존 workbook을 활용한 사본 | 사용자 원본 선택 → 정확한 대상 시트 선택 → 해당 시트 교체 → 새 경로 저장 | 대상 외 값·수식·서식·관계 보존 검증을 통과할 때만 제공 |
| 지속 연결/자동 overwrite | DB 변경 때 외부 XLSX 자동 수정 | 금지 |

기존 workbook을 유지해야 한다면 workbook library의 재직렬화만으로 완전 보존을 약속하지 않는다. 타깃 외 part를 유지하는 OOXML 교체의 관계/스타일/sharedStrings/정의 이름 처리를 검증한다. 지원하지 못하는 요소가 있으면 사본 Export를 중단하고 새 보고서 Export를 제공한다. 새 파일 Export 및 나머지 앱 개발은 이 호환성 검증과 독립적으로 진행한다. Import 시 원본 변경은 없으며 V1처럼 판별된 모든 시트를 삭제하지 않는다.

연도 없는 V1 보고서의 재수입은 Import preview에서 기준 연도를 확인한다. 새 보고서는 제목에 시작 연도를 넣고 연도 전환의 월 라벨에도 연도 단서를 표시한다. 파서는 각 블록의 명시적 연도를 우선하며, 없는 경우만 월 감소에 따른 연도 전환을 사용한다. 빈 해를 건너뛰는 보고서도 명시 연도로 처리한다. 별도 metadata 시트는 초기 구현에서 제외한다. Excel에서 안정 id나 같은 업무 그룹을 추정하지 않으며 완전한 데이터 이동은 JSON backup으로 제공한다.

## 6. Backup 및 Native 경계

JSON 사용자 백업/복원과 SQLite 사전 snapshot을 함께 사용한다. 규격·절차·retention은 [데이터 모델](V2_DATA_MODEL.md)의 8–9절을 단일 기준으로 삼는다. backup 생성은 일관 read snapshot, restore는 native write transaction으로 처리한다. 활성 `.db`를 Finder/Explorer 복사하는 방식을 자동 백업으로 구현하지 않는다.

| 후보 | 추천 사용 | 비고 |
|---|---|---|
| `@tauri-apps/plugin-dialog` / native dialog plugin | Import/Export/Backup 파일 선택, 삭제 확인·메시지 | 실제 설치하지 않음. [공식 dialog 문서](https://v2.tauri.app/plugin/dialog/) |
| Tauri core path / native path resolver | AppData, 사용자 폴더 | app identifier에 따른 경로. OS 문자열 하드코딩하지 않음 |
| `@tauri-apps/plugin-fs` | 선택 파일 bytes 읽기 등 일반 파일 접근 대안 | scope를 제한. [공식 file system 문서](https://v2.tauri.app/plugin/file-system/) |
| custom native file commands | read, 검증된 임시 파일→flush→replace, DB snapshot | 추천 FileGateway 구현. plugin-fs 전체 권한과 중복 도입 불필요 |
| `tauri-plugin-single-instance` | 한 앱 writer와 기존 창 활성화 | 서버/사용자 계정 기능이 아님. [공식 문서](https://v2.tauri.app/plugin/single-instance/) |
| SQL plugin | SQLite repository 대안 | 기본안에서는 native repository 선택 |
| store/persisted-scope/HTTP/updater/shell | 초기 불필요 | 설정은 SQLite, 장기 파일 권한·네트워크·shell 실행 추가 없음 |

파일 선택은 해당 읽기/쓰기 작업을 위한 선택이며 장기 연결 권한이 아니다. native 명령은 앱 자신의 창에서만 호출 가능하게 하고, 파일 선택 결과 및 목적별 경로만 다룬다. 임의 전체 디스크 접근 capability를 기본 부여하지 않는다. 저장한 최근 폴더는 hint이므로 없거나 접근 불가하면 기본 사용자 폴더로 fallback한다.

platform error를 `cancelled`, `permission_denied`, `not_found`, `file_busy`, `disk_full`, `invalid_format`, `db_unavailable`, `unsupported_version` 같은 공통 결과로 바꾼다. 사용자 메시지는 한국어로 작업 결과와 재시도 방법을 설명한다. raw SQL·stack trace는 제품 메시지에 노출하지 않는다.

## 7. 추천 디렉터리 구조

아래는 향후 구조이며 이번 작업에서 생성하지 않는다.

```text
legacy/kar-schedule-v1.html          # 수정 금지 기준선
docs/V2_*.md
src/
  main.ts                          # composition root / 의존성 주입
  domain/task.ts
  domain/date-only.ts
  domain/task-validation.ts
  services/task-service.ts
  services/palette-service.ts
  services/import-export-service.ts
  services/backup-service.ts
  ports/task-repository.ts
  ports/file-gateway.ts
  ports/snapshot-repository.ts
  adapters/tauri/task-repository.ts # SQL 없이 typed invoke
  adapters/tauri/file-gateway.ts
  calendar/monthly-calendar.ts
  calendar/weekly-calendar.ts
  calendar/task-layout.ts           # renderer/export 공유 순수 규칙
  calendar/task-segments.ts
  calendar/drag-drop.ts
  ui/app-state.ts
  ui/task-modal.ts
  ui/color-picker.ts
  ui/import-preview.ts
  ui/toast.ts
  ui/tooltip.ts
  excel/excel-import.ts
  excel/excel-export.ts
  excel/workbook-detection.ts
  excel/mce-style-map.ts
  excel/workbook-sanitize.ts
  backup/backup-codec.ts
  migration/v1-import.ts
  utils/color.ts
  styles/                          # V1 최종 cascade 보존
  assets/fonts/                    # 로컬 font + license
src-tauri/
  src/commands.rs                   # native 입력검증/명령 경계
  src/database.rs                  # 연결, transaction, repository
  src/migrations.rs
  src/backup.rs
  src/platform.rs                  # path, 파일 IO 차이
  migrations/0001_initial.sql
  capabilities/
tests/
  domain/
  migration/
  fixtures/                        # 생성된 비식별 회귀 자료 우선
  integration/
```

Task repository를 TS의 `database/`에 두고 그 안에서 SQL을 실행하는 구조보다, ports 및 native database 구현의 경계를 명시했다. 날짜 유틸리티는 도메인 규칙이므로 domain에 둔다. 기존 `distributeTaskAcrossMonths`는 V2 업무 저장에 이식하지 않고 legacy parser 또는 export projection에서만 개념을 사용한다.

## 8. 오프라인 및 두 OS 배포 설계

빌드 결과의 JS/CSS/font는 앱에 포함한다. CSP는 self/local asset 및 필요한 Tauri IPC만 허용하고 원격 script/font/frame/navigation/connect를 허용하지 않는 방향으로 구성한다. 사용 버전의 IPC origin을 확인하기 전에 `connect-src 'none'`만 넣어 앱 통신까지 막지 않는다. Dev의 Vite HMR 연결은 개발 전용이며 release에서 제거한다. CSP는 native 코드의 네트워크를 막는 장치가 아니므로 HTTP/updater/telemetry 미도입 및 실행 관찰을 함께 적용한다. [Tauri CSP](https://v2.tauri.app/security/csp/).

Windows는 WebView2가 필요하지만 Edge 브라우저 설치가 필수인 것은 아니다. 엄격한 오프라인 배포에는 **Fixed Runtime 포함**을 우선 추천하고 앱 갱신 때 런타임 패치도 함께 배포한다. 대안인 `offlineInstaller`는 런타임 미설치 환경의 오프라인 설치를 지원하나 Evergreen 업데이트/요청 정책을 따로 검증해야 한다. download/embed bootstrapper 또는 runtime 없는 환경의 skip은 목표에 맞지 않는다. NSIS setup.exe를 기본으로 Windows에서 빌드·시험하며 MSI는 필요 시 추가한다. 단독 실행 파일 배포 시에도 runtime/resource 누락이 없어야 한다. [Tauri WebView2 설치 옵션](https://v2.tauri.app/distribute/windows-installer/#webview2-installation-options).

macOS는 WKWebView를 사용하므로 OS에 따라 렌더링이 달라질 수 있다. `aarch64-apple-darwin`과 `x86_64-apple-darwin`을 각각 검증한 뒤 `universal-apple-darwin`으로 `.app/.dmg` 배포를 우선한다. 파일 크기나 의존 라이브러리 문제가 있으면 별도 arm64/Intel 배포로 전환하며 Rosetta만으로 Intel/Apple Silicon 지원 검증을 대신하지 않는다. [Tauri CLI target](https://v2.tauri.app/reference/cli/).

macOS 빌드는 macOS/Xcode 환경에서 수행한다. Developer ID 서명·공증은 배포 준비 단계에서 진행하고 ticket을 staple하여 사용자의 인터넷 없는 첫 실행에 대비한다. 이를 위해 앱 런타임에 공증 서버 호출을 구현하지 않는다. [Tauri macOS 서명](https://v2.tauri.app/distribute/sign/macos/), [Apple ticket stapling](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow).

AppData의 의미는 OS adapter가 해결한다. Windows/macOS DB filename과 schema는 같지만 물리 경로 문자열은 다를 수 있다. macOS `~/Library/Application Support/...` 등의 경로를 business 코드에 쓰지 않는다. app identifier는 초기 배포 전에 안정적으로 확정하여 업데이트 때 DB 위치가 달라지지 않게 한다. 한글 파일명, Windows 공유/잠금, macOS 접근 권한, 임시 파일 동일 볼륨 교체 등은 native adapter에서 시험한다.

## 9. 검증과 구현 전 의사결정

순수 함수는 윤년/월말/연말/DST·구간 겹침·행 충돌·id 유지로 검증한다. Repository는 commit/rollback/재시작·강제 종료·디스크 오류를, Excel은 원본 hash/샘플별 시트 탐지/제목·날짜·메모·완료·스타일·병합을, Backup은 교차 OS/과거·미래 버전/손상을 확인한다. UI는 V1과 두 native WebView를 비교한다. 일반 Chromium 브라우저 시험만으로 macOS 앱 시험 완료를 선언하지 않는다.

[마이그레이션 계획 7절](V2_MIGRATION_PLAN.md)의 기본값으로 구현을 시작한다. 월별 pin/정렬은 task_month_layout으로 보존하며, Task는 한 행으로 유지한다. layout override도 repository snapshot·JSON backup에 포함하고 월간/주간/Exporter가 같은 배치 정책을 사용한다. 실제 V1 데이터는 확보 전 생성 fixture로 대체하여 개발을 진행한다. 이번 분석에서 빌드·설치·성능·실제 오프라인 네트워크 시험은 수행하지 않았으며, 해당 시험은 구현 단계에서 완료한다.
