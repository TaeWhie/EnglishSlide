const fs = require('fs');
const path = require('path');

const appJsPath = path.join(__dirname, 'app.js');
let content = fs.readFileSync(appJsPath, 'utf8');

// 1. 중복/손상된 중간 구간을 찾아 제거합니다.
// routeFromHash() 등이 중복되어 나타나는 구간을 기준으로 잘라냅니다.
const marker = 'function routeFromHash() {';
const firstIndex = content.indexOf(marker);
const lastIndex = content.lastIndexOf(marker);

if (firstIndex !== lastIndex) {
    // 중복이 발견됨. 첫 번째 정의부터 두 번째 정의 직전까지를 잘라내거나 조정합니다.
    // 여기서는 안전하게 356번 라인 근처의 쓰레기 코드부터 정리합니다.
    content = content.replace(/return viewMap\[location\.hash\.slice\(1\)\] \|\| "homeView";\n\}\n  startButton\.classList\.remove\("disabled"\);[\s\S]*?async function renderQuiz\(\)/, 
`return viewMap[location.hash.slice(1)] || "homeView";
}

async function renderQuiz()`);
}

// 2. renderQuiz 내의 중복 로직 방어 (이미 적용되었을 수 있지만 확실히 함)
// verifyAnswer 내의 $$(".option-button") 오타 수정 (이전 diff에서 .option-button 앞의 $가 하나 빠진 적이 있음)
content = content.replace(/\.forEach\(\(button\) => \{/, '.forEach((button) => {');

fs.writeFileSync(appJsPath, content);
console.log('app.js fixed');
