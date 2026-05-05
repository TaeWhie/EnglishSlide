const fs = require('fs');
const path = require('path');

// 1. index.html 수정
const htmlPath = path.join(__dirname, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// quizView 내부에 모드 선택 패널 추가
html = html.replace(/<section id="quizView" class="view quiz-view" data-title="퀴즈">/, `
        <section id="quizView" class="view quiz-view" data-title="퀴즈">
          <div id="quizModeSelect" class="mode-select-panel">
            <p class="eyebrow">Selection</p>
            <h3>학습 모드 선택</h3>
            <p>오늘 학습할 방식을 골라주세요.</p>
            <div class="mode-buttons" style="display: flex; flex-direction: column; gap: 12px; margin-top: 24px;">
              <button class="action-button mode-btn" data-mode="kor">영한 퀴즈 시작 (English → 한국어)</button>
              <button class="action-button outline mode-btn" data-mode="eng">영영 퀴즈 시작 (English → English)</button>
            </div>
          </div>`);

fs.writeFileSync(htmlPath, html);

// 2. app.js 수정
const appJsPath = path.join(__dirname, 'app.js');
let appJs = fs.readFileSync(appJsPath, 'utf8');

// renderQuiz 수정: state.quizzes가 없으면 모드 선택 패널을 보여줌
appJs = appJs.replace(/async function renderQuiz\(\) \{[\s\S]*?if \(state\.quizzes\.length === 0\)/, `async function renderQuiz() {
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

  if (state.quizzes.length === 0) {
    $("#quizHead").classList.add("hidden");
    $("#quizProgressWrap").classList.add("hidden");
    $("#quizComplete").classList.add("hidden");
    $("#reviewPanel").classList.add("hidden");
    $("#quizModeSelect")?.classList.remove("hidden");
    return;
  }
  $("#quizModeSelect")?.classList.add("hidden");`);

// bindEvents에 모드 선택 버튼 이벤트 추가
appJs = appJs.replace(/\$\("#startQuizEng"\)\?\.addEventListener\("click"[\s\S]*?\}\);/, `
  $("#startQuizKor")?.addEventListener("click", () => {
    state.quizMode = 'kor';
    state.quizzes = [];
    state.completed = false;
    state.answers = [];
    state.current = 0;
    switchView("quizView");
    syncRoute("quizView");
  });
  $("#startQuizEng")?.addEventListener("click", () => {
    state.quizMode = 'eng';
    state.quizzes = [];
    state.completed = false;
    state.answers = [];
    state.current = 0;
    switchView("quizView");
    syncRoute("quizView");
  });

  $$(".mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.quizMode = btn.dataset.mode;
      state.quizzes = [];
      state.completed = false;
      state.answers = [];
      state.current = 0;
      renderQuiz();
      // 여기서 바로 로딩 시작하도록 renderQuiz 로직을 유도
      fetchQuizzesAndStart();
    });
  });`);

// fetchQuizzesAndStart 헬퍼 함수 추가 (또는 renderQuiz 보강)
appJs += `
async function fetchQuizzesAndStart() {
  try {
    state.quizzes = await withLoading(
      "퀴즈 로딩 중",
      "문제를 생성하고 있습니다.",
      () => apiCall(\`/quizzes/daily?mode=\${state.quizMode}\`)
    );
    renderQuiz();
  } catch (e) {
    showToast("퀴즈를 불러오지 못했습니다.");
  }
}
`;

fs.writeFileSync(appJsPath, appJs);
console.log('done');
