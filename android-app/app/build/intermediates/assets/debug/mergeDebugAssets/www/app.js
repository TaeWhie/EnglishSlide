const quizzes = [
  {
    question: "다음 중 '혜택'이라는 뜻을 가진 단어는?",
    options: ["Benefit", "Battery", "Balance", "Banner"],
    answer: 0,
    category: "Life English",
    level: 1,
    explanation: "Benefit은 혜택이나 이익을 뜻합니다."
  },
  {
    question: "I would like to order some ____ at the cafe.",
    options: ["coffee", "coffees", "coffeed", "coffeeing"],
    answer: 0,
    category: "Sentence Completion",
    level: 2,
    explanation: "음료를 주문하는 문장에서는 some coffee가 자연스럽습니다."
  },
  {
    question: "'광고 수익'에 가장 가까운 표현은?",
    options: ["Ad revenue", "App review", "Ad reverse", "Api value"],
    answer: 0,
    category: "Business & Finance",
    level: 2,
    explanation: "Ad revenue는 광고를 통해 발생한 수익입니다."
  },
  {
    question: "'예약을 확인하다'에 가장 가까운 표현은?",
    options: ["Confirm a reservation", "Cancel a station", "Carry a reason", "Change a season"],
    answer: 0,
    category: "Travel English",
    level: 3,
    explanation: "Confirm a reservation은 예약을 확인하다는 뜻입니다."
  },
  {
    question: "The reward is ____ after watching the video ad.",
    options: ["doubled", "doubling", "doublet", "doubles"],
    answer: 0,
    category: "Reward English",
    level: 2,
    explanation: "수동태 문장에서는 is doubled가 맞습니다."
  },
  {
    question: "'연속 참여 일수'를 앱 지표로 표현할 때 쓰는 단어는?",
    options: ["Streak", "Stack", "Strike", "Stream"],
    answer: 0,
    category: "Life English",
    level: 1,
    explanation: "Streak는 연속 기록을 뜻합니다."
  },
  {
    question: "A payout ratio of 95% means users receive ____ of ad income.",
    options: ["most", "none", "half", "less"],
    answer: 0,
    category: "Business & Finance",
    level: 2,
    explanation: "95%는 대부분의 수익을 사용자에게 환원한다는 의미입니다."
  },
  {
    question: "'매일 연습하면 실력이 좋아진다'에 어울리는 단어는?",
    options: ["improve", "import", "invite", "invent"],
    answer: 0,
    category: "Grammar Practice",
    level: 3,
    explanation: "Improve는 나아지다, 향상되다라는 뜻입니다."
  },
  {
    question: "'학습 리포트'를 영어 화면명으로 쓰면?",
    options: ["Learning Report", "Loading Ratio", "Legal Route", "Local Reward"],
    answer: 0,
    category: "Life English",
    level: 1,
    explanation: "Learning Report가 학습 리포트에 해당합니다."
  },
  {
    question: "Offerwall 미션 완료 시 사용자가 받는 것은?",
    options: ["Points", "Ports", "Posts", "Parts"],
    answer: 0,
    category: "Reward English",
    level: 1,
    explanation: "리워드 앱에서는 미션 완료 보상으로 points를 받습니다."
  }
];

const shopItems = [
  {
    id: "voucher_5k",
    icon: "5K",
    name: "5천원 금액권",
    price: 5000,
    description: "제품 구매에 사용할 수 있는 기본 금액권"
  },
  {
    id: "voucher_10k",
    icon: "1만",
    name: "1만원 금액권",
    price: 10000,
    description: "가장 많이 선택되는 실속형 금액권"
  },
  {
    id: "voucher_30k",
    icon: "3만",
    name: "3만원 금액권",
    price: 30000,
    description: "포인트를 모아 더 큰 혜택으로 교환"
  },
  {
    id: "voucher_50k",
    icon: "5만",
    name: "5만원 금액권",
    price: 50000,
    description: "고액 교환을 위한 프리미엄 금액권"
  }
];

const todayKey = new Date().toISOString().slice(0, 10);
const savedDaily = JSON.parse(localStorage.getItem("nrc_daily_quiz") || "{}");
const initialDaily = savedDaily.date === todayKey ? savedDaily : { date: todayKey, solved: 0, current: 0, completed: false, answers: [] };
const savedCoupons = JSON.parse(localStorage.getItem("nrc_coupons") || "[]");
const savedLockscreen = JSON.parse(localStorage.getItem("nrc_lockscreen_settings") || "{}");
const savedProfile = JSON.parse(localStorage.getItem("nrc_user_profile") || "null");
let pendingGoogleUser = null;

const state = {
  user: savedProfile,
  points: Number(localStorage.getItem("nrc_points")) || 1250,
  coupons: Array.isArray(savedCoupons) ? savedCoupons : [],
  lockscreen: {
    enabled: savedLockscreen.enabled ?? true,
    rewardPrompt: savedLockscreen.rewardPrompt ?? true
  },
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
  localStorage.setItem("nrc_points", String(state.points));
  localStorage.setItem("nrc_daily_quiz", JSON.stringify({
    date: todayKey,
    solved: state.solved,
    current: state.current,
    completed: state.completed,
    answers: state.answers
  }));
  updateQuizEntryState();
  saveCoupons();
  saveLockscreenSettings();
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
  pendingGoogleUser = googleUser;
  $("#googleLoginButton").classList.add("hidden");
  $("#loginForm").classList.remove("hidden");
  $("#loginGuide").textContent = "Google 로그인 확인이 끝났습니다. 앱에서 사용할 닉네임을 만들어 주세요.";
  $("#loginName").focus();
}

function updateProfileStats() {
  const quizState = $("#profileQuizState");
  const couponCount = $("#profileCouponCount");
  const profilePoints = $("#profilePoints");
  if (!quizState || !couponCount || !profilePoints) return;
  quizState.textContent = state.completed ? "완료" : `${state.solved}/10`;
  couponCount.textContent = `${state.coupons.length}개`;
  profilePoints.textContent = `${formatNumber(state.points)}P`;
}

function saveCoupons() {
  localStorage.setItem("nrc_coupons", JSON.stringify(state.coupons));
}

function saveLockscreenSettings() {
  localStorage.setItem("nrc_lockscreen_settings", JSON.stringify(state.lockscreen));
}

function updateGoalSummary() {
  const nextItem = shopItems.find((item) => item.price > state.points) || shopItems[shopItems.length - 1];
  const remain = Math.max(0, nextItem.price - state.points);
  $("#nextGoal").textContent = nextItem.name;
  $("#goalRemain").textContent = remain === 0 ? "교환 가능" : `${formatNumber(remain)}P 남음`;
}

function updateQuizEntryState() {
  const startButton = $("#startQuiz");
  if (!startButton) return;
  startButton.disabled = state.completed;
  startButton.textContent = state.completed ? "오늘 완료" : "도전하기";
  startButton.classList.toggle("disabled", state.completed);
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

function startTimer() {
  clearInterval(state.timerId);
  state.timer = 15;
  $("#timer").textContent = state.timer;
  $("#timer").classList.remove("warning");
  state.timerId = setInterval(() => {
    state.timer -= 1;
    $("#timer").textContent = state.timer;
    $("#timer").classList.toggle("warning", state.timer < 5);
    if (state.timer <= 0) {
      clearInterval(state.timerId);
      verifyAnswer(-1);
    }
  }, 1000);
}

function renderQuiz() {
  if (state.completed || state.solved >= 10) {
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

  const quiz = quizzes[state.current % quizzes.length];
  $("#quizHead").classList.remove("hidden");
  $("#quizProgressWrap").classList.remove("hidden");
  $("#quizCategory").textContent = `${quiz.category} · Level ${quiz.level}`;
  $("#quizQuestion").textContent = quiz.question;
  $("#quizProgress").style.width = `${((state.current % quizzes.length) + 1) * 10}%`;
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

function verifyAnswer(selectedIndex) {
  if (state.locked || state.completed) return;
  state.locked = true;
  clearInterval(state.timerId);

  const quiz = quizzes[state.current % quizzes.length];
  const isCorrect = selectedIndex === quiz.answer;
  const earned = isCorrect ? 10 + (quiz.level - 1) * 3 : 2;
  const selectedAnswer = selectedIndex >= 0 ? quiz.options[selectedIndex] : "시간 초과";
  const existingAnswer = state.answers.find((answer) => answer.quizIndex === state.current);
  if (!existingAnswer) {
    state.answers.push({
      quizIndex: state.current,
      question: quiz.question,
      selected: selectedAnswer,
      correct: quiz.options[quiz.answer],
      isCorrect,
      explanation: quiz.explanation,
      category: quiz.category
    });
  }
  state.points += earned;
  state.solved = Math.min(10, state.solved + 1);
  if (state.solved >= 10) {
    state.completed = true;
  }

  $$(".option-button").forEach((button) => {
    const index = Number(button.dataset.index);
    button.disabled = true;
    if (index === quiz.answer) button.classList.add("correct");
    if (index === selectedIndex && !isCorrect) button.classList.add("wrong");
  });

  $("#quizFeedback").innerHTML = `
    <strong>${isCorrect ? "정답입니다" : "아쉬워요"}</strong>
    <p>${quiz.explanation} ${earned}P가 적립되었습니다.</p>
    <button id="rewardAd" class="action-button compact" type="button">${state.completed ? "완료하기" : isCorrect ? "보상 2배 광고 보기" : "다음 문제"}</button>
  `;
  $("#quizFeedback").classList.remove("hidden");
  $("#rewardAd").addEventListener("click", () => {
    if (isCorrect) {
      const bonus = earned * 2;
      state.points += bonus;
      showToast(`보상형 광고 완료: ${bonus}P 추가 적립`);
    }
    nextQuiz();
  });

  updateStats();
}

function nextQuiz() {
  if (state.completed) {
    state.locked = false;
    renderQuiz();
    return;
  }
  state.current = (state.current + 1) % quizzes.length;
  state.locked = false;
  renderQuiz();
}

function renderShop() {
  $("#shopList").innerHTML = shopItems
    .map(
      (item) => `
        <article class="shop-item">
          <div class="visual">${item.icon}</div>
          <strong>${item.name}</strong>
          <p>${item.description}</p>
          <p><b>${formatNumber(item.price)}P</b></p>
          <button type="button" data-item="${item.id}">교환하기</button>
        </article>
      `
    )
    .join("");

  $$("#shopList button").forEach((button) => {
    button.addEventListener("click", () => exchangeItem(button.dataset.item));
  });
}

function exchangeItem(itemId) {
  const item = shopItems.find((entry) => entry.id === itemId);
  if (!item) return;
  if (state.points < item.price) {
    showToast("보유 포인트가 부족합니다. 오늘의 퀴즈 세트를 먼저 진행하세요.");
    return;
  }
  state.points -= item.price;
  const code = `NRCQ-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Date.now().toString().slice(-4)}`;
  state.coupons.unshift({
    id: `${item.id}_${Date.now()}`,
    name: item.name,
    code,
    price: item.price,
    status: "사용 가능",
    issuedAt: new Date().toISOString().slice(0, 10)
  });
  updateStats();
  showToast(`${item.name} 교환 완료. 마이페이지 쿠폰함에서 확인할 수 있습니다.`);
}

function renderCoupons() {
  const list = $("#couponList");
  const count = $("#couponCount");
  if (!list || !count) return;
  count.textContent = `${state.coupons.length}개`;
  if (!state.coupons.length) {
    list.innerHTML = `<div class="empty-state">아직 교환한 금액권이 없습니다.</div>`;
    return;
  }
  list.innerHTML = state.coupons.map((coupon) => `
    <article class="coupon-card">
      <div>
        <strong>${coupon.name}</strong>
        <p>${coupon.issuedAt} 발급 · ${coupon.status}</p>
      </div>
      <code>${coupon.code}</code>
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

function renderLockscreenSettings() {
  const enabled = $("#lockscreenEnabled");
  const reward = $("#lockscreenReward");
  if (!enabled || !reward) return;
  enabled.checked = state.lockscreen.enabled;
  reward.checked = state.lockscreen.rewardPrompt;
}

function bindEvents() {
  $("#googleLoginButton").addEventListener("click", () => {
    if (window.NRCBridge?.googleSignIn) {
      try {
        completeGoogleStep(JSON.parse(window.NRCBridge.googleSignIn()));
      } catch {
        showToast("Google 로그인 정보를 확인하지 못했습니다.");
      }
      return;
    }
    completeGoogleStep({
      provider: "google",
      googleSub: `browser-google-${Date.now()}`,
      email: "",
      displayName: "Google User"
    });
    showToast("브라우저 미리보기에서는 Google 로그인 단계를 시뮬레이션합니다.");
  });

  $("#loginForm").addEventListener("submit", (event) => {
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
    state.user = {
      provider: "google",
      googleSub: pendingGoogleUser.googleSub,
      email: pendingGoogleUser.email || "",
      nickname,
      userId: `google-${pendingGoogleUser.googleSub || Date.now()}`,
      loggedInAt: new Date().toISOString()
    };
    localStorage.setItem("nrc_user_profile", JSON.stringify(state.user));
    showApp();
    renderProfile();
    updateOsRuntime();
    showToast("로그인되었습니다.");
  });

  $("#logoutButton").addEventListener("click", () => {
    localStorage.removeItem("nrc_user_profile");
    state.user = null;
    showLogin();
    showToast("로그아웃되었습니다.");
  });

  $$(".nav-item").forEach((item) => item.addEventListener("click", () => {
    switchView(item.dataset.view);
    syncRoute(item.dataset.view);
  }));
  $("#startQuiz").addEventListener("click", () => {
    if (state.completed) {
      showToast("오늘의 퀴즈는 이미 완료했습니다.");
      return;
    }
    switchView("quizView");
    syncRoute("quizView");
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

  $("#openOverlaySettings").addEventListener("click", () => {
    if (window.NRCBridge?.openOverlaySettings) {
      window.NRCBridge.openOverlaySettings();
    } else {
      showToast("Android 앱에서 설치하면 잠금화면 권한 설정으로 이동합니다.");
    }
  });

  $("#openAppSettings").addEventListener("click", () => {
    if (window.NRCBridge?.openAppSettings) {
      window.NRCBridge.openAppSettings();
    } else {
      showToast("Android 앱에서 설치하면 앱 권한 설정으로 이동합니다.");
    }
  });

  $$("[data-view-target]").forEach((button) => {
    button.addEventListener("click", () => {
      switchView(button.dataset.viewTarget);
      syncRoute(button.dataset.viewTarget);
    });
  });

  window.addEventListener("hashchange", () => switchView(routeFromHash()));
}

function updateOsRuntime() {
  const runtime = $("#osRuntime");
  if (!runtime) return;
  if (window.NRCBridge?.runtime) {
    runtime.textContent = window.NRCBridge.runtime();
  } else {
    runtime.textContent = "브라우저 미리보기";
  }
}

function init() {
  bindEvents();
  renderShop();
  renderCoupons();
  renderLockscreenSettings();
  if (hasLogin()) {
    showApp();
    switchView(routeFromHash());
  } else {
    showLogin();
  }
  updateOsRuntime();
  updateStats();

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      showToast("오프라인 캐시 등록은 HTTPS 환경에서 활성화됩니다.");
    });
  }
}

init();
