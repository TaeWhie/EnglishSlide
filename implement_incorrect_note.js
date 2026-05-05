const fs = require('fs');
const path = require('path');

// 1. index.html 수정
const htmlPath = path.join(__dirname, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

const incorrectNoteSection = \`
          <div class="settings-group">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <h3>오답노트</h3>
              <button id="startIncorrectQuiz" class="action-button compact outline" type="button">오답 퀴즈 풀기</button>
            </div>
            <div id="incorrectWordList" class="incorrect-list" style="margin-top: 12px; background: #fff; border-radius: 8px; border: 1px solid var(--line); min-height: 80px; padding: 12px;">
              <p class="empty-msg" style="text-align: center; color: var(--muted); padding: 20px 0;">틀린 단어가 아직 없습니다.</p>
            </div>
          </div>
\`;

html = html.replace(/<div class="settings-group">[\s\S]*?<\/div>[\s\S]*?<\/div>/, (match) => match + incorrectNoteSection);
fs.writeFileSync(htmlPath, html);

// 2. app.js 수정
const appJsPath = path.join(__dirname, 'app.js');
let appJs = fs.readFileSync(appJsPath, 'utf8');

// state에 incorrectWords 추가
appJs = appJs.replace(/const state = \{/, \`const state = {
  incorrectWords: JSON.parse(localStorage.getItem("nrc_incorrect_words") || "[]"),\`);

// verifyAnswer 수정: 틀렸을 때 오답노트에 저장
appJs = appJs.replace(/if \(!isCorrect\) button\.classList\.add\("wrong"\);/, (match) => \`\${match}
      if (!isCorrect) saveIncorrectWord(quiz);\`);

// 헬퍼 함수들 추가
const helpers = \`
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
    renderIncorrectWords();
  }
}

function renderIncorrectWords() {
  const container = $("#incorrectWordList");
  if (!container) return;
  if (state.incorrectWords.length === 0) {
    container.innerHTML = '<p class="empty-msg" style="text-align: center; color: var(--muted); padding: 20px 0;">틀린 단어가 아직 없습니다.</p>';
    return;
  }
  container.innerHTML = state.incorrectWords.map(w => \`
    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #f0f0f0; padding: 8px 0;">
      <strong>\${w.word}</strong>
      <span style="color: var(--muted);">\${w.korean}</span>
    </div>
  \`).join("");
}

function startIncorrectQuiz() {
  if (state.incorrectWords.length < 4) {
    showToast("오답 퀴즈를 풀려면 최소 4개의 틀린 단어가 필요합니다.");
    return;
  }
  
  // 오답노트에서 최대 10개를 랜덤하게 뽑아 퀴즈 생성
  const picked = [...state.incorrectWords].sort(() => 0.5 - Math.random()).slice(0, 10);
  state.quizzes = picked.map(w => {
    // 오답노트 내 다른 단어들을 오답 선택지로 활용
    const distractors = state.incorrectWords
      .filter(dw => dw.word !== w.word)
      .sort(() => 0.5 - Math.random())
      .slice(0, 3)
      .map(dw => dw.korean);
    
    // 선택지가 부족하면 기본값 추가
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
}
\`;

appJs = appJs.replace(/async function fetchQuizzesAndStart\(\)/, \`\${helpers}\nasync function fetchQuizzesAndStart()\`);

// bindEvents에 이벤트 연결
appJs = appJs.replace(/function bindEvents\(\) \{/, \`function bindEvents() {
  $("#startIncorrectQuiz")?.addEventListener("click", startIncorrectQuiz);\`);

// reportView 진입 시 오답노트 렌더링 호출
appJs = appJs.replace(/renderLockscreenSettings\(\);/, \`renderLockscreenSettings();
    renderIncorrectWords();\`);

fs.writeFileSync(appJsPath, appJs);
console.log('done');
