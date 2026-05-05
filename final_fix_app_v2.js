const fs = require('fs');
const path = require('path');

const appJsPath = path.join(__dirname, 'app.js');
let appJs = fs.readFileSync(appJsPath, 'utf8');

// 1. 중복/손상된 모든 하단 코드 제거 (820번 라인 이후를 다시 정리)
// redundant logic들을 찾아 제거합니다.
appJs = appJs.replace(/\nasync async function[\s\S]*/, ''); 
// if (hasLogin()) ... block도 init 내부에 있어야 함.

// 2. bindEvents 함수 본문을 완전히 교체 (안전하게)
const cleanBindEvents = `function bindEvents() {
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
    switchView(item.dataset.view);
    syncRoute(item.dataset.view);
  }));

  // 홈 화면 모드 선택 버튼
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
  $$(".mode-btn").forEach(btn => {
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

  window.addEventListener("hashchange", () => switchView(routeFromHash()));
}`;

appJs = appJs.replace(/function bindEvents\(\) \{[\s\S]*?\n\}/, cleanBindEvents);

// 3. fetchQuizzesAndStart와 init 함수를 파일 끝에 깔끔하게 추가
appJs += `
async function fetchQuizzesAndStart() {
  try {
    state.quizzes = await withLoading(
      "퀴즈 로딩 중",
      "문제를 생성하고 있습니다.",
      () => apiCall(\`/quizzes/daily?mode=\${state.quizMode}\`)
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
`;

// 4. renderQuiz의 $$ 오타 수정
appJs = appJs.replace(/\$\(".option-button"\)\.forEach/, '$$(".option-button").forEach');

fs.writeFileSync(appJsPath, appJs);
console.log('done');
