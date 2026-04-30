# NRC Quiz

문서 폴더의 기획서를 바탕으로 만든 Google Play 출시 후보용 PWA/TWA 앱 소스입니다.

## 실행

개발 확인은 `index.html`을 브라우저에서 열면 됩니다.

Play Store 배포용 TWA 빌드는 HTTPS 호스팅 후 Bubblewrap 또는 Android Studio에서 생성합니다.

## 반영된 주요 요구사항

- 홈 대시보드: 보유 포인트, 퀴즈 진행률, 광고 수익 공개 지표
- 잠금화면 퀴즈 진입 흐름
- 영어 퀴즈 10문제 세트와 정답/오답 차등 포인트
- 보상형 광고 시청 시 추가 포인트 적립 시뮬레이션
- NRC 포인트 상점과 쿠폰 코드 발급 흐름
- 마이페이지 학습 리포트
- 운영 화면: AI 퀴즈 생성, 어뷰징 검토, 장애 등급
- PWA 매니페스트, 서비스 워커, 오프라인 페이지
- 개인정보 처리방침, 이용약관, Play Store 등록 문구 초안
- TWA 패키징 설정 템플릿

## 문서 추출본

`.docx` 문서 본문은 `extracted_docs` 폴더에 텍스트로 추출해 두었습니다.

## Play Store 패키징 절차

1. 이 폴더를 HTTPS 도메인에 업로드합니다.
2. `manifest.webmanifest`의 아이콘을 PNG 512x512로 추가합니다.
3. `android-twa/twa-manifest.json`의 `host`, `iconUrl`, 패키지명을 실제 값으로 교체합니다.
4. Bubblewrap으로 Android 프로젝트를 생성합니다.
5. 릴리스 키를 만들고 SHA-256 지문을 `assetlinks.template.json`에 반영합니다.
6. `https://도메인/.well-known/assetlinks.json`에 업로드합니다.
7. Android App Bundle `.aab`를 빌드해 Play Console에 업로드합니다.
