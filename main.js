// ----- 基本状态 -----
const state = {
  mode: "normal",          // 当前模式：easy / normal / hard
  chips: 60,               // 当前筹码
  pair: "BTC-USDT",        // 当前选择的交易对（下拉）
  activePair: null,        // 本局锁定的交易对（开始一局时确定）
  lastPrice: null,         // 最近一次价格
  useSimulated: false,     // 当前是否使用模拟价格
  countdown: 0,            // 倒计时秒数
  timerId: null,           // 本局倒计时定时器
  pricePollId: null,       // 价格轮询定时器
  roundStart: null,
  roundEnd: null,
  history: []              // 对局历史
};

// ----- DOM 元素 -----
const els = {
  modeSelect: document.getElementById("modeSelect"),
  chipsDisplay: document.getElementById("chipsDisplay"),

  pairSelect: document.getElementById("pairSelect"),
  currentPrice: document.getElementById("currentPrice"),
  priceSource: document.getElementById("priceSource"),
  lastUpdated: document.getElementById("lastUpdated"),
  reconnectBtn: document.getElementById("reconnectBtn"),

  countdown: document.getElementById("countdown"),
  roundStartPrice: document.getElementById("roundStartPrice"),
  roundEndPrice: document.getElementById("roundEndPrice"),
  betChips: document.getElementById("betChips"),
  guessUpBtn: document.getElementById("guessUpBtn"),
  guessDownBtn: document.getElementById("guessDownBtn"),
  resetAccountBtn: document.getElementById("resetAccountBtn"),
  roundResult: document.getElementById("roundResult"),

  historyBody: document.getElementById("historyBody"),

  showAdvancedBtn: document.getElementById("showAdvancedBtn"),
  closeAdvancedBtn: document.getElementById("closeAdvancedBtn"),
  advancedPanel: document.getElementById("advancedPanel"),
  exportAccountBtn: document.getElementById("exportAccountBtn"),
  importAccountBtn: document.getElementById("importAccountBtn"),
  exportCode: document.getElementById("exportCode"),
  importCode: document.getElementById("importCode"),
  accountStatus: document.getElementById("accountStatus")
};

// ----- 工具函数 -----
function formatNumber(num) {
  if (num == null || isNaN(num)) return "--";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatTime(date) {
  const d = typeof date === "string" ? new Date(date) : date;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

// ----- 模式 / 筹码 -----
function applyMode(mode) {
  state.mode = mode;
  if (mode === "easy") state.chips = 100;
  else if (mode === "hard") state.chips = 30;
  else state.chips = 60;

  updateChips();
  resetRoundState();
}

function updateChips() {
  els.chipsDisplay.textContent = state.chips;
}

// ----- 价格逻辑 -----

// 本地模拟一个价格，避免界面长时间 "--"
function setSimulatedPrice(pair) {
  let px = state.lastPrice;
  if (!px) {
    if (pair.startsWith("BTC")) px = 90000;
    else if (pair.startsWith("ETH")) px = 3500;
    else px = 1000;
  }
  const change = 1 + (Math.random() - 0.5) * 0.004; // 小幅波动
  px = px * change;
  state.lastPrice = px;
  state.useSimulated = true;

  els.currentPrice.textContent = formatNumber(px);
  els.priceSource.textContent = "模拟价格 · 本地推演";
  els.lastUpdated.textContent =
    "最近更新：" + formatTime(new Date()) + " （模拟）";

  return px;
}

/**
 * 从 OKX 拉取最新指数价格
 * @param {string} pairOverride 若传入，则强制用这个交易对；否则用 state.pair
 */
async function fetchOkxPrice(pairOverride) {
  const pair = pairOverride || state.pair;

  // 先用模拟价顶上，UI 不会空着
  const simulated = setSimulatedPrice(pair);

  const instId = pair; // 这里 pair 直接用 "BTC-USDT" / "ETH-USDT" 这种

  const url =
    "https://www.okx.com/api/v5/market/index-tickers?instId=" +
    encodeURIComponent(instId);

  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error("HTTP " + res.status);

    const data = await res.json();
    const ticker =
      data &&
      Array.isArray(data.data) &&
      data.data.length > 0 &&
      data.data[0];

    const px = ticker ? Number(ticker.idxPx || ticker.last) : NaN;
    if (!px || !isFinite(px)) throw new Error("invalid price from API");

    state.lastPrice = px;
    state.useSimulated = false;

    // 只有在当前显示的交易对 === 本次请求交易对时，才更新 UI
    const displayPair = state.activePair || state.pair;
    if (displayPair === pair) {
      els.currentPrice.textContent = formatNumber(px);
      els.priceSource.textContent = "指数价格 · 来自 OKX";
      els.lastUpdated.textContent =
        "最近更新：" + formatTime(ticker.ts || new Date());
    }

    return px;
  } catch (e) {
    console.warn("Fetch OKX price failed, keep simulated:", e);
    els.lastUpdated.textContent =
      "最近更新：" + formatTime(new Date()) + " （OKX 未返回，使用模拟价格）";
    return simulated;
  }
}

// 每 5 秒轮询一次价格（显示当前交易对 / 本局锁定交易对）
function startPricePolling() {
  if (state.pricePollId) clearInterval(state.pricePollId);
  state.pricePollId = setInterval(() => {
    const pairForDisplay = state.activePair || state.pair;
    fetchOkxPrice(pairForDisplay);
  }, 5000);
}

// ----- 回合逻辑 -----
function resetRoundState() {
  clearInterval(state.timerId);
  state.timerId = null;
  state.countdown = 0;
  state.roundStart = null;
  state.roundEnd = null;
  state.activePair = null;
  els.pairSelect.disabled = false;

  els.countdown.textContent = "未开始";
  els.roundStartPrice.textContent = "--";
  els.roundEndPrice.textContent = "--";
  els.roundResult.textContent = "";
}

// 点击 猜涨 / 猜跌，开启一局：锁定交易对 + 锁定起始价 + 60 秒后结算
async function handleGuess(direction) {
  if (state.timerId) {
    alert("上一局还在进行中，请等倒计时结束后再开始新一局～");
    return;
  }

  const bet = Number(els.betChips.value || 0);
  if (!Number.isFinite(bet) || bet <= 0) {
    alert("请输入有效的下注筹码");
    return;
  }
  if (bet > state.chips) {
    alert("当前筹码不足");
    return;
  }

  // 本局锁定交易对
  const roundPair = state.pair;
  state.activePair = roundPair;
  els.pairSelect.disabled = true; // 锁定期间不允许切换交易对

  // 锁定起始价：用 activePair 拿价
  const startPrice = await fetchOkxPrice(roundPair);
  state.roundStart = startPrice;
  els.roundStartPrice.textContent = formatNumber(startPrice);
  els.roundEndPrice.textContent = "--";
  els.roundResult.textContent =
    `本局交易对：${roundPair}，起始价已锁定，结果将在 60 秒后根据价格变化结算。`;

  state.countdown = 60;
  els.countdown.textContent = `${state.countdown}s`;

  state.timerId = setInterval(async () => {
    state.countdown -= 1;

    if (state.countdown <= 0) {
      clearInterval(state.timerId);
      state.timerId = null;
      els.countdown.textContent = "已结束";

      // 用同一个 roundPair 拿结束价
      const endPrice = await fetchOkxPrice(roundPair);
      state.roundEnd = endPrice;
      els.roundEndPrice.textContent = formatNumber(endPrice);

      settleRound(direction, bet, startPrice, endPrice, roundPair);
      // 一局结算完再解除交易对锁定
      state.activePair = null;
      els.pairSelect.disabled = false;
    } else {
      els.countdown.textContent = `${state.countdown}s`;
    }
  }, 1000);
}

function settleRound(direction, bet, startPrice, endPrice, pair) {
  const wentUp = endPrice > startPrice;
  const guessedUp = direction === "up";
  const isWin = (wentUp && guessedUp) || (!wentUp && !guessedUp);

  const delta = isWin ? bet : -bet;
  state.chips += delta;
  updateChips();

  const resultText = isWin ? "赢" : "输";
  els.roundResult.textContent =
    `本局（${pair}）${resultText} 了 ${Math.abs(delta)} 筹码，` +
    `结束价 ${wentUp ? "高于" : "低于"} 起始价（` +
    `${formatNumber(startPrice)} → ${formatNumber(endPrice)}）。`;

  pushHistory({
    time: new Date(),
    pair,
    direction: guessedUp ? "涨" : "跌",
    startPrice,
    endPrice,
    bet,
    resultText,
    delta
  });

  if (state.chips <= 0) {
    alert("筹码已经用光啦，可以点击“重置账户”重新开始一局 🎮");
  }
}

function pushHistory(item) {
  state.history.unshift(item);
  if (state.history.length > 50) state.history.pop();
  renderHistory();
}

function renderHistory() {
  const tbody = els.historyBody;
  tbody.innerHTML = "";

  state.history.forEach((h, idx) => {
    const tr = document.createElement("tr");

    const tdIndex = document.createElement("td");
    tdIndex.textContent = state.history.length - idx;
    tr.appendChild(tdIndex);

    const tdTime = document.createElement("td");
    tdTime.textContent = formatTime(h.time);
    tr.appendChild(tdTime);

    const tdPair = document.createElement("td");
    tdPair.textContent = h.pair || "-";
    tr.appendChild(tdPair);

    const tdDir = document.createElement("td");
    tdDir.textContent = h.direction;
    tr.appendChild(tdDir);

    const tdStart = document.createElement("td");
    tdStart.textContent = formatNumber(h.startPrice);
    tr.appendChild(tdStart);

    const tdEnd = document.createElement("td");
    tdEnd.textContent = formatNumber(h.endPrice);
    tr.appendChild(tdEnd);

    const tdBet = document.createElement("td");
    tdBet.textContent = h.bet;
    tr.appendChild(tdBet);

    const tdResult = document.createElement("td");
    tdResult.textContent = h.resultText;
    tdResult.className =
      h.delta > 0 ? "result-win" : h.delta < 0 ? "result-lose" : "";
    tr.appendChild(tdResult);

    const tdDelta = document.createElement("td");
    tdDelta.textContent =
      (h.delta > 0 ? "+" : h.delta < 0 ? "-" : "") + Math.abs(h.delta);
    tdDelta.className =
      h.delta > 0 ? "result-win" : h.delta < 0 ? "result-lose" : "";
    tr.appendChild(tdDelta);

    tbody.appendChild(tr);
  });
}

// ----- 账户导出 / 导入 -----
function exportAccount() {
  const payload = {
    v: 3,
    mode: state.mode,
    chips: state.chips,
    pair: state.pair,
    history: state.history.slice(0, 20).map(h => ({
      t: h.time,
      pair: h.pair,
      d: h.direction,
      s: Number(h.startPrice.toFixed(2)),
      e: Number(h.endPrice.toFixed(2)),
      b: h.bet,
      r: h.resultText === "赢" ? 1 : h.resultText === "输" ? -1 : 0,
      p: h.delta
    }))
  };

  const json = JSON.stringify(payload);
  const encoded = btoa(encodeURIComponent(json));
  const code = "0x" + encoded;

  els.exportCode.value = code;
  els.accountStatus.textContent = "已生成导出代码，可复制保存。";
}

function importAccount() {
  const raw = (els.importCode.value || "").trim();
  if (!raw || !raw.startsWith("0x")) {
    els.accountStatus.textContent = "导入失败：请粘贴正确的 0x 开头账号代码。";
    return;
  }

  try {
    const encoded = raw.slice(2);
    const json = decodeURIComponent(atob(encoded));
    const data = JSON.parse(json);

    if (!data || typeof data !== "object") throw new Error("invalid payload");

    state.mode = data.mode || "normal";
    state.pair = data.pair || "BTC-USDT";
    state.chips = Number(data.chips) || 0;
    state.history = Array.isArray(data.history)
      ? data.history.map(h => ({
          time: h.t,
          pair: h.pair || state.pair,
          direction: h.d,
          startPrice: h.s,
          endPrice: h.e,
          bet: h.b,
          resultText: h.r > 0 ? "赢" : h.r < 0 ? "输" : "平",
          delta: h.p
        }))
      : [];

    els.modeSelect.value = state.mode;
    els.pairSelect.value = state.pair;
    updateChips();
    renderHistory();
    resetRoundState();

    els.accountStatus.textContent = "导入成功，账户与历史记录已恢复。";
  } catch (e) {
    console.error("import account error", e);
    els.accountStatus.textContent = "导入失败：代码格式不正确或已损坏。";
  }
}

// ----- 事件绑定 -----
function bindEvents() {
  els.modeSelect.addEventListener("change", e => {
    applyMode(e.target.value);
  });

  els.pairSelect.addEventListener("change", e => {
    // 只有没有正在进行的局时才允许切换
    if (state.timerId) {
      // 理论上被 disabled 了，这里只是双保险
      e.target.value = state.pair;
      return;
    }
    state.pair = e.target.value;
    fetchOkxPrice(state.pair);
  });

  els.reconnectBtn.addEventListener("click", () => {
    const pairForDisplay = state.activePair || state.pair;
    fetchOkxPrice(pairForDisplay);
  });

  els.guessUpBtn.addEventListener("click", () => handleGuess("up"));
  els.guessDownBtn.addEventListener("click", () => handleGuess("down"));

  els.resetAccountBtn.addEventListener("click", () => {
    if (confirm("确认要重置账户并清空历史记录吗？")) {
      applyMode(state.mode);
      state.history = [];
      renderHistory();
      resetRoundState();
    }
  });

  els.showAdvancedBtn.addEventListener("click", () => {
    els.advancedPanel.classList.add("show");
  });

  els.closeAdvancedBtn.addEventListener("click", () => {
    els.advancedPanel.classList.remove("show");
  });

  els.exportAccountBtn.addEventListener("click", exportAccount);
  els.importAccountBtn.addEventListener("click", importAccount);
}

// ----- 初始化 -----
function init() {
  applyMode("normal");
  state.pair = "BTC-USDT";
  els.pairSelect.value = "BTC-USDT";

  bindEvents();

  const pairForDisplay = state.activePair || state.pair;
  fetchOkxPrice(pairForDisplay);
  startPricePolling();
}

document.addEventListener("DOMContentLoaded", init);
