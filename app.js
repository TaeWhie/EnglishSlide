// 로컬 환경과 배포 환경(Render)의 API 주소를 분기처리합니다.
// TODO: 배포 후 your-backend-service.onrender.com 부분을 실제 백엔드 주소로 변경하세요.
const API_BASE = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost"
  ? "http://127.0.0.1:8000/v1"
  : "https://nrc-backend-llgx.onrender.com/v1";

const todayKey = new Date().toISOString().slice(0, 10);
const savedDaily = JSON.parse(localStorage.getItem("nrc_daily_quiz") || "{}");
const initialDaily = savedDaily.date === todayKey ? savedDaily : { date: todayKey, solved: 0, current: 0, completed: false, answers: [] };
const savedProfile = JSON.parse(localStorage.getItem("nrc_user_profile") || "null");
let pendingGoogleUser = null;

const state = {
  incorrectWords: JSON.parse(localStorage.getItem("nrc_incorrect_words") || "[]"),
  quizMode: 'kor',
  user: savedProfile,
  points: savedProfile ? savedProfile.total_points || 0 : 0,
  coupons: [],
  lockscreen: { enabled: true, rewardPrompt: true },
  quizzes: [],
  shopItems: [],
  solved: initialDaily.solved,
  current: initialDaily.current,
  completed: initialDaily.completed,
  answers: Array.isArray(initialDaily.answers) ? initialDaily.answers : [],
  locked: false,
  timer: 15,
  timerId: null,
  totalRevenue: 1250400
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let loadingDepth = 0;

function showLoading(title = "처리 중", message = "서버와 통신하고 있습니다.") {
  const overlay = $("#loadingOverlay");
  if (!overlay) return;
  $("#loadingTitle").textContent = title;
  $("#loadingMessage").textContent = message;
  loadingDepth += 1;
  overlay.classList.remove("hidden");
}

function hideLoading() {
  const overlay = $("#loadingOverlay");
  if (!overlay) return;
  loadingDepth = Math.max(0, loadingDepth - 1);
  if (loadingDepth === 0) {
    overlay.classList.add("hidden");
  }
}

async function withLoading(title, message, task) {
  showLoading(title, message);
  try {
    return await task();
  } finally {
    hideLoading();
  }
}

function setButtonBusy(button, busy, label = "처리 중") {
  if (!button) return;
  if (busy) {
    button.dataset.idleText = button.textContent;
    button.textContent = label;
  } else if (button.dataset.idleText) {
    button.textContent = button.dataset.idleText;
    delete button.dataset.idleText;
  }
  button.disabled = busy;
  button.classList.toggle("is-loading", busy);
}

async function apiCall(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  try {
    const res = await fetch(`${API_BASE}${endpoint}`, options);
    if (!res.ok) {
      const error = await res.json().catch(() => ({ detail: 'API Error' }));
      throw new Error(error.detail || "API 오류가 발생했습니다.");
    }
    return await res.json();
  } catch (err) {
    console.error("API Call Error:", err);
    throw err;
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function updateStats() {
  $("#totalPoints").textContent = `${formatNumber(state.points)}P`;
  $("#quizSolved").textContent = state.solved;
  $("#topQuizStatus").textContent = state.completed ? "오늘 완료" : `${state.solved}/10 완료`;
  $("#topProgressFill").style.width = `${Math.min(100, state.solved * 10)}%`;
  updateProfileStats();
  updateGoalSummary();
  $("#todayRevenue").textContent = `${formatNumber(state.totalRevenue)}원`;
  localStorage.setItem("nrc_daily_quiz", JSON.stringify({
    date: todayKey,
    solved: state.solved,
    current: state.current,
    completed: state.completed,
    answers: state.answers
  }));
  updateQuizEntryState();
  renderCoupons();
  renderProfile();
}

function hasLogin() {
  return Boolean(state.user && (state.user.nickname || state.user.name));
}

function showLogin() {
  $("#loginView").classList.remove("hidden");
  $("#appShell").classList.add("hidden");
}

function showApp() {
  $("#loginView").classList.add("hidden");
  $("#appShell").classList.remove("hidden");
}

function renderProfile() {
  const name = $("#profileName");
  const avatar = $("#profileAvatar");
  if (!name || !avatar || !state.user) return;
  const nickname = state.user.nickname || state.user.name;
  if (!nickname) return;
  if (!state.user.nickname && nickname) {
    state.user.nickname = nickname;
    localStorage.setItem("nrc_user_profile", JSON.stringify(state.user));
  }
  name.textContent = `${nickname}님, 오늘도 학습 중`;
  avatar.textContent = nickname.slice(0, 2).toUpperCase();
}

function completeGoogleStep(googleUser) {
  setButtonBusy($("#googleLoginButton"), false);
  pendingGoogleUser = googleUser;
  $("#googleLoginButton").classList.add("hidden");
  $("#loginForm").classList.remove("hidden");
  $("#loginGuide").textContent = "Google 로그인 확인이 끝났습니다. 앱에서 사용할 닉네임을 만들어 주세요.";
  $("#loginName").focus();
}

function applyLoginResponse(res, googleUser) {
  state.user = {
    provider: "google",
    googleSub: res.google_sub || googleUser.googleSub,
    email: res.email || googleUser.email || "",
    nickname: res.nickname,
    user_id: res.user_id,
    access_token: res.access_token,
    total_points: res.total_points,
    loggedInAt: new Date().toISOString()
  };
  state.points = res.total_points;

  // 서버 기준 오늘 진행도로 동기화 (기존 계정 재로그인 시 복원)
  if (typeof res.daily_solved === "number") {
    state.solved = res.daily_solved;
    state.current = res.daily_solved;
    state.completed = Boolean(res.daily_completed);
    localStorage.setItem("nrc_daily_quiz", JSON.stringify({
      date: todayKey,
      solved: state.solved,
      current: state.current,
      completed: state.completed,
      answers: state.answers
    }));
  }

  localStorage.setItem("nrc_user_profile", JSON.stringify(state.user));
  pendingGoogleUser = null;
  $("#googleLoginButton").classList.remove("hidden");
  $("#loginForm").classList.add("hidden");
  $("#loginName").value = "";
  showApp();
  renderProfile();
  updateStats();
}

async function loginWithGoogleUser(googleUser, nickname = "") {
  const res = await fetch(`${API_BASE}/auth/google-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      google_sub: googleUser.googleSub,
      email: googleUser.email || "",
      nickname,
      id_token: googleUser.idToken || googleUser.id_token || ""
    })
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: "API Error" }));
    const apiError = new Error(error.detail || "Google login failed.");
    apiError.status = res.status;
    apiError.detail = error.detail;
    throw apiError;
  }
  return res.json();
}

async function continueGoogleLogin(googleUser) {
  setButtonBusy($("#googleLoginButton"), true, "로그인 중");
  try {
    const res = await withLoading(
      "로그인 중",
      "DB에 저장된 계정 정보를 확인하고 있습니다.",
      () => loginWithGoogleUser(googleUser)
    );
    applyLoginResponse(res, googleUser);
    showToast("로그인되었습니다.");
  } catch (err) {
    if (err.status === 409 && err.detail === "nickname required") {
      completeGoogleStep(googleUser);
      return;
    }
    setButtonBusy($("#googleLoginButton"), false);
    showToast(err.message || "로그인 처리 중 오류가 발생했습니다.");
  }
}

function normalizeNativeGooglePayload(payload) {
  if (!payload) return null;
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }
  return payload;
}

window.onNativeGoogleSignIn = (payload) => {
  const googleUser = normalizeNativeGooglePayload(payload);
  if (!googleUser || googleUser.status === "pending") return;
  setButtonBusy($("#googleLoginButton"), false);
  if (googleUser.status === "unconfigured") {
    showToast(googleUser.message || "Google Client ID is not configured.");
    return;
  }
  if (!googleUser.googleSub && !googleUser.idToken && !googleUser.id_token) {
    showToast("Google 로그인 정보를 확인하지 못했습니다.");
    return;
  }
  continueGoogleLogin(googleUser);
};

window.onNativeGoogleSignInError = (message) => {
  setButtonBusy($("#googleLoginButton"), false);
  showToast(message || "Google 로그인에 실패했습니다.");
};

function updateProfileStats() {
  const quizState = $("#profileQuizState");
  const couponCount = $("#profileCouponCount");
  const profilePoints = $("#profilePoints");
  if (!quizState || !couponCount || !profilePoints) return;
  quizState.textContent = state.completed ? "완료" : `${state.solved}/10`;
  couponCount.textContent = `${state.coupons.length}개`;
  profilePoints.textContent = `${formatNumber(state.points)}P`;
}

async function saveLockscreenSettings() {
  if (!state.user) return;
  syncNativeLockscreenSettings();
  try {
    await apiCall(`/settings/lockscreen?user_id=${state.user.user_id}`, 'PUT', state.lockscreen);
  } catch (err) {
    console.error(err);
  }
}

function syncNativeLockscreenSettings() {
  if (window.NRCBridge?.updateLockscreenSettings) {
    const rewardPrompt = state.lockscreen.reward_prompt ?? state.lockscreen.rewardPrompt ?? true;
    window.NRCBridge.updateLockscreenSettings(Boolean(state.lockscreen.enabled), Boolean(rewardPrompt));
  }
}

function updateGoalSummary() {
  if (state.shopItems.length === 0) return;
  const nextItem = state.shopItems.find((item) => item.price_points > state.points) || state.shopItems[state.shopItems.length - 1];
  const remain = Math.max(0, nextItem.price_points - state.points);
  $("#nextGoal").textContent = nextItem.name;
  $("#goalRemain").textContent = remain === 0 ? "교환 가능" : `${formatNumber(remain)}P 남음`;
}

function updateQuizEntryState() {
  const startButton = $("#startQuiz");
  if (!startButton) return;
  startButton.disabled = false;
  startButton.textContent = "도전하기 (무제한)";
  startButton.classList.remove("disabled");
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.add("hidden"), 2600);
}

function switchView(viewId) {
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === viewId));
  if (viewId === "quizView") {
    renderQuiz();
  } else if (viewId === "reportView") {
    renderCoupons();
    renderLockscreenSettings();
    clearInterval(state.timerId);
    state.locked = false;
  } else {
    clearInterval(state.timerId);
    state.locked = false;
  }
}

function syncRoute(viewId) {
  const routeMap = {
    homeView: "home",
    quizView: "quiz",
    shopView: "shop",
    reportView: "profile"
  };
  const nextHash = routeMap[viewId] || "home";
  if (location.hash.slice(1) !== nextHash) {
    history.replaceState(null, "", `#${nextHash}`);
  }
}

function routeFromHash() {
  const viewMap = {
    home: "homeView",
    quiz: "quizView",
    shop: "shopView",
    profile: "reportView"
  };
  return viewMap[location.hash.slice(1)] || "homeView";
}
  startButton.classList.remove("disabled");
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.add("hidden"), 2600);
}

function switchView(viewId) {
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === viewId));
  if (viewId === "quizView") {
    renderQuiz();
  } else if (viewId === "reportView") {
    renderCoupons();
    renderLockscreenSettings();
    renderIncorrectWords();
    clearInterval(state.timerId);
    state.locked = false;
  } else {
    clearInterval(state.timerId);
    state.locked = false;
  }
}

function syncRoute(viewId) {
  const routeMap = {
    homeView: "home",
    quizView: "quiz",
    shopView: "shop",
    reportView: "profile"
  };
  const nextHash = routeMap[viewId] || "home";
  if (location.hash.slice(1) !== nextHash) {
    history.replaceState(null, "", `#${nextHash}`);
  }
}

function routeFromHash() {
  const viewMap = {
    home: "homeView",
    quiz: "quizView",
    shop: "shopView",
    profile: "reportView"
  };
  return viewMap[location.hash.slice(1)] || "homeView";
}

function startTimer() {
  clearInterval(state.timerId);
  state.timer = 15;
  $("#timer").textContent = state.timer;
  $("#timer").classList.remove("warning");
  $("#quizProgress").style.width = "100%";
  state.timerId = setInterval(() => {
    state.timer -= 1;
    $("#timer").textContent = state.timer;
    $("#timer").classList.toggle("warning", state.timer < 5);
    $("#quizProgress").style.width = `${Math.max(0, (state.timer / 15) * 100)}%`;
    if (state.timer <= 0) {
      clearInterval(state.timerId);
      verifyAnswer(-1);
    }
  }, 1000);
}

async function renderQuiz() {
  // 1. 결과 화면 (10문제 완료 시)
  if (state.completed && state.answers.length % 10 === 0 && state.answers.length > 0) {
    clearInterval(state.timerId);
    $("#quizHead").classList.add("hidden");
    $("#quizProgressWrap").classList.add("hidden");
    $("#quizModeSelect")?.classList.add("hidden");
    $("#optionList").innerHTML = "";
    $("#quizFeedback").classList.add("hidden");
    $("#quizComplete").classList.remove("hidden");
    renderReview();
    $("#reviewPanel").classList.remove("hidden");
    updateStats();
    return;
  }

  // 2. 모드 선택 화면 (퀴즈가 로드되지 않았을 때)
  if (!state.quizzes || state.quizzes.length === 0) {
    $("#quizHead").classList.add("hidden");
    $("#quizProgressWrap").classList.add("hidden");
    $("#quizComplete").classList.add("hidden");
    $("#reviewPanel").classList.add("hidden");
    $("#quizModeSelect")?.classList.remove("hidden");
    return;
  }

  // 3. 실제 퀴즈 진행 화면
  $("#quizModeSelect")?.classList.add("hidden");
  $("#quizComplete").classList.add("hidden");
  $("#reviewPanel").classList.add("hidden");

  const quiz = state.quizzes[state.current % state.quizzes.length];
  if (!quiz) return;

  $("#quizHead").classList.remove("hidden");
  $("#quizProgressWrap").classList.remove("hidden");
  $("#quizCategory").textContent = `${quiz.category} · Level ${quiz.level}`;
  $("#quizQuestion").textContent = quiz.question;
  $("#quizFeedback").classList.add("hidden");
  $("#optionList").innerHTML = (quiz.options || [])
    .map((option, index) => `<button class="option-button" type="button" data-index="${index}">${String.fromCharCode(65 + index)}. ${option}</button>`)
    .join("");
    
  $(".option-button").forEach((button) => {
    button.addEventListener("click", () => verifyAnswer(Number(button.dataset.index)));
  });
  startTimer();
}

async function verifyAnswer(selectedIndex) {
  if (state.locked) return;
  if (!state.quizzes.length) return;
  
  state.locked = true;
  clearInterval(state.timerId);
  $$(".option-button").forEach((button) => button.disabled = true);

  const quiz = state.quizzes[state.current % state.quizzes.length];
  if (!quiz) {
    state.locked = false;
    return;
  }

  const selectedAnswer = selectedIndex >= 0 ? (quiz.options ? quiz.options[selectedIndex] : "알 수 없음") : "시간 초과";
  
  try {
    let res;
    if (state.quizMode === 'incorrect') {
      res = {
        is_correct: selectedIndex === quiz._correct_idx,
        correct_idx: quiz._correct_idx,
        explanation: quiz.explanation || "",
        current_total_points: state.points,
        daily_solved: state.solved,
        daily_completed: false
      };
    } else {
      res = await withLoading(
        "채점 중",
        "정답 여부를 확인하고 있습니다.",
        () => apiCall('/quizzes/verify', 'POST', {
          user_id: state.user?.user_id || "",
          quiz_id: quiz.quiz_id,
          selected_idx: selectedIndex
        })
      );
    }

    const isCorrect = res.is_correct;
    state.points = res.current_total_points;
    state.solved = res.daily_solved;
    state.completed = res.daily_completed;

    const existingAnswer = state.answers.find((answer) => answer.quizIndex === state.current);
    if (!existingAnswer) {
      state.answers.push({
        quizIndex: state.current,
        question: quiz.question,
        selected: selectedAnswer,
        correct: quiz.options ? quiz.options[res.correct_idx] : "",
        isCorrect,
        explanation: res.explanation,
        category: quiz.category
      });
    }

    $$(".option-button").forEach((button) => {
      const index = Number(button.dataset.index);
      if (index === res.correct_idx) button.classList.add("correct");
      if (index === selectedIndex && !isCorrect) {
        button.classList.add("wrong");
        saveIncorrectWord(quiz);
      }
    });

    $("#quizFeedback").innerHTML = `
      <strong>${isCorrect ? "정답입니다" : "아쉬워요"}</strong>
      <p>${res.explanation}</p>
      <button id="nextQuizButton" class="action-button compact" type="button">다음 문제</button>
    `;
    $("#quizFeedback").classList.remove("hidden");
    $("#nextQuizButton").addEventListener("click", () => {
      nextQuiz();
    });

    updateStats();
  } catch (err) {
    state.locked = false;
    $$(".option-button").forEach((button) => button.disabled = false);
    showToast(err.message || "채점 중 오류가 발생했습니다.");
  }
}

function nextQuiz() {
  if (state.quizzes.length > 0) {
    state.current = (state.current + 1) % state.quizzes.length;
  }
  state.locked = false;
  renderQuiz();
}

function startNextSet() {
  state.quizzes = []; // 새 세트를 위해 초기화
  state.completed = false;
  state.answers = [];
  state.current = 0;
  switchView("quizView");
  renderQuiz();
}

async function claimReward() {
  if (!state.user) return;
  try {
    const res = await withLoading(
      "리워드 신청 중",
      "광고 확인 및 포인트 적립을 진행합니다.",
      () => apiCall('/quizzes/reward', 'POST', {
        user_id: state.user.user_id,
        ad_token: "ad_sim_" + Date.now()
      })
    );
    
    state.points = res.current_total_points;
    updateStats();
    
    if (res.reward_points > 0) {
      showToast(`축하합니다! ${res.reward_points}P가 적립되었습니다.`);
    } else if (res.already_claimed) {
      showToast("오늘의 최대 리워드 한도(100P)에 도달했습니다. 학습은 계속 하실 수 있습니다!");
    } else {
      showToast("아쉽게도 이번 세트에서는 획득한 포인트가 없습니다.");
    }
    
    renderReview();
  } catch (err) {
    showToast(err.message || "리워드 처리 중 오류가 발생했습니다.");
  }
}
  state.current = (state.current + 1) % state.quizzes.length;
  state.locked = false;
  renderQuiz();
}

async function renderShop() {
  if (state.shopItems.length === 0) {
    try {
      state.shopItems = await withLoading(
        "상점 로딩 중",
        "교환 목록을 불러오고 있습니다.",
        () => apiCall('/rewards/items')
      );
    } catch (e) {
      showToast("상점 목록을 불러오지 못했습니다.");
      return;
    }
  }

  $("#shopList").innerHTML = state.shopItems
    .map(
      (item) => `
        <article class="shop-item">
          <div class="visual">🎁</div>
          <strong>${item.name}</strong>
          <p>금액권 교환</p>
          <p><b>${formatNumber(item.price_points)}P</b></p>
          <button type="button" data-item="${item.item_id}">교환하기</button>
        </article>
      `
    )
    .join("");

  $$("#shopList button").forEach((button) => {
    button.addEventListener("click", () => exchangeItem(button.dataset.item));
  });
}

async function exchangeItem(itemId) {
  const item = state.shopItems.find((entry) => entry.item_id === itemId);
  if (!item) return;
  if (state.points < item.price_points) {
    showToast("보유 포인트가 부족합니다.");
    return;
  }
  
  try {
    const res = await withLoading(
      "교환 처리 중",
      "쿠폰을 발급하고 있습니다.",
      () => apiCall('/rewards/exchange', 'POST', {
        user_id: state.user.user_id,
        item_id: itemId
      })
    );
    
    state.points = res.remaining_points;
    state.coupons.unshift(res.coupon);
    
    updateStats();
    showToast(`${res.coupon.name} 교환 완료. 마이페이지 쿠폰함에서 확인할 수 있습니다.`);
  } catch (err) {
    showToast(err.message || "교환 처리 중 오류가 발생했습니다.");
  }
}

async function renderCoupons() {
  const list = $("#couponList");
  const count = $("#couponCount");
  if (!list || !count) return;

  if (state.user) {
    try {
      state.coupons = await apiCall(`/coupons?user_id=${state.user.user_id}`);
    } catch (e) {}
  }

  count.textContent = `${state.coupons.length}개`;
  if (!state.coupons.length) {
    list.innerHTML = `<div class="empty-state">아직 교환한 금액권이 없습니다.</div>`;
    return;
  }
  list.innerHTML = state.coupons.map((coupon) => `
    <article class="coupon-card">
      <div>
        <strong>${coupon.name}</strong>
        <p>${coupon.issuedAt || coupon.issued_at} 발급 · ${coupon.status}</p>
      </div>
      <code>${coupon.coupon_code || coupon.code}</code>
    </article>
  `).join("");
}

function renderReview() {
  const panel = $("#reviewPanel");
  const list = $("#reviewList");
  const score = $("#reviewScore");
  if (!panel || !list || !score) return;

  const correctCount = state.answers.filter((answer) => answer.isCorrect).length;
  score.textContent = `${correctCount}/${state.answers.length || 10}`;

  if (!state.answers.length) {
    list.innerHTML = `<div class="empty-state">오늘 풀이 기록이 없습니다.</div>`;
    return;
  }

  list.innerHTML = state.answers.map((answer, index) => `
    <article class="review-card ${answer.isCorrect ? "correct" : "wrong"}">
      <div class="review-mark">${answer.isCorrect ? "정답" : "오답"}</div>
      <div>
        <strong>${index + 1}. ${answer.question}</strong>
        <p>내 답: <b>${answer.selected}</b></p>
        <p>정답: <b>${answer.correct}</b></p>
        <small>${answer.explanation}</small>
      </div>
    </article>
  `).join("");
}

async function renderLockscreenSettings() {
  const enabled = $("#lockscreenEnabled");
  const reward = $("#lockscreenReward");
  if (!enabled || !reward) return;

  if (state.user) {
    try {
      state.lockscreen = await apiCall(`/settings/lockscreen?user_id=${state.user.user_id}`);
    } catch (e) {}
  }

  enabled.checked = state.lockscreen.enabled;
  reward.checked = state.lockscreen.reward_prompt ?? state.lockscreen.rewardPrompt ?? true;
  syncNativeLockscreenSettings();
}

function bindEvents() {
  $("#loginForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const nickname = $("#loginNickname").value.trim();
    if (!pendingGoogleUser) {
      showToast("Google 로그인부터 진행해 주세요.");
      return;
    }
    if (!nickname) {
      showToast("닉네임을 입력해 주세요.");
      return;
    }
    
    const submitButton = event.submitter || $("#loginForm button[type='submit']");
    setButtonBusy(submitButton, true, "로그인 중");
    try {
      const res = await withLoading("로그인 중", "계정 정보를 확인하고 있습니다.", () => loginWithGoogleUser(pendingGoogleUser, nickname));
      applyLoginResponse(res, pendingGoogleUser);
      showToast("로그인되었습니다.");
    } catch (err) {
      showToast(err.message || "로그인 처리 중 오류가 발생했습니다.");
    } finally {
      setButtonBusy(submitButton, false);
    }
  });

  $("#logoutButton")?.addEventListener("click", () => {
    if (window.NRCBridge?.signOut) window.NRCBridge.signOut();
    localStorage.removeItem("nrc_user_profile");
    localStorage.removeItem("nrc_daily_quiz");
    state.user = null;
    showLogin();
    showToast("로그아웃되었습니다.");
  });

  $$(".nav-item").forEach((item) => item.addEventListener("click", () => {
    const targetView = item.dataset.view;
    if (targetView === "quizView") {
      state.quizzes = [];
      clearInterval(state.timerId);
      state.locked = false;
    }
    switchView(targetView);
    syncRoute(targetView);
  }));

  // 홈 화면 모드 선택 버튼
  $("#startQuizMixed")?.addEventListener("click", () => {
    state.quizMode = 'mixed';
    state.quizzes = [];
    switchView("quizView");
  });
  $("#startQuizKor")?.addEventListener("click", () => {
    state.quizMode = 'kor';
    state.quizzes = [];
    switchView("quizView");
  });
  $("#startQuizEng")?.addEventListener("click", () => {
    state.quizMode = 'eng';
    state.quizzes = [];
    switchView("quizView");
  });

  // 퀴즈 탭 내부 모드 선택 버튼
  $(".mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.quizMode = btn.dataset.mode;
      fetchQuizzesAndStart();
    });
  });

  $("#lockscreenEnabled")?.addEventListener("change", (event) => {
    state.lockscreen.enabled = event.target.checked;
    saveLockscreenSettings();
    showToast(state.lockscreen.enabled ? "잠금화면 퀴즈가 켜졌습니다." : "잠금화면 퀴즈가 꺼졌습니다.");
  });

  $("#lockscreenReward")?.addEventListener("change", (event) => {
    state.lockscreen.rewardPrompt = event.target.checked;
    saveLockscreenSettings();
    showToast(state.lockscreen.rewardPrompt ? "보상 안내가 켜졌습니다." : "보상 안내가 꺼졌습니다.");
  });

  $("#claimRewardButton")?.addEventListener("click", claimReward);
  $("#startNextSetButton")?.addEventListener("click", startNextSet);
  $("#startIncorrectQuiz")?.addEventListener("click", startIncorrectQuiz);

  window.addEventListener("hashchange", () => switchView(routeFromHash()));
}



function saveIncorrectWord(quiz) {
  if (!state.incorrectWords.some(w => w.word === quiz.word)) {
    state.incorrectWords.push({
      word: quiz.word,
      korean: quiz.korean,
      english: quiz.english,
      category: quiz.category,
      level: quiz.level
    });
    localStorage.setItem("nrc_incorrect_words", JSON.stringify(state.incorrectWords));
  }
}

function renderIncorrectWords() {
  const container = $("#incorrectWordList");
  if (!container) return;
  if (state.incorrectWords.length === 0) {
    container.innerHTML = '<p class="empty-msg" style="text-align: center; color: var(--muted); padding: 20px 0;">틀린 단어가 아직 없습니다.</p>';
    return;
  }
  container.innerHTML = state.incorrectWords.map(w => `
    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #f0f0f0; padding: 10px 4px;">
      <strong style="color: var(--ink);">${w.word}</strong>
      <span style="color: var(--muted);">${w.korean}</span>
    </div>
  `).join("");
}

function startIncorrectQuiz() {
  if (state.incorrectWords.length < 4) {
    showToast("오답 퀴즈를 풀려면 최소 4개의 틀린 단어가 필요합니다.");
    return;
  }
  const picked = [...state.incorrectWords].sort(() => 0.5 - Math.random()).slice(0, 10);
  state.quizzes = picked.map(w => {
    const distractors = state.incorrectWords
      .filter(dw => dw.word !== w.word)
      .sort(() => 0.5 - Math.random())
      .slice(0, 3)
      .map(dw => dw.korean);
    while(distractors.length < 3) distractors.push("해당 없음");
    const options = [w.korean, ...distractors].sort(() => 0.5 - Math.random());
    return {
      quiz_id: "incorrect_" + w.word,
      word: w.word,
      question: w.word,
      options: options,
      category: "오답 복습",
      level: w.level || 1,
      explanation: w.korean,
      _correct_idx: options.indexOf(w.korean)
    };
  });
  state.quizMode = 'incorrect';
  state.completed = false;
  state.current = 0;
  state.answers = [];
  switchView("quizView");
  renderQuiz();
}

async function fetchQuizzesAndStart() {
  try {
    state.quizzes = await withLoading(
      "퀴즈 로딩 중",
      "문제를 생성하고 있습니다.",
      () => apiCall(`/quizzes/daily?mode=${state.quizMode}`)
    );
    state.completed = false;
    state.current = 0;
    state.answers = [];
    renderQuiz();
  } catch (e) {
    showToast("퀴즈를 불러오지 못했습니다.");
  }
}

async function init() {
  bindEvents();
  if (hasLogin()) {
    showApp();
    await Promise.all([
      renderShop(),
      renderCoupons(),
      renderLockscreenSettings()
    ]);
    switchView(routeFromHash());
  } else {
    showLogin();
    renderShop();
  }
  updateStats();

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      showToast("오프라인 캐시 등록은 HTTPS 환경에서 활성화됩니다.");
    });
  }
}

init();
