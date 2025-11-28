// ---------- 基本配置 ----------
const BASE_CHIPS = {
  easy: 100,
  normal: 60,
  hard: 30
};

// 一局时间（毫秒），需要真实 1 分钟就保持 60000
const ROUND_DURATION_MS = 60000;

// localStorage key 前缀
const STORAGE_PREFIX = "chipGame:";
const STORAGE_LAST_STATE = STORAGE_PREFIX + "lastState";

// 当前状态
let state = {
  mode: "easy",
  chips: BASE_CHIPS.easy,
  history: [],
  instId: "BTC-USDT-SWAP",
  createdAt: new Date().toISOString()
};

let currentRound = null;
let roundTimerInterval = null;

// 价格相关
let ws = null;
let latestPrice = null;
let lastPriceUpdatedAt = null;
let priceSimInterval = null;
let wsTried = false;

// ---------- DOM ----------
const chipsDisplay = document.getElementById("chips-display");
const modeSelect = document.getElementById("mode-select");
const instIdInput = document.getElementById("inst-id-input");

const priceValue = document.getElementById("price-value");
const priceUpdatedAtEl = document.getElementById("price-updated-at");
const priceSourceLabel = document.getElementById("price-source-label");

const betInput = document.getElementById("bet-input");
const btnGuessUp = document.getElementById("btn-guess-up");
const btnGuessDown = document.getElementById("btn-guess-down");
const btnResetAccount = document.getElementById("btn-reset-account");

const roundCountdown = document.getElementById("round-countdown");
const roundStartPrice = document.getElementById("round-start-price");
const roundEndPrice = document.getElementById("round-end-price");
const lastResultEl = document.getElementById("last-result");

const btnExportAccount = document.getElementById("btn-export-account");
const btnImportAccount = document.getElementById("btn-import-account");
const exportCodeOutput = document.getElementById("export-code-output");
const importCodeInput = document.getElementById("import-code-input");

const historyBody = document.getElementById("history-body");

// ---------- 初始化 ----------
document.addEventListener("DOMContentLoaded", () => {
  loadLastState();
  applyStateToUI();
  setupEventListeners();
  initPriceSource();
});

// ---------- 状态存取 ----------
function loadLastState() {
  try {
    const raw = localStorage.getItem(STORAGE_LAST_STATE);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return;

    // 简单校验
    if (!saved.mode || !BASE_CHIPS[saved.mode]) return;
    if (typeof saved.chips !== "number") return;

    state = {
      mode: saved.mode,
      chips: saved.chips,
      history: Array.isArray(saved.history) ? saved.history : [],
      instId: typeof saved.instId === "string" ? saved.instId : "BTC-USDT-SWAP",
      createdAt: saved.createdAt || new Date().toISOString(),
      accountCode: saved.accountCode || null
    };
  } catch (e) {
    console.warn("无法加载上次状态", e);
  }
}

function saveState() {
  try {
    const toSave = {
      mode: state.mode,
      chips: state.chips,
      history: state.history,
      instId: state.instId,
      createdAt: state.createdAt,
      accountCode: state.accountCode || null
    };
    localStorage.setItem(STORAGE_LAST_STATE, JSON.stringify(toSave));
  } catch (e) {
    console.warn("保存状态失败", e);
  }
}

// ---------- UI ----------
function applyStateToUI() {
  // 模式、筹码、交易对
  modeSelect.value = state.mode;
  chipsDisplay.textContent = state.chips.toFixed(1).replace(/\.0$/, "");
  instIdInput.value = state.instId;

  // 当前局
  if (!currentRound) {
    roundCountdown.textContent = "未开始";
    roundStartPrice.textContent = "--";
    roundEndPrice.textContent = "--";
  }

  // 历史
  renderHistoryTable();
}

function renderHistoryTable() {
  historyBody.innerHTML = "";
  state.history.forEach((r, idx) => {
    const tr = document.createElement("tr");

    const tdIndex = document.createElement("td");
    tdIndex.textContent = state.history.length - idx;
    tr.appendChild(tdIndex);

    const tdTime = document.createElement("td");
    const timeStr = formatTime(r.startTime);
    tdTime.textContent = timeStr;
    tr.appendChild(tdTime);

    const tdDir = document.createElement("td");
    tdDir.textContent = r.direction === "up" ? "涨" : "跌";
    tr.appendChild(tdDir);

    const tdStart = document.createElement("td");
    tdStart.textContent = r.startPrice.toFixed(2);
    tr.appendChild(tdStart);

    const tdEnd = document.createElement("td");
    tdEnd.textContent = r.endPrice.toFixed(2);
    tr.appendChild(tdEnd);

    const tdBet = document.createElement("td");
    tdBet.textContent = r.bet.toString();
    tr.appendChild(tdBet);

    const tdResult = document.createElement("td");
    tdResult.textContent =
      r.result === "win" ? "赢" : r.result === "lose" ? "输" : "平局";
    tdResult.className =
      r.result === "win"
        ? "result-win"
        : r.result === "lose"
        ? "result-lose"
        : "result-tie";
    tr.appendChild(tdResult);

    const tdProfit = document.createElement("td");
    tdProfit.textContent =
      (r.profit > 0 ? "+" : "") + r.profit.toFixed(1).replace(/\.0$/, "");
    if (r.profit > 0) tdProfit.className = "result-win";
    if (r.profit < 0) tdProfit.className = "result-lose";
    tr.appendChild(tdProfit);

    historyBody.insertBefore(tr, historyBody.firstChild);
  });
}

function updatePriceDisplay() {
  if (latestPrice == null) return;
  priceValue.textContent = latestPrice.toFixed(2);

  if (lastPriceUpdatedAt) {
    const t = new Date(lastPriceUpdatedAt);
    priceUpdatedAtEl.textContent =
      "最后更新：" + t.toLocaleTimeString(undefined, { hour12: false });
  }
}

function setButtonsEnabled(enabled) {
  btnGuessUp.disabled = !enabled;
  btnGuessDown.disabled = !enabled;
}

// ---------- 事件 ----------
function setupEventListeners() {
  modeSelect.addEventListener("change", () => {
    const newMode = modeSelect.value;
    if (!BASE_CHIPS[newMode]) return;

    if (
      state.history.length > 0 ||
      state.chips !== BASE_CHIPS[state.mode]
    ) {
      const ok = window.confirm("切换模式会重置当前账户并清空历史记录，确定要切换吗？");
      if (!ok) {
        modeSelect.value = state.mode;
        return;
      }
    }
    resetAccount(newMode);
  });

  instIdInput.addEventListener("change", () => {
    const val = instIdInput.value.trim();
    if (!val) {
      instIdInput.value = state.instId;
      return;
    }
    state.instId = val;
    saveState();
    reconnectPriceSource();
  });

  btnGuessUp.addEventListener("click", () => {
    startNewRound("up");
  });

  btnGuessDown.addEventListener("click", () => {
    startNewRound("down");
  });

  btnResetAccount.addEventListener("click", () => {
    const ok = window.confirm("确认要重置账户吗？所有筹码与历史记录都会被清空。");
    if (!ok) return;
    resetAccount(state.mode);
  });

  btnExportAccount.addEventListener("click", handleExportAccount);
  btnImportAccount.addEventListener("click", handleImportAccount);
}

// ---------- 账户重置 ----------
function resetAccount(mode) {
  const m = mode || state.mode || "easy";
  state.mode = m;
  state.chips = BASE_CHIPS[m];
  state.history = [];
  state.createdAt = new Date().toISOString();
  state.accountCode = null;

  currentRound = null;
  clearRoundTimer();

  lastResultEl.textContent = "本局结果会显示在这里";
  applyStateToUI();
  saveState();
}

// ---------- 开始一局 ----------
function startNewRound(direction) {
  if (currentRound) {
    window.alert("上一局还在进行中，请稍候结束后再下注。");
    return;
  }

  if (latestPrice == null) {
    window.alert("尚未取得价格数据，请稍等价格连上后再试。");
    return;
  }

  let bet = parseInt(betInput.value, 10);
  if (isNaN(bet) || bet <= 0) {
    window.alert("请输入正确的下注筹码（至少 1）。");
    return;
  }

  if (bet > state.chips) {
    window.alert("筹码不足，无法下注这么多。");
    return;
  }

  const startPrice = latestPrice;
  const now = Date.now();

  // 扣除筹码（先扣，再结算）
  state.chips -= bet;

  currentRound = {
    direction,
    bet,
    startPrice,
    startTime: now,
    expectedEndTime: now + ROUND_DURATION_MS
  };

  roundStartPrice.textContent = startPrice.toFixed(2);
  roundEndPrice.textContent = "--";
  lastResultEl.textContent =
    "本局已开始，等待结束价格…";

  setButtonsEnabled(false);
  updateChipsUI();
  saveState();
  startRoundCountdown();
}

function updateChipsUI() {
  chipsDisplay.textContent = state.chips.toFixed(1).replace(/\.0$/, "");
  if (state.chips <= 0) {
    setButtonsEnabled(false);
    lastResultEl.textContent = "筹码已用完，可以点击重置账户重新开始。";
  }
}

// ---------- 倒计时 ----------
function startRoundCountdown() {
  clearRoundTimer();
  if (!currentRound) return;

  const end = currentRound.expectedEndTime;

  function tick() {
    const now = Date.now();
    let remain = end - now;

    if (remain <= 0) {
      roundCountdown.textContent = "0秒";
      clearRoundTimer();
      finishRound();
      return;
    }

    const seconds = Math.ceil(remain / 1000);
    roundCountdown.textContent = seconds + "秒";
  }

  tick();
  roundTimerInterval = setInterval(tick, 1000);
}

function clearRoundTimer() {
  if (roundTimerInterval) {
    clearInterval(roundTimerInterval);
    roundTimerInterval = null;
  }
}

// ---------- 结束一局 ----------
function finishRound() {
  if (!currentRound) return;

  const endPrice = latestPrice != null ? latestPrice : currentRound.startPrice;
  const startPrice = currentRound.startPrice;
  roundEndPrice.textContent = endPrice.toFixed(2);

  let actualDir = "flat";
  if (endPrice > startPrice) actualDir = "up";
  else if (endPrice < startPrice) actualDir = "down";

  let result = "tie";
  let profit = 0;

  if (actualDir === "flat") {
    // 平局，退还下注
    state.chips += currentRound.bet;
    result = "tie";
    profit = 0;
    lastResultEl.textContent =
      "本局价格持平，退还下注筹码。";
  } else if (actualDir === currentRound.direction) {
    // 赢：退还本金 + 0.5 倍盈利
    const netProfit = Math.round(currentRound.bet * 0.5 * 10) / 10;
    state.chips += currentRound.bet + netProfit;
    result = "win";
    profit = netProfit;
    lastResultEl.textContent =
      "恭喜，本局猜对方向，净赚 " +
      netProfit.toFixed(1).replace(/\.0$/, "") +
      " 筹码。";
  } else {
    // 输：已扣掉本金
    result = "lose";
    profit = -currentRound.bet;
    lastResultEl.textContent =
      "很可惜，本局方向没猜中，亏损 " +
      currentRound.bet +
      " 筹码。";
  }

  const record = {
    direction: currentRound.direction,
    bet: currentRound.bet,
    startPrice,
    endPrice,
    startTime: currentRound.startTime,
    endTime: Date.now(),
    result,
    profit
  };

  state.history.push(record);

  currentRound = null;
  roundCountdown.textContent = "未开始";
  updateChipsUI();
  renderHistoryTable();
  saveState();

  if (state.chips > 0) {
    setButtonsEnabled(true);
  }
}

// ---------- 价格来源：优先 WebSocket + 备用模拟 ----------
function initPriceSource() {
  connectWebSocket();
  // 10 秒还没有拿到价格就启用模拟
  setTimeout(() => {
    if (latestPrice == null) {
      startPriceSimulation();
    }
  }, 10000);
}

function reconnectPriceSource() {
  if (ws) {
    try {
      ws.close();
    } catch (e) {
      // ignore
    }
    ws = null;
  }
  if (priceSimInterval) {
    clearInterval(priceSimInterval);
    priceSimInterval = null;
  }
  latestPrice = null;
  priceValue.textContent = "--";
  priceSourceLabel.textContent = "连接中";

  initPriceSource();
}

function connectWebSocket() {
  wsTried = true;
  try {
    ws = new WebSocket("wss://ws.okx.com:8443/ws/v5/public");

    ws.addEventListener("open", () => {
      priceSourceLabel.textContent = "OKX 行情 · WebSocket";
      const subMsg = {
        op: "subscribe",
        args: [
          {
            channel: "tickers",
            instId: state.instId || "BTC-USDT-SWAP"
          }
        ]
      };
      ws.send(JSON.stringify(subMsg));
    });

    ws.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data);
        if (!data) return;
        if (data.event === "error") {
          console.warn("WS error event", data);
          return;
        }
        if (data.event === "subscribe") {
          return;
        }

        if (
          data.arg &&
          data.arg.channel === "tickers" &&
          Array.isArray(data.data) &&
          data.data.length > 0
        ) {
          const d = data.data[0];
          const pxRaw = d.last || d.lastPx || d.px;
          const px = parseFloat(pxRaw);
          if (!isNaN(px)) {
            latestPrice = px;
            lastPriceUpdatedAt = Date.now();
            updatePriceDisplay();
          }
        }
      } catch (e) {
        console.warn("WS message parse error", e);
      }
    });

    ws.addEventListener("close", () => {
      // 如果已经有模拟在跑，就不再重连
      if (priceSimInterval) return;
      priceSourceLabel.textContent = "连接已断开，使用模拟价格";
      ws = null;
      startPriceSimulation();
    });

    ws.addEventListener("error", () => {
      priceSourceLabel.textContent = "连接失败，使用模拟价格";
      if (ws) {
        try {
          ws.close();
        } catch (e) {}
      }
      ws = null;
      startPriceSimulation();
    });
  } catch (e) {
    console.warn("WS 初始化失败", e);
    priceSourceLabel.textContent = "连接失败，使用模拟价格";
    startPriceSimulation();
  }
}

// 模拟价格（备用方案，避免前端被 CORS 或网络限制）
function startPriceSimulation() {
  if (priceSimInterval) return;

  if (latestPrice == null) {
    // 根据交易对随便给个起点
    latestPrice = state.instId.includes("BTC") ? 50000 : 3000;
    lastPriceUpdatedAt = Date.now();
    updatePriceDisplay();
  }

  priceSourceLabel.textContent = "本地模拟价格";

  priceSimInterval = setInterval(() => {
    const drift = (Math.random() - 0.5) * 0.5; // 大约 ±0.5%
    latestPrice = latestPrice * (1 + drift / 100);
    lastPriceUpdatedAt = Date.now();
    updatePriceDisplay();
  }, 5000);
}

// ---------- 导出 / 导入账号 ----------
function generateAccountCode() {
  // 生成 0x + 40 个十六进制字符
  const bytes = new Uint8Array(20);
  (window.crypto || window.msCrypto).getRandomValues(bytes);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return "0x" + hex;
}

function handleExportAccount() {
  // 生成新账号代码
  const code = generateAccountCode();
  state.accountCode = code;

  const raw = JSON.stringify({
    mode: state.mode,
    chips: state.chips,
    history: state.history,
    instId: state.instId,
    createdAt: state.createdAt
  });

  try {
    localStorage.setItem(STORAGE_PREFIX + code, raw);
    saveState();
    exportCodeOutput.value = code;
    window.alert("账号已导出并保存在本机浏览器，对应代码已生成。");
  } catch (e) {
    console.warn("导出失败", e);
    window.alert("导出账号时出现问题，可能是浏览器不允许存储。");
  }
}

function handleImportAccount() {
  const code = importCodeInput.value.trim();
  if (!code) {
    window.alert("请输入要导入的账号代码。");
    return;
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(code)) {
    window.alert("账号代码格式不正确，应为 0x 开头共 42 个字符。");
    return;
  }

  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + code);
    if (!raw) {
      window.alert("本机浏览器中没有找到对应账号数据。");
      return;
    }
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") {
      window.alert("账号数据损坏或无法解析。");
      return;
    }

    if (!data.mode || !BASE_CHIPS[data.mode]) {
      window.alert("账号数据不完整：模式字段无效。");
      return;
    }
    if (typeof data.chips !== "number") {
      window.alert("账号数据不完整：筹码字段无效。");
      return;
    }

    state.mode = data.mode;
    state.chips = data.chips;
    state.history = Array.isArray(data.history) ? data.history : [];
    state.instId = typeof data.instId === "string" ? data.instId : "BTC-USDT-SWAP";
    state.createdAt = data.createdAt || new Date().toISOString();
    state.accountCode = code;

    currentRound = null;
    clearRoundTimer();

    applyStateToUI();
    saveState();
    window.alert("账号导入成功。");
  } catch (e) {
    console.warn("导入失败", e);
    window.alert("导入账号时出现错误。");
  }
}

// ---------- 工具 ----------
function formatTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour12: false });
  } catch {
    return "--";
  }
}
