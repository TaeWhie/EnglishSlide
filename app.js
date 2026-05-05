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
  if (loadingDepth === 0) overlay.classList.add("hidden");
}

async function withLoading(title, message, task) {
  showLoading(title, message);
  try { return await task(); } finally { hideLoading(); }
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
  const options = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) options.body = JSON.stringify(body);
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

function formatNumber(value) { return new Intl.NumberFormat("ko-KR").format(value); }

function updateStats() {
  $("#totalPoints").textContent = `${formatNumber(state.points)}P`;
  $("#quizSolved").textContent = state.solved;
  localStorage.setItem("nrc_daily_quiz", JSON.stringify({
    date: todayKey, solved: state.solved, current: state.current, completed: state.completed, answers: state.answers
  }));
  updateGoalSummary();
}

function hasLogin() { return Boolean(state.user && (state.user.nickname || state.user.name)); }
function showLogin() { $("#loginView").classList.remove("hidden"); $("#mainView").classList.add("hidden"); }
function showApp() { $("#loginView").classList.add("hidden"); $("#mainView").classList.remove("hidden"); }

function switchView(viewId) {
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === viewId));
  
  if (viewId === "quizView") {
    // 탭을 눌러 퀴즈로 올 때마다 초기화하도록 강제
    state.quizzes = [];
    clearInterval(state.timerId);
    state.locked = false;
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
  const routeMap = { homeView: "home", quizView: "quiz", shopView: "shop", reportView: "profile" };
  const nextHash = routeMap[viewId] || "home";
  if (location.hash.slice(1) !== nextHash) history.replaceState(null, "", `#${nextHash}`);
}

function routeFromHash() {
  const viewMap = { home: "homeView", quiz: "quizView", shop: "shopView", profile: "reportView" };
  return viewMap[location.hash.slice(1)] || "homeView";
}

function startTimer() {
  clearInterval(state.timerId);
  state.timer = 15;
  $("#timer").textContent = state.timer;
  $("#quizProgress").style.width = "100%";
  state.timerId = setInterval(() => {
    state.timer -= 1;
    $("#timer").textContent = state.timer;
    $("#quizProgress").style.width = `${Math.max(0, (state.timer / 15) * 100)}%`;
    if (state.timer <= 0) { clearInterval(state.timerId); verifyAnswer(-1); }
  }, 1000);
}

async function renderQuiz() {
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

  if (!state.quizzes || state.quizzes.length === 0) {
    $("#quizHead").classList.add("hidden");
    $("#quizProgressWrap").classList.add("hidden");
    $("#quizComplete").classList.add("hidden");
    $("#reviewPanel").classList.add("hidden");
    $("#quizModeSelect")?.classList.remove("hidden");
    return;
  }

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
  if (!quiz) { state.locked = false; return; }

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
      res = await withLoading("채점 중", "정답 여부를 확인하고 있습니다.", () => apiCall('/quizzes/verify', 'POST', {
        user_id: state.user?.user_id || "", quiz_id: quiz.quiz_id, selected_idx: selectedIndex
      }));
    }

    const isCorrect = res.is_correct;
    state.points = res.current_total_points;
    state.solved = res.daily_solved;
    state.completed = res.daily_completed;

    state.answers.push({
      quizIndex: state.current, question: quiz.question, selected: selectedAnswer,
      correct: quiz.options ? quiz.options[res.correct_idx] : "", isCorrect, explanation: res.explanation, category: quiz.category
    });

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
    $("#nextQuizButton").addEventListener("click", nextQuiz);
    updateStats();
  } catch (err) {
    state.locked = false;
    $$(".option-button").forEach((button) => button.disabled = false);
    showToast(err.message || "채점 중 오류가 발생했습니다.");
  }
}

function nextQuiz() {
  state.current = (state.current + 1) % state.quizzes.length;
  state.locked = false;
  renderQuiz();
}

function startNextSet() {
  state.quizzes = []; state.completed = false; state.answers = []; state.current = 0;
  switchView("quizView");
}

async function claimReward() {
  if (!state.user) return;
  try {
    const res = await withLoading("리워드 신청 중", "포인트 적립을 진행합니다.", () => apiCall('/quizzes/reward', 'POST', {
      user_id: state.user.user_id, ad_token: "ad_sim_" + Date.now()
    }));
    state.points = res.current_total_points;
    updateStats();
    showToast(res.reward_points > 0 ? `축하합니다! ${res.reward_points}P가 적립되었습니다.` : "오늘의 한도에 도달했거나 적립 포인트가 없습니다.");
    renderReview();
  } catch (err) { showToast(err.message || "오류가 발생했습니다."); }
}

async function renderShop() {
  if (state.shopItems.length === 0) {
    state.shopItems = await apiCall('/rewards/items');
  }
  $("#shopList").innerHTML = state.shopItems.map(item => `
    <article class="shop-item">
      <div class="visual">🎁</div>
      <strong>${item.name}</strong>
      <p>${formatNumber(item.price_points)}P</p>
      <button type="button" data-item="${item.item_id}">교환하기</button>
    </article>
  `).join("");
  $$("#shopList button").forEach(btn => btn.addEventListener("click", () => exchangeItem(btn.dataset.item)));
}

async function exchangeItem(itemId) {
  const item = state.shopItems.find(i => i.item_id === itemId);
  if (!item || state.points < item.price_points) { showToast("포인트가 부족합니다."); return; }
  try {
    await withLoading("교환 중", "쿠폰을 발급하고 있습니다.", () => apiCall('/rewards/exchange', 'POST', {
      user_id: state.user.user_id, item_id: itemId
    }));
    showToast("교환 완료! 내 정보에서 쿠폰을 확인하세요.");
    renderCoupons();
  } catch (e) { showToast(e.message); }
}

async function renderCoupons() {
  if (!state.user) return;
  const coupons = await apiCall(`/rewards/coupons?user_id=${state.user.user_id}`);
  state.coupons = coupons;
  $("#couponList").innerHTML = coupons.length ? coupons.map(c => `
    <div class="coupon-item">
      <strong>${c.item_name}</strong>
      <code>${c.coupon_code}</code>
    </div>
  `).join("") : '<p class="empty-msg">보유 쿠폰이 없습니다.</p>';
}

function renderLockscreenSettings() {
  $("#lockscreenEnabled").checked = state.lockscreen.enabled;
  $("#lockscreenReward").checked = state.lockscreen.rewardPrompt;
}

function updateGoalSummary() {
  if (!state.shopItems.length) return;
  const nextItem = state.shopItems.find(i => i.price_points > state.points) || state.shopItems[0];
  $("#nextGoal").textContent = nextItem.name;
  const remain = Math.max(0, nextItem.price_points - state.points);
  $("#goalRemain").textContent = remain === 0 ? "교환 가능" : `${formatNumber(remain)}P 남음`;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 2600);
}

function saveIncorrectWord(quiz) {
  if (!state.incorrectWords.some(w => w.word === quiz.word)) {
    state.incorrectWords.push({ word: quiz.word, korean: quiz.korean, english: quiz.english, category: quiz.category, level: quiz.level });
    localStorage.setItem("nrc_incorrect_words", JSON.stringify(state.incorrectWords));
  }
}

function renderIncorrectWords() {
  const container = $("#incorrectWordList");
  if (!container) return;
  container.innerHTML = state.incorrectWords.length ? state.incorrectWords.map(w => `
    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #f0f0f0; padding: 10px 4px;">
      <strong>${w.word}</strong>
      <span style="color: var(--muted);">${w.korean}</span>
    </div>
  `).join("") : '<p class="empty-msg">틀린 단어가 없습니다.</p>';
}

function startIncorrectQuiz() {
  if (state.incorrectWords.length < 4) { showToast("단어가 부족합니다 (최소 4개)."); return; }
  const picked = [...state.incorrectWords].sort(() => 0.5 - Math.random()).slice(0, 10);
  state.quizzes = picked.map(w => {
    const distractors = state.incorrectWords.filter(dw => dw.word !== w.word).sort(() => 0.5 - Math.random()).slice(0, 3).map(dw => dw.korean);
    while(distractors.length < 3) distractors.push("해당 없음");
    const options = [w.korean, ...distractors].sort(() => 0.5 - Math.random());
    return { quiz_id: "incorrect_" + w.word, word: w.word, question: w.word, options, category: "오답 복습", level: w.level || 1, explanation: w.korean, _correct_idx: options.indexOf(w.korean) };
  });
  state.quizMode = 'incorrect'; state.completed = false; state.current = 0; state.answers = [];
  switchView("quizView");
}

function renderReview() {
  const container = $("#reviewList");
  if (!container) return;
  container.innerHTML = state.answers.map(ans => `
    <div class="review-item ${ans.isCorrect ? 'correct' : 'wrong'}">
      <strong>${ans.question}</strong>
      <p>내 답변: ${ans.selected} | 정답: ${ans.correct}</p>
    </div>
  `).join("");
  $("#reviewSummary").textContent = `10문제 중 ${state.answers.filter(a => a.isCorrect).length}문제를 맞혔습니다.`;
}

async function fetchQuizzesAndStart() {
  try {
    state.quizzes = await withLoading("로딩 중", "문제를 생성하고 있습니다.", () => apiCall(`/quizzes/daily?mode=${state.quizMode}`));
    state.completed = false; state.current = 0; state.answers = [];
    renderQuiz();
  } catch (e) { showToast("불러오기 실패"); }
}

function bindEvents() {
  $("#googleLogin")?.addEventListener("click", () => {
    if (window.NRCBridge?.signInWithGoogle) window.NRCBridge.signInWithGoogle();
    else showToast("네이티브 환경에서만 가능합니다.");
  });

  $("#loginForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nickname = $("#loginNickname").value.trim();
    const res = await withLoading("가입 중", "", () => loginWithGoogleUser(pendingGoogleUser, nickname));
    applyLoginResponse(res, pendingGoogleUser);
  });

  $$(".nav-item").forEach(item => item.addEventListener("click", () => {
    if (item.dataset.view === "quizView") { state.quizzes = []; clearInterval(state.timerId); state.locked = false; }
    switchView(item.dataset.view);
    syncRoute(item.dataset.view);
  }));

  $("#startQuizMixed")?.addEventListener("click", () => { state.quizMode = 'mixed'; state.quizzes = []; switchView("quizView"); });
  $("#startQuizKor")?.addEventListener("click", () => { state.quizMode = 'kor'; state.quizzes = []; switchView("quizView"); });
  $("#startQuizEng")?.addEventListener("click", () => { state.quizMode = 'eng'; state.quizzes = []; switchView("quizView"); });

  $$(".mode-btn").forEach(btn => btn.addEventListener("click", () => { state.quizMode = btn.dataset.mode; fetchQuizzesAndStart(); }));

  $("#lockscreenEnabled")?.addEventListener("change", (e) => { state.lockscreen.enabled = e.target.checked; saveLockscreenSettings(); });
  $("#lockscreenReward")?.addEventListener("change", (e) => { state.lockscreen.rewardPrompt = e.target.checked; saveLockscreenSettings(); });

  $("#claimRewardButton")?.addEventListener("click", claimReward);
  $("#startNextSetButton")?.addEventListener("click", () => { state.quizzes = []; switchView("quizView"); });
  $("#startIncorrectQuiz")?.addEventListener("click", startIncorrectQuiz);

  $("#logoutButton")?.addEventListener("click", () => { localStorage.clear(); location.reload(); });

  window.addEventListener("hashchange", () => switchView(routeFromHash()));
}

async function init() {
  // 캐시 문제 방지를 위해 기존 서비스 워커 해제
  if (window.navigator.serviceWorker) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (let reg of registrations) { await reg.unregister(); }
  }

  bindEvents();
  if (hasLogin()) {
    showApp();
    await Promise.all([renderShop(), renderCoupons(), renderLockscreenSettings()]);
    switchView(routeFromHash());
  } else { showLogin(); }
  updateStats();
}

init();
