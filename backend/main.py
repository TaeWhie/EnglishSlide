import datetime
import random
import json
import os
from random import choices
from string import ascii_uppercase, digits
from typing import Optional
from uuid import uuid4

import firebase_admin
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from firebase_admin import auth as firebase_auth
from firebase_admin import credentials as firebase_credentials
from firebase_admin import firestore as firebase_firestore
from pydantic import BaseModel

FIREBASE_SERVICE_ACCOUNT_JSON = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON", "")
FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID", "")
ALLOW_UNVERIFIED_GOOGLE_LOGIN = os.getenv("ALLOW_UNVERIFIED_GOOGLE_LOGIN", "").lower() in ("1", "true", "yes")
WORDS_PATH = os.path.join(os.path.dirname(__file__), "data", "words.json")

QUIZZES = [
    (1, "다음 중 '혜택'이라는 뜻을 가진 단어는?", '["Benefit", "Battery", "Balance", "Banner"]', 0, "Life English", 1, "Benefit은 혜택이나 이익을 뜻합니다."),
    (2, "I would like to order some ____ at the cafe.", '["coffee", "coffees", "coffeed", "coffeeing"]', 0, "Sentence Completion", 2, "음료를 주문하는 문장에서는 some coffee가 자연스럽습니다."),
    (3, "'예약을 확인하다'와 가장 가까운 표현은?", '["Confirm a reservation", "Cancel a station", "Carry a reason", "Change a season"]', 0, "Travel English", 3, "Confirm a reservation은 예약을 확인하다는 뜻입니다."),
]

REWARD_ITEMS = [
    ("voucher_5k", "5천원 금액권", 5000),
    ("voucher_10k", "1만원 금액권", 10000),
    ("voucher_30k", "3만원 금액권", 30000),
    ("voucher_50k", "5만원 금액권", 50000),
]


def init_firebase_admin():
    if firebase_admin._apps:
        return
    if not FIREBASE_SERVICE_ACCOUNT_JSON:
        raise RuntimeError("FIREBASE_SERVICE_ACCOUNT_JSON is required for the Firestore-only backend")
    options = {"projectId": FIREBASE_PROJECT_ID} if FIREBASE_PROJECT_ID else None
    service_account = json.loads(FIREBASE_SERVICE_ACCOUNT_JSON)
    firebase_admin.initialize_app(firebase_credentials.Certificate(service_account), options)


init_firebase_admin()
firestore_db = firebase_firestore.client()

app = FastAPI(title="NRC Quiz API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


class DeviceLoginRequest(BaseModel):
    device_uuid: str
    nrc_id: Optional[str] = None


class GoogleLoginRequest(BaseModel):
    google_sub: Optional[str] = None
    email: Optional[str] = None
    nickname: Optional[str] = None
    id_token: Optional[str] = None


class QuizVerifyRequest(BaseModel):
    user_id: str
    quiz_id: str
    selected_idx: int


class RewardExchangeRequest(BaseModel):
    user_id: str
    item_id: str


class LockscreenSettingsSchema(BaseModel):
    enabled: bool = True
    reward_prompt: bool = True


def now_iso() -> str:
    return datetime.datetime.utcnow().isoformat()


def make_coupon_code() -> str:
    token = "".join(choices(ascii_uppercase + digits, k=8))
    return f"NRCQ-{token[:4]}-{token[4:]}"


def verify_firebase_id_token(raw_token: str) -> dict:
    try:
        claims = firebase_auth.verify_id_token(raw_token)
    except Exception:
        raise HTTPException(status_code=401, detail="invalid firebase id token")
    if not claims.get("uid"):
        raise HTTPException(status_code=401, detail="firebase uid missing")
    return claims


def load_words():
    with open(WORDS_PATH, encoding="utf-8") as file:
        return json.load(file)


WORDS = load_words()


def quiz_mode_label(mode: str) -> str:
    return "영영 퀴즈" if mode == "eng" else "영한 퀴즈"


def answer_text(word: dict, mode: str) -> str:
    return word["english"] if mode == "eng" else word["korean"]


def build_word_quiz(word: dict, mode: str, quiz_date: str):
    if mode not in ("eng", "kor"):
        raise HTTPException(status_code=400, detail="invalid quiz mode")
    rng = random.Random(f"{quiz_date}:{mode}:{word['id']}")
    correct = answer_text(word, mode)
    distractors = [
        answer_text(entry, mode)
        for entry in WORDS
        if entry["id"] != word["id"] and answer_text(entry, mode) != correct
    ]
    options = [correct] + rng.sample(distractors, 3)
    rng.shuffle(options)
    return {
        "quiz_id": f"{mode}:{quiz_date}:{word['id']}",
        "word_id": word["id"],
        "unit": word.get("unit", 1),
        "word": word["word"],
        "part": word.get("part", ""),
        "question": word["word"],
        "options": options,
        "category": quiz_mode_label(mode),
        "level": max(1, min(5, (int(word.get("unit", 1)) + 5) // 6)),
        "explanation": correct,
        "english": word["english"],
        "korean": word["korean"],
        "_correct_idx": options.index(correct),
        "_mode": mode,
        "_date": quiz_date,
    }


def daily_word_quizzes(mode: str, quiz_date: str):
    if mode not in ("eng", "kor"):
        raise HTTPException(status_code=400, detail="invalid quiz mode")
    rng = random.Random(f"{quiz_date}:{mode}:daily")
    picked = rng.sample(WORDS, 10)
    return [build_word_quiz(word, mode, quiz_date) for word in picked]


def public_quiz(quiz: dict):
    return {key: value for key, value in quiz.items() if not key.startswith("_")}


def quiz_by_id(quiz_id: str):
    try:
        mode, quiz_date, raw_word_id = str(quiz_id).split(":")
        word_id = int(raw_word_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="quiz not found")
    word = next((entry for entry in WORDS if int(entry["id"]) == word_id), None)
    if not word:
        raise HTTPException(status_code=404, detail="quiz not found")
    return build_word_quiz(word, mode, quiz_date)


def reward_row_to_response(r):
    return {"item_id": r[0], "name": r[1], "price_points": r[2]}


def reward_by_id(item_id: str):
    return next((r for r in REWARD_ITEMS if r[0] == item_id), None)


def user_ref(user_id: str):
    return firestore_db.collection("users").document(user_id)


def find_one(collection: str, field: str, value):
    docs = firestore_db.collection(collection).where(field, "==", value).limit(1).stream()
    for doc in docs:
        data = doc.to_dict()
        data["_doc_id"] = doc.id
        return data
    return None


def create_user(device_uuid: str, auth_provider: str = "device", google_sub: Optional[str] = None, email: Optional[str] = None, nickname: Optional[str] = None, nrc_id: Optional[str] = None):
    user_id = str(uuid4())
    now = now_iso()
    user = {
        "user_id": user_id,
        "device_uuid": device_uuid,
        "nrc_id": nrc_id,
        "auth_provider": auth_provider,
        "google_sub": google_sub,
        "email": email,
        "nickname": nickname,
        "total_points": 1250,
        "created_at": now,
    }
    user_ref(user_id).set(user)
    firestore_db.collection("point_logs").add({"user_id": user_id, "amount": 1250, "reason": "signup_bonus", "created_at": now})
    firestore_db.collection("lockscreen_settings").document(user_id).set({"user_id": user_id, "enabled": True, "reward_prompt": True, "updated_at": now})
    return user


def auth_response(user):
    return {
        "access_token": f"dev-token-{user['user_id']}",
        "user_id": user["user_id"],
        "nickname": user.get("nickname"),
        "email": user.get("email"),
        "google_sub": user.get("google_sub"),
        "total_points": user.get("total_points", 0),
    }


@app.get("/health")
def health():
    return {"status": "ok", "time": now_iso(), "database": "firestore", "project_id": FIREBASE_PROJECT_ID}


@app.get("/")
def root():
    return {"service": "NRC Quiz API", "status": "ok", "database": "firestore", "health": "/health"}


@app.post("/v1/auth/device-login")
def device_login(payload: DeviceLoginRequest):
    user = find_one("users", "device_uuid", payload.device_uuid)
    if not user:
        user = create_user(device_uuid=payload.device_uuid, nrc_id=payload.nrc_id)
    return {"access_token": f"dev-token-{user['user_id']}", "user_id": user["user_id"], "total_points": user.get("total_points", 0)}


@app.post("/v1/auth/google-login")
def google_login(payload: GoogleLoginRequest):
    google_sub = payload.google_sub
    email = payload.email
    if payload.id_token:
        claims = verify_firebase_id_token(payload.id_token)
        google_sub = claims["uid"]
        email = claims.get("email") or email
    elif not ALLOW_UNVERIFIED_GOOGLE_LOGIN:
        raise HTTPException(status_code=401, detail="firebase id token required")
    if not google_sub:
        raise HTTPException(status_code=400, detail="google_sub required")

    user = find_one("users", "google_sub", google_sub)
    if user:
        return {**auth_response(user), "is_new_user": False}

    nickname = (payload.nickname or "").strip()
    if not nickname:
        raise HTTPException(status_code=409, detail="nickname required", headers={"X-NRC-Needs-Profile": "true"})

    user = create_user(device_uuid=f"google:{google_sub}", auth_provider="google", google_sub=google_sub, email=email, nickname=nickname)
    return {**auth_response(user), "is_new_user": True}


@app.get("/v1/quizzes/daily")
def daily_quizzes(mode: str = "kor"):
    today = datetime.date.today().isoformat()
    return [public_quiz(quiz) for quiz in daily_word_quizzes(mode, today)]


@app.post("/v1/quizzes/verify")
def verify_quiz(payload: QuizVerifyRequest):
    today = datetime.date.today().isoformat()
    now = now_iso()
    user_doc = user_ref(payload.user_id).get()
    if not user_doc.exists:
        raise HTTPException(status_code=404, detail="user not found")

    solved_count = sum(1 for _ in firestore_db.collection("solved_logs").where("user_id", "==", payload.user_id).where("solved_date", "==", today).stream())
    if solved_count >= 10:
        raise HTTPException(status_code=403, detail="daily quiz already completed")

    quiz = quiz_by_id(payload.quiz_id)
    if not quiz:
        raise HTTPException(status_code=404, detail="quiz not found")

    solved_id = f"{payload.user_id}_{payload.quiz_id}_{today}"
    if firestore_db.collection("solved_logs").document(solved_id).get().exists:
        raise HTTPException(status_code=403, detail="quiz already solved")

    user = user_doc.to_dict()
    is_correct = payload.selected_idx == quiz["_correct_idx"]
    earned = 10 + (quiz["level"] - 1) * 3 if is_correct else 2
    total_points = int(user.get("total_points", 0)) + earned
    user_ref(payload.user_id).update({"total_points": total_points})
    firestore_db.collection("solved_logs").document(solved_id).set({
        "user_id": payload.user_id,
        "quiz_id": payload.quiz_id,
        "mode": quiz["_mode"],
        "word_id": quiz["word_id"],
        "solved_date": today,
        "selected_idx": payload.selected_idx,
        "correct_idx": quiz["_correct_idx"],
        "is_correct": is_correct,
        "earned_points": earned,
        "created_at": now,
    })
    firestore_db.collection("point_logs").add({"user_id": payload.user_id, "amount": earned, "reason": "quiz", "ref_id": str(payload.quiz_id), "created_at": now})
    return {
        "is_correct": is_correct,
        "correct_idx": quiz["_correct_idx"],
        "earned_points": earned,
        "current_total_points": total_points,
        "daily_solved": solved_count + 1,
        "daily_completed": (solved_count + 1) >= 10,
        "explanation": quiz["explanation"],
        "english": quiz["english"],
        "korean": quiz["korean"],
    }


@app.get("/v1/rewards/items")
def reward_items():
    return [reward_row_to_response(r) for r in REWARD_ITEMS]


@app.post("/v1/rewards/exchange")
def exchange_reward(payload: RewardExchangeRequest):
    now = now_iso()
    user_doc = user_ref(payload.user_id).get()
    if not user_doc.exists:
        raise HTTPException(status_code=404, detail="user not found")

    user = user_doc.to_dict()
    item = reward_by_id(payload.item_id)
    if not item:
        raise HTTPException(status_code=404, detail="item not found")
    if int(user.get("total_points", 0)) < item[2]:
        raise HTTPException(status_code=400, detail="not enough points")

    coupon_id = str(uuid4())
    coupon_code = make_coupon_code()
    remaining = int(user.get("total_points", 0)) - item[2]
    coupon = {"coupon_id": coupon_id, "user_id": payload.user_id, "item_id": item[0], "name": item[1], "coupon_code": coupon_code, "status": "사용 가능", "issued_at": datetime.date.today().isoformat()}
    user_ref(payload.user_id).update({"total_points": remaining})
    firestore_db.collection("coupons").document(coupon_id).set(coupon)
    firestore_db.collection("point_logs").add({"user_id": payload.user_id, "amount": -item[2], "reason": "reward_exchange", "ref_id": coupon_id, "created_at": now})
    return {"coupon": {k: coupon[k] for k in ("coupon_id", "name", "coupon_code", "status", "issued_at")}, "remaining_points": remaining}


@app.get("/v1/coupons")
def get_coupons(user_id: str):
    docs = firestore_db.collection("coupons").where("user_id", "==", user_id).stream()
    coupons = [doc.to_dict() for doc in docs]
    coupons.sort(key=lambda c: c.get("issued_at", ""), reverse=True)
    return [{"coupon_id": c["coupon_id"], "name": c["name"], "coupon_code": c["coupon_code"], "status": c["status"], "issued_at": c["issued_at"]} for c in coupons]


@app.get("/v1/settings/lockscreen")
def get_lockscreen(user_id: str):
    setting = firestore_db.collection("lockscreen_settings").document(user_id).get()
    if not setting.exists:
        return LockscreenSettingsSchema()
    data = setting.to_dict()
    return LockscreenSettingsSchema(enabled=bool(data.get("enabled", True)), reward_prompt=bool(data.get("reward_prompt", True)))


@app.put("/v1/settings/lockscreen")
def update_lockscreen(user_id: str, settings: LockscreenSettingsSchema):
    if not user_ref(user_id).get().exists:
        raise HTTPException(status_code=404, detail="user not found")
    firestore_db.collection("lockscreen_settings").document(user_id).set({
        "user_id": user_id,
        "enabled": settings.enabled,
        "reward_prompt": settings.reward_prompt,
        "updated_at": now_iso(),
    }, merge=True)
    return settings
