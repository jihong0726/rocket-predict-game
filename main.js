// ===== 工具函数 =====
const STORAGE_KEY = "rocketPredictGame_v2";

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.error("loadState error", e);
    return null;
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function createEmptyAccount(mode) {
  let initialChips = 100;
  if (mode === "normal") initialChips = 60;
  if (mode === "hard") initialChips = 30;

  return {
    mode,
    chips: initialChips,
    roundIndex: 0,
    totalRounds: 0,
    totalWins: 0,
    maxStreak: 0,
    currentStreak: 0,
    totalPnl: 0,
    history: [] // 存最近 20 局
  };
}

function generateShortCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "ACC-";
  for (let i = 0; i < 8; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return s;
}

function formatTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    "-" +
    pad(d.getMonth() + 1) +
    "-" +
    pad(d.getDate()) +
    " " +
    pad(d.getHours()) +
    ":" +
    pad(d.getMinutes()) +
    ":" +
    pad(d.getSeconds())
  );
}

// ===== 状态管理 =====
let appState = loadState() || {
  currentAccountCode: null,
  accounts: {} // code -> accountState
};

// 初始化默认账号
if (!appState.currentAccountCode) {
  const defaultCode = generateShortCode();
  appState.currentAccountCode = defaultCode;
  appState.accounts[defaultCode] = createEmptyAccount("easy");
  saveState(appState);
}

let currentAccountCode = appState.currentAccountCode;
let account = appState.accounts[currentAccountCode];

// 运行时状态（不存 localStorage）
let currentSymbol = "BTC-USDT";
let currentPrice = null;
let priceSource = "okx"; // okx / mock
let lastPriceUpdatedAt = null;

let isRoundRunning = false;
let roundTimerId = null;
let roundDeadline = null;
let lockedRoundInfo = null;

// ===== DOM =====
const modeSelect = document.getElementById("modeSelect");
const chipsDisplay = document.getElementById("chipsDisplay");
const roundIndexDisplay = document.getElementById("roundIndexDisplay");
const resetAccountBtn = document.getElementById("resetAccountBtn");

const symbolSelect = document.getElementById("symbolSelect");
const priceDisplay = document.getElementById("priceDisplay");
const priceSourceLabel = document.getElementById("priceSourceLabel");
const priceUpdatedAtLabel = document.getElementById("priceUpdatedAt");
const reconnectBtn = document.getElementById("reconnectBtn");

const countdownDisplay = document.getElementById("countdownDisplay");
const startPriceDisplay = document.getElementById("startPriceDisplay");
const endPriceDisplay = document.getElementById("endPriceDisplay");
const betSizeInput = document.getElementById("betSizeInput");
const betUpBtn = document.getElementById("betUpBtn");
const betDownBtn = document.getElementById("betDownBtn");

const totalRoundsDisplay = document.getElementById("totalRoundsDisplay");
const winRateDisplay = document.getElementById("winRateDisplay");
const maxStreakDisplay = document.getElementById("maxStreakDisplay");
const totalPnlDisplay = document.getElementById("totalPnlDisplay");
const historyTableBody = document.getElementById("historyTableBody");

const exportCodeInput = document.getElementById("exportCodeInput");
const generateCodeBtn = document.getElementById("generateCodeBtn");
const importCodeInput = document.getElementById("importCodeInput");
const importCodeBtn = document.getElementById("importCodeBtn");

const themeToggleBtn = document.getElementById("themeToggleBtn");

// ===== 渲染函数 =====
function renderAccountBasic() {
  modeSelect.value = account.mode;
  chipsDisplay.textContent = account.chips;
  roundIndexDisplay.textContent = account.roundIndex;
}

function renderStats() {
  totalRoundsDisplay.textContent = account.totalRounds;
  if (account.totalRounds === 0) {
    winRateDisplay.textContent = "--";
  } else {
    const rate = (account.totalWins / account.totalRounds) * 100;
    winRateDisplay.textContent = rate.toFixed(1) + "%";
  }
  maxStreakDisplay.textContent = account.maxStreak;

  totalPnlDisplay.textContent = (account.totalPnl >= 0 ? "+" : "") + account.totalPnl;
  totalPnlDisplay.classList.remove("positive", "negative");
  if (account.totalPnl > 0) totalPnlDisplay.classList.add("positive");
  if (account.totalPnl < 0) totalPnlDisplay.classList.add("negative");

  // 导出账号代码
  exportCodeInput.value = currentAccountCode;
}

function renderHistory() {
  historyTableBody.innerHTML = "";
  const rows = account.history.slice().reverse(); // 最近的在上
  rows.forEach((row, idx) => {
    const tr = document.createElement("tr");

    const tdIndex = document.createElement("td");
    tdIndex.textContent = account.history.length - idx;
    tr.appendChild(tdIndex);

    const tdTime = document.createElement("td");
    tdTime.textContent = formatTime(row.time);
    tr.appendChild(tdTime);

    const tdSym = document.createElement("td");
    tdSym.textContent = row.symbol;
    tr.appendChild(tdSym);

    const tdDir = document.createElement("td");
    tdDir.textContent = row.direction === "up" ? "涨" : "跌";
    tr.appendChild(tdDir);

    const tdStart = document.createElement("td");
    tdStart.textContent = row.startPrice.toFixed(2);
    tr.appendChild(tdStart);

    const tdEnd = document.createElement("td");
    tdEnd.textContent = row.endPrice.toFixed(2);
    tr.appendChild(tdEnd);

    const tdBet = document.createElement("td");
    tdBet.textContent = row.betSize;
    tr.appendChild(tdBet);

    const tdResult = document.createElement("td");
    tdResult.textContent = row.win ? "赢" : "输";
    tdResult.className = row.win ? "green-text" : "red-text";
    tr.appendChild(tdResult);

    const tdPnl = document.createElement("td");
    const pnlPrefix = row.pnl >= 0 ? "+" : "";
    tdPnl.textContent = pnlPrefix + row.pnl;
    tdPnl.className = row.pnl >= 0 ? "green-text" : "red-text";
    tr.appendChild(tdPnl);

    historyTableBody.appendChild(tr);
  });
}

function renderPricePanel() {
  if (currentPrice == null) {
    priceDisplay.textContent = "价格加载中...";
  } else {
    priceDisplay.textContent = currentPrice.toFixed(2);
  }
  priceSourceLabel.textContent =
    priceSource === "okx" ? "指数价格：来自 OKX" : "指数价格：本地模拟";
  priceUpdatedAtLabel.textContent =
    "最近更新：" + (lastPriceUpdatedAt ? formatTime(lastPriceUpdatedAt) : "--");
}

function renderRoundInfoIdle() {
  if (!isRoundRunning) {
    countdownDisplay.textContent = "未开始";
    startPriceDisplay.textContent = "--";
    endPriceDisplay.textContent = "--";
  }
}

// ===== 价格获取 =====
async function fetchIndexPrice(symbol, { allowMock = true } = {}) {
  const instId = symbol === "BTC-USDT" ? "BTC-USDT" : "ETH-USDT";
  const url = `https://www.okx.com/api/v5/market/index-tickers?instId=${encodeURIComponent(
    instId
  )}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json();
    const ticker = data.data && data.data[0];
    if (!ticker || !ticker.idxPx) throw new Error("no idxPx");
    const price = parseFloat(ticker.idxPx);
    currentPrice = price;
    priceSource = "okx";
    lastPriceUpdatedAt = Date.now();
    renderPricePanel();
    return price;
  } catch (e) {
    console.warn("fetchIndexPrice failed, use mock", e);
    if (!allowMock) throw e;
    // 使用本地模拟价格
    const base = currentPrice != null ? currentPrice : symbol === "BTC-USDT" ? 90000 : 4000;
    const mock = base * (1 + (Math.random() - 0.5) * 0.002);
    currentPrice = mock;
    priceSource = "mock";
    lastPriceUpdatedAt = Date.now();
    renderPricePanel();
    return mock;
  }
}

// 周期刷新当前价格
async function refreshCurrentPriceLoop() {
  while (true) {
    try {
      await fetchIndexPrice(currentSymbol);
    } catch (e) {
      // 已在内部处理 mock
    }
    await new Promise((resolve) => setTimeout(resolve, 8000));
  }
}

// ===== 轮次逻辑 =====
function lockUIForRound(lock) {
  betUpBtn.disabled = lock;
  betDownBtn.disabled = lock;
  modeSelect.disabled = lock;
  symbolSelect.disabled = lock;
}

async function startRound(direction) {
  if (isRoundRunning) return;

  const betSizeRaw = parseInt(betSizeInput.value, 10);
  const betSize = Number.isFinite(betSizeRaw) && betSizeRaw > 0 ? betSizeRaw : 0;
  if (!betSize || betSize <= 0) {
    alert("请输入有效的下注筹码数量");
    return;
  }
  if (betSize > account.chips) {
    alert("当前筹码不足，无法下注");
    return;
  }

  lockUIForRound(true);
  isRoundRunning = true;
  countdownDisplay.textContent = "价格锁定中...";

  try {
    const startPrice = await fetchIndexPrice(currentSymbol, { allowMock: true });
    const now = Date.now();

    account.chips -= betSize;
    account.roundIndex += 1;
    lockedRoundInfo = {
      direction,
      symbol: currentSymbol,
      startPrice,
      betSize,
      startTime: now
    };
    roundDeadline = now + 60 * 1000;

    startPriceDisplay.textContent = startPrice.toFixed(2);
    endPriceDisplay.textContent = "--";

    updateCountdown();
    roundTimerId = setInterval(updateCountdown, 200);

    renderAccountBasic();
    saveState(appState);
  } catch (e) {
    alert("锁定价格失败，请稍后重试");
    isRoundRunning = false;
    lockUIForRound(false);
    renderRoundInfoIdle();
  }
}

async function finishRound() {
  if (!isRoundRunning || !lockedRoundInfo) return;

  clearInterval(roundTimerId);
  roundTimerId = null;

  countdownDisplay.textContent = "结算中...";

  const { direction, symbol, startPrice, betSize, startTime } = lockedRoundInfo;

  let endPrice = null;
  try {
    endPrice = await fetchIndexPrice(symbol, { allowMock: true });
  } catch (e) {
    // 已使用 mock
    endPrice = currentPrice != null ? currentPrice : startPrice;
  }

  const diff = endPrice - startPrice;
  const win =
    (direction === "up" && diff > 0) ||
    (direction === "down" && diff < 0);

  let pnl = 0;
  if (win) {
    pnl = betSize;
    account.chips += betSize * 2; // 返还本金+盈利
  } else {
    pnl = -betSize;
    // 筹码已在开始时扣除
  }

  account.totalRounds += 1;
  if (win) {
    account.totalWins += 1;
    account.currentStreak += 1;
    if (account.currentStreak > account.maxStreak) {
      account.maxStreak = account.currentStreak;
    }
  } else {
    account.currentStreak = 0;
  }
  account.totalPnl += pnl;

  // 记录历史，只保留 20 条
  account.history.push({
    time: startTime,
    symbol,
    direction,
    startPrice,
    endPrice,
    betSize,
    win,
    pnl
  });
  if (account.history.length > 20) {
    account.history = account.history.slice(account.history.length - 20);
  }

  endPriceDisplay.textContent = endPrice.toFixed(2);
  countdownDisplay.textContent = win ? "本局：赢 🎉" : "本局：输";

  lockedRoundInfo = null;
  isRoundRunning = false;
  lockUIForRound(false);

  renderAccountBasic();
  renderStats();
  renderHistory();
  saveState(appState);
}

function updateCountdown() {
  if (!isRoundRunning || !roundDeadline) return;
  const now = Date.now();
  const remain = roundDeadline - now;
  if (remain <= 0) {
    countdownDisplay.textContent = "00:00";
    finishRound();
  } else {
    const sec = Math.floor(remain / 1000);
    const s = String(sec).padStart(2, "0");
    countdownDisplay.textContent = "00:" + s;
  }
}

// ===== 账号切换 =====
function switchToAccount(code) {
  if (!appState.accounts[code]) {
    alert("未找到该账号代码对应的数据");
    return;
  }
  currentAccountCode = code;
  appState.currentAccountCode = code;
  account = appState.accounts[code];
  saveState(appState);

  renderAccountBasic();
  renderStats();
  renderHistory();
  renderRoundInfoIdle();
}

// ===== 事件绑定 =====
modeSelect.addEventListener("change", () => {
  account.mode = modeSelect.value;
  saveState(appState);
});

resetAccountBtn.addEventListener("click", () => {
  if (!confirm("确定要重置当前账户筹码吗？历史记录和统计将保留。")) return;
  const newAcc = createEmptyAccount(account.mode);
  // 保留历史统计
  newAcc.totalRounds = account.totalRounds;
  newAcc.totalWins = account.totalWins;
  newAcc.maxStreak = account.maxStreak;
  newAcc.currentStreak = account.currentStreak;
  newAcc.totalPnl = account.totalPnl;
  newAcc.history = account.history.slice();

  appState.accounts[currentAccountCode] = newAcc;
  account = newAcc;
  saveState(appState);
  renderAccountBasic();
  renderStats();
  renderHistory();
  renderRoundInfoIdle();
});

symbolSelect.addEventListener("change", () => {
  currentSymbol = symbolSelect.value;
  fetchIndexPrice(currentSymbol, { allowMock: true });
});

reconnectBtn.addEventListener("click", () => {
  fetchIndexPrice(currentSymbol, { allowMock: true });
});

betUpBtn.addEventListener("click", () => startRound("up"));
betDownBtn.addEventListener("click", () => startRound("down"));

generateCodeBtn.addEventListener("click", () => {
  if (!currentAccountCode || !appState.accounts[currentAccountCode]) {
    alert("当前账号无效，无法生成代码");
    return;
  }
  // 保持当前 code 即为导出代码
  exportCodeInput.value = currentAccountCode;
  alert("当前账号代码已显示，可复制保存：\n" + currentAccountCode);
});

importCodeBtn.addEventListener("click", () => {
  const code = importCodeInput.value.trim();
  if (!code) {
    alert("请输入要导入的账号代码");
    return;
  }
  if (!appState.accounts[code]) {
    alert("本设备中未找到该账号代码。账号代码仅在生成它的设备中生效。");
    return;
  }
  switchToAccount(code);
  alert("已切换到账号：" + code);
});

// 简单主题切换：仅作为示例，切换背景明暗
let isLightMode = false;
themeToggleBtn.addEventListener("click", () => {
  isLightMode = !isLightMode;
  if (isLightMode) {
    document.body.style.background =
      "radial-gradient(circle at top, #e5e7eb 0, #0f172a 55%) fixed";
    document.querySelector(".app").style.background =
      "linear-gradient(180deg, rgba(248,250,252,0.08) 0, rgba(15,23,42,0.96) 45%)";
  } else {
    document.body.style.background =
      "radial-gradient(circle at top left, #1e293b 0, #020617 55%) fixed";
    document.querySelector(".app").style.background =
      "radial-gradient(circle at top, rgba(148,163,184,0.12) 0, rgba(15,23,42,0.9) 40%)";
  }
});

// ===== 初始化 =====
(function init() {
  // 恢复当前 symbol
  symbolSelect.value = currentSymbol;
  renderAccountBasic();
  renderStats();
  renderHistory();
  renderRoundInfoIdle();
  renderPricePanel();
  fetchIndexPrice(currentSymbol, { allowMock: true });
  refreshCurrentPriceLoop();
})();
