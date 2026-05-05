const fs = require('fs');
const path = require('path');

const appJsPath = path.join(__dirname, 'app.js');
let content = fs.readFileSync(appJsPath, 'utf8');

// 1. 중복된 헬퍼 함수들 및 중복 정의 제거
// 중복된 routeFromHash, syncRoute, switchView 등이 하단에 생겼을 수 있으므로 정리합니다.

// 특정 패턴의 중복 구간을 제거합니다. (예: line 357-405 부근의 오동작 구간)
content = content.replace(/return viewMap\[location\.hash\.slice\(1\)\] \|\| "homeView";\n\}\n  startButton\.classList\.remove\("disabled"\);[\s\S]*?return viewMap\[location\.hash\.slice\(1\)\] \|\| "homeView";\n\}/, 
`return viewMap[location.hash.slice(1)] || "homeView";
}`);

// renderQuiz, verifyAnswer, nextQuiz는 이미 최신 로직(safety check 포함)이 반영되었으나 
// 중복 삽입되었을 수 있으므로 확인 후 하나만 남깁니다.
// (이미 replace_file_content가 적용된 상태라면 중복 부분을 수동으로 잘라내는 것이 안전함)

fs.writeFileSync(appJsPath, content);
console.log('app.js cleaned');
