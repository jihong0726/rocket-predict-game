// -----------------------------
// 基础状态
// -----------------------------

const STORAGE_KEY = "rocket_predict_game_v2";

const MODE_CONFIG = {
  easy: { label: "简单", startChips: 100 },
  normal: { label: "普通", startChips: 60 },
  hard: { label: "困难", startChips: 30 }
};

const DEFAULT_STATE = {
  mode: "easy",
  chips: MODE_CONFIG.easy.startChips,
  roundSeq: 0,
  totalGames: 0,
  totalWin: 0,
  totalLose: 0,
  totalPnL: 0,
  maxStreak: 0,
  currentStreak: 0,
  history: [] // 最近 20 局
};

let state = loadState();
let currentPriceInfo = {
  instId: "BTC-USDT",
  price: null,
  source: "loading", // loading / okx / local
  updatedAt: null
};
let timer = null;
let timerRemaining = 0;
let currentRound = null; // { id, instId, direction, bet, startPrice, startTime }

// -----------------------------
// DOM 获取
// -----------------------------

const modeSelect = document.getElementById("mode-select");
const chipsDisplay = document.getElementById("chips-display");
const roundSeqDisplay = document.getElementById("round-seq");

const symbolSelect = document.getElementById("symbol-select");
const priceDisplay = document.getElementById("price-display");
const priceSourceSpan = document.getElementById("price-source");
const priceUpdatedSpan = document.getElementById("price-updated");
const retryPriceBtn = document.getElementById("retry-price");

const countdownDisplay = document.getElementById("countdown-display");
const roundStartPriceSpan = document.getElementById("round-start-price");
const roundEndPriceSpan = document.getElementById("round-end-price");
const betInput = document.getElementById("bet-input");
const btnUp = document.getElementById("btn-up");
const btnDown = document.getElementById("btn-down");
const resetAccountBtn = document.getElementById("reset-account");

const statTotalGames = document.getElementById("stat-total-games");
const statWinRate = document.getElementById("stat-win-rate");
const statMaxStreak = document.getElementById("stat-max-streak");
const statTotalPnl = document.getElementById("stat-total-pnl");
const historyBody = document.getElementById("history-body");

const accountCodeOutput = document.getElementById("account-code");
const accountCodeInput = document.getElementById("account-code-import");
const btnExportAccount = document.getElementById("btn-export-account");
const btnImportAccount = document.getElementById("btn-import-account");

// -----------------------------
// 初始化
// -----------------------------

init();

function init() {
  modeSelect.value = state.mode;
  symbolSelect.value = currentPriceInfo.instId;

  attachEvents();
  renderAll();
  fetchPrice(true);

  // 定时刷新价格
  setInterval(() => {
    fetchPrice(false);
  }, 7000);
}

function attachEvents() {
  modeSelect.addEventListener("change", () => {
    state.mode = modeSelect.value;
    if (state.chips <= 0) {
      // 如果已破产，切模式时重置筹码
      state.chips = MODE_CONFIG[state.mode].startChips;
      state.roundSeq = 0;
    }
    saveState();
    renderAccountArea();
  });

  symbolSelect.addEventListener("change", () => {
    currentPriceInfo.instId = symbolSelect.value;
    fetchPrice(true);
  });

  retryPriceBtn.addEventListener("click", () => {
    fetchPrice(true);
  });

  btnUp.addEventListener("click", () => {
    startRound("up");
  });

  btnDown.addEventListener("click", () => {
    startRound("down");
  });

  resetAccountBtn.addEventListener("click", () => {
    if (!confirm("确定要重置账户吗？当前筹码与统计会被清空。")) return;
    state = {
      ...DEFAULT_STATE,
      mode: modeSelect.value,
      chips: MODE_CONFIG[modeSelect.value].startChips
    };
    currentRound = null;
    clearTimer();
    saveState();
    renderAll();
  });

  btnExportAccount.addEventListener("click", () => {
    const code = exportShortAccountCode(state);
    accountCodeOutput.value = code;
  });

  btnImportAccount.addEventListener("click", () => {
    const raw = accountCodeInput.value.trim();
    if (!raw) return;
    try {
      const imported = importShortAccountCode(raw);
      if (!imported) {
        alert("账号代码格式不正确");
        return;
      }
      state.mode = imported.mode;
      state.chips = imported.chips;
      state.totalGames = imported.totalGames;
      state.totalWin = imported.totalWin;
      state.totalLose = imported.totalLose;
      state.totalPnL = imported.totalPnl;
      state.maxStreak = imported.maxStreak;
      state.currentStreak = 0;
      state.roundSeq = imported.roundSeq;
      state.history = []; // 历史不随代码迁移

      modeSelect.value = state.mode;
      clearTimer();
      currentRound = null;
      saveState();
      renderAll();
      alert("账号导入成功");
    } catch (e) {
      console.error(e);
      alert("账号导入失败，请检查代码是否完整。");
    }
  });
}

// -----------------------------
// 渲染
// -----------------------------

function renderAll() {
  renderAccountArea();
  renderPriceArea();
  renderRoundArea();
  renderStats();
  renderHistory();
}

function renderAccountArea() {
  chipsDisplay.textContent = state.chips.toString();
  roundSeqDisplay.textContent = state.roundSeq.toString();
}

function renderPriceArea() {
  if (currentPriceInfo.price == null) {
    priceDisplay.textContent = "--";
  } else {
    priceDisplay.textContent = currentPriceInfo.price.toFixed(2);
  }

  if (currentPriceInfo.source === "okx") {
    priceSourceSpan.textContent = "指数价格：来自 OKX";
  } else if (currentPriceInfo.source === "local") {
    priceSourceSpan.textContent = "模拟价格：本地随机波动";
  } else {
    priceSourceSpan.textContent = "价格加载中...";
  }

  if (currentPriceInfo.updatedAt) {
    const d = new Date(currentPriceInfo.updatedAt);
    priceUpdatedSpan.textContent = d.toLocaleString();
  } else {
    priceUpdatedSpan.textContent = "--";
  }
}

function renderRoundArea() {
  if (!currentRound) {
    countdownDisplay.textContent = "未开始";
    roundStartPriceSpan.textContent = "--";
    roundEndPriceSpan.textContent = "--";
    symbolSelect.disabled = false;
  } else {
    symbolSelect.disabled = true;
    roundStartPriceSpan.textContent =
      currentRound.startPrice != null ? currentRound.startPrice.toFixed(2) : "--";
    if (currentRound.endPrice != null) {
      roundEndPriceSpan.textContent = currentRound.endPrice.toFixed(2);
    } else {
      roundEndPriceSpan.textContent = "--";
    }
  }
}

function renderStats() {
  statTotalGames.textContent = state.totalGames.toString();
  statMaxStreak.textContent = state.maxStreak.toString();
  statTotalPnl.textContent =
    (state.totalPnl >= 0 ? "+" : "") + state.totalPnl.toString();
  statTotalPnl.classList.remove("positive", "negative");
  if (state.totalPnl > 0) statTotalPnl.classList.add("positive");
  else if (state.totalPnl < 0) statTotalPnl.classList.add("negative");

  // 近 20 局胜率
  const recent = state.history.slice(-20);
  const winCount = recent.filter((h) => h.result === "win").length;
  if (recent.length === 0) {
    statWinRate.textContent = "--";
  } else {
    statWinRate.textContent =
      ((winCount / recent.length) * 100).toFixed(1).replace(/\.0$/, "") + "%";
  }
}

function renderHistory() {
  historyBody.innerHTML = "";
  if (!state.history.length) return;

  const list = state.history.slice(-20).slice().reverse(); // 最近的在最上

  list.forEach((item, idx) => {
    const mainRow = document.createElement("tr");
    mainRow.className = "main-row";

    const subRow = document.createElement("tr");
    subRow.className = "history-sub-row";

    const indexCell = document.createElement("td");
    indexCell.textContent = (state.history.length - idx).toString();
    mainRow.appendChild(indexCell);

    const timeCell = document.createElement("td");
    const time = new Date(item.time);
    timeCell.textContent = time.toLocaleString();
    mainRow.appendChild(timeCell);

    const instCell = document.createElement("td");
    instCell.textContent = item.instId;
    mainRow.appendChild(instCell);

    const dirCell = document.createElement("td");
    dirCell.textContent = item.direction === "up" ? "涨" : "跌";
    dirCell.className =
      item.direction === "up" ? "history-direction-up" : "history-direction-down";
    mainRow.appendChild(dirCell);

    const betCell = document.createElement("td");
    betCell.textContent = item.bet.toString();
    mainRow.appendChild(betCell);

    const pnlCell = document.createElement("td");
    pnlCell.textContent = (item.pnl >= 0 ? "+" : "") + item.pnl.toString();
    pnlCell.className =
      item.pnl > 0
        ? "history-pnl-positive"
        : item.pnl < 0
        ? "history-pnl-negative"
        : "";
    mainRow.appendChild(pnlCell);

    // 子行：展示起始价 / 结束价 / 结果
    const subIndexCell = document.createElement("td");
    subIndexCell.textContent = "";
    subRow.appendChild(subIndexCell);

    const subDetailCell = document.createElement("td");
    subDetailCell.colSpan = 5;
    const detailText = `价格 ${item.startPrice.toFixed(
      2
    )} → ${item.endPrice.toFixed(2)} · 结果：${
      item.result === "win" ? "赢" : item.result === "lose" ? "输" : "平"
    } · 本局盈亏 ${item.pnl >= 0 ? "+" : ""}${item.pnl}`;
    subDetailCell.textContent = detailText;
    subRow.appendChild(subDetailCell);

    historyBody.appendChild(mainRow);
    historyBody.appendChild(subRow);
  });
}

// -----------------------------
// 价格相关
// -----------------------------

async function fetchPrice(showLoading) {
  const instId = currentPriceInfo.instId;

  if (showLoading) {
    currentPriceInfo.price = null;
    currentPriceInfo.source = "loading";
    currentPriceInfo.updatedAt = null;
    renderPriceArea();
  }

  try {
    const url =
      "https://www.okx.com/api/v5/market/index-tickers?instId=" + encodeURIComponent(instId);
    const res = await fetch(url, { cache: "no-cache" });
    const data = await res.json();
    if (data && data.data && data.data.length) {
      const row = data.data[0];
      const price = parseFloat(row.idxPx || row.last || row.lastPrice);
      if (!isNaN(price)) {
        currentPriceInfo.price = price;
        currentPriceInfo.source = "okx";
        currentPriceInfo.updatedAt = Date.now();
        renderPriceArea();
        return;
      }
    }
    throw new Error("Empty data");
  } catch (e) {
    console.warn("获取 OKX 价格失败，使用本地模拟价格。", e);
    // 模拟价格
    if (currentPriceInfo.price == null) {
      // 初始化一个基础价格
      if (instId === "BTC-USDT") currentPriceInfo.price = 90000;
      else if (instId === "ETH-USDT") currentPriceInfo.price = 3500;
      else currentPriceInfo.price = 150;
    } else {
      // 随机轻微波动
      const base = currentPriceInfo.price;
      const delta = base * (Math.random() * 0.002 - 0.001);
      currentPriceInfo.price = base + delta;
    }
    currentPriceInfo.source = "local";
    currentPriceInfo.updatedAt = Date.now();
    renderPriceArea();
  }
}

// -----------------------------
// 回合逻辑
// -----------------------------

function startRound(direction) {
  if (currentRound) {
    alert("当前回合尚未结束，请等待本局结算。");
    return;
  }

  if (state.chips <= 0) {
    alert("筹码已用完，请先重置账户或导入其它账号。");
    return;
  }

  const bet = parseInt(betInput.value, 10);
  if (!bet || bet <= 0) {
    alert("请输入有效的下注筹码。");
    return;
  }
  if (bet > state.chips) {
    alert("下注筹码不能大于当前筹码。");
    return;
  }

  if (!currentPriceInfo.price) {
    alert("当前价格尚未加载，请稍后再试或点击重试获取价格。");
    return;
  }

  // 锁定本局信息
  state.chips -= bet;
  state.roundSeq += 1;

  currentRound = {
    id: state.roundSeq,
    instId: currentPriceInfo.instId,
    direction,
    bet,
    startPrice: currentPriceInfo.price,
    endPrice: null,
    startTime: Date.now()
  };

  timerRemaining = 60;
  updateCountdownDisplay();
  clearTimer();
  timer = setInterval(() => {
    timerRemaining -= 1;
    if (timerRemaining <= 0) {
      timerRemaining = 0;
      clearTimer();
      settleCurrentRound();
    }
    updateCountdownDisplay();
  }, 1000);

  saveState();
  renderAccountArea();
  renderRoundArea();
}

function updateCountdownDisplay() {
  if (!currentRound) {
    countdownDisplay.textContent = "未开始";
    return;
  }
  countdownDisplay.textContent = timerRemaining + " 秒";
}

function clearTimer() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function settleCurrentRound() {
  if (!currentRound) return;

  // 结算时，用同一交易对再获取一次价格
  const targetInstId = currentRound.instId;
  const previousInst = currentPriceInfo.instId;

  // 暂时切换 instId 拉一次价格（只影响内部用，不改下拉框的值）
  const tmpInfo = { ...currentPriceInfo };
  try {
    currentPriceInfo.instId = targetInstId;
    await fetchPrice(false);
  } finally {
    // 不改变 UI 上选择的交易对，只使用我们刚拿到的价格
    currentPriceInfo.instId = previousInst;
  }

  const endPrice =
    currentPriceInfo.price != null ? currentPriceInfo.price : currentRound.startPrice;
  currentRound.endPrice = endPrice;

  const diff = endPrice - currentRound.startPrice;
  const isUp = diff > 0;
  const isDown = diff < 0;
  let result = "draw";
  let pnl = 0;

  if (isUp && currentRound.direction === "up") {
    result = "win";
    pnl = currentRound.bet;
  } else if (isDown && currentRound.direction === "down") {
    result = "win";
    pnl = currentRound.bet;
  } else if (isUp && currentRound.direction === "down") {
    result = "lose";
    pnl = -currentRound.bet;
  } else if (isDown && currentRound.direction === "up") {
    result = "lose";
    pnl = -currentRound.bet;
  } else {
    result = "draw";
    pnl = 0;
  }

  state.chips += currentRound.bet + pnl; // 返还本金 + 盈亏
  state.totalGames += 1;
  state.totalPnL += pnl;

  if (result === "win") {
    state.totalWin += 1;
    state.currentStreak += 1;
    if (state.currentStreak > state.maxStreak) {
      state.maxStreak = state.currentStreak;
    }
  } else if (result === "lose") {
    state.totalLose += 1;
    state.currentStreak = 0;
  } // draw 不改变连胜

  // 写入历史
  const historyItem = {
    id: currentRound.id,
    time: new Date().toISOString(),
    instId: currentRound.instId,
    direction: currentRound.direction,
    bet: currentRound.bet,
    startPrice: currentRound.startPrice,
    endPrice: currentRound.endPrice,
    result,
    pnl
  };
  state.history.push(historyItem);
  if (state.history.length > 40) {
    state.history = state.history.slice(-40);
  }

  currentRound = null;
  timerRemaining = 0;

  saveState();
  renderAll();
}

// -----------------------------
// 本地存储
// -----------------------------

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const obj = JSON.parse(raw);
    return { ...DEFAULT_STATE, ...obj };
  } catch (e) {
    console.warn("读取本地存储失败，使用默认状态。", e);
    return { ...DEFAULT_STATE };
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("保存本地存储失败。", e);
  }
}

// -----------------------------
// 短账号导出 / 导入（Base58 编码二进制）
// -----------------------------

// 布局：
// byte0  : version (1)
// byte1  : mode (0 easy, 1 normal, 2 hard)
// byte2-5  chips (int32)
// byte6-9 totalGames (int32)
// byte10-13 totalWin (int32)
// byte14-17 totalLose (int32)
// byte18-21 totalPnl (int32)
// byte22-23 roundSeq (uint16)
// byte24 checksum (简单异或)

const MODE_TO_BYTE = { easy: 0, normal: 1, hard: 2 };
const BYTE_TO_MODE = { 0: "easy", 1: "normal", 2: "hard" };

function exportShortAccountCode(st) {
  const buffer = new ArrayBuffer(25);
  const view = new DataView(buffer);

  view.setUint8(0, 1); // version
  view.setUint8(1, MODE_TO_BYTE[st.mode] ?? 0);
  view.setInt32(2, st.chips);
  view.setInt32(6, st.totalGames);
  view.setInt32(10, st.totalWin);
  view.setInt32(14, st.totalLose);
  view.setInt32(18, st.totalPnL);
  view.setUint16(22, Math.min(st.roundSeq, 65535));

  // checksum
  let sum = 0;
  for (let i = 0; i < 24; i++) {
    sum ^= view.getUint8(i);
  }
  view.setUint8(24, sum);

  const bytes = new Uint8Array(buffer);
  const b58 = base58Encode(bytes);
  return "ACC-" + b58;
}

function importShortAccountCode(code) {
  if (!code.startsWith("ACC-")) return null;
  const b58 = code.slice(4);
  const bytes = base58Decode(b58);
  if (!bytes || bytes.length !== 25) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // 校验 checksum
  let sum = 0;
  for (let i = 0; i < 24; i++) {
    sum ^= view.getUint8(i);
  }
  const checksum = view.getUint8(24);
  if (sum !== checksum) {
    throw new Error("Checksum mismatch");
  }

  const version = view.getUint8(0);
  if (version !== 1) throw new Error("Unsupported version");

  const modeByte = view.getUint8(1);
  const mode = BYTE_TO_MODE[modeByte] ?? "easy";

  const chips = view.getInt32(2);
  const totalGames = view.getInt32(6);
  const totalWin = view.getInt32(10);
  const totalLose = view.getInt32(14);
  const totalPnl = view.getInt32(18);
  const roundSeq = view.getUint16(22);

  return {
    mode,
    chips,
    totalGames,
    totalWin,
    totalLose,
    totalPnl,
    roundSeq,
    maxStreak: 0 // 无法从短码推导，导入后重新累计
  };
}

// Base58 实现（比特币字母表）

const B58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58_MAP = {};
for (let i = 0; i < B58_ALPHABET.length; i++) {
  B58_MAP[B58_ALPHABET[i]] = i;
}

function base58Encode(buffer) {
  if (!buffer || !buffer.length) return "";
  const digits = [0];
  for (let i = 0; i < buffer.length; i++) {
    let carry = buffer[i];
    for (let j = 0; j < digits.length; j++) {
      const x = digits[j] * 256 + carry;
      digits[j] = x % 58;
      carry = (x / 58) | 0;
    }
    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  // 处理前导 0
  for (let i = 0; i < buffer.length && buffer[i] === 0; i++) {
    digits.push(0);
  }
  return digits
    .reverse()
    .map((d) => B58_ALPHABET[d])
    .join("");
}

function base58Decode(str) {
  if (!str || !str.length) return new Uint8Array(0);
  const bytes = [0];
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    const value = B58_MAP[c];
    if (value == null) throw new Error("Invalid base58 character");
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      const x = bytes[j] * 58 + carry;
      bytes[j] = x & 0xff;
      carry = x >> 8;
    }
    while (carry) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // 处理前导 1（代表 0）
  for (let i = 0; i < str.length && str[i] === "1"; i++) {
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}
