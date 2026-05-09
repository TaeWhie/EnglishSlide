// 로컬 환경과 배포 환경(Render)의 API 주소를 분기처리합니다.
// TODO: 배포 후 your-backend-service.onrender.com 부분을 실제 백엔드 주소로 변경하세요.
const API_BASE = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost"
  ? "http://127.0.0.1:8000/v1"
  : "https://nrc-backend-llgx.onrender.com/v1";

const todayKey = new Date().toISOString().slice(0, 10);
const quizSessionKey = "nrc_active_quiz_session";
const savedDaily = JSON.parse(localStorage.getItem("nrc_daily_quiz") || "{}");
const initialDaily = savedDaily.date === todayKey ? savedDaily : { date: todayKey, solved: 0, current: 0, completed: false, answers: [], modeCounts: null };
const savedProfile = JSON.parse(localStorage.getItem("nrc_user_profile") || "null");
let pendingGoogleUser = null;

function createEmptyModeCounts() {
  return { eng: 0, kor: 0, mixed: 0, incorrect: 0 };
}

function normalizeModeCounts(rawCounts, fallbackSolved = 0) {
  const counts = createEmptyModeCounts();
  if (rawCounts && typeof rawCounts === "object") {
    for (const key of Object.keys(counts)) {
      const value = Number(rawCounts[key] || 0);
      counts[key] = Number.isFinite(value) && value > 0 ? value : 0;
    }
  } else if (fallbackSolved > 0) {
    counts.mixed = fallbackSolved;
  }
  return counts;
}

const state = {
  incorrectWords: JSON.parse(localStorage.getItem("nrc_incorrect_words") || "[]"),
  quizMode: "mixed",
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
  modeCounts: normalizeModeCounts(initialDaily.modeCounts, initialDaily.solved),
  rewardStatus: { remaining: 1000, cap: 1000, earned: 0 },
  studyBook: "default",
  studyWords: [],
  studySearch: "",
  locked: false,
  timer: 15,
  timerId: null,
  questionDeadline: null,
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

function getSolvedBreakdownText() {
  const labels = [
    ["eng", "영영"],
    ["kor", "영한"],
    ["mixed", "오늘의 퀴즈"],
    ["incorrect", "오답"]
  ];
  const parts = labels
    .map(([key, label]) => {
      const count = Number(state.modeCounts?.[key] || 0);
      return count > 0 ? `${label} ${count}` : "";
    })
    .filter(Boolean);
  return parts.length ? parts.join(" · ") : "아직 푼 문제가 없습니다.";
}

function renderRewardAvailability() {
  const pointsNode = $("#rewardAvailablePoints");
  const metaNode = $("#rewardAvailableMeta");
  if (!pointsNode || !metaNode) return;

  const remaining = Number(state.rewardStatus?.remaining || 0);
  const earned = Number(state.rewardStatus?.earned || 0);
  pointsNode.textContent = `${formatNumber(remaining)}P`;
  metaNode.textContent = earned > 0
    ? `오늘 ${formatNumber(earned)}P 적립, 추가로 ${formatNumber(remaining)}P 가능`
    : "보상 퀴즈 기준 남은 적립 가능 포인트";
}

async function loadStudyWords() {
  if (state.studyWords.length) return state.studyWords;
  const words = await fetch("./data/words.json").then((res) => {
    if (!res.ok) throw new Error("단어장을 불러오지 못했습니다.");
    return res.json();
  });
  state.studyWords = Array.isArray(words) ? words : [];
  return state.studyWords;
}

function getFilteredStudyWords() {
  const query = state.studySearch.trim().toLowerCase();
  if (!query) return state.studyWords;
  return state.studyWords.filter((item) => {
    return [item.word, item.korean, item.english, item.part]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
}

function renderStudyView() {
  const unitList = $("#studyUnitList");
  const wordCount = $("#studyWordCount");
  const unitCount = $("#studyUnitCount");
  const searchMeta = $("#studySearchMeta");
  if (!unitList || !wordCount || !unitCount || !searchMeta) return;

  const filteredWords = getFilteredStudyWords();
  const grouped = filteredWords.reduce((map, item) => {
    const unit = Number(item.unit || 0);
    if (!map.has(unit)) map.set(unit, []);
    map.get(unit).push(item);
    return map;
  }, new Map());

  const sortedUnits = [...grouped.entries()].sort((a, b) => a[0] - b[0]);
  wordCount.textContent = `${formatNumber(filteredWords.length)}개`;
  unitCount.textContent = `${formatNumber(sortedUnits.length)}개`;
  searchMeta.textContent = state.studySearch.trim()
    ? `${formatNumber(filteredWords.length)}개 단어가 검색되었습니다.`
    : `기본 단어장 ${formatNumber(state.studyWords.length)}개 단어를 유닛별로 볼 수 있습니다.`;

  if (!filteredWords.length) {
    unitList.innerHTML = `<div class="empty-state">검색 결과가 없습니다.</div>`;
    return;
  }

  unitList.innerHTML = sortedUnits.map(([unit, words]) => `
    <article class="study-unit-card">
      <div class="study-unit-head">
        <div>
          <p class="eyebrow">Unit ${unit}</p>
          <h3>${formatNumber(words.length)}개 단어</h3>
        </div>
        <span class="study-unit-badge">${formatNumber(words.length)} words</span>
      </div>
      <div class="study-word-list">
        ${words.map((word) => `
          <div class="study-word-card">
            <div class="study-word-top">
              <strong>${word.word}</strong>
              <span>${word.part || ""}</span>
            </div>
            <p class="study-word-korean">${word.korean || ""}</p>
            <p class="study-word-english">${word.english || ""}</p>
          </div>
        `).join("")}
      </div>
    </article>
  `).join("");
}

async function ensureStudyView() {
  try {
    await loadStudyWords();
    renderStudyView();
  } catch (err) {
    const unitList = $("#studyUnitList");
    const searchMeta = $("#studySearchMeta");
    if (searchMeta) searchMeta.textContent = err.message || "단어장을 불러오지 못했습니다.";
    if (unitList) {
      unitList.innerHTML = `<div class="empty-state">단어장을 불러오지 못했습니다.</div>`;
    }
  }
}

async function refreshRewardStatus() {
  if (!state.user?.user_id) {
    state.rewardStatus = { remaining: 1000, cap: 1000, earned: 0 };
    renderRewardAvailability();
    return;
  }

  try {
    const status = await apiCall(`/quizzes/reward-status?user_id=${encodeURIComponent(state.user.user_id)}`);
    state.rewardStatus = {
      remaining: Number(status.remaining_reward_points || 0),
      cap: Number(status.daily_reward_cap || 1000),
      earned: Number(status.daily_total_earned || 0)
    };
  } catch (err) {
    state.rewardStatus = { remaining: 0, cap: 1000, earned: 0 };
  }

  renderRewardAvailability();
}

function updateStats() {
  $("#totalPoints").textContent = `${formatNumber(state.points)}P`;
  const totalSolvedToday = Object.values(state.modeCounts || {}).reduce((sum, count) => sum + Number(count || 0), 0);
  $("#quizSolved").textContent = totalSolvedToday;
  $("#quizSolvedBreakdown").textContent = getSolvedBreakdownText();
  $("#topQuizStatus").textContent = totalSolvedToday > 0 ? `${totalSolvedToday}문제 학습` : "아직 시작 전";
  $("#topProgressFill").style.width = `${Math.min(100, totalSolvedToday * 5)}%`;
  updateProfileStats();
  updateGoalSummary();
  renderRewardAvailability();
  $("#todayRevenue").textContent = `${formatNumber(state.totalRevenue)}원`;
  localStorage.setItem("nrc_daily_quiz", JSON.stringify({
    date: todayKey,
    solved: state.solved,
    current: state.current,
    completed: state.completed,
    answers: state.answers,
    modeCounts: state.modeCounts
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
  const totalSolvedToday = Object.values(state.modeCounts || {}).reduce((sum, count) => sum + Number(count || 0), 0);
  quizState.textContent = `${totalSolvedToday}문제`;
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

function updateCurrentTabTitle(viewId) {
  const title = $("#currentTabTitle");
  if (!title) return;
  const labels = {
    homeView: "\uD648",
    quizView: "\uD034\uC988",
    studyView: "\uD559\uC2B5",
    shopView: "\uC0C1\uC810",
    reportView: "\uB9C8\uC774"
  };
  title.textContent = labels[viewId] || "\uD648";
}

function switchView(viewId) {
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === viewId));
  updateCurrentTabTitle(viewId);
  if (viewId === "quizView") {
    renderQuiz();
  } else if (viewId === "studyView") {
    ensureStudyView();
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
    studyView: "study",
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
    study: "studyView",
    shop: "shopView",
    profile: "reportView"
  };
  return viewMap[location.hash.slice(1)] || "homeView";
}

function startTimer() {
  clearInterval(state.timerId);
  if (!state.questionDeadline) state.questionDeadline = Date.now() + 15000;
  state.timer = Math.max(0, Math.ceil((state.questionDeadline - Date.now()) / 1000));
  $("#timer").textContent = state.timer;
  $("#timer").classList.toggle("warning", state.timer < 5);
  $("#quizProgress").style.width = `${Math.max(0, (state.timer / 15) * 100)}%`;
  if (state.timer <= 0) {
    verifyAnswer(-1);
    return;
  }
  saveQuizSession();
  state.timerId = setInterval(() => {
    state.timer = Math.max(0, Math.ceil((state.questionDeadline - Date.now()) / 1000));
    $("#timer").textContent = state.timer;
    $("#timer").classList.toggle("warning", state.timer < 5);
    $("#quizProgress").style.width = `${Math.max(0, (state.timer / 15) * 100)}%`;
    if (state.timer <= 0) {
      clearInterval(state.timerId);
      verifyAnswer(-1);
    }
  }, 1000);
}

function restoreQuizSession() {
  const saved = JSON.parse(localStorage.getItem(quizSessionKey) || "null");
  if (!saved || saved.date !== todayKey || !Array.isArray(saved.quizzes) || saved.quizzes.length === 0) return;
  if (Array.isArray(saved.answers) && saved.answers.length >= 10 && !saved.completed) return;
  state.quizMode = saved.quizMode || state.quizMode;
  state.quizzes = saved.quizzes;
  state.current = Number(saved.current || 0);
  state.completed = Boolean(saved.completed);
  state.answers = Array.isArray(saved.answers) ? saved.answers : [];
  state.questionDeadline = saved.questionDeadline || null;
}

function saveQuizSession() {
  if (!Array.isArray(state.quizzes) || state.quizzes.length === 0) return;
  localStorage.setItem(quizSessionKey, JSON.stringify({
    date: todayKey,
    quizMode: state.quizMode,
    quizzes: state.quizzes,
    current: state.current,
    completed: state.completed,
    answers: state.answers,
    questionDeadline: state.questionDeadline
  }));
}

function clearQuizSession() {
  localStorage.removeItem(quizSessionKey);
}

function advancePastAnsweredQuestion() {
  if (!state.quizzes.length || !state.answers.length || state.answers.length >= 10) return;
  const answered = new Set(state.answers.map((answer) => Number(answer.quizIndex)));
  let guard = 0;
  const initialCurrent = state.current;
  while (answered.has(state.current) && guard < state.quizzes.length) {
    state.current = (state.current + 1) % state.quizzes.length;
    guard += 1;
  }
  if (state.current !== initialCurrent) state.questionDeadline = null;
  saveQuizSession();
}

function resumeOrOpenQuiz() {
  if (state.quizzes.length) {
    switchView("quizView");
    syncRoute("quizView");
  } else {
    openQuizModeSelect();
  }
}

async function renderQuiz() {
  if (state.quizzes.length === 0) {
    $("#quizModeSelect")?.classList.remove("hidden");
    $("#quizHead").classList.add("hidden");
    $("#quizProgressWrap").classList.add("hidden");
    $("#quizComplete").classList.add("hidden");
    $("#reviewPanel").classList.add("hidden");
    $("#quizFeedback").classList.add("hidden");
    $("#optionList").innerHTML = "";
    return;
  }

  if (state.answers.length >= 10) {
    state.completed = true;
    saveQuizSession();
    clearInterval(state.timerId);
    $("#quizModeSelect")?.classList.add("hidden");
    $("#quizHead").classList.add("hidden");
    $("#quizProgressWrap").classList.add("hidden");
    $("#optionList").innerHTML = "";
    $("#quizFeedback").classList.add("hidden");
    $("#quizComplete").classList.remove("hidden");
    await updateRewardControls();
    renderReview();
    $("#reviewPanel").classList.remove("hidden");
    updateStats();
    return;
  }

  if (false) { // 무제한 풀기 허용
    state.completed = true;
    clearInterval(state.timerId);
    $("#quizHead").classList.add("hidden");
    $("#quizProgressWrap").classList.add("hidden");
    $("#optionList").innerHTML = "";
    $("#quizFeedback").classList.add("hidden");
    $("#quizComplete").classList.remove("hidden");
    renderReview();
    $("#reviewPanel").classList.remove("hidden");
    updateStats();
    return;
  }

  if (state.quizzes.length === 0) {
    try {
      state.quizzes = await withLoading(
        "퀴즈 로딩 중",
        "오늘의 문제를 불러오고 있습니다.",
        () => apiCall('/quizzes/daily')
      );
    } catch (e) {
      showToast("퀴즈를 불러오지 못했습니다.");
      return;
    }
  }

  advancePastAnsweredQuestion();
  const quiz = state.quizzes[state.current % state.quizzes.length];
  $("#quizModeSelect")?.classList.add("hidden");
  $("#quizHead").classList.remove("hidden");
  $("#quizProgressWrap").classList.remove("hidden");
  $("#quizCategory").textContent = `${quiz.category} · Level ${quiz.level}`;
  $("#quizQuestion").textContent = quiz.question;
  $("#quizComplete").classList.add("hidden");
  $("#reviewPanel").classList.add("hidden");
  $("#quizFeedback").classList.add("hidden");
  $("#optionList").innerHTML = quiz.options
    .map((option, index) => `<button class="option-button" type="button" data-index="${index}">${String.fromCharCode(65 + index)}. ${option}</button>`)
    .join("");
  $$(".option-button").forEach((button) => {
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
  const selectedAnswer = selectedIndex >= 0 ? quiz.options[selectedIndex] : "시간 초과";
  
  try {
    const res = state.quizMode === "incorrect" ? {
      is_correct: selectedIndex === quiz._correct_idx,
      correct_idx: quiz._correct_idx,
      explanation: quiz.explanation || "",
      earned_points: 0,
      current_total_points: state.points,
      daily_solved: state.solved,
      daily_completed: false
    } : await withLoading(
      "채점 중",
      "정답과 포인트를 확인하고 있습니다.",
      () => apiCall('/quizzes/verify', 'POST', {
        user_id: state.user.user_id,
        quiz_id: quiz.quiz_id,
        selected_idx: selectedIndex
      })
    );

    const isCorrect = res.is_correct;
    state.points = res.current_total_points;
    state.solved = res.daily_solved;
    state.completed = state.answers.length + 1 >= 10;

    const existingAnswer = state.answers.find((answer) => answer.quizIndex === state.current);
    if (!existingAnswer) {
      if (!state.modeCounts[state.quizMode]) state.modeCounts[state.quizMode] = 0;
      state.modeCounts[state.quizMode] += 1;
      state.answers.push({
        quizIndex: state.current,
        question: quiz.question,
        selected: selectedAnswer,
        correct: quiz.options[res.correct_idx],
        isCorrect,
        explanation: res.explanation,
        category: quiz.category
      });
    }
    saveQuizSession();

    $$(".option-button").forEach((button) => {
      const index = Number(button.dataset.index);
      if (index === res.correct_idx) button.classList.add("correct");
      if (index === selectedIndex && !isCorrect) {
        button.classList.add("wrong");
        saveIncorrectWord(quiz);
      }
    });

    if (state.answers.length >= 10) {
      updateStats();
      renderQuiz();
      return;
    }

    $("#quizFeedback").innerHTML = `
      <strong>${isCorrect ? "정답입니다" : "아쉬워요"}</strong>
      <p>${res.explanation}</p>
      <button id="nextQuizButton" class="action-button compact" type="button">다음 문제</button>
    `;
    $("#quizFeedback").classList.remove("hidden");
    $("#nextQuizButton").addEventListener("click", nextQuiz);

    updateStats();
  } catch (err) {
    state.locked = false;
    $$(".option-button").forEach((button) => button.disabled = false);
    showToast(err.message || "채점 중 오류가 발생했습니다.");
  }
}

function nextQuiz() {
  if (state.answers.length >= 10) {
    state.completed = true;
    state.locked = false;
    renderQuiz();
    return;
  }
  state.current = (state.current + 1) % state.quizzes.length;
  state.questionDeadline = null;
  state.locked = false;
  saveQuizSession();
  renderQuiz();
}

async function claimReward() {
  if (state.quizMode === "incorrect") {
    openQuizModeSelect();
    return;
  }
  if (!state.user) return;
  try {
    const res = await withLoading(
      "리워드 신청 중",
      "광고 확인 후 포인트를 적립하고 있습니다.",
      () => apiCall('/quizzes/reward', 'POST', {
        user_id: state.user.user_id,
        ad_token: `ad_sim_${Date.now()}`
      })
    );
    state.points = res.current_total_points;
    await refreshRewardStatus();
    updateStats();
    showToast(res.reward_points > 0 ? `${res.reward_points}P가 적립되었습니다.` : "적립 가능한 포인트가 없습니다.");
    clearQuizSession();
    openQuizModeSelect();
  } catch (err) {
    showToast(err.message || "리워드 처리 중 오류가 발생했습니다.");
  }
}

function openQuizModeSelect() {
  clearQuizSession();
  state.quizzes = [];
  state.completed = false;
  state.current = 0;
  state.answers = [];
  state.questionDeadline = null;
  clearInterval(state.timerId);
  state.locked = false;
  switchView("quizView");
  syncRoute("quizView");
}

async function updateRewardControls() {
  const rewardButton = $("#claimRewardButton");
  const skipButton = $("#skipRewardButton");
  if (skipButton) skipButton.classList.remove("hidden");
  if (!rewardButton) return;

  rewardButton.textContent = "보상 획득";
  rewardButton.disabled = false;

  if (state.quizMode === "incorrect") {
    rewardButton.textContent = "오답 퀴즈는 보상 없음";
    rewardButton.disabled = true;
    return;
  }

  if (!state.user?.user_id) {
    rewardButton.textContent = "로그인 필요";
    rewardButton.disabled = true;
    return;
  }

  try {
    const status = await apiCall(`/quizzes/reward-status?user_id=${encodeURIComponent(state.user.user_id)}`);
    const remaining = Number(status.remaining_reward_points || 0);
    state.rewardStatus = {
      remaining,
      cap: Number(status.daily_reward_cap || 1000),
      earned: Number(status.daily_total_earned || 0)
    };
    renderRewardAvailability();
    if (remaining <= 0) {
      rewardButton.textContent = "오늘 보상 한도 도달";
      rewardButton.disabled = true;
    } else {
      rewardButton.textContent = `보상 획득 (최대 ${formatNumber(remaining)}P)`;
    }
  } catch (err) {
    rewardButton.textContent = "보상 확인 실패";
    rewardButton.disabled = true;
  }
}

async function fetchQuizzesAndStart() {
  try {
    state.quizzes = await withLoading(
      "로딩 중",
      "문제를 생성하고 있습니다.",
      () => apiCall(`/quizzes/daily?mode=${state.quizMode}`)
    );
    state.completed = false;
    state.current = 0;
    state.answers = [];
    state.questionDeadline = null;
    saveQuizSession();
    renderQuiz();
  } catch (e) {
    showToast("퀴즈를 불러오지 못했습니다.");
  }
}

function saveIncorrectWord(quiz) {
  const key = String(quiz?.word || "").trim().toLowerCase();
  if (!key) return;
  const unique = new Map();
  state.incorrectWords.forEach((word) => {
    const existingKey = String(word?.word || "").trim().toLowerCase();
    if (existingKey && !unique.has(existingKey)) unique.set(existingKey, word);
  });
  if (!unique.has(key)) {
    unique.set(key, {
      word: quiz.word,
      korean: quiz.korean || quiz.options?.[quiz._correct_idx] || "",
      english: quiz.english || quiz.question,
      category: quiz.category,
      level: quiz.level
    });
  }
  state.incorrectWords = [...unique.values()];
  localStorage.setItem("nrc_incorrect_words", JSON.stringify(state.incorrectWords));
}

function renderIncorrectWords() {
  const container = $("#incorrectWordList");
  if (!container) return;
  container.innerHTML = state.incorrectWords.length ? state.incorrectWords.map((word) => `
    <div class="incorrect-item">
      <strong>${word.word}</strong>
      <span>${word.korean || word.english || ""}</span>
    </div>
  `).join("") : '<div class="empty-state">틀린 단어가 아직 없습니다.</div>';
}

function toggleIncorrectNote() {
  const panel = $("#incorrectNotePanel");
  if (!panel) return;
  renderIncorrectWords();
  panel.classList.toggle("hidden");
}

function startIncorrectQuiz() {
  if (state.incorrectWords.length < 4) {
    showToast("오답 단어가 부족합니다. 최소 4개가 필요합니다.");
    return;
  }

  const picked = [...state.incorrectWords].sort(() => 0.5 - Math.random()).slice(0, 10);
  state.quizzes = picked.map((word) => {
    const distractors = state.incorrectWords
      .filter((item) => item.word !== word.word)
      .sort(() => 0.5 - Math.random())
      .slice(0, 3)
      .map((item) => item.korean);
    while (distractors.length < 3) distractors.push("해당 없음");
    const options = [word.korean, ...distractors].sort(() => 0.5 - Math.random());
    return {
      quiz_id: `incorrect_${word.word}`,
      word: word.word,
      question: word.word,
      options,
      category: "오답 복습",
      level: word.level || 1,
      explanation: word.korean,
      _correct_idx: options.indexOf(word.korean)
    };
  });
  state.quizMode = "incorrect";
  state.completed = false;
  state.current = 0;
  state.answers = [];
  state.questionDeadline = null;
  saveQuizSession();
  switchView("quizView");
  syncRoute("quizView");
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
  $("#googleLoginButton").addEventListener("click", () => {
    setButtonBusy($("#googleLoginButton"), true, "Google 확인 중");
    if (window.NRCBridge?.googleSignIn) {
      try {
        window.onNativeGoogleSignIn(window.NRCBridge.googleSignIn());
      } catch {
        setButtonBusy($("#googleLoginButton"), false);
        showToast("Google 로그인 정보를 확인하지 못했습니다.");
      }
      return;
    }
    continueGoogleLogin({
      provider: "google",
      googleSub: `browser-google-${Date.now()}`,
      email: "",
      displayName: "Google User"
    });
    showToast("브라우저 미리보기에서는 Google 로그인 단계를 시뮬레이션합니다.");
  });

  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const nickname = $("#loginName").value.trim();
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
      const res = await withLoading(
        "로그인 중",
        "계정 정보를 확인하고 있습니다.",
        () => loginWithGoogleUser(pendingGoogleUser, nickname)
      );
      
      applyLoginResponse(res, pendingGoogleUser);
      showToast("로그인되었습니다.");
    } catch (err) {
      showToast(err.message || "로그인 처리 중 오류가 발생했습니다.");
    } finally {
      setButtonBusy(submitButton, false);
    }
  });

  $("#logoutButton").addEventListener("click", () => {
    if (window.NRCBridge?.signOut) {
      window.NRCBridge.signOut();
    }
    localStorage.removeItem("nrc_user_profile");
    localStorage.removeItem("nrc_daily_quiz");
    clearQuizSession();
    state.user = null;
    showLogin();
    showToast("로그아웃되었습니다.");
  });

  $$(".nav-item").forEach((item) => item.addEventListener("click", () => {
    if (item.dataset.view === "quizView") {
      resumeOrOpenQuiz();
      return;
    }
    switchView(item.dataset.view);
    syncRoute(item.dataset.view);
  }));
  $("#startQuiz").addEventListener("click", () => {
    if (state.completed && !state.quizzes.length) {
      showToast("오늘의 퀴즈는 이미 완료했습니다.");
      return;
    }
    resumeOrOpenQuiz();
  });
  $$(".mode-btn").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.mode === "incorrect") {
      startIncorrectQuiz();
      return;
    }
    state.quizMode = button.dataset.mode;
    fetchQuizzesAndStart();
  }));
  $("#claimRewardButton")?.addEventListener("click", claimReward);
  $("#skipRewardButton")?.addEventListener("click", openQuizModeSelect);
  $("#showIncorrectNoteButton")?.addEventListener("click", toggleIncorrectNote);
  $("#startIncorrectQuiz")?.addEventListener("click", startIncorrectQuiz);
  $("#studySearchInput")?.addEventListener("input", (event) => {
    state.studySearch = event.target.value || "";
    renderStudyView();
  });
  $$(".study-book-chip").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      state.studyBook = button.dataset.book || "default";
      $$(".study-book-chip").forEach((chip) => chip.classList.toggle("active", chip === button));
      renderStudyView();
    });
  });
  $("#lockscreenEnabled").addEventListener("change", (event) => {
    state.lockscreen.enabled = event.target.checked;
    saveLockscreenSettings();
    showToast(state.lockscreen.enabled ? "잠금화면 퀴즈가 켜졌습니다." : "잠금화면 퀴즈가 꺼졌습니다.");
  });

  $("#lockscreenReward").addEventListener("change", (event) => {
    state.lockscreen.rewardPrompt = event.target.checked;
    saveLockscreenSettings();
    showToast(state.lockscreen.rewardPrompt ? "보상 안내가 켜졌습니다." : "보상 안내가 꺼졌습니다.");
  });



  $$("[data-view-target]").forEach((button) => {
    button.addEventListener("click", () => {
      switchView(button.dataset.viewTarget);
      syncRoute(button.dataset.viewTarget);
    });
  });

  window.addEventListener("hashchange", () => switchView(routeFromHash()));
}



async function init() {
  bindEvents();
  restoreQuizSession();
  if (hasLogin()) {
    showApp();
    await Promise.all([
      renderShop(),
      renderCoupons(),
      renderLockscreenSettings(),
      refreshRewardStatus(),
      loadStudyWords()
    ]);
    switchView(routeFromHash());
  } else {
    showLogin();
    renderShop();
    loadStudyWords().catch(() => {});
  }
  updateStats();

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      showToast("오프라인 캐시 등록은 HTTPS 환경에서 활성화됩니다.");
    });
  }
}

init();
