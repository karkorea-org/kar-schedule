# Windows 노트북에서 테스트하기

일반 Intel/AMD 64비트 Windows 10/11용입니다. 개발 도구는 설치하지 않아도 됩니다.

1. GitHub에 로그인하고 [Windows 테스트 릴리스](https://github.com/karkorea-org/kar-schedule/releases/tag/v2.0.3-test.1)를 엽니다. 비공개 저장소이므로 접근 가능한 계정이 필요합니다.
2. 아래 **Assets**에서 `KAR-Schedule_2.0.3_windows-x64-setup.exe`를 다운로드하고 실행해 설치합니다.
3. 시작 메뉴에서 **KAR Schedule**을 실행합니다. 새 PC는 빈 일정으로 시작합니다.
4. 상단 **Excel 연결**로 노트북의 본인 업무 일지 `.xlsx`를 선택하고 일정 시트와 연도를 확인합니다.
5. 업무를 수정하고 **저장 / Ctrl+S**를 누릅니다. 저장 완료를 확인한 뒤 FreeFileSync로 NAS에 동기화합니다.

처음에는 업무 파일의 테스트용 복사본을 연결해 수정·저장·다시 열기를 확인하세요. 다른 직원은 NAS의 변경 파일을 자기 PC로 동기화한 뒤 Excel에서 열면 됩니다. 이미 열려 있던 Excel은 닫았다가 다시 열어 최신 파일을 확인합니다.

설치 파일에는 개인 업무 Excel이나 작성 중인 SQLite가 포함되지 않습니다. SQLite는 앱 최초 실행 시 각 PC의 사용자 데이터 폴더에 생성됩니다. 공유할 파일은 연결한 Excel입니다.

이 테스트 설치 파일은 코드 서명 전 단계이므로 Windows에서 게시자를 확인할 수 없다는 안내가 나올 수 있습니다. 회사 정책이 실행을 막으면 담당자에게 이 설치 파일의 허용을 요청하세요.

WebView2 런타임 오프라인 설치 패키지를 포함하도록 설정했습니다. 파일을 만드는 GitHub 빌드는 인터넷을 사용하지만, 설치 후 업무 작성·저장은 외부 서버가 필요 없습니다. Windows 실기에서 설치·화면·저장 및 네트워크 차단 상태의 동작은 직접 확인해야 합니다.

## 새 설치 파일 만들기

Actions → Desktop test installers → Run workflow에서 `platforms: windows`를 선택합니다. GitHub의 Windows 환경에서 의존성 설치, TypeScript 테스트, Rust 테스트, NSIS 설치 파일 생성을 순서대로 진행합니다. 초록색으로 성공한 실행 아래 Artifacts의 `KAR-Schedule-x86_64-pc-windows-msvc` ZIP에 설치 파일이 들어 있습니다. Actions 산출물은 30일간 보관하고, 배포할 버전은 별도 테스트 릴리스에 등록합니다. macOS 설치 파일도 필요할 때 `all`을 선택합니다.

회사 업무 원본 파일은 저장소에 포함하지 않습니다. 실제 원본을 사용하는 두 추가 테스트는 해당 파일이 없는 CI에서 건너뛰고, 합성 데이터로 Excel 저장과 다른 시트 보존 등을 검증합니다.
