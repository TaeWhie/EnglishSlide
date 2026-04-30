import os
import json
import datetime
from string import ascii_uppercase, digits
from random import choices
from uuid import uuid4
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, Integer, String, Boolean, ForeignKey, DateTime, Text, UniqueConstraint
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session

# --- Database Configuration ---
DB_USER = os.getenv("POSTGRES_USER", "nrc_user")
DB_PASSWORD = os.getenv("POSTGRES_PASSWORD", "nrc_pass")
DB_HOST = os.getenv("DB_HOST", "db")
DB_NAME = os.getenv("POSTGRES_DB", "nrc_quiz_db")
RENDER_DB_URL = os.getenv("DATABASE_URL") # Render에서 자동 제공하는 DB URL

# Render에서 제공하는 DATABASE_URL을 최우선으로 사용
if RENDER_DB_URL:
    # SQLAlchemy 1.4+ 에서는 postgres:// 대신 postgresql:// 을 요구합니다.
    if RENDER_DB_URL.startswith("postgres://"):
        RENDER_DB_URL = RENDER_DB_URL.replace("postgres://", "postgresql://", 1)
    DATABASE_URL = RENDER_DB_URL
    engine = create_engine(DATABASE_URL)
# 로컬 개발 환경 중 DB_HOST가 지정되지 않은 경우 (SQLite 대체)
elif not os.getenv("DB_HOST"):
    DATABASE_URL = "sqlite:///./nrc_quiz.db"
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
# 기존 Docker Compose 로컬 환경
else:
    DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:5432/{DB_NAME}"
    engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# --- Database Models ---
class User(Base):
    __tablename__ = "users"
    user_id = Column(String, primary_key=True, index=True)
    device_uuid = Column(String, unique=True, index=True, nullable=False)
    nrc_id = Column(String, nullable=True)
    auth_provider = Column(String, nullable=False, default='device')
    google_sub = Column(String, unique=True, index=True, nullable=True)
    email = Column(String, nullable=True)
    nickname = Column(String, nullable=True)
    total_points = Column(Integer, nullable=False, default=0)
    created_at = Column(String, nullable=False)

class Quiz(Base):
    __tablename__ = "quizzes"
    quiz_id = Column(Integer, primary_key=True, index=True)
    question = Column(Text, nullable=False)
    options_json = Column(Text, nullable=False)
    correct_idx = Column(Integer, nullable=False)
    category = Column(String, nullable=False)
    level = Column(Integer, nullable=False)
    explanation = Column(Text, nullable=False)

class SolvedLog(Base):
    __tablename__ = "solved_logs"
    log_id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=False)
    quiz_id = Column(Integer, ForeignKey("quizzes.quiz_id"), nullable=False)
    solved_date = Column(String, nullable=False)
    selected_idx = Column(Integer, nullable=False)
    is_correct = Column(Integer, nullable=False)
    earned_points = Column(Integer, nullable=False)
    created_at = Column(String, nullable=False)
    __table_args__ = (UniqueConstraint('user_id', 'quiz_id', 'solved_date', name='_user_quiz_date_uc'),)

class PointLog(Base):
    __tablename__ = "point_logs"
    log_id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=False)
    amount = Column(Integer, nullable=False)
    reason = Column(String, nullable=False)
    ref_id = Column(String, nullable=True)
    created_at = Column(String, nullable=False)

class RewardItem(Base):
    __tablename__ = "reward_items"
    item_id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    price_points = Column(Integer, nullable=False)

class Coupon(Base):
    __tablename__ = "coupons"
    coupon_id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.user_id"), nullable=False)
    item_id = Column(String, ForeignKey("reward_items.item_id"), nullable=False)
    name = Column(String, nullable=False)
    coupon_code = Column(String, unique=True, nullable=False)
    status = Column(String, nullable=False)
    issued_at = Column(String, nullable=False)

class LockscreenSetting(Base):
    __tablename__ = "lockscreen_settings"
    user_id = Column(String, ForeignKey("users.user_id"), primary_key=True)
    enabled = Column(Integer, nullable=False, default=1)
    reward_prompt = Column(Integer, nullable=False, default=1)
    updated_at = Column(String, nullable=False)

# --- Initial Data ---
QUIZZES = [
    (1, "다음 중 '혜택'이라는 뜻을 가진 단어는?", '["Benefit", "Battery", "Balance", "Banner"]', 0, "Life English", 1, "Benefit은 혜택이나 이익을 뜻합니다."),
    (2, "I would like to order some ____ at the cafe.", '["coffee", "coffees", "coffeed", "coffeeing"]', 0, "Sentence Completion", 2, "음료를 주문하는 문장에서는 some coffee가 자연스럽습니다."),
    (3, "'예약을 확인하다'에 가장 가까운 표현은?", '["Confirm a reservation", "Cancel a station", "Carry a reason", "Change a season"]', 0, "Travel English", 3, "Confirm a reservation은 예약을 확인하다는 뜻입니다.")
]
REWARD_ITEMS = [
    ("voucher_5k", "5천원 금액권", 5000),
    ("voucher_10k", "1만원 금액권", 10000),
    ("voucher_30k", "3만원 금액권", 30000),
    ("voucher_50k", "5만원 금액권", 50000),
]

def init_db():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        for q in QUIZZES:
            if not db.query(Quiz).filter(Quiz.quiz_id == q[0]).first():
                db.add(Quiz(quiz_id=q[0], question=q[1], options_json=q[2], correct_idx=q[3], category=q[4], level=q[5], explanation=q[6]))
        for r in REWARD_ITEMS:
            if not db.query(RewardItem).filter(RewardItem.item_id == r[0]).first():
                db.add(RewardItem(item_id=r[0], name=r[1], price_points=r[2]))
        db.commit()
    finally:
        db.close()

init_db()

# --- FastAPI App Setup ---
app = FastAPI(title="NRC Quiz API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- Schemas ---
class DeviceLoginRequest(BaseModel):
    device_uuid: str
    nrc_id: Optional[str] = None

class GoogleLoginRequest(BaseModel):
    google_sub: str
    email: Optional[str] = None
    nickname: str

class QuizVerifyRequest(BaseModel):
    user_id: str
    quiz_id: int
    selected_idx: int

class RewardExchangeRequest(BaseModel):
    user_id: str
    item_id: str

class LockscreenSettingsSchema(BaseModel):
    enabled: bool = True
    reward_prompt: bool = True

def make_coupon_code() -> str:
    token = "".join(choices(ascii_uppercase + digits, k=8))
    return f"NRCQ-{token[:4]}-{token[4:]}"

# --- Endpoints ---
@app.get("/health")
def health():
    return {"status": "ok", "time": datetime.datetime.utcnow().isoformat()}

@app.post("/v1/auth/device-login")
def device_login(payload: DeviceLoginRequest, db: Session = Depends(get_db)):
    now = datetime.datetime.utcnow().isoformat()
    user = db.query(User).filter(User.device_uuid == payload.device_uuid).first()
    if not user:
        user_id = str(uuid4())
        user = User(user_id=user_id, device_uuid=payload.device_uuid, nrc_id=payload.nrc_id, total_points=1250, created_at=now)
        db.add(user)
        db.add(PointLog(user_id=user_id, amount=1250, reason="signup_bonus", created_at=now))
        db.add(LockscreenSetting(user_id=user_id, enabled=1, reward_prompt=1, updated_at=now))
        db.commit()
        db.refresh(user)

    return {"access_token": f"dev-token-{user.user_id}", "user_id": user.user_id, "total_points": user.total_points}

@app.post("/v1/auth/google-login")
def google_login(payload: GoogleLoginRequest, db: Session = Depends(get_db)):
    now = datetime.datetime.utcnow().isoformat()
    nickname = payload.nickname.strip()
    if not nickname:
        raise HTTPException(status_code=400, detail="nickname required")

    user = db.query(User).filter(User.google_sub == payload.google_sub).first()
    if not user:
        user_id = str(uuid4())
        user = User(user_id=user_id, device_uuid=f"google:{payload.google_sub}", auth_provider="google", google_sub=payload.google_sub, email=payload.email, nickname=nickname, total_points=1250, created_at=now)
        db.add(user)
        db.add(PointLog(user_id=user_id, amount=1250, reason="signup_bonus", created_at=now))
        db.add(LockscreenSetting(user_id=user_id, enabled=1, reward_prompt=1, updated_at=now))
        db.commit()
        db.refresh(user)
    else:
        user.email = payload.email
        user.nickname = nickname
        db.commit()
        db.refresh(user)

    return {"access_token": f"dev-token-{user.user_id}", "user_id": user.user_id, "nickname": user.nickname, "total_points": user.total_points}

@app.get("/v1/quizzes/daily")
def daily_quizzes(db: Session = Depends(get_db)):
    quizzes = db.query(Quiz).order_by(Quiz.quiz_id).limit(10).all()
    return [{"quiz_id": q.quiz_id, "question": q.question, "options": json.loads(q.options_json), "category": q.category, "level": q.level} for q in quizzes]

@app.post("/v1/quizzes/verify")
def verify_quiz(payload: QuizVerifyRequest, db: Session = Depends(get_db)):
    today = datetime.date.today().isoformat()
    now = datetime.datetime.utcnow().isoformat()
    
    user = db.query(User).filter(User.user_id == payload.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="user not found")

    solved_count = db.query(SolvedLog).filter(SolvedLog.user_id == payload.user_id, SolvedLog.solved_date == today).count()
    if solved_count >= 10:
        raise HTTPException(status_code=403, detail="daily quiz already completed")

    quiz = db.query(Quiz).filter(Quiz.quiz_id == payload.quiz_id).first()
    if not quiz:
        raise HTTPException(status_code=404, detail="quiz not found")

    already = db.query(SolvedLog).filter(SolvedLog.user_id == payload.user_id, SolvedLog.quiz_id == payload.quiz_id, SolvedLog.solved_date == today).first()
    if already:
        raise HTTPException(status_code=403, detail="quiz already solved")

    is_correct = (payload.selected_idx == quiz.correct_idx)
    earned = 10 + (quiz.level - 1) * 3 if is_correct else 2
    
    user.total_points += earned
    db.add(SolvedLog(user_id=payload.user_id, quiz_id=payload.quiz_id, solved_date=today, selected_idx=payload.selected_idx, is_correct=int(is_correct), earned_points=earned, created_at=now))
    db.add(PointLog(user_id=payload.user_id, amount=earned, reason="quiz", ref_id=str(payload.quiz_id), created_at=now))
    db.commit()

    return {
        "is_correct": is_correct,
        "correct_idx": quiz.correct_idx,
        "earned_points": earned,
        "current_total_points": user.total_points,
        "daily_solved": solved_count + 1,
        "daily_completed": (solved_count + 1) >= 10,
        "explanation": quiz.explanation,
    }

@app.get("/v1/rewards/items")
def reward_items(db: Session = Depends(get_db)):
    items = db.query(RewardItem).order_by(RewardItem.price_points).all()
    return [{"item_id": i.item_id, "name": i.name, "price_points": i.price_points} for i in items]

@app.post("/v1/rewards/exchange")
def exchange_reward(payload: RewardExchangeRequest, db: Session = Depends(get_db)):
    now = datetime.datetime.utcnow().isoformat()
    user = db.query(User).filter(User.user_id == payload.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="user not found")

    item = db.query(RewardItem).filter(RewardItem.item_id == payload.item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="item not found")

    if user.total_points < item.price_points:
        raise HTTPException(status_code=400, detail="not enough points")

    coupon_id = str(uuid4())
    coupon_code = make_coupon_code()
    
    user.total_points -= item.price_points
    coupon = Coupon(coupon_id=coupon_id, user_id=payload.user_id, item_id=item.item_id, name=item.name, coupon_code=coupon_code, status="사용 가능", issued_at=datetime.date.today().isoformat())
    db.add(coupon)
    db.add(PointLog(user_id=payload.user_id, amount=-item.price_points, reason="reward_exchange", ref_id=coupon_id, created_at=now))
    db.commit()

    return {
        "coupon": {
            "coupon_id": coupon_id,
            "name": item.name,
            "coupon_code": coupon_code,
            "status": "사용 가능",
            "issued_at": datetime.date.today().isoformat(),
        },
        "remaining_points": user.total_points,
    }

@app.get("/v1/coupons")
def get_coupons(user_id: str, db: Session = Depends(get_db)):
    coupons = db.query(Coupon).filter(Coupon.user_id == user_id).order_by(Coupon.issued_at.desc()).all()
    return [{"coupon_id": c.coupon_id, "name": c.name, "coupon_code": c.coupon_code, "status": c.status, "issued_at": c.issued_at} for c in coupons]

@app.get("/v1/settings/lockscreen")
def get_lockscreen(user_id: str, db: Session = Depends(get_db)):
    setting = db.query(LockscreenSetting).filter(LockscreenSetting.user_id == user_id).first()
    if not setting:
        return LockscreenSettingsSchema()
    return LockscreenSettingsSchema(enabled=bool(setting.enabled), reward_prompt=bool(setting.reward_prompt))

@app.put("/v1/settings/lockscreen")
def update_lockscreen(user_id: str, settings: LockscreenSettingsSchema, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="user not found")
        
    setting = db.query(LockscreenSetting).filter(LockscreenSetting.user_id == user_id).first()
    if setting:
        setting.enabled = int(settings.enabled)
        setting.reward_prompt = int(settings.reward_prompt)
        setting.updated_at = datetime.datetime.utcnow().isoformat()
    else:
        db.add(LockscreenSetting(user_id=user_id, enabled=int(settings.enabled), reward_prompt=int(settings.reward_prompt), updated_at=datetime.datetime.utcnow().isoformat()))
    db.commit()
    return settings
