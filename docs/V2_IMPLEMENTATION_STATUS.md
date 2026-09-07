# V2 구현·검증 기록

기록일: 2026-09-07 / 앱 2.0.0 / macOS arm64. 사용자의 후속 구현 요청에 따라 분석 전용 단계에서 실제 앱 구현 단계로 진행했다. 기존 5개 설계 문서는 분석 기준선이며, 현재 구현/검증 상태는 이 문서가 우선한다.

## 2.0.2 후속 변경 — 연결 확인 간소화

내용이 같은 파일 또는 빈 앱의 첫 파일 연결은 별도 교체 확인을 생략한다. 업무 건수만 비교하지 않고, 월별로 표시되는 제목·기간·메모·완료·색·행 및 팔레트를 비교한다. Excel에 없는 ID/시각/group 정보는 비교에서 제외하고, 내용이 같으면 기존 snapshot을 사용해 업무 ID와 여러 달 그룹을 유지한다. 내용이 다른 기존 일정이 있을 때만 “현재 일정과 파일 내용이 다릅니다. 현재 일정을 파일 내용으로 바꿀까요?”라고 확인한다. 복구 사본은 기존처럼 native에서 자동 생성하되 연결 확인 문구에서 DB/사본 설명을 제거했다.

비교 관련 자동 테스트 4개를 추가했고 TypeScript 테스트 총 22개 및 production build가 통과했다. 2.0.2 앱/DMG를 생성하고 앱 서명을 검증했다. 사용자 앱에 새 업무 입력창이 열려 있어 실행 중인 앱을 종료하거나 덮어쓰지 않고 `outputs/KAR Schedule 2.0.2.app`으로 제공한다. 사용자 데이터는 로컬 SQLite에 저장하고 명시적 저장으로 연결 Excel을 갱신하는 구조는 바뀌지 않았다.

## 2.0.1 후속 변경 — 연결 Excel 저장

사용자의 후속 요청에 따라 이전의 “항상 새 파일로 내보내기” 및 “Ctrl+S는 상태만 확인” 정책을 변경했다. 상단은 **Excel 연결 · 저장 · 더 보기** 세 버튼이다. 백업/복원/다른 이름으로 내보내기를 더 보기로 이동했다. 입력창 저장과 Ctrl+S/⌘S는 로컬 commit 후 연결 Excel을 같은 경로에 업데이트한다. 드래그/삭제 등은 로컬 보관 후 명시적 저장으로 Excel에 반영한다.

연결 경로·대상 시트·SHA-256·마지막 저장 revision은 SQLite의 machine-local `local_settings`에 저장한다. 연결 시 snapshot과 연결 metadata를 같은 트랜잭션으로 바꾼다. portable schema/JSON은 1을 유지하며 이 로컬 테이블은 portable 데이터에 포함하지 않는다. 재실행 시 Excel을 자동 재수입하지 않아 DB의 안정 ID와 여러 달 그룹을 보존한다.

OOXML ZIP에서 선택한 일정 worksheet와 ColorDB만 교체한다. 다른 worksheet, 기존 메모/수식/관계·테마·이미지 bytes는 그대로 두고 styles 인덱스를 병합한다. workbook/content-types/관계 목록은 ColorDB와 메모 part 등록 및 계산 cache 무효화를 위해 필요한 부분을 변경한다. 반복 저장 시 스타일을 deduplicate한다. 선택 일정 시트 안의 별도 수식/표/이미지는 보존하지 않는다. [Microsoft CellFormats 인덱스 규칙](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.cellformats?view=openxml-3.0.1)을 따르며, 원본의 sharedStrings 인덱스는 건드리지 않는다.

저장 직전 SHA 비교·Excel owner 잠금 파일 검사를 하고, 이전 XLSX를 AppData `backups/excel`에 최대 10개 보관한다. 동일 폴더 임시 파일 완성/sync 후 파일 교체, 교체 직전·직후 검증을 수행한다. 외부 변경은 자동 병합하지 않고 저장을 중단한다. FreeFileSync와 분산 트랜잭션을 구성한 것은 아니므로 여러 프로그램의 동시 교체에 대한 완전한 상호배제는 보장하지 않는다. Excel 저장과 SQLite 저장은 두 자원이므로 Excel 쓰기 실패 시 로컬 변경을 유지하고 재시도한다.

검증 결과:

- TypeScript/Vitest **18개**, Rust **5개** 통과. 새 검증에는 관련 없는 ZIP part 불변, 수식/메모/ColorDB, 반복 저장 스타일 수, 빈 일정 저장, 손상/서명 파일 거부, 파일 변경·잠금 차단, 이전 XLSX 사본, 연결 metadata 원자 저장/재시작/실패 rollback이 포함된다.
- 별도 identifier `kr.kar.schedule.qa`의 실제 macOS release 앱에서 테스트 파일 연결 → 모달 제목/색 수정 → **⌘S** → 동일 파일 업데이트 성공. 실제 XLSX 재읽기로 제목·RGB·여러 줄 메모와 다른 시트의 `B1*3` 수식 보존을 확인했다.
- QA 앱 재실행 후 연결 경로와 일정 유지 확인. 테스트 파일을 외부에서 바꾼 후 상단 저장을 눌렀을 때 외부 변경 오류를 표시하고 파일 SHA가 그대로 유지됨을 확인했다.
- 원본 사용자 Excel과 실제 사용자 DB를 연결 저장 QA에 사용하지 않았다. QA 파일은 `/tmp/kar-connected-save-qa.xlsx`, QA 앱 데이터는 별도 AppData다.
- Windows Ctrl+S/WebView2·실제 FreeFileSync 병행 동작과 Excel 앱 자체 호환성 시험은 아직 별도 확인이 필요하다. macOS의 ⌘S는 실제 UI로 확인했다.

아래는 **2.0.0 시점의 기록**이다. 연결 저장·단축키·원본 변경 금지·연결 경로 미보존에 관한 이전 설명은 위 2.0.1 변경과 현재 테스트 안내로 대체한다.

## 완료한 구현

Tauri 2 네이티브 앱, Vite + Vanilla TypeScript 화면, Rust rusqlite bundled SQLite, 날짜 도메인·layout·TaskService·native repository·Excel adapter·JSON backup adapter를 분리했다. 데이터는 Task 한 행과 월별 layout override로 관리한다. 저장/삭제/drop/가져오기/복원은 검증된 snapshot 전체를 SQLite 단일 트랜잭션으로 교체하며 revision으로 오래된 저장을 거부한다. 성공 후 재조회한 상태만 UI에 반영한다.

원본 CSS와 Excel 스타일·보고서 변환의 유효 로직을 재사용하고, localStorage/IndexedDB·파일 핸들 연결·CDN을 런타임에서 제거했다. Pretendard와 변환 라이브러리는 번들에 포함한다. CSP는 로컬 asset과 Tauri IPC만 허용하며 HTTP client/updater/telemetry 기능은 추가하지 않았다.

네이티브 열기/저장 대화상자, UTF-8 JSON 백업, 교체·복원·초기화 전 SQLite backup API 사본과 최대 10개 보관, 읽기 전용 사본 검증 후 복원 UI를 구현했다. 파일 출력은 같은 폴더 임시 파일을 완성·동기화한 뒤 교체한다. 현재 실행에서 읽은 원본 파일과 활성 DB/복구 폴더를 출력 대상으로 덮어쓰지 않게 막는다.

## 확인한 결과

| 검증 | 결과 및 한계 |
|---|---|
| TypeScript 검사와 Vite production build | 통과 |
| Vitest 14개 | 윤년/DST/연말, 여러 달 projection, pin 충돌, ID 보존, 월간 clamp/주간 이동, 실패 시 상태 보존, 초기화 팔레트 보존, JSON 버전/중복 검증, V1 그룹 검증, Excel 변환 통과 |
| Rust 3개 | SQLite 재시작·revision 충돌·실패 trigger rollback, backup·잘못된 날짜 거부, 읽기 전용 recovery 및 손상/미래 DB 거부 통과. 실제 디스크 부족 장비를 만든 시험은 아님 |
| 업무 Excel 2개 읽기 | 둘 다 Sheet2 탐지, Sheet1 오탐 방지, 파싱 업무 존재 확인. 원본 불변 |
| Excel 생성 후 재읽기 | 연도, 월간 병합, 제목, 여러 줄 메모, 완료, RGB, ColorDB 확인. Microsoft Excel 앱 자체의 인쇄/외관 비교는 미실시 |
| macOS 실제 release 앱 | 실행, 빈 DB 생성, 업무 등록, 월간·주간 표시, 저장 후 재실행, 월간 마우스 드래그 날짜 이동, JSON native save/open/복원, Excel native save, Excel 가져오기 미리보기·취소 후 기존 상태 유지 확인 |
| 네이티브 출력 파일 | 실제 내보낸 `.xlsx` 재읽기로 테스트 제목·여러 줄 메모·병합 확인 |
| macOS packaging | arm64 `.app`와 `.dmg` 생성 성공. ad-hoc 서명 후 `codesign --verify --deep --strict` 통과, 개발 서버 종료 상태에서 outputs 앱 실행 확인 |
| npm audit | fflate 손상 ZIP64 무한 루프 문제를 0.8.3으로 수정한 뒤 보고 취약점 0개. 모든 파서 안전성의 증명은 아님 |
| 원본 SHA-256 | V1 HTML, 5번 XLSX, 6번 XLSX 모두 분석 전 기준과 동일 |

테스트용 실제 앱 데이터는 `[테스트] 오프라인 저장 확인` 1개다. 사용자 원본 일정은 실제 앱 DB에 가져오지 않았다. 테스트 백업/Excel 출력은 `/tmp/kar-native-qa-backup.json`, `/tmp/kar-native-qa-export.xlsx`에 생성했다.

## 배포 전 남은 검증 및 구현 차이

- Windows x64와 Intel Mac 실제 실행, 한글 IME/date/color input/행 교환, OS 간 JSON 왕복, 대규모 일정 성능, 90개 회귀 항목 전체는 아직 통과 처리하지 않는다. GitHub Actions 수동 빌드 설정만 추가했으며 원격 실행은 하지 않았다.
- 현재 `.app`/DMG는 사용자 테스트 빌드다. Developer ID 서명·공증과 Windows 코드 서명이 없다.
- Windows는 바로 빌드 가능한 `offlineInstaller` 전략을 채택했다. Fixed Runtime 포함 배포는 아직 구성하지 않았으며, WebView2 업데이트 동작/네트워크 차단 첫 설치를 Windows에서 확인해야 한다.
- 앱 번들에는 외부 의존 URL과 외부 통신 기능이 없지만, 네트워크를 차단한 깨끗한 장비의 첫 설치나 패킷/DNS 캡처 시험은 수행하지 않았다. 앱이 외부 요청을 전혀 만들지 않는다는 실측 통과 주장은 하지 않는다.
- 원본 workbook의 다른 시트·수식·관계까지 보존하는 사본 Export는 제공하지 않는다. 설계의 실패 시 대안인 새 월간 보고서 Export를 기본으로 구현했다.
- 파일 대화상자의 최근 폴더 및 원본 경로 보호 목록은 현재 실행 동안 보존한다. 재실행 후에도 유지되는 사용자 설정, import fingerprint 이력은 아직 없다. 반복 추가 경고를 제공한다.
- DB schema 1의 초기 migration은 트랜잭션과 이력을 기록하고 미래 버전을 거부한다. 후속 schema가 아직 없으므로 버전 간 migration/checksum registry·upgrade 직전 snapshot 경로는 추후 schema 추가 시 구현해야 한다. 데이터 교체/복원 직전 snapshot은 현재 동작한다.

## 원본 불변 기준

| 원본 | SHA-256 |
|---|---|
| legacy/kar-schedule-v1.html | 79c5fab62fbf5ecfd9340275134f9a774f1a6bd15e22186e3a842b56b072e0f5 |
| 5번 업무 XLSX | ba62fa402ffcb681a837e4c1afe816e620e4f5b7cdebc6fe35a2f4c2e1acc1e6 |
| 6번 업무 XLSX | 46911287517a941b0675901ac2d5468e14f83b64df772126a3c420ad939e76f2 |
