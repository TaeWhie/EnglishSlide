# NRC Quiz Backend

개발용 FastAPI 백엔드입니다. 앱의 프론트엔드와 같은 데이터 계약으로 퀴즈, 포인트, 금액권 교환, 쿠폰함, 잠금화면 설정을 제공합니다.

## 실행

```powershell
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

## 주요 API

- `POST /v1/auth/device-login`
- `POST /v1/auth/google-login`
- `GET /v1/quizzes/daily`
- `POST /v1/quizzes/verify`
- `GET /v1/rewards/items`
- `POST /v1/rewards/exchange`
- `GET /v1/coupons`
- `GET /v1/settings/lockscreen`
- `PUT /v1/settings/lockscreen`

## DB

기본 DB는 `backend/nrc_quiz.db` SQLite 파일입니다. 서버를 껐다 켜도 사용자, 포인트, 퀴즈 풀이 로그, 쿠폰함, 잠금화면 설정이 유지됩니다.

주요 테이블:

- `users`
- `quizzes`
- `solved_logs`
- `point_logs`
- `reward_items`
- `coupons`
- `lockscreen_settings`

실제 배포 시에는 같은 테이블 구조를 PostgreSQL로 옮기고, 인증/JWT, 요청 서명, 관리자 승인 플로우를 붙이면 됩니다.
