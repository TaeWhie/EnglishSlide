// 로컬 환경과 배포 환경(Render)의 API 주소를 분기처리합니다.
// TODO: 배포 후 your-backend-service.onrender.com 부분을 실제 백엔드 주소로 변경하세요.
const API_BASE = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost"
  ? "http://127.0.0.1:8000/v1"
  : "https://nrc-backend-llgx.onrender.com/v1";
const UNIT_ROTATION_START_DATE = "2026-05-05";

function formatLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const todayKey = formatLocalDateKey(new Date());
const quizSessionKey = "nrc_active_quiz_session";
const savedDaily = JSON.parse(localStorage.getItem("nrc_daily_quiz") || "{}");
const initialDaily = savedDaily.date === todayKey ? savedDaily : { date: todayKey, solved: 0, current: 0, completed: false, answers: [], modeCounts: null };
const savedProfile = JSON.parse(localStorage.getItem("nrc_user_profile") || "null");
let pendingGoogleUser = null;

function createEmptyModeCounts() {
  return { eng: 0, kor: 0, mixed: 0, incorrect: 0 };
}

function normalizeModeCounts(rawCounts, fallbackSolved = 0) {
  const counts = createEmptyModeCounts();
  if (rawCounts && typeof rawCounts === "object") {
    for (const key of Object.keys(counts)) {
      const value = Number(rawCounts[key] || 0);
      counts[key] = Number.isFinite(value) && value > 0 ? value : 0;
    }
  } else if (fallbackSolved > 0) {
    counts.mixed = fallbackSolved;
  }
  return counts;
}

const state = {
  incorrectWords: JSON.parse(localStorage.getItem("nrc_incorrect_words") || "[]"),
  quizMode: "mixed",
  user: savedProfile,
  points: savedProfile ? savedProfile.total_points || 0 : 0,
  coupons: [],
  lockscreen: { enabled: true, rewardPrompt: true },
  quizzes: [],
  shopItems: [],
  solved: initialDaily.solved,
  current: initialDaily.current,
  completed: initialDaily.completed,
  answers: Array.isArray(initialDaily.answers) ? initialDaily.answers : [],
  modeCounts: normalizeModeCounts(initialDaily.modeCounts, initialDaily.solved),
  rewardStatus: { remaining: 1000, cap: 1000, earned: 0 },
  quizActivity: null,
  studyLibrary: null,
  quizWordUnits: null,
  quizSourceMap: null,
  studySeries: "1000",
  studyVolume: "",
  studyUnitKey: "",
  studySearch: "",
  locked: false,
  timer: 15,
  timerId: null,
  questionDeadline: null,
  totalRevenue: 1250400
};

let rewardClaimPending = false;
let retryInterstitialPending = false;
let quizConfirmResolver = null;

function getTotalSolvedFromDaily(daily) {
  if (!daily || typeof daily !== "object") return 0;
  const counts = normalizeModeCounts(daily.modeCounts, daily.solved);
  const counted = Object.values(counts).reduce((sum, count) => sum + Number(count || 0), 0);
  return Math.max(Number(daily.solved || 0), counted);
}

function readActivityHistory() {
  return JSON.parse(localStorage.getItem("nrc_quiz_activity_history") || "{}");
}

function writeActivityHistory(history) {
  localStorage.setItem("nrc_quiz_activity_history", JSON.stringify(history || {}));
}

function rememberActivityDay(dateKey, count) {
  if (!dateKey) return;
  const safeCount = Math.max(0, Number(count || 0));
  if (safeCount <= 0) return;
  const history = readActivityHistory();
  history[dateKey] = Math.max(Number(history[dateKey] || 0), safeCount);
  writeActivityHistory(history);
}

if (savedDaily.date && savedDaily.date !== todayKey) {
  rememberActivityDay(savedDaily.date, getTotalSolvedFromDaily(savedDaily));
}

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let loadingDepth = 0;

function showLoading(title = "처리 중", message = "서버와 통신하고 있습니다.") {
  const overlay = $("#loadingOverlay");
  if (!overlay) return;
  $("#loadingTitle").textContent = title;
  $("#loadingMessage").textContent = message;
  loadingDepth += 1;
  overlay.classList.remove("hidden");
}

function hideLoading() {
  const overlay = $("#loadingOverlay");
  if (!overlay) return;
  loadingDepth = Math.max(0, loadingDepth - 1);
  if (loadingDepth === 0) {
    overlay.classList.add("hidden");
  }
}

async function withLoading(title, message, task) {
  showLoading(title, message);
  try {
    return await task();
  } finally {
    hideLoading();
  }
}

function setButtonBusy(button, busy, label = "처리 중") {
  if (!button) return;
  if (busy) {
    button.dataset.idleText = button.textContent;
    button.textContent = label;
  } else if (button.dataset.idleText) {
    button.textContent = button.dataset.idleText;
    delete button.dataset.idleText;
  }
  button.disabled = busy;
  button.classList.toggle("is-loading", busy);
}

async function apiCall(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  try {
    const res = await fetch(`${API_BASE}${endpoint}`, options);
    if (!res.ok) {
      const error = await res.json().catch(() => ({ detail: 'API Error' }));
      throw new Error(error.detail || "API 오류가 발생했습니다.");
    }
    return await res.json();
  } catch (err) {
    console.error("API Call Error:", err);
    throw err;
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function getSolvedBreakdownText() {
  const labels = [
    ["eng", "영영"],
    ["kor", "영한"],
    ["mixed", "오늘의 퀴즈"],
    ["incorrect", "오답"]
  ];
  const parts = labels
    .map(([key, label]) => {
      const count = Number(state.modeCounts?.[key] || 0);
      return count > 0 ? `${label} ${count}` : "";
    })
    .filter(Boolean);
  return parts.length ? parts.join(" · ") : "아직 푼 문제가 없습니다.";
}

function renderRewardAvailability() {
  const pointsNode = $("#rewardAvailablePoints");
  const metaNode = $("#rewardAvailableMeta");
  if (!pointsNode || !metaNode) return;

  const remaining = Number(state.rewardStatus?.remaining || 0);
  const earned = Number(state.rewardStatus?.earned || 0);
  pointsNode.textContent = `${formatNumber(remaining)}P`;
  metaNode.textContent = earned > 0
    ? `\uC624\uB298 ${formatNumber(earned)}P \uC801\uB9BD, \uCD94\uAC00\uB85C ${formatNumber(remaining)}P \uAC00\uB2A5`
    : "\uBCF4\uC0C1 \uD034\uC988 \uAE30\uC900 \uB0A8\uC740 \uC801\uB9BD \uAC00\uB2A5 \uD3EC\uC778\uD2B8";
}

function formatShortDateLabel(dateText) {
  if (!dateText) return "";
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateText;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function getActivityIntensity(count, maxCount) {
  if (count <= 0 || maxCount <= 0) return 0;
  const ratio = count / maxCount;
  if (ratio >= 0.75) return 4;
  if (ratio >= 0.5) return 3;
  if (ratio >= 0.25) return 2;
  return 1;
}

function renderActivityCalendar() {
  const card = $("#activityCalendarCard");
  if (!card) return;

  const activityDays = Array.isArray(state.quizActivity?.days) ? state.quizActivity.days : [];
  const history = readActivityHistory();
  const countsByDate = new Map(Object.entries(history).map(([date, count]) => [date, Number(count || 0)]));
  activityDays.forEach((day) => {
    if (!day.date) return;
    countsByDate.set(day.date, Math.max(Number(countsByDate.get(day.date) || 0), Number(day.count || 0)));
  });
  const totalSolvedToday = Object.values(state.modeCounts || {}).reduce((sum, count) => sum + Number(count || 0), 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const slots = [];

  for (let offset = -6; offset <= 0; offset += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + offset);
    const key = formatLocalDateKey(date);
    const isToday = offset === 0;
    const count = countsByDate.has(key)
      ? countsByDate.get(key)
      : (isToday ? totalSolvedToday : 0);
    const solved = count > 0;
    const label = `${date.getMonth() + 1}/${date.getDate()}`;
    const classes = ["calendar-slot"];
    if (isToday) classes.push("is-today");
    if (solved) classes.push("is-solved");
    slots.push(`
      <article class="${classes.join(" ")}" aria-label="${key} ${solved ? "O" : "X"}">
        <span class="calendar-slot-date">${label}</span>
        <strong class="calendar-slot-mark">${solved ? "O" : "X"}</strong>
      </article>
    `);
  }

  card.innerHTML = `
    <div class="calendar-card-head simple">
      <div class="calendar-card-copy">
        <strong>\uD034\uC988 \uCE98\uB9B0\uB354</strong>
      </div>
    </div>
    <div class="calendar-strip">${slots.join("")}</div>
  `;
}

async function loadStudyLibrary() {
  if (state.studyLibrary) return state.studyLibrary;
  const payload = await new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", "file:///android_asset/www/data/study_library.json", true);
    request.overrideMimeType("application/json");
    request.onload = () => {
      if (request.status === 0 || (request.status >= 200 && request.status < 300)) {
        try {
          resolve(JSON.parse(request.responseText));
        } catch (err) {
          reject(new Error("\uB2E8\uC5B4 \uB370\uC774\uD130 \uD615\uC2DD\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4."));
        }
      } else {
        reject(new Error("\uB2E8\uC5B4 \uB370\uC774\uD130\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4."));
      }
    };
    request.onerror = () => reject(new Error("\uB2E8\uC5B4 \uB370\uC774\uD130\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4."));
    request.send();
  });
  state.studyLibrary = payload && Array.isArray(payload.series) ? payload : { series: [] };
  return state.studyLibrary;
}

async function loadQuizWordUnits() {
  if (state.quizWordUnits) return state.quizWordUnits;
  const payload = await new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", "file:///android_asset/www/data/words.json", true);
    request.overrideMimeType("application/json");
    request.onload = () => {
      if (request.status === 0 || (request.status >= 200 && request.status < 300)) {
        try {
          resolve(JSON.parse(request.responseText));
        } catch {
          reject(new Error("quiz words parse failed"));
        }
      } else {
        reject(new Error("quiz words load failed"));
      }
    };
    request.onerror = () => reject(new Error("quiz words load failed"));
    request.send();
  });
  state.quizWordUnits = Array.isArray(payload) ? payload : [];
  return state.quizWordUnits;
}

function getTodayBackendUnit(maxUnit) {
  const start = new Date(`${UNIT_ROTATION_START_DATE}T00:00:00`);
  const today = new Date();
  start.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  const dayOffset = Math.floor((today.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  return ((dayOffset % Math.max(1, maxUnit)) + Math.max(1, maxUnit)) % Math.max(1, maxUnit) + 1;
}

async function ensureQuizSourceMap() {
  if (state.quizSourceMap) return state.quizSourceMap;
  const [quizWords, studyLibrary] = await Promise.all([loadQuizWordUnits(), loadStudyLibrary()]);
  const backendUnits = new Map();
  quizWords.forEach((word) => {
    const unit = Number(word.unit || 1);
    if (!backendUnits.has(unit)) backendUnits.set(unit, new Set());
    backendUnits.get(unit).add(String(word.word || "").toLowerCase());
  });

  const studyUnits = [];
  (studyLibrary.series || []).forEach((series) => {
    (series.books || []).forEach((book) => {
      (book.units || []).forEach((unit) => {
        studyUnits.push({
          seriesId: series.id,
          seriesTitle: series.title,
          volume: book.volume,
          bookTitle: book.title,
          unit: unit.unit,
          words: new Set((unit.words || []).map((entry) => String(entry.word || "").toLowerCase()))
        });
      });
    });
  });

  const resolvedMap = new Map();
  backendUnits.forEach((wordSet, backendUnit) => {
    let bestMatch = null;
    studyUnits.forEach((candidate) => {
      let overlap = 0;
      wordSet.forEach((word) => {
        if (candidate.words.has(word)) overlap += 1;
      });
      if (!bestMatch || overlap > bestMatch.overlap) {
        bestMatch = { ...candidate, overlap };
      }
    });
    if (bestMatch) resolvedMap.set(backendUnit, bestMatch);
  });
  state.quizSourceMap = resolvedMap;
  return resolvedMap;
}

async function renderQuizSourceCard() {
  const panel = document.getElementById("quizModeSelect");
  if (!panel) return;
  let card = document.getElementById("quizSourceCard");
  if (!card) {
    card = document.createElement("article");
    card.id = "quizSourceCard";
    card.className = "quiz-source-card";
    card.innerHTML = `
      <p class="eyebrow">오늘 출제 범위</p>
      <strong id="quizSourceTitle">단어장을 확인하는 중입니다.</strong>
      <p id="quizSourceCopy">오늘 퀴즈 출제 범위를 불러오고 있습니다.</p>
    `;
    const buttons = panel.querySelector(".mode-buttons");
    panel.insertBefore(card, buttons || null);
  }

  try {
    const sourceMap = await ensureQuizSourceMap();
    const maxUnit = Math.max(1, ...sourceMap.keys());
    const todayUnit = getTodayBackendUnit(maxUnit);
    const source = sourceMap.get(todayUnit);
    const title = document.getElementById("quizSourceTitle");
    const copy = document.getElementById("quizSourceCopy");
    if (!source || !title || !copy) return;
    title.textContent = `${source.seriesId} · ${source.volume}권 · Unit ${source.unit}`;
    copy.textContent = `${source.bookTitle} 범위에서 오늘 퀴즈가 출제됩니다.`;
  } catch {
    const title = document.getElementById("quizSourceTitle");
    const copy = document.getElementById("quizSourceCopy");
    if (title) title.textContent = "출제 범위를 불러오지 못했습니다.";
    if (copy) copy.textContent = "잠시 후 다시 시도해주세요.";
  }
}

function getCurrentStudySeries() {
  const seriesList = state.studyLibrary?.series || [];
  return seriesList.find((series) => series.id === state.studySeries) || seriesList[0] || null;
}

function getCurrentStudyBooks() {
  const series = getCurrentStudySeries();
  return Array.isArray(series?.books) ? series.books : [];
}

function getCurrentStudyBook() {
  const books = getCurrentStudyBooks();
  return books.find((book) => String(book.volume) === String(state.studyVolume)) || books[0] || null;
}

function getCurrentStudyUnits() {
  const series = getCurrentStudySeries();
  const book = getCurrentStudyBook();
  if (!series || !book) return [];
  return book.units.map((unit) => ({
    ...unit,
    volume: book.volume,
    bookTitle: book.title,
    unitKey: `${series.id}:${book.volume}:${unit.unit}`
  }));
}

function getCurrentStudyUnit() {
  const units = getCurrentStudyUnits();
  return units.find((unit) => unit.unitKey === state.studyUnitKey) || units[0] || null;
}

function getFilteredStudyWords() {
  const query = state.studySearch.trim().toLowerCase();
  if (!query) {
    const unit = getCurrentStudyUnit();
    return Array.isArray(unit?.words) ? unit.words : [];
  }

  const allSeries = state.studyLibrary?.series || [];
  const searchPool = allSeries.flatMap((series) =>
    (series.books || []).flatMap((book) =>
      (book.units || []).flatMap((unit) =>
        (unit.words || []).map((word) => ({
          ...word,
          seriesId: series.id,
          seriesTitle: series.title,
          volume: book.volume,
          unit: unit.unit,
          bookTitle: book.title
        }))
      )
    )
  );

  return searchPool.filter((item) => {
    return [item.word, item.korean, item.english, item.part, item.example]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
}

function applyStudyStaticLabels() {
  const titleMap = {
    studyIntroTitle: "\uCC45\uBCC4 \uB2E8\uC5B4 \uD559\uC2B5",
    studyIntroCopy: "\uCC45\uC744 \uBA3C\uC800 \uACE0\uB974\uACE0, \uAD8C\uACFC \uC720\uB2DB\uC744 \uCC28\uB840\uB300\uB85C \uC120\uD0DD\uD574\uC11C \uD574\uB2F9 \uC720\uB2DB\uC758 \uB2E8\uC5B4\uB97C \uC77D\uC5B4\uBCF4\uC138\uC694.",
    studyBookPickerTitle: "\uAD8C \uC120\uD0DD",
    studyUnitPickerTitle: "\uC720\uB2DB \uC120\uD0DD",
    studySearchLabel: "\uB2E8\uC5B4 \uCC3E\uAE30"
  };
  Object.entries(titleMap).forEach(([id, text]) => {
    const node = document.getElementById(id);
    if (node) node.textContent = text;
  });

  const input = $("#studySearchInput");
  if (input) {
    input.placeholder = "\uC804\uCCB4 \uB2E8\uC5B4\uC5D0\uC11C \uAC80\uC0C9";
  }
}

function renderStudyView() {
  applyStudyStaticLabels();
  const unitList = $("#studyResultsSection");
  const bookCount = $("#studyBookCount");
  const unitCount = $("#studyUnitCount");
  const searchMeta = $("#studySearchMeta");
  const bookTabs = $("#studyBookTabs");
  const unitTabs = $("#studyUnitTabs");
  if (!unitList || !bookCount || !unitCount || !searchMeta || !bookTabs || !unitTabs) return;

  const series = getCurrentStudySeries();
  const books = getCurrentStudyBooks();
  const selectedBook = getCurrentStudyBook();
  const units = getCurrentStudyUnits();
  const selectedUnit = getCurrentStudyUnit();
  $$(".study-book-chip").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.series === (series?.id || state.studySeries));
  });

  if (!series || !selectedBook || !selectedUnit) {
    bookCount.textContent = "0\uAD8C";
    unitCount.textContent = "0\uAC1C";
    bookTabs.innerHTML = "";
    unitTabs.innerHTML = "";
    unitList.innerHTML = `<div class="empty-state">\uB2E8\uC5B4 \uB370\uC774\uD130\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.</div>`;
    return;
  }

  state.studyVolume = String(selectedBook.volume);
  state.studyUnitKey = selectedUnit.unitKey;
  const filteredWords = getFilteredStudyWords();
  bookCount.textContent = `${formatNumber(books.length)}\uAD8C`;
  unitCount.textContent = `${formatNumber(units.length)}\uAC1C`;
  searchMeta.textContent = state.studySearch.trim()
    ? `1000 / 2000 / 4000 \uC804\uCCB4\uC5D0\uC11C ${formatNumber(filteredWords.length)}\uAC1C \uB2E8\uC5B4\uAC00 \uAC80\uC0C9\uB418\uC5C8\uC2B5\uB2C8\uB2E4.`
    : `${selectedUnit.volume}\uAD8C Unit ${selectedUnit.unit} \uB2E8\uC5B4\uB97C \uBCF4\uACE0 \uC788\uC2B5\uB2C8\uB2E4.`;

  bookTabs.innerHTML = books.map((book) => `
    <button class="study-unit-tab ${String(book.volume) === String(selectedBook.volume) ? "active" : ""}" type="button" data-volume="${book.volume}">
      ${book.volume}\uAD8C
    </button>
  `).join("");
  $$("#studyBookTabs .study-unit-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.studyVolume = button.dataset.volume || "";
      state.studyUnitKey = "";
      state.studySearch = "";
      const input = $("#studySearchInput");
      if (input) input.value = "";
      renderStudyView();
    });
  });

  unitTabs.innerHTML = units.map((unit) => `
    <button class="study-unit-tab ${unit.unitKey === selectedUnit.unitKey ? "active" : ""}" type="button" data-unit-key="${unit.unitKey}">
      U${unit.unit}
    </button>
  `).join("");
  $$("#studyUnitTabs .study-unit-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.studyUnitKey = button.dataset.unitKey || "";
      state.studySearch = "";
      const input = $("#studySearchInput");
      if (input) input.value = "";
      renderStudyView();
    });
  });

  if (!filteredWords.length) {
    unitList.innerHTML = `<div class="empty-state">\uAC80\uC0C9 \uACB0\uACFC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</div>`;
    return;
  }

  if (state.studySearch.trim()) {
    unitList.innerHTML = `
      <article class="study-unit-card">
        <div class="study-unit-head">
          <div>
            <p class="eyebrow">1000 / 2000 / 4000</p>
            <h3>\uAC80\uC0C9 \uACB0\uACFC</h3>
          </div>
          <span class="study-unit-badge">${formatNumber(filteredWords.length)} words</span>
        </div>
        <div class="study-word-list">
          ${filteredWords.map((word) => `
            <div class="study-word-card ${word.is_extra ? "extra" : ""}">
            <div class="study-word-top">
              <strong>${word.word}</strong>
              <span>${word.part || ""}</span>
            </div>
            <p class="study-word-korean">${word.korean || ""}</p>
            <p class="study-word-english">${word.english || ""}</p>
            <p class="study-word-location">${word.seriesId} / ${word.volume}\uAD8C / Unit ${word.unit}</p>
            ${word.example ? `<p class="study-word-example">${word.example}</p>` : ""}
            ${word.is_extra ? `<span class="study-extra-badge">Extra</span>` : ""}
          </div>
        `).join("")}
        </div>
      </article>
    `;
    return;
  }

  unitList.innerHTML = `
    <article class="study-unit-card">
      <div class="study-unit-head">
        <div>
          <p class="eyebrow">${selectedUnit.bookTitle}</p>
          <h3>${selectedUnit.volume}\uAD8C Unit ${selectedUnit.unit}</h3>
        </div>
        <span class="study-unit-badge">${formatNumber(filteredWords.length)} words</span>
      </div>
      <div class="study-word-list">
        ${filteredWords.map((word) => `
          <div class="study-word-card ${word.is_extra ? "extra" : ""}">
            <div class="study-word-top">
              <strong>${word.word}</strong>
              <span>${word.part || ""}</span>
            </div>
            <p class="study-word-korean">${word.korean || ""}</p>
            <p class="study-word-english">${word.english || ""}</p>
            ${word.example ? `<p class="study-word-example">${word.example}</p>` : ""}
            ${word.is_extra ? `<span class="study-extra-badge">Extra</span>` : ""}
          </div>
        `).join("")}
      </div>
    </article>
  `;
}

async function ensureStudyView() {
  try {
    await loadStudyLibrary();
    const series = getCurrentStudySeries();
    if (series && !state.studySeries) {
      state.studySeries = series.id;
    }
    if (!getCurrentStudyBook()) {
      const firstBook = getCurrentStudyBooks()[0];
      state.studyVolume = firstBook ? String(firstBook.volume) : "";
    }
    if (!getCurrentStudyUnit()) {
      const firstUnit = getCurrentStudyUnits()[0];
      state.studyUnitKey = firstUnit?.unitKey || "";
    }
    renderStudyView();
  } catch (err) {
    const unitList = $("#studyUnitList");
    const searchMeta = $("#studySearchMeta");
    if (searchMeta) searchMeta.textContent = err.message || "\uB2E8\uC5B4 \uB370\uC774\uD130\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.";
    if (unitList) {
      unitList.innerHTML = `<div class="empty-state">\uB2E8\uC5B4 \uB370\uC774\uD130\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.</div>`;
    }
  }
}

async function refreshRewardStatus() {
  if (!state.user?.user_id) {
    state.rewardStatus = { remaining: 1000, cap: 1000, earned: 0 };
    renderRewardAvailability();
    return;
  }

  try {
    const status = await apiCall(`/quizzes/reward-status?user_id=${encodeURIComponent(state.user.user_id)}`);
    state.rewardStatus = {
      remaining: Number(status.remaining_reward_points || 0),
      cap: Number(status.daily_reward_cap || 1000),
      earned: Number(status.daily_total_earned || 0)
    };
  } catch (err) {
    state.rewardStatus = { remaining: 0, cap: 1000, earned: 0 };
  }

  renderRewardAvailability();
}

async function refreshQuizActivity() {
  if (!state.user?.user_id) {
    state.quizActivity = null;
    renderActivityCalendar();
    return;
  }

  try {
    const activity = await apiCall(`/quizzes/activity?user_id=${encodeURIComponent(state.user.user_id)}&days=35`);
    state.quizActivity = activity;
  } catch (err) {
    state.quizActivity = null;
  }

  renderActivityCalendar();
}

function updateStats() {
  $("#totalPoints").textContent = `${formatNumber(state.points)}P`;
  const totalSolvedToday = Object.values(state.modeCounts || {}).reduce((sum, count) => sum + Number(count || 0), 0);
  $("#quizSolved").textContent = totalSolvedToday;
  $("#quizSolvedBreakdown").textContent = getSolvedBreakdownText();
  $("#topQuizStatus").textContent = totalSolvedToday > 0 ? `${totalSolvedToday}문제 학습` : "아직 시작 전";
  $("#topProgressFill").style.width = `${Math.min(100, totalSolvedToday * 5)}%`;
  updateProfileStats();
  updateGoalSummary();
  renderRewardAvailability();
  rememberActivityDay(todayKey, totalSolvedToday);
  renderActivityCalendar();
  localStorage.setItem("nrc_daily_quiz", JSON.stringify({
    date: todayKey,
    solved: state.solved,
    current: state.current,
    completed: state.completed,
    answers: state.answers,
    modeCounts: state.modeCounts
  }));
  updateQuizEntryState();
  renderCoupons();
  renderProfile();
}

function hasLogin() {
  return Boolean(state.user && (state.user.nickname || state.user.name));
}

function showLogin() {
  $("#loginView").classList.remove("hidden");
  $("#appShell").classList.add("hidden");
}

function showApp() {
  $("#loginView").classList.add("hidden");
  $("#appShell").classList.remove("hidden");
}

function renderProfile() {
  const name = $("#profileName");
  const avatar = $("#profileAvatar");
  if (!name || !avatar || !state.user) return;
  const nickname = state.user.nickname || state.user.name;
  if (!nickname) return;
  if (!state.user.nickname && nickname) {
    state.user.nickname = nickname;
    localStorage.setItem("nrc_user_profile", JSON.stringify(state.user));
  }
  name.textContent = `${nickname}님, 오늘도 학습 중`;
  avatar.textContent = nickname.slice(0, 2).toUpperCase();
}

function completeGoogleStep(googleUser) {
  setButtonBusy($("#googleLoginButton"), false);
  pendingGoogleUser = googleUser;
  $("#googleLoginButton").classList.add("hidden");
  $("#loginForm").classList.remove("hidden");
  $("#loginGuide").textContent = "Google 로그인 확인이 끝났습니다. 앱에서 사용할 닉네임을 만들어 주세요.";
  $("#loginName").focus();
}

function applyLoginResponse(res, googleUser) {
  state.user = {
    provider: "google",
    googleSub: res.google_sub || googleUser.googleSub,
    email: res.email || googleUser.email || "",
    nickname: res.nickname,
    user_id: res.user_id,
    access_token: res.access_token,
    total_points: res.total_points,
    loggedInAt: new Date().toISOString()
  };
  state.points = res.total_points;

  // 서버 기준 오늘 진행도로 동기화 (기존 계정 재로그인 시 복원)
  if (typeof res.daily_solved === "number") {
    state.solved = res.daily_solved;
    state.current = res.daily_solved;
    state.completed = Boolean(res.daily_completed);
    localStorage.setItem("nrc_daily_quiz", JSON.stringify({
      date: todayKey,
      solved: state.solved,
      current: state.current,
      completed: state.completed,
      answers: state.answers
    }));
  }

  localStorage.setItem("nrc_user_profile", JSON.stringify(state.user));
  pendingGoogleUser = null;
  $("#googleLoginButton").classList.remove("hidden");
  $("#loginForm").classList.add("hidden");
  $("#loginName").value = "";
  showApp();
  renderProfile();
  updateStats();
}

async function loginWithGoogleUser(googleUser, nickname = "") {
  const res = await fetch(`${API_BASE}/auth/google-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      google_sub: googleUser.googleSub,
      email: googleUser.email || "",
      nickname,
      id_token: googleUser.idToken || googleUser.id_token || ""
    })
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: "API Error" }));
    const apiError = new Error(error.detail || "Google login failed.");
    apiError.status = res.status;
    apiError.detail = error.detail;
    throw apiError;
  }
  return res.json();
}

async function continueGoogleLogin(googleUser) {
  setButtonBusy($("#googleLoginButton"), true, "로그인 중");
  try {
    const res = await withLoading(
      "로그인 중",
      "DB에 저장된 계정 정보를 확인하고 있습니다.",
      () => loginWithGoogleUser(googleUser)
    );
    applyLoginResponse(res, googleUser);
    showToast("로그인되었습니다.");
  } catch (err) {
    if (err.status === 409 && err.detail === "nickname required") {
      completeGoogleStep(googleUser);
      return;
    }
    setButtonBusy($("#googleLoginButton"), false);
    showToast(err.message || "로그인 처리 중 오류가 발생했습니다.");
  }
}

function normalizeNativeGooglePayload(payload) {
  if (!payload) return null;
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }
  return payload;
}

window.onNativeGoogleSignIn = (payload) => {
  const googleUser = normalizeNativeGooglePayload(payload);
  if (!googleUser || googleUser.status === "pending") return;
  setButtonBusy($("#googleLoginButton"), false);
  if (googleUser.status === "unconfigured") {
    showToast(googleUser.message || "Google Client ID is not configured.");
    return;
  }
  if (!googleUser.googleSub && !googleUser.idToken && !googleUser.id_token) {
    showToast("Google 로그인 정보를 확인하지 못했습니다.");
    return;
  }
  continueGoogleLogin(googleUser);
};

window.onNativeGoogleSignInError = (message) => {
  setButtonBusy($("#googleLoginButton"), false);
  showToast(message || "Google 로그인에 실패했습니다.");
};

window.onNativeRewardAdResult = (payload) => {
  rewardClaimPending = false;
  try {
    const data = JSON.parse(payload || "{}");
    if (!data.success) {
      showToast(data.message || "\uAD11\uACE0\uB97C \uC7AC\uC0DD\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
      return;
    }
    rewardClaimPending = true;
    if (window.NRCBridge?.claimQuizReward && state.user?.user_id) {
      window.NRCBridge.claimQuizReward(
        state.user.user_id,
        data.adToken || `admob_rewarded_${Date.now()}`
      );
      return;
    }
    showToast("\uBCF4\uC0C1 \uCC98\uB9AC\uB97C \uC9C4\uD589\uD569\uB2C8\uB2E4.");
  } catch (err) {
    rewardClaimPending = false;
    showToast("\uBCF4\uC0C1 \uAD11\uACE0 \uCC98\uB9AC \uC911 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.");
  }
};

window.onNativeRewardClaimResult = async (payload) => {
  rewardClaimPending = false;
  try {
    const data = JSON.parse(payload || "{}");
    if (data.success === false) {
      showToast(data.detail || data.message || "\uBCF4\uC0C1 \uCC98\uB9AC\uB97C \uC644\uB8CC\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
      return;
    }
    state.points = Number(data.current_total_points || state.points || 0);
    await refreshRewardStatus();
    updateStats();
    showToast(
      data.reward_points > 0
        ? `${data.reward_points}P\uAC00 \uC801\uB9BD\uB418\uC5C8\uC2B5\uB2C8\uB2E4.`
        : "\uC801\uB9BD \uAC00\uB2A5\uD55C \uD3EC\uC778\uD2B8\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4."
    );
    clearQuizSession();
    openQuizModeSelect();
  } catch (err) {
    showToast("\uBCF4\uC0C1 \uC751\uB2F5 \uCC98\uB9AC \uC911 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.");
  }
};

window.onNativeInterstitialAdResult = (payload) => {
  retryInterstitialPending = false;
  try {
    const data = JSON.parse(payload || "{}");
    if (!data.success) {
      showToast(data.message || "\uC804\uBA74\uAD11\uACE0\uB97C \uC7AC\uC0DD\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
      return;
    }
    startRetryQuizChallenge();
  } catch (err) {
    showToast("\uC7AC\uB3C4\uC804 \uCC98\uB9AC \uC911 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.");
  }
};

function updateProfileStats() {
  const quizState = $("#profileQuizState");
  const couponCount = $("#profileCouponCount");
  const profilePoints = $("#profilePoints");
  if (!quizState || !couponCount || !profilePoints) return;
  const totalSolvedToday = Object.values(state.modeCounts || {}).reduce((sum, count) => sum + Number(count || 0), 0);
  quizState.textContent = `${totalSolvedToday}문제`;
  couponCount.textContent = `${state.coupons.length}개`;
  profilePoints.textContent = `${formatNumber(state.points)}P`;
}

async function saveLockscreenSettings() {
  if (!state.user) return;
  syncNativeLockscreenSettings();
  try {
    await apiCall(`/settings/lockscreen?user_id=${state.user.user_id}`, 'PUT', state.lockscreen);
  } catch (err) {
    console.error(err);
  }
}

function syncNativeLockscreenSettings() {
  if (window.NRCBridge?.updateLockscreenSettings) {
    const rewardPrompt = state.lockscreen.reward_prompt ?? state.lockscreen.rewardPrompt ?? true;
    window.NRCBridge.updateLockscreenSettings(Boolean(state.lockscreen.enabled), Boolean(rewardPrompt));
  }
}

function updateGoalSummary() {
  if (state.shopItems.length === 0) return;
  const nextItem = state.shopItems.find((item) => item.price_points > state.points) || state.shopItems[state.shopItems.length - 1];
  const remain = Math.max(0, nextItem.price_points - state.points);
  $("#nextGoal").textContent = nextItem.name;
  $("#goalRemain").textContent = remain === 0 ? "교환 가능" : `${formatNumber(remain)}P 남음`;
}

function updateQuizEntryState() {
  const startButton = $("#startQuiz");
  if (!startButton) return;
  startButton.disabled = false;
  startButton.textContent = "도전하기 (무제한)";
  startButton.classList.remove("disabled");
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.add("hidden"), 2600);
}

function requiresQuizModeConfirm(mode) {
  return mode === "eng" || mode === "kor" || mode === "mixed";
}

function closeQuizModeConfirm(accepted) {
  const overlay = $("#quizConfirmOverlay");
  if (overlay) overlay.classList.add("hidden");
  const resolver = quizConfirmResolver;
  quizConfirmResolver = null;
  if (resolver) resolver(Boolean(accepted));
}

function confirmQuizModeStart() {
  const overlay = $("#quizConfirmOverlay");
  if (!overlay) return Promise.resolve(true);
  overlay.classList.remove("hidden");
  return new Promise((resolve) => {
    quizConfirmResolver = resolve;
  });
}

async function handleQuizModeSelection(mode) {
  if (mode === "incorrect") {
    startIncorrectQuiz();
    return;
  }
  if (requiresQuizModeConfirm(mode)) {
    const accepted = await confirmQuizModeStart();
    if (!accepted) return;
  }
  state.quizMode = mode;
  fetchQuizzesAndStart();
}


function applyAppStaticLabels() {
  const loginTitle = document.querySelector("#loginView h1");
  if (loginTitle) loginTitle.textContent = "로그인";

  const loginGuide = document.getElementById("loginGuide");
  if (loginGuide) loginGuide.textContent = "Google 계정으로 로그인한 뒤 앱에서 사용할 닉네임을 만들어 주세요.";

  const googleButton = document.getElementById("googleLoginButton");
  if (googleButton) googleButton.innerHTML = `<span>G</span>Google로 계속하기`;

  const todayEyebrow = document.querySelector(".today-summary .eyebrow");
  if (todayEyebrow) todayEyebrow.textContent = "오늘의 학습";

  const goalEyebrow = document.querySelector(".goal-summary .eyebrow");
  if (goalEyebrow) goalEyebrow.textContent = "다음 교환 목표";

  const quizProgressLabel = document.querySelector("#homeView .stats-grid .metric:nth-of-type(2) > p");
  if (quizProgressLabel) quizProgressLabel.textContent = "퀴즈 진행";

  const rewardLabel = document.querySelector("#homeView .stats-grid .metric:nth-of-type(3) > p");
  if (rewardLabel) rewardLabel.textContent = "오늘 적립 가능";

  const dailyEyebrow = document.querySelector(".daily-card .eyebrow");
  if (dailyEyebrow) dailyEyebrow.textContent = "오늘의 추천";

  const dailyTitle = document.querySelector(".daily-card h3");
  if (dailyTitle) dailyTitle.textContent = "오늘의 10문제 세트";

  const dailyCopy = document.querySelector(".daily-card p:not(.eyebrow)");
  if (dailyCopy) dailyCopy.textContent = "생활 영어, 비즈니스, 여행 표현을 엮어 출제합니다.";

  const startQuiz = document.getElementById("startQuiz");
  if (startQuiz) startQuiz.textContent = "도전하기";

  const recommendTag = document.querySelector(".recommend-card span");
  if (recommendTag) recommendTag.textContent = "오늘의 목표";

  const recommendTitle = document.querySelector(".recommend-card strong");
  if (recommendTitle) recommendTitle.textContent = "꾸준함을 쌓아보세요";

  const recommendCopy = document.querySelector(".recommend-card p");
  if (recommendCopy) recommendCopy.textContent = "오늘 퀴즈를 마치면 교환 목표까지 더 가까워집니다.";

  const navLabels = { homeView: "홈", quizView: "퀴즈", studyView: "학습", shopView: "상점", reportView: "마이" };
  document.querySelectorAll(".nav-item").forEach((button) => {
    const label = navLabels[button.dataset.view];
    if (label) button.textContent = label;
  });

  const loadingTitle = document.getElementById("loadingTitle");
  if (loadingTitle) loadingTitle.textContent = "처리 중";
  const loadingMessage = document.getElementById("loadingMessage");
  if (loadingMessage) loadingMessage.textContent = "서버와 통신하고 있습니다.";

  const completeStrong = document.querySelector("#quizComplete > strong");
  if (completeStrong) completeStrong.textContent = "오늘의 퀴즈를 완료했습니다";
  const completeCopy = document.querySelector("#quizComplete > p");
  if (completeCopy) completeCopy.textContent = "광고를 본 뒤 10문제 정답률에 따라 포인트가 적립됩니다.";

  const reviewTitle = document.querySelector("#reviewPanel h3");
  if (reviewTitle) reviewTitle.textContent = "오늘의 복습";

  const myStatsTitle = document.querySelector(".learning-panel h3");
  if (myStatsTitle) myStatsTitle.textContent = "이용 현황";
}

function applyQuizStaticLabels() {
  const selectEyebrow = document.getElementById("quizSelectEyebrow");
  if (selectEyebrow) selectEyebrow.style.display = "none";
  const selectTitle = document.getElementById("quizSelectTitle") || document.querySelector("#quizModeSelect h3");
  if (selectTitle) selectTitle.style.display = "none";
  const selectCopy = document.querySelector("#quizModeSelect > p:not(.eyebrow)");
  if (selectCopy) selectCopy.style.display = "none";

  const completeEyebrow = document.getElementById("quizCompleteEyebrow");
  if (completeEyebrow) completeEyebrow.remove();
  const completeTitle = document.getElementById("quizCompleteTitle");
  if (completeTitle) completeTitle.remove();

  const reviewActions = document.querySelector("#quizComplete .review-actions");
  if (reviewActions && !document.getElementById("retryQuizButton")) {
    const retryButton = document.createElement("button");
    retryButton.id = "retryQuizButton";
    retryButton.className = "outline-button";
    retryButton.type = "button";
    retryButton.textContent = "\uC7AC\uB3C4\uC804";
    const rewardButton = document.getElementById("claimRewardButton");
    if (rewardButton) {
      reviewActions.insertBefore(retryButton, rewardButton);
    } else {
      reviewActions.appendChild(retryButton);
    }
  }

  const retryButton = $("#retryQuizButton");
  if (retryButton) retryButton.textContent = "\uC7AC\uB3C4\uC804";
  const backButton = $("#skipRewardButton");
  if (backButton) backButton.remove();
  const rewardButton = $("#claimRewardButton");
  if (rewardButton) rewardButton.textContent = "\uBCF4\uC0C1 \uD68D\uB4DD";
  const confirmTitle = $("#quizConfirmTitle");
  if (confirmTitle) confirmTitle.textContent = "\uD034\uC988 \uC2DC\uC791";
  const confirmMessage = $("#quizConfirmMessage");
  if (confirmMessage) {
    confirmMessage.textContent = "\uD3EC\uC778\uD2B8 \uC9C0\uAE09 \uD034\uC988\uB97C \uC2DC\uC791\uD558\uBA74 \uC644\uB8CC \uC804\uAE4C\uC9C0 \uB2E4\uB978 \uD034\uC988\uB85C \uBCC0\uACBD\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.";
  }
  const confirmCancel = $("#quizConfirmCancel");
  if (confirmCancel) confirmCancel.textContent = "\uCDE8\uC18C";
  const confirmAccept = $("#quizConfirmAccept");
  if (confirmAccept) confirmAccept.textContent = "\uACC4\uC18D";
  renderQuizSourceCard();
}

function renderQuizModeSelectPanel() {
  const panel = document.getElementById("quizModeSelect");
  if (!panel) return;
  panel.innerHTML = `
    <article id="quizSourceCard" class="quiz-source-card">
      <p class="eyebrow">오늘 출제 범위</p>
      <strong id="quizSourceTitle">단어 범위를 확인하고 있습니다.</strong>
      <p id="quizSourceCopy">오늘 퀴즈가 어느 책과 유닛에서 나오는지 불러오고 있습니다.</p>
    </article>
    <div class="mode-buttons">
      <button class="action-button outline mode-btn" type="button" data-mode="eng">영영 퀴즈</button>
      <button class="action-button outline mode-btn" type="button" data-mode="kor">영한 퀴즈</button>
      <button class="action-button mode-btn" type="button" data-mode="mixed">오늘의 퀴즈</button>
      <button class="action-button outline mode-btn" type="button" data-mode="incorrect">오답 퀴즈</button>
    </div>
  `;
  panel.querySelectorAll(".mode-btn").forEach((button) => {
    button.addEventListener("click", () => {
      handleQuizModeSelection(button.dataset.mode);
    });
  });
  renderQuizSourceCard();
}

function updateCurrentTabTitle(viewId) {
  const title = $("#currentTabTitle");
  if (!title) return;
  const labels = {
    homeView: "\uD648",
    quizView: "\uD034\uC988",
    studyView: "\uD559\uC2B5",
    shopView: "\uC0C1\uC810",
    reportView: "\uB9C8\uC774"
  };
  title.textContent = labels[viewId] || "\uD648";
}

function syncViewMode(viewId) {
  const appShell = $("#appShell");
  const workspace = document.querySelector(".workspace");
  const topbar = document.querySelector(".topbar");
  const topbarSummary = document.querySelector(".topbar-summary");
  const isQuiz = viewId === "quizView";
  if (appShell) {
    appShell.classList.toggle("quiz-mode", isQuiz);
  }
  if (workspace) {
    workspace.classList.toggle("quiz-mode", isQuiz);
  }
  if (topbar) {
    topbar.classList.remove("quiz-hidden");
    topbar.style.display = "";
  }
  if (topbarSummary) {
    topbarSummary.style.display = "grid";
  }
}

function setQuizDisplayState(mode) {
  const quizView = $("#quizView");
  if (!quizView) return;
  quizView.classList.remove("quiz-state-select", "quiz-state-active", "quiz-state-complete");
  if (mode) {
    quizView.classList.add(`quiz-state-${mode}`);
  }
}

function setQuizFeedbackVisible(visible) {
  const quizView = $("#quizView");
  if (!quizView) return;
  quizView.classList.toggle("quiz-feedback-visible", Boolean(visible));
}

function scrollActiveViewToTop(viewId) {
  const appShell = $("#appShell");
  if (appShell) appShell.classList.add("nav-jumping");
  const workspace = document.querySelector(".workspace");
  const activeView = document.getElementById(viewId);
  const scroller = document.scrollingElement || document.documentElement;
  if (workspace) {
    workspace.scrollTop = 0;
    if (workspace.scrollTo) workspace.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }
  if (scroller) scroller.scrollTop = 0;
  if (activeView?.scrollTo) {
    activeView.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }
  if (activeView) {
    activeView.scrollTop = 0;
  }
  $$(".view").forEach((view) => {
    view.scrollTop = 0;
  });
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  window.scrollTo(0, 0);
  requestAnimationFrame(() => {
    if (workspace) {
      workspace.scrollTop = 0;
      if (workspace.scrollTo) workspace.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
    if (scroller) scroller.scrollTop = 0;
    if (activeView?.scrollTo) {
      activeView.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
    if (activeView) {
      activeView.scrollTop = 0;
    }
    window.scrollTo(0, 0);
    requestAnimationFrame(() => {
      if (appShell) appShell.classList.remove("nav-jumping");
    });
  });
}

function switchView(viewId) {
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === viewId));
  updateCurrentTabTitle(viewId);
  syncViewMode(viewId);
  scrollActiveViewToTop(viewId);
  if (viewId === "quizView") {
    renderQuiz();
  } else if (viewId === "studyView") {
    ensureStudyView();
  } else if (viewId === "reportView") {
    renderCoupons();
    renderLockscreenSettings();
    renderIncorrectWords();
    clearInterval(state.timerId);
    state.locked = false;
  } else {
    clearInterval(state.timerId);
    state.locked = false;
    if (viewId === "homeView") {
      refreshQuizActivity().catch(() => {});
    }
  }
}

function syncRoute(viewId) {
  const routeMap = {
    homeView: "home",
    quizView: "quiz",
    studyView: "study",
    shopView: "shop",
    reportView: "profile"
  };
  const nextHash = routeMap[viewId] || "home";
  if (location.hash.slice(1) !== nextHash) {
    history.replaceState(null, "", `#${nextHash}`);
  }
}

function routeFromHash() {
  const viewMap = {
    home: "homeView",
    quiz: "quizView",
    study: "studyView",
    shop: "shopView",
    profile: "reportView"
  };
  return viewMap[location.hash.slice(1)] || "homeView";
}

function startTimer() {
  clearInterval(state.timerId);
  if (!state.questionDeadline) state.questionDeadline = Date.now() + 15000;
  state.timer = Math.max(0, Math.ceil((state.questionDeadline - Date.now()) / 1000));
  $("#timer").textContent = state.timer;
  $("#timer").classList.toggle("warning", state.timer < 5);
  $("#quizProgress").style.width = `${Math.max(0, (state.timer / 15) * 100)}%`;
  if (state.timer <= 0) {
    verifyAnswer(-1);
    return;
  }
  saveQuizSession();
  state.timerId = setInterval(() => {
    state.timer = Math.max(0, Math.ceil((state.questionDeadline - Date.now()) / 1000));
    $("#timer").textContent = state.timer;
    $("#timer").classList.toggle("warning", state.timer < 5);
    $("#quizProgress").style.width = `${Math.max(0, (state.timer / 15) * 100)}%`;
    if (state.timer <= 0) {
      clearInterval(state.timerId);
      verifyAnswer(-1);
    }
  }, 1000);
}

function restoreQuizSession() {
  const saved = JSON.parse(localStorage.getItem(quizSessionKey) || "null");
  if (!saved || saved.date !== todayKey || !Array.isArray(saved.quizzes) || saved.quizzes.length === 0) return;
  if (Array.isArray(saved.answers) && saved.answers.length >= 10 && !saved.completed) return;
  state.quizMode = saved.quizMode || state.quizMode;
  state.quizzes = saved.quizzes;
  state.current = Number(saved.current || 0);
  state.completed = Boolean(saved.completed);
  state.answers = Array.isArray(saved.answers) ? saved.answers : [];
  state.questionDeadline = saved.questionDeadline || null;
}

function saveQuizSession() {
  if (!Array.isArray(state.quizzes) || state.quizzes.length === 0) return;
  localStorage.setItem(quizSessionKey, JSON.stringify({
    date: todayKey,
    quizMode: state.quizMode,
    quizzes: state.quizzes,
    current: state.current,
    completed: state.completed,
    answers: state.answers,
    questionDeadline: state.questionDeadline
  }));
}

function clearQuizSession() {
  localStorage.removeItem(quizSessionKey);
}

function advancePastAnsweredQuestion() {
  if (!state.quizzes.length || !state.answers.length || state.answers.length >= 10) return;
  const answered = new Set(state.answers.map((answer) => Number(answer.quizIndex)));
  let guard = 0;
  const initialCurrent = state.current;
  while (answered.has(state.current) && guard < state.quizzes.length) {
    state.current = (state.current + 1) % state.quizzes.length;
    guard += 1;
  }
  if (state.current !== initialCurrent) state.questionDeadline = null;
  saveQuizSession();
}

function resumeOrOpenQuiz() {
  if (state.quizzes.length) {
    switchView("quizView");
    syncRoute("quizView");
  } else {
    openQuizModeSelect();
  }
}

async function renderQuiz() {
  if (state.quizzes.length === 0) {
    setQuizDisplayState("select");
    setQuizFeedbackVisible(false);
    renderQuizModeSelectPanel();
    $("#quizModeSelect")?.classList.remove("hidden");
    $("#quizHead").classList.add("hidden");
    $("#quizProgressWrap").classList.add("hidden");
    $("#quizComplete").classList.add("hidden");
    $("#reviewPanel").classList.add("hidden");
    $("#quizFeedback").classList.add("hidden");
    $("#optionList").innerHTML = "";
    return;
  }

  if (state.answers.length >= 10) {
    state.completed = true;
    saveQuizSession();
    clearInterval(state.timerId);
    setQuizFeedbackVisible(false);
    $("#quizModeSelect")?.classList.add("hidden");
    $("#quizHead").classList.add("hidden");
    $("#quizProgressWrap").classList.add("hidden");
    $("#optionList").innerHTML = "";
    $("#quizFeedback").classList.add("hidden");
    setQuizDisplayState("complete");
    $("#quizComplete").classList.remove("hidden");
    await updateRewardControls();
    renderReview();
    $("#reviewPanel").classList.remove("hidden");
    updateStats();
    return;
  }

  if (false) { // 무제한 풀기 허용
    setQuizDisplayState("complete");
    setQuizFeedbackVisible(false);
    state.completed = true;
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

  if (state.quizzes.length === 0) {
    try {
      state.quizzes = await withLoading(
        "퀴즈 로딩 중",
        "오늘의 문제를 불러오고 있습니다.",
        () => apiCall('/quizzes/daily')
      );
    } catch (e) {
      showToast("퀴즈를 불러오지 못했습니다.");
      return;
    }
  }

  advancePastAnsweredQuestion();
  setQuizDisplayState("active");
  setQuizFeedbackVisible(false);
  const quiz = state.quizzes[state.current % state.quizzes.length];
  $("#quizModeSelect")?.classList.add("hidden");
  $("#quizHead").classList.remove("hidden");
  $("#quizProgressWrap").classList.remove("hidden");
  $("#quizCategory").textContent = `${quiz.category} · Level ${quiz.level}`;
  $("#quizQuestion").textContent = quiz.question;
  $("#quizComplete").classList.add("hidden");
  $("#reviewPanel").classList.add("hidden");
  $("#quizFeedback").classList.add("hidden");
  $("#optionList").innerHTML = quiz.options
    .map((option, index) => `<button class="option-button" type="button" data-index="${index}">${String.fromCharCode(65 + index)}. ${option}</button>`)
    .join("");
  $$(".option-button").forEach((button) => {
    button.addEventListener("click", () => verifyAnswer(Number(button.dataset.index)));
  });
  startTimer();
}

async function verifyAnswer(selectedIndex) {
  if (state.locked) return;
  if (!state.quizzes.length) return;
  state.locked = true;
  clearInterval(state.timerId);
  $$(".option-button").forEach((button) => button.disabled = true);

  const quiz = state.quizzes[state.current % state.quizzes.length];
  const selectedAnswer = selectedIndex >= 0 ? quiz.options[selectedIndex] : "시간 초과";
  
  try {
    const res = state.quizMode === "incorrect" ? {
      is_correct: selectedIndex === quiz._correct_idx,
      correct_idx: quiz._correct_idx,
      explanation: quiz.explanation || "",
      earned_points: 0,
      current_total_points: state.points,
      daily_solved: state.solved,
      daily_completed: false
    } : await withLoading(
      "채점 중",
      "정답과 포인트를 확인하고 있습니다.",
      () => apiCall('/quizzes/verify', 'POST', {
        user_id: state.user.user_id,
        quiz_id: quiz.quiz_id,
        selected_idx: selectedIndex
      })
    );

    const isCorrect = res.is_correct;
    state.points = res.current_total_points;
    state.solved = res.daily_solved;
    state.completed = state.answers.length + 1 >= 10;

    const existingAnswer = state.answers.find((answer) => answer.quizIndex === state.current);
    if (!existingAnswer) {
      if (!state.modeCounts[state.quizMode]) state.modeCounts[state.quizMode] = 0;
      state.modeCounts[state.quizMode] += 1;
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
    saveQuizSession();

    $$(".option-button").forEach((button) => {
      const index = Number(button.dataset.index);
      if (index === res.correct_idx) button.classList.add("correct");
      if (index === selectedIndex && !isCorrect) {
        button.classList.add("wrong");
        saveIncorrectWord(quiz);
      }
    });

    if (state.answers.length >= 10) {
      updateStats();
      renderQuiz();
      return;
    }

    const feedbackPanel = $("#quizFeedback");
    feedbackPanel.classList.remove("correct", "wrong");
    feedbackPanel.classList.add(isCorrect ? "correct" : "wrong");
    feedbackPanel.innerHTML = `
      <strong>${isCorrect ? "정답입니다" : "아쉬워요"}</strong>
      <p>${res.explanation}</p>
      <button id="nextQuizButton" class="action-button compact" type="button">다음 문제</button>
    `;
    feedbackPanel.classList.remove("hidden");
    setQuizFeedbackVisible(true);
    $("#nextQuizButton").addEventListener("click", nextQuiz);

    updateStats();
  } catch (err) {
    state.locked = false;
    $$(".option-button").forEach((button) => button.disabled = false);
    showToast(err.message || "채점 중 오류가 발생했습니다.");
  }
}

function nextQuiz() {
  if (state.answers.length >= 10) {
    state.completed = true;
    state.locked = false;
    renderQuiz();
    return;
  }
  state.current = (state.current + 1) % state.quizzes.length;
  state.questionDeadline = null;
  state.locked = false;
  saveQuizSession();
  renderQuiz();
}

async function claimReward() {
  if (state.quizMode === "incorrect") {
    openQuizModeSelect();
    return;
  }
  if (!state.user) return;
  if (rewardClaimPending) return;
  if (window.NRCBridge?.showRewardedAd) {
    rewardClaimPending = true;
    window.NRCBridge.showRewardedAd();
    showToast("\uBCF4\uC0C1\uD615 \uAD11\uACE0\uB97C \uBD88\uB7EC\uC624\uB294 \uC911\uC785\uB2C8\uB2E4.");
    return;
  }
  try {
    const res = await withLoading(
      "리워드 신청 중",
      "광고 확인 후 포인트를 적립하고 있습니다.",
      () => apiCall('/quizzes/reward', 'POST', {
        user_id: state.user.user_id,
        ad_token: `ad_sim_${Date.now()}`
      })
    );
    state.points = res.current_total_points;
    await refreshRewardStatus();
    updateStats();
    showToast(res.reward_points > 0 ? `${res.reward_points}P가 적립되었습니다.` : "적립 가능한 포인트가 없습니다.");
    clearQuizSession();
    openQuizModeSelect();
  } catch (err) {
    showToast(err.message || "리워드 처리 중 오류가 발생했습니다.");
  }
}

function openQuizModeSelect() {
  clearQuizSession();
  state.quizzes = [];
  state.completed = false;
  state.current = 0;
  state.answers = [];
  state.questionDeadline = null;
  clearInterval(state.timerId);
  state.locked = false;
  switchView("quizView");
  syncRoute("quizView");
}

function startRetryQuizChallenge() {
  clearQuizSession();
  state.completed = false;
  state.current = 0;
  state.answers = [];
  state.questionDeadline = null;
  clearInterval(state.timerId);
  state.locked = false;
  openQuizModeSelect();
}

function retryQuizChallenge() {
  if (retryInterstitialPending) return;
  if (window.NRCBridge?.showInterstitialAd) {
    retryInterstitialPending = true;
    window.NRCBridge.showInterstitialAd();
    showToast("\uC7AC\uB3C4\uC804 \uAD11\uACE0\uB97C \uBD88\uB7EC\uC624\uB294 \uC911\uC785\uB2C8\uB2E4.");
    return;
  }
  startRetryQuizChallenge();
}

async function updateRewardControls() {
  const rewardButton = $("#claimRewardButton");
  const skipButton = $("#skipRewardButton");
  const retryButton = $("#retryQuizButton");
  if (skipButton) skipButton.remove();
  if (retryButton) retryButton.classList.remove("hidden");
  if (!rewardButton) return;

  rewardButton.textContent = "보상 획득";
  rewardButton.disabled = false;

  if (state.quizMode === "incorrect") {
    rewardButton.textContent = "오답 퀴즈는 보상 없음";
    rewardButton.disabled = true;
    return;
  }

  if (!state.user?.user_id) {
    rewardButton.textContent = "로그인 필요";
    rewardButton.disabled = true;
    return;
  }

  try {
    const status = await apiCall(`/quizzes/reward-status?user_id=${encodeURIComponent(state.user.user_id)}`);
    const remaining = Number(status.remaining_reward_points || 0);
    state.rewardStatus = {
      remaining,
      cap: Number(status.daily_reward_cap || 1000),
      earned: Number(status.daily_total_earned || 0)
    };
    renderRewardAvailability();
    if (remaining <= 0) {
      rewardButton.textContent = "오늘 보상 한도 도달";
      rewardButton.disabled = true;
    } else {
      rewardButton.textContent = `보상 획득 (최대 ${formatNumber(remaining)}P)`;
    }
  } catch (err) {
    rewardButton.textContent = "보상 확인 실패";
    rewardButton.disabled = true;
  }
}

async function fetchQuizzesAndStart() {
  try {
    state.quizzes = await withLoading(
      "로딩 중",
      "문제를 생성하고 있습니다.",
      () => apiCall(`/quizzes/daily?mode=${state.quizMode}`)
    );
    state.completed = false;
    state.current = 0;
    state.answers = [];
    state.questionDeadline = null;
    saveQuizSession();
    renderQuiz();
  } catch (e) {
    showToast("퀴즈를 불러오지 못했습니다.");
  }
}

function saveIncorrectWord(quiz) {
  const key = String(quiz?.word || "").trim().toLowerCase();
  if (!key) return;
  const unique = new Map();
  state.incorrectWords.forEach((word) => {
    const existingKey = String(word?.word || "").trim().toLowerCase();
    if (existingKey && !unique.has(existingKey)) unique.set(existingKey, word);
  });
  if (!unique.has(key)) {
    unique.set(key, {
      word: quiz.word,
      korean: quiz.korean || quiz.options?.[quiz._correct_idx] || "",
      english: quiz.english || quiz.question,
      category: quiz.category,
      level: quiz.level
    });
  }
  state.incorrectWords = [...unique.values()];
  localStorage.setItem("nrc_incorrect_words", JSON.stringify(state.incorrectWords));
}

function renderIncorrectWords() {
  const container = $("#incorrectWordList");
  if (!container) return;
  container.innerHTML = state.incorrectWords.length ? state.incorrectWords.map((word) => `
    <div class="incorrect-item">
      <strong>${word.word}</strong>
      <span>${word.korean || word.english || ""}</span>
    </div>
  `).join("") : '<div class="empty-state">틀린 단어가 아직 없습니다.</div>';
}

function toggleIncorrectNote() {
  const panel = $("#incorrectNotePanel");
  if (!panel) return;
  renderIncorrectWords();
  panel.classList.toggle("hidden");
}

function startIncorrectQuiz() {
  if (state.incorrectWords.length < 4) {
    showToast("오답 단어가 부족합니다. 최소 4개가 필요합니다.");
    return;
  }

  const picked = [...state.incorrectWords].sort(() => 0.5 - Math.random()).slice(0, 10);
  state.quizzes = picked.map((word) => {
    const distractors = state.incorrectWords
      .filter((item) => item.word !== word.word)
      .sort(() => 0.5 - Math.random())
      .slice(0, 3)
      .map((item) => item.korean);
    while (distractors.length < 3) distractors.push("해당 없음");
    const options = [word.korean, ...distractors].sort(() => 0.5 - Math.random());
    return {
      quiz_id: `incorrect_${word.word}`,
      word: word.word,
      question: word.word,
      options,
      category: "오답 복습",
      level: word.level || 1,
      explanation: word.korean,
      _correct_idx: options.indexOf(word.korean)
    };
  });
  state.quizMode = "incorrect";
  state.completed = false;
  state.current = 0;
  state.answers = [];
  state.questionDeadline = null;
  saveQuizSession();
  switchView("quizView");
  syncRoute("quizView");
}

async function renderShop() {
  if (state.shopItems.length === 0) {
    try {
      state.shopItems = await withLoading(
        "상점 로딩 중",
        "교환 목록을 불러오고 있습니다.",
        () => apiCall('/rewards/items')
      );
    } catch (e) {
      showToast("상점 목록을 불러오지 못했습니다.");
      return;
    }
  }

  $("#shopList").innerHTML = state.shopItems
    .map(
      (item) => `
        <article class="shop-item">
          <div class="visual">🎁</div>
          <strong>${item.name}</strong>
          <p>금액권 교환</p>
          <p><b>${formatNumber(item.price_points)}P</b></p>
          <button type="button" data-item="${item.item_id}">교환하기</button>
        </article>
      `
    )
    .join("");

  $$("#shopList button").forEach((button) => {
    button.addEventListener("click", () => exchangeItem(button.dataset.item));
  });
}

async function exchangeItem(itemId) {
  const item = state.shopItems.find((entry) => entry.item_id === itemId);
  if (!item) return;
  if (state.points < item.price_points) {
    showToast("보유 포인트가 부족합니다.");
    return;
  }
  
  try {
    const res = await withLoading(
      "교환 처리 중",
      "쿠폰을 발급하고 있습니다.",
      () => apiCall('/rewards/exchange', 'POST', {
        user_id: state.user.user_id,
        item_id: itemId
      })
    );
    
    state.points = res.remaining_points;
    state.coupons.unshift(res.coupon);
    
    updateStats();
    showToast(`${res.coupon.name} 교환 완료. 마이페이지 쿠폰함에서 확인할 수 있습니다.`);
  } catch (err) {
    showToast(err.message || "교환 처리 중 오류가 발생했습니다.");
  }
}

async function renderCoupons() {
  const list = $("#couponList");
  const count = $("#couponCount");
  if (!list || !count) return;

  if (state.user) {
    try {
      state.coupons = await apiCall(`/coupons?user_id=${state.user.user_id}`);
    } catch (e) {}
  }

  count.textContent = `${state.coupons.length}개`;
  if (!state.coupons.length) {
    list.innerHTML = `<div class="empty-state">아직 교환한 금액권이 없습니다.</div>`;
    return;
  }
  list.innerHTML = state.coupons.map((coupon) => `
    <article class="coupon-card">
      <div>
        <strong>${coupon.name}</strong>
        <p>${coupon.issuedAt || coupon.issued_at} 발급 · ${coupon.status}</p>
      </div>
      <code>${coupon.coupon_code || coupon.code}</code>
    </article>
  `).join("");
}

function renderReview() {
  const panel = $("#reviewPanel");
  const list = $("#reviewList");
  const score = $("#reviewScore");
  if (!panel || !list || !score) return;

  const correctCount = state.answers.filter((answer) => answer.isCorrect).length;
  score.textContent = `${correctCount}/${state.answers.length || 10}`;

  if (!state.answers.length) {
    list.innerHTML = `<div class="empty-state">오늘 풀이 기록이 없습니다.</div>`;
    return;
  }

  list.innerHTML = state.answers.map((answer, index) => `
    <article class="review-card ${answer.isCorrect ? "correct" : "wrong"}">
      <div class="review-mark">${answer.isCorrect ? "정답" : "오답"}</div>
      <div>
        <strong>${index + 1}. ${answer.question}</strong>
        <p>내 답: <b>${answer.selected}</b></p>
        <p>정답: <b>${answer.correct}</b></p>
        <small>${answer.explanation}</small>
      </div>
    </article>
  `).join("");
}

async function renderLockscreenSettings() {
  const enabled = $("#lockscreenEnabled");
  const reward = $("#lockscreenReward");
  if (!enabled || !reward) return;

  if (state.user) {
    try {
      state.lockscreen = await apiCall(`/settings/lockscreen?user_id=${state.user.user_id}`);
    } catch (e) {}
  }

  enabled.checked = state.lockscreen.enabled;
  reward.checked = state.lockscreen.reward_prompt ?? state.lockscreen.rewardPrompt ?? true;
  syncNativeLockscreenSettings();
}

function bindEvents() {
  $("#googleLoginButton").addEventListener("click", () => {
    setButtonBusy($("#googleLoginButton"), true, "Google 확인 중");
    if (window.NRCBridge?.googleSignIn) {
      try {
        window.onNativeGoogleSignIn(window.NRCBridge.googleSignIn());
      } catch {
        setButtonBusy($("#googleLoginButton"), false);
        showToast("Google 로그인 정보를 확인하지 못했습니다.");
      }
      return;
    }
    continueGoogleLogin({
      provider: "google",
      googleSub: `browser-google-${Date.now()}`,
      email: "",
      displayName: "Google User"
    });
    showToast("브라우저 미리보기에서는 Google 로그인 단계를 시뮬레이션합니다.");
  });

  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const nickname = $("#loginName").value.trim();
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
      const res = await withLoading(
        "로그인 중",
        "계정 정보를 확인하고 있습니다.",
        () => loginWithGoogleUser(pendingGoogleUser, nickname)
      );
      
      applyLoginResponse(res, pendingGoogleUser);
      showToast("로그인되었습니다.");
    } catch (err) {
      showToast(err.message || "로그인 처리 중 오류가 발생했습니다.");
    } finally {
      setButtonBusy(submitButton, false);
    }
  });

  $("#logoutButton").addEventListener("click", () => {
    if (window.NRCBridge?.signOut) {
      window.NRCBridge.signOut();
    }
    localStorage.removeItem("nrc_user_profile");
    localStorage.removeItem("nrc_daily_quiz");
    clearQuizSession();
    state.user = null;
    showLogin();
    showToast("로그아웃되었습니다.");
  });

  $$(".nav-item").forEach((item) => item.addEventListener("click", () => {
    const targetView = item.dataset.view;
    if (!targetView) return;
    if (item.dataset.view === "quizView") {
      resumeOrOpenQuiz();
      return;
    }
    scrollActiveViewToTop(targetView);
    switchView(targetView);
    syncRoute(targetView);
  }));
  $("#startQuiz").addEventListener("click", () => {
    if (state.completed && !state.quizzes.length) {
      showToast("오늘의 퀴즈는 이미 완료했습니다.");
      return;
    }
    resumeOrOpenQuiz();
  });
  $("#claimRewardButton")?.addEventListener("click", claimReward);
  $("#retryQuizButton")?.addEventListener("click", retryQuizChallenge);
  $("#quizConfirmCancel")?.addEventListener("click", () => closeQuizModeConfirm(false));
  $("#quizConfirmAccept")?.addEventListener("click", () => closeQuizModeConfirm(true));
  $("#quizConfirmOverlay")?.addEventListener("click", (event) => {
    if (event.target?.id === "quizConfirmOverlay") {
      closeQuizModeConfirm(false);
    }
  });
  $("#showIncorrectNoteButton")?.addEventListener("click", toggleIncorrectNote);
  $("#startIncorrectQuiz")?.addEventListener("click", startIncorrectQuiz);
  $("#studySearchInput")?.addEventListener("input", (event) => {
    state.studySearch = event.target.value || "";
    renderStudyView();
  });
  $$(".study-book-chip").forEach((button) => {
    button.addEventListener("click", () => {
      const nextSeries = button.dataset.series;
      if (!nextSeries) return;
      state.studySeries = nextSeries;
      state.studyVolume = "";
      state.studyUnitKey = "";
      state.studySearch = "";
      const input = $("#studySearchInput");
      if (input) input.value = "";
      $$(".study-book-chip").forEach((chip) => chip.classList.toggle("active", chip === button));
      renderStudyView();
    });
  });
  $("#lockscreenEnabled").addEventListener("change", (event) => {
    state.lockscreen.enabled = event.target.checked;
    saveLockscreenSettings();
    showToast(state.lockscreen.enabled ? "잠금화면 퀴즈가 켜졌습니다." : "잠금화면 퀴즈가 꺼졌습니다.");
  });

  $("#lockscreenReward").addEventListener("change", (event) => {
    state.lockscreen.rewardPrompt = event.target.checked;
    saveLockscreenSettings();
    showToast(state.lockscreen.rewardPrompt ? "보상 안내가 켜졌습니다." : "보상 안내가 꺼졌습니다.");
  });



  $$("[data-view-target]").forEach((button) => {
    button.addEventListener("click", () => {
      switchView(button.dataset.viewTarget);
      syncRoute(button.dataset.viewTarget);
    });
  });

  window.addEventListener("hashchange", () => switchView(routeFromHash()));
}



async function init() {
  applyAppStaticLabels();
  applyQuizStaticLabels();
  bindEvents();
  restoreQuizSession();
  if (hasLogin()) {
    showApp();
    await Promise.all([
      renderShop(),
      renderCoupons(),
      renderLockscreenSettings(),
      refreshRewardStatus(),
      refreshQuizActivity(),
      loadStudyLibrary()
    ]);
    switchView(routeFromHash());
  } else {
    showLogin();
    renderShop();
    renderActivityCalendar();
    loadStudyLibrary().catch(() => {});
  }
  updateStats();

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      showToast("오프라인 캐시 등록은 HTTPS 환경에서 활성화됩니다.");
    });
  }
}

init();
