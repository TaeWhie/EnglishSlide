const fs = require('fs');
const path = require('path');

const appJsPath = path.join(__dirname, 'app.js');
let appJs = fs.readFileSync(appJsPath, 'utf8');

// 1. 모든 $(".class")를 $$(".class")로 교체 (querySelectorAll가 필요한 곳들)
appJs = appJs.replace(/\$\("\.nav-item"\)/g, '$$(".nav-item")');
appJs = appJs.replace(/\$\("\.option-button"\)/g, '$$(".option-button")');
appJs = appJs.replace(/\$\("\.mode-btn"\)/g, '$$(".mode-btn")');
appJs = appJs.replace(/\$\("\.view"\)/g, '$$(".view")');

// 2. switchView 함수 보강: 퀴즈 탭 진입 시 상태를 더 확실히 제어
appJs = appJs.replace(/if \(viewId === "quizView"\) \{/, \`if (viewId === "quizView") {
    // 강제 초기화가 필요한 경우 (예: 탭 버튼 클릭)를 위해 renderQuiz 호출 전 상태 점검
    console.log("Switching to quizView, quizzes length:", state.quizzes.length);\`);

// 3. renderQuiz 함수 내부에 오타 수정 (이미 위에서 교체되었겠지만 확실히 함)
appJs = appJs.replace(/\$\("\.option-button"\)\.forEach/, '$$(".option-button").forEach');

// 4. fetchQuizzesAndStart 함수에 로그 추가
appJs = appJs.replace(/async function fetchQuizzesAndStart\(\) \{/, \`async function fetchQuizzesAndStart() {
  console.log("Fetching quizzes for mode:", state.quizMode);\`);

fs.writeFileSync(appJsPath, appJs);
console.log('done');
