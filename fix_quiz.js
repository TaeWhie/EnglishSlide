const fs = require('fs');
const path = require('path');

// 1. app.js 수정
const appJsPath = path.join(__dirname, 'app.js');
let appJs = fs.readFileSync(appJsPath, 'utf8');

// renderQuiz 수정
appJs = appJs.replace(/async function renderQuiz\(\) \{[\s\S]*?if \(state\.quizzes\.length === 0\)/, `async function renderQuiz() {
  if (state.completed && state.answers.length % 10 === 0 && state.answers.length > 0) {
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

  if (state.quizzes.length === 0)`);

// verifyAnswer 수정 (보상 로직 제거 및 버튼 텍스트 변경)
appJs = appJs.replace(/const isCorrect = res\.is_correct;[\s\S]*?updateStats\(\);/, `const isCorrect = res.is_correct;
    state.points = res.current_total_points;
    state.solved = res.daily_solved;
    state.completed = res.daily_completed;

    const existingAnswer = state.answers.find((answer) => answer.quizIndex === state.current);
    if (!existingAnswer) {
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

    $$(".option-button").forEach((button) => {
      const index = Number(button.dataset.index);
      if (index === res.correct_idx) button.classList.add("correct");
      if (index === selectedIndex && !isCorrect) button.classList.add("wrong");
    });

    $("#quizFeedback").innerHTML = \`
      <strong>\${isCorrect ? "정답입니다" : "아쉬워요"}</strong>
      <p>\${res.explanation}</p>
      <button id="nextQuizButton" class="action-button compact" type="button">다음 문제</button>
    \`;
    $("#quizFeedback").classList.remove("hidden");
    $("#nextQuizButton").addEventListener("click", () => {
      nextQuiz();
    });

    updateStats();`);

// nextQuiz 및 신규 함수 추가
appJs = appJs.replace(/function nextQuiz\(\) \{[\s\S]*?renderQuiz\(\);[\s\S]*?\}/, `function nextQuiz() {
  state.current = (state.current + 1) % state.quizzes.length;
  state.locked = false;
  renderQuiz();
}

function startNextSet() {
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
      showToast(\`축하합니다! \${res.reward_points}P가 적립되었습니다.\`);
    } else if (res.already_claimed) {
      showToast("오늘의 최대 리워드 한도(100P)에 도달했습니다. 학습은 계속 하실 수 있습니다!");
    } else {
      showToast("아쉽게도 이번 세트에서는 획득한 포인트가 없습니다.");
    }
    
    renderReview();
  } catch (err) {
    showToast(err.message || "리워드 처리 중 오류가 발생했습니다.");
  }
}`);

// bindEvents에 버튼 바인딩 추가
appJs = appJs.replace(/window\.addEventListener\("hashchange"/, `$("#claimRewardButton")?.addEventListener("click", claimReward);
  $("#startNextSetButton")?.addEventListener("click", startNextSet);

  window.addEventListener("hashchange"`);

fs.writeFileSync(appJsPath, appJs);

// 2. index.html 수정
const htmlPath = path.join(__dirname, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

html = html.replace(/<div id="reviewList" class="review-list"><\/div>/, `
            <div id="rewardClaimSection" class="reward-claim-section" style="margin: 20px 0; display: flex; gap: 10px; flex-direction: column;">
              <button id="claimRewardButton" class="action-button" type="button">10문제 보상 받기</button>
              <button id="startNextSetButton" class="outline-button" type="button">다음 10문제 도전하기</button>
            </div>
            <div id="reviewList" class="review-list"></div>`);

fs.writeFileSync(htmlPath, html);

console.log('done');
