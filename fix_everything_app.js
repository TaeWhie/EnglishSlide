const fs = require('fs');
const path = require('path');

const appJsPath = path.join(__dirname, 'app.js');
let appJs = fs.readFileSync(appJsPath, 'utf8');

// 1. 중복된 함수들 제거 (마지막에 추가된 redundant logic들)
appJs = appJs.replace(/\nasync function fetchQuizzesAndStart\(\) \{[\s\S]*?\}/g, '');
appJs = appJs.replace(/\}\n  state\.current = \(state\.current \+ 1\) % state\.quizzes\.length;[\s\S]*?renderQuiz\(\);\n\}/g, '}');

// 2. renderQuiz 재정의 (클린한 버전으로 교체)
const cleanRenderQuiz = `async function renderQuiz() {
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
  $("#quizCategory").textContent = \`\${quiz.category} · Level \${quiz.level}\`;
  $("#quizQuestion").textContent = quiz.question;
  $("#quizFeedback").classList.add("hidden");
  $("#optionList").innerHTML = (quiz.options || [])
    .map((option, index) => \`<button class="option-button" type="button" data-index="\${index}">\${String.fromCharCode(65 + index)}. \${option}</button>\`)
    .join("");
    
  $$(".option-button").forEach((button) => {
    button.addEventListener("click", () => verifyAnswer(Number(button.dataset.index)));
  });
  startTimer();
}`;

appJs = appJs.replace(/async function renderQuiz\(\) \{[\s\S]*?\n\}/, cleanRenderQuiz);

// 3. fetchQuizzesAndStart 함수를 bindEvents가 참조할 수 있게 명시적으로 추가
appJs = appJs.replace(/function init\(\) \{/, `async function fetchQuizzesAndStart() {
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

function init() {`);

// 4. bindEvents 내의 버튼 핸들러 정리
appJs = appJs.replace(/\$\("#startQuizKor"\)\?\.addEventListener\("click"[\s\S]*?fetchQuizzesAndStart\(\);\n\s+\}\);\n\s+\}\);/, `
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

  $$(".mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.quizMode = btn.dataset.mode;
      fetchQuizzesAndStart();
    });
  });`);

fs.writeFileSync(appJsPath, appJs);
console.log('done');
