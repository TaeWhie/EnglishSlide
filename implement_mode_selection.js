const fs = require('fs');
const path = require('path');

// 1. index.html 수정
const htmlPath = path.join(__dirname, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

html = html.replace(/<button id="startQuiz" class="action-button" type="button">도전하기<\/button>/, `
              <div class="quiz-start-group" style="display: flex; gap: 10px; margin-top: 15px;">
                <button id="startQuizKor" class="action-button" type="button" style="flex: 1;">영한 퀴즈</button>
                <button id="startQuizEng" class="action-button outline" type="button" style="flex: 1;">영영 퀴즈</button>
              </div>`);

fs.writeFileSync(htmlPath, html);

// 2. app.js 수정
const appJsPath = path.join(__dirname, 'app.js');
let appJs = fs.readFileSync(appJsPath, 'utf8');

// state에 quizMode 추가 (기본값 kor)
appJs = appJs.replace(/const state = \{/, `const state = {
  quizMode: 'kor',`);

// renderQuiz에서 API 호출 시 mode 파라미터 전달
appJs = appJs.replace(/\(\) => apiCall\('\/quizzes\/daily'\)/, `() => apiCall(\`/quizzes/daily?mode=\${state.quizMode}\`)`);

// startNextSet에서도 mode 유지
appJs = appJs.replace(/function startNextSet\(\) \{/, `function startNextSet() {
  state.quizzes = []; // 새 세트를 위해 초기화`);

// bindEvents에서 신규 버튼 바인딩
appJs = appJs.replace(/\$("#startQuiz")\.addEventListener\("click", \(\) => \{[\s\S]*?\}\);/, `
  $("#startQuizKor")?.addEventListener("click", () => {
    state.quizMode = 'kor';
    state.quizzes = [];
    switchView("quizView");
    syncRoute("quizView");
  });
  $("#startQuizEng")?.addEventListener("click", () => {
    state.quizMode = 'eng';
    state.quizzes = [];
    switchView("quizView");
    syncRoute("quizView");
  });`);

fs.writeFileSync(appJsPath, appJs);
console.log('done');
