# Python 3.11 슬림 이미지를 기반으로 합니다.
FROM python:3.11-slim

# 작업 디렉토리 설정
WORKDIR /app

# 필수 라이브러리 설치 (PostgreSQL 연결용 라이브러리 포함)
RUN apt-get update && apt-get install -y \
    libpq-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# 요구사항 파일 복사 및 설치
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 소스 코드 복사
COPY . .

# FastAPI 실행 (Uvicorn)
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
