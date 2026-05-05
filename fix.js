const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf8');

code = code.replace(
  'if (state.completed || state.solved >= 10) {',
  'if (false) { // 무제한 풀기 허용'
);

code = code.replace(
  'if (state.locked || state.completed) return;',
  'if (state.locked) return;'
);

code = code.replace(
  /startButton\.disabled = state\.completed;[\s\S]*?startButton\.classList\.toggle\("disabled", state\.completed\);/,
  'startButton.disabled = false;\n  startButton.textContent = "도전하기 (무제한)";\n  startButton.classList.remove("disabled");'
);

code = code.replace(
  /if \(state\.completed\) \{[\s\S]*?return;\n  \}/,
  ''
);

code = code.replace(
  /<p>\$\{res\.explanation\} \$\{earned\}P가 적립되었습니다\.\<\/p>/,
  '<p>${isCorrect ? (earned === 0 ? res.explanation + " (일일 최대 100P 한도 도달)" : res.explanation + " " + earned + "P 적립") : res.explanation}</p>'
);

code = code.replace(
  /<button id="rewardAd" class="action-button compact" type="button">\$\{state\.completed \? "완료하기" : isCorrect \? "보상 2배 광고 보기" : "다음 문제"\}<\/button>/,
  '<button id="rewardAd" class="action-button compact" type="button">다음 문제</button>'
);

fs.writeFileSync('app.js', code);
console.log('done');
