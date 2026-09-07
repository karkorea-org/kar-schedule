# KAR 업무 일정 V2 요구사항

> 후속 구현 진행: 현재 실행 파일과 실제 검증 결과는 [구현·검증 기록](V2_IMPLEMENTATION_STATUS.md), 사용 방법은 [테스트 안내](V2_TEST_GUIDE.md)를 참고하세요. 아래 내용은 분석 당시 기준선입니다.
기준일: 2026-09-07. 구현 전 요구사항 초안. V1 관찰 사실은 [분석 계획](V2_MIGRATION_PLAN.md), 개별 회귀 항목은 [기능 보존표](V2_FEATURE_PARITY.md)를 따른다.

## 제품 목적과 지원 범위

실제 업무에 사용하는 KAR 월간·주간 일정표의 UI와 조작을 보존하면서, 사용자 PC의 SQLite를 유일한 업무 저장소로 삼는 오프라인 데스크톱 앱을 만든다. 기술은 Tauri 2, Vite, Vanilla TypeScript, HTML/CSS, SQLite다. React/Vue/Svelte는 사용하지 않는다.

Windows 11과 macOS에서 동일한 업무 기능을 제공한다. 초기 배포안은 Windows x64, macOS Apple Silicon/Intel이다. macOS 최소 지원 버전은 실제 업무 장비 및 WebKit 동작 시험 후 확정한다. 모바일·Linux는 현재 지원 범위가 아니다. 한 코드베이스를 사용하지만 각 OS 실행 파일은 따로 빌드한다.

## Functional Requirements

| ID | 요구사항 | 합격 조건 |
|---|---|---|
| F01 | 월간 가로 일자 일정표 및 주간 7일 일정표 동시 제공 | 28/29/30/31일, 월말·연말 주간, 빈 달에 정상 표시 |
| F02 | 이전/다음 달 및 지난주/이번주/다음주 | 월·주 선택이 독립이며 월요일 시작. 실제 오늘/이번 주 강조 유지 |
| F03 | 장시간 실행 시 오늘 갱신 | 로컬 날짜 변경·절전 복귀 시 기준 날짜 재평가. 사용자 선택은 필요 없이 초기화하지 않음 |
| F04 | 업무 추가·수정·삭제 | 안정 id로 저장. 제목·기간·메모·색·완료 보존. 삭제는 전체 업무 1개 대상 |
| F05 | 여러 달 업무 | DB 1행; 화면에서 월/주 범위만 잘라 표시; 제목/완료/메모 수정이 모든 화면에 반영 |
| F06 | 상세 모달의 저장/취소 | 명시적 저장 시 적용. X는 draft 폐기. 바깥 클릭·Esc로 닫지 않는 V1 동작 유지 |
| F07 | 완료 업무 | 모달 완료 토글과 취소선·회색 표시; 완료 업무 편집·드래그 제한을 새로 추가하지 않음 |
| F08 | 색상 및 팔레트 | 색 없음·기존 다섯 프리셋·사용자 색 이름 CRUD. 팔레트 삭제로 업무 색이 사라지지 않음 |
| F09 | 업무 툴팁·초점 | 제목·완료·기간·평문 메모 표시, clipping 방지, 모달/드래그 시 숨김 |
| F10 | DnD | 5px 임계값, 날짜 이동/행 이동/월간 행 교환, ghost/drop 피드백/클릭 억제. D 항목별 회귀 통과 |
| F11 | 자동 행 배치 | pin 우선 후 겹치지 않는 빈 구간 배치. 월별 override 보존, display_row는 기본 희망 행, computed row는 일시값 |
| F12 | 스크롤·창 크기 | V1 월간 가로 스크롤과 주간 스크롤 보존. 작은 데스크톱 창에서도 제어 가능 |
| F13 | 저장 상태·오류·단축키 | Ctrl+S/⌘S는 DB 저장 대기를 완료하고 상태 확인. Excel 파일을 자동 쓰지 않음 |
| F14 | 초기화 | V1 연결 해제의 일정 초기화 능력은 별도 명시적 초기화로 제공. 삭제 건수 확인·사전 백업 후 트랜잭션 수행 |

모달 저장 전 Ctrl/Cmd+S는 모달 draft를 암묵적으로 확정하지 않는다. 업무 저장 버튼과 앱 저장 상태를 구분한다. 사용자 팔레트 관리의 즉시 저장은 업무 draft와 분리한다. UI 디자인은 V1을 기본으로 하며 파일 연결 버튼을 Import로, Excel 저장 상태를 DB 저장 상태로 바꾸는 등 필요한 의미 변경만 문서에 제안한다.

## Offline Requirements

| ID | 요구사항 | 합격 조건 |
|---|---|---|
| O01 | 설치 후 모든 기능 100% 오프라인 실행 | 네트워크 차단 상태에서 첫 실행·CRUD·Import/Export·Backup/Restore·재시작 가능 |
| O02 | 배포 asset 전체 로컬화 | CDN/preconnect/외부 CSS/font/원격 JS/원격 이미지를 번들에서 참조하지 않음 |
| O03 | 앱에서 외부 네트워크 요청 0 | 앱 WebView와 native/worker의 외부 HTTP(S), WebSocket, DNS 요청을 관찰. updater·telemetry·HTTP client·원격 페이지 없음 |
| O04 | 런타임 도구 독립 | Chrome/Edge 브라우저, Node, npm, Rust, Python, Excel 설치 없이 실행 및 파일 변환 가능 |
| O05 | 네이티브 WebView 제공 | Windows는 WebView2 runtime 포함 배포 전략, macOS는 시스템 WKWebView. 브라우저 앱 설치와 WebView runtime 필요를 구별 |
| O06 | 오프라인 첫 설치 | Windows 런타임 미설치 장비와 macOS 미실행 장비에서 테스트. 웹 다운로드 bootstrapper 의존 금지 |

개발 시 npm/cargo 의존성 확보, 빌드 도구 다운로드, 배포자의 서명·공증은 준비 단계이며 최종 사용자의 런타임 네트워크 요구와 구분한다. 최종 앱은 개발 서버나 localhost 서버에 의존하지 않는다. Tauri의 로컬 asset/IPC 통신은 인터넷 통신이 아니며 CSP 설정 때 이를 잘못 차단하지 않는다. OS 자체 보안·업데이트 프로세스까지 앱이 제어한다고 약속하지 않지만, 앱이나 포함 런타임에서 발생한 외부 요청은 원인을 확인해 0 요청 기준을 만족시켜야 한다.

## Persistence Requirements

| ID | 요구사항 | 합격 조건 |
|---|---|---|
| P01 | SQLite primary storage | 업무의 진실 원천은 app data의 로컬 DB. Excel/localStorage/IndexedDB를 동시 primary로 유지하지 않음 |
| P02 | 명시적 commit | 업무 저장·삭제·drop 직후 트랜잭션을 수행하고 commit 후 성공 표시. 실패 시 기존 상태 또는 실패 draft 유지 |
| P03 | 안정 식별자 | 제목·기간 변경 및 월 이동으로 Task id가 바뀌지 않음 |
| P04 | 원자적 다중 변경 | Import/Restore/초기화/행 교환·충돌 pin 해제를 한 트랜잭션으로 완료하거나 전부 rollback |
| P05 | 저장 경로 | native AppData 경로 결정. 앱 설치 폴더·Excel 폴더·네트워크/클라우드 폴더에 활성 DB를 두지 않음 |
| P06 | 저장 오류 및 종료 | 디스크 부족·권한·잠금·DB 손상 안내, 미완료 write 대기, 자동 빈 DB 초기화 금지 |
| P07 | 버전 관리 | schema migration 이력과 체크섬, migration 전 복구 snapshot, 미래 schema의 구형 앱 열기 거부 |
| P08 | 단일 사용자 단일 writer | 중복 앱 실행은 기존 창 활성화 또는 명확한 거부. 네트워크 협업 기능 추가 없음 |

## Excel Requirements

| ID | 요구사항 | 합격 조건 |
|---|---|---|
| E01 | `.xlsx` Import/Export만 명시 지원 | 숨은 V1 `.xls` input을 근거로 .xls 지원을 주장하지 않음 |
| E02 | 원본 불변 Import | 취소·오류·성공 모두 원본 hash 유지. 시트·기간·연도·업무 수·경고 preview 후 확정 |
| E03 | 입력 판별과 연도 | 월 블록 없는 Sheet1 오탐 방지, 헤더가 뒤에 있는 시트 경고, 연도 없음/혼합 연도는 사용자 확인 |
| E04 | 검증 후 서비스 경유 저장 | Excel → ParsedTask → Import Service → Task Service → Repository. 파싱 중 업무/팔레트 DB 변경 금지 |
| E05 | 교체/추가 명시 | 기본 추가, 전체 교체는 별도 선택·건수 확인·사전 백업. 제목이 같다고 자동 병합하지 않음 |
| E06 | 형식 호환 | V1 A–AF 월간 표, 병합, 열 너비/행 높이/스타일, ✓ 완료, 셀 메모, RGB fill, ColorDB 보존 |
| E07 | 원본 workbook의 별도 사본 Export | 사용자가 선택한 일정 시트만 교체. 대상 외 값·수식·서식·관계 보존 검증 실패 시 사본 Export를 중단하고 새 보고서 Export 제공. 모든 monthly 시트 일괄 삭제 금지 |
| E08 | 저장과 Export 분리 | 파일 핸들 지속 연결·watch·자동 Excel 덮어쓰기 금지. 매 Export는 사용자 동작과 native save dialog로 시작 |
| E09 | 정상/빈/손상 구별 | 파싱 실패를 빈 파일 성공으로 취급하지 않음. 잘못된 일수·색·병합·대형 ZIP 진단 |
| E10 | 재수입 한계 명시 | V1 파일에는 안정 id/group 정보가 없다. 연도 미상은 Import 때 확인, 그룹 없는 업무는 독립 Task로 처리 |
| E11 | 내보내기 실패 처리 | 취소·파일 잠금·권한·디스크 부족에서도 DB와 원본 유지. 성공 전에 결과 파일 완성/검증 |

새 보고서 제목에는 시작 연도를 표시한다. 초기 구현에는 별도 metadata 시트를 추가하지 않는다. Excel은 사용자 보고·교환 형식이며 모든 DB 정보를 완전 보존하는 백업으로 안내하지 않는다. Excel 프로그램으로 파일을 여는 것은 호환성 검증이며 앱 실행 필수조건이 아니다.

## Backup Requirements

사용자 백업은 UTF-8 versioned JSON, 자동 복구 지점은 일관된 SQLite snapshot을 추천한다. 각각의 계약은 [데이터 모델](V2_DATA_MODEL.md)에 있다.

| ID | 요구사항 | 합격 조건 |
|---|---|---|
| B01 | Excel과 독립된 백업 | `KAR-Schedule-Backup-2026-09-07.json` 형태. Task 전체 필드·월별 layout·팔레트·portable 설정 포함 |
| B02 | OS 간 복원 | Windows 생성 → macOS 복원 → 다시 Windows 복원 시 id/날짜/메모/색/완료/정렬 동일 |
| B03 | 형식/버전 검증 | format/version/id 중복/필수 필드/날짜/범위 검사. 미래 버전·잘린 파일·변조 데이터는 기존 DB 유지 |
| B04 | 복원 전 보호 | 기존 데이터 건수와 교체 내용을 표시, 사전 SQLite snapshot 성공 후 복원 transaction 실행 |
| B05 | 원자적 복원 | 중간 실패 시 기존 DB 완전 유지. 성공 후 재조회·데이터 수 및 필드 비교 |
| B06 | 활성 DB 안전 backup | WAL 포함 일관 snapshot은 SQLite backup API 등으로 생성. 실행 중 DB 파일만 단순 복사 금지 |
| B07 | 저장 위치 | 사용자가 native dialog로 외부 백업 경로 선택. 활성 DB는 이동하지 않음 |

## Cross-platform 및 Distribution Requirements

- AppData/DB path, 파일 열기·저장, backup path, 오류 변환은 platform/native adapter 안에서 처리한다. Calendar/Service에 OS 분기를 흩뿌리지 않는다.
- Windows와 macOS의 DB schema·JSON backup 형식은 동일하다. OS 절대경로, 핸들, 폰트 설치 경로를 portable backup에 넣지 않는다.
- 한국어 파일명·공백·Unicode 정규화, 잠긴 Excel 파일, 경로 길이, 대소문자, 저장 취소를 공통 fixture로 확인한다.
- WebView2와 WKWebView에서 한국어 IME, date/color input, DOMParser, CSS Grid/`:has`, 폰트 폭, mouse/trackpad, Ctrl/⌘S 동작을 확인한다. V1 CSS를 최신화한다는 이유로 임의 변경하지 않는다.
- Windows는 `KAR Schedule` 실행 파일 및 NSIS setup.exe 우선, 필요 시 MSI. 런타임 없는 단독 exe가 완전히 자립한다고 안내하지 않는다. 오프라인 런타임 패키징 선택은 [아키텍처](V2_ARCHITECTURE.md)에 기술한다. [Tauri Windows 배포](https://v2.tauri.app/distribute/windows-installer/).
- macOS는 `.app`/`.dmg`, arm64/x86_64 별도 시험 후 universal 배포를 우선 검토한다. 배포 전에 Developer ID 서명·공증 및 ticket stapling을 준비한다. 오프라인 첫 실행은 실제 배포본으로 확인한다. [Tauri macOS 서명](https://v2.tauri.app/distribute/sign/macos/), [Apple 오프라인 공증 ticket](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow).
- 업데이트는 새 서명 설치 파일을 사용자가 전달받는 방식. 자동 updater는 없다. 앱 교체·업데이트로 사용자 DB를 지우지 않는다.

## Non-goals

로그인, 사용자 계정, 권한 관리 제품 기능, 사내 서버, Cloud, SaaS, 실시간 동기화, 다중 사용자 협업, 관리자 기능, 승인 workflow, 알림 서버, 모바일 앱, 인터넷 기반 기능을 넣지 않는다. Tauri의 OS 파일 접근 권한은 사용자 권한 관리 제품 기능과 별개다. React/Vue/Svelte, UI redesign, Excel primary storage도 범위 밖이다. 잔존 코드만 있는 정렬/인라인 목록/접기 기능의 부활은 별도 요청 없이는 하지 않는다.

## 구현 시작 조건

월별 표시 override 보존, 원본 읽기 전용 Import/새 파일 Export, 연도 표기 및 JSON 완전 백업을 기본값으로 구현을 시작할 수 있다. 실데이터는 파일 단위로 받아 검증하며 확보 전에는 생성 fixture를 사용한다. 개발 착수를 위해 추가 사용자 결정을 기다리지 않는다. 현재 요구사항 표는 검증 계획이며 구현 완료 또는 시험 통과를 뜻하지 않는다.
