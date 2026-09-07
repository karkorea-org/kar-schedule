# KAR 업무 일정 V2

기존 월간·주간 업무 일정을 Tauri 2 + Vanilla TypeScript + SQLite로 옮긴 오프라인 데스크톱 앱입니다.

## 지금 테스트하기

Windows 노트북에서는 [Windows 테스트 릴리스](https://github.com/karkorea-org/kar-schedule/releases/tag/v2.0.2-test.1)의 Assets에서 `.exe`를 다운로드해 설치합니다. [Windows 설치 안내](docs/WINDOWS_INSTALL.md)를 참고하세요. 사용자 PC에는 개발 도구가 필요 없습니다.

이 컴퓨터에서는 프로젝트의 `outputs/KAR Schedule 2.0.2.app`을 더블클릭하면 됩니다. 설치용 파일은 `outputs/KAR Schedule_2.0.2_aarch64.dmg`입니다. Apple Silicon Mac용이며, Node/Rust/Excel이나 개발 서버 없이 실행됩니다.

[테스트 안내](docs/V2_TEST_GUIDE.md)에 업무 추가, 여러 달 일정, 드래그, Excel, 백업·복원 확인 순서를 적었습니다. 기존에 저장한 일정은 앱 업데이트 후에도 유지됩니다. 새 PC의 첫 실행은 빈 일정으로 시작합니다.

## 간단한 저장 흐름

상단 **Excel 연결 → 본인 로컬 업무 파일 선택 → 작성 → 저장 또는 Ctrl+S / ⌘S** 순서로 사용합니다. 연결 파일명과 위치는 그대로 유지되므로 FreeFileSync의 기존 동기화 설정을 사용할 수 있습니다. 입력창의 저장 버튼도 연결 Excel에 반영합니다. 드래그·삭제는 로컬에 먼저 보관하고 저장 버튼으로 Excel에 반영합니다. 백업·복원·다른 이름으로 내보내기는 **더 보기**에 있습니다.

연결한 일정 시트와 ColorDB를 업데이트하고 다른 시트의 원본 XML·수식·관계를 보존합니다. 파일이 외부에서 변경됐거나 Excel 잠금 파일이 있으면 덮어쓰지 않고 알립니다. 연결 경로는 재실행 후에도 유지됩니다.

## 구현 범위

- 기존 가로 월간 일정표와 지난주/이번주/다음주 화면, 업무 CRUD, 완료, 메모, 색상 팔레트
- 여러 달 업무를 하나의 Task로 저장, 월별 행 위치 유지, 날짜/행 드래그
- SQLite 트랜잭션 저장, 재시작 보존, 중복 실행 방지
- Excel 원본 읽기 전용 가져오기, 시트·연도·추가/교체 확인, 새 보고서 내보내기
- JSON 완전 백업/복원, 교체·초기화 전 SQLite 자동 복구 사본, 앱에서 사본 복원
- V1 월별 JSON 가져오기, 로컬 폰트와 JS 번들, 외부 서버/로그인/업데이터 없음

## 개발 및 빌드

Node.js 24, Rust stable, 해당 OS의 [Tauri 빌드 필수 도구](https://v2.tauri.app/start/prerequisites/)가 필요합니다. 사용자 실행에는 이 도구들이 필요 없습니다.

```sh
npm ci
npm test
npm run test:native
npm run desktop
```

```sh
# macOS
npm run package -- --bundles app,dmg
# Windows x64 Developer PowerShell
npm run package -- --bundles nsis
```

`.tools/cargo`에 프로젝트 전용 Rust가 있으면 npm 명령이 자동 사용하며, 없으면 시스템 Rust를 사용합니다. Windows 빌드에는 Visual Studio C++ Build Tools가 필요합니다. 최초 의존성/런타임 확보 단계는 인터넷을 사용합니다.

`.github/workflows/desktop-build.yml`은 Actions에서 수동 실행합니다. 기본값 `windows`는 Windows x64 설치 파일만 생성하고, `all`은 macOS arm64·Intel도 함께 빌드합니다. 설치 파일은 Actions artifact로 30일간 보관합니다. [Windows 설치 안내](docs/WINDOWS_INSTALL.md)를 참고하세요. [Tauri 공식 CI 안내](https://v2.tauri.app/distribute/pipelines/github/).

Windows 설정은 WebView2 **오프라인 설치 패키지 포함**입니다. 개발 서버를 사용하지 않으며, 런타임 없는 PC의 오프라인 첫 설치 및 WebView2 자체 요청 여부는 Windows 실기 검증이 필요합니다. [Tauri Windows 설치 옵션](https://v2.tauri.app/distribute/windows-installer/#webview2-installation-options).

## 검증 상태

[구현·검증 기록](docs/V2_IMPLEMENTATION_STATUS.md)을 참고하세요. macOS arm64 앱·DMG 생성 및 실제 앱 조작을 확인했습니다. Windows/Intel 실기, Developer ID 서명·공증, 네트워크 차단 환경 시험은 완료되지 않았습니다. 현재 산출물은 사용자 테스트용입니다.

원본 V1 HTML과 두 업무 Excel 파일은 수정하지 않았습니다. 다른 이름으로 내보내기는 새 일정 보고서를 만듭니다. 연결 파일 저장은 선택 일정 시트와 ColorDB를 교체하고 다른 시트를 보존합니다. 전체 데이터 이동은 JSON 백업을 사용하세요.
