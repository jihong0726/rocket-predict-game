// -------------------- 配置区 --------------------

// 每局倒计时（秒）
const ROUND_SECONDS = 60;

// 价格轮询间隔（毫秒）
const PRICE_POLL_INTERVAL = 5000;

// 支持的交易对 -> OKX 指数 ID
const PAIRS = {
  "BTC-USDT": "BTC-USDT",
  "ETH-USDT": "ETH-USDT",
};

// 初始筹码
const MODE_CONFIG = {
  easy: { label: "简单模式", chips: 100 },
  normal: { label: "普通模式", chips: 60 },
  hard: { label: "困难模式", chips: 30 },
};

// 本地存储 key
const STORAGE_KEY = "rocket_predict_game_state_v2";

// -------------------- 状态 --------------------

const state = {
  mode: "normal",
  chips: 60,
  currentPair: "BTC-USDT",
  priceSource: "okx", // "okx" | "mock"
  currentPrice: null,
  currentPriceTime: null,

  // 每一局锁定用
  roundActive: false,
  roundStartTime: null,
  roundStartPrice: null,
  roundInstId: null,
  roundDirection: null, // "up" | "down"
  roundTimer: null,
  roundSecondsLeft: ROUND_SECONDS,

  // 历史记录
  history: [], // {time, pair, direction, startPrice, endPrice, bet, result, delta}
};

// -------------------- 工具函数 --------------------

function $(id) {
  return document.getElementById(id);
}

function formatNumber(n, digits = 2) {
  if (n === null || n === undefined || isNaN(n)) return "--";
  return Number(n).toFixed(digits);
}

function formatTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

// 本地模拟价格（如果 OKX 接口挂了）
function nextMockPrice(oldPrice) {
  const base = oldPrice || 50000;
  const delta = (Math.random() - 0.5) * 200; // ±100
  return base + delta;
}

// -------------------- 本地存储 --------------------

function saveState() {
  try {
    const toSave = {
      mode: state.mode,
      chips: state.chips,
      currentPair: state.currentPair,
      priceSource: state.priceSource,
      history: state.history.slice(-100), // 最多存 100 条
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch (e) {
    console.warn("保存本地状态失败：", e);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.mode && MODE_CONFIG[data.mode]) state.mode = data.mode;
    if (typeof data.chips === "number") state.chips = data.chips;
    if (data.currentPair && PAIRS[data.currentPair])
      state.currentPair = data.currentPair;
    if (data.priceSource === "mock") state.priceSource = "mock";
    if (Array.isArray(data.history)) state.history = data.history;
  } catch (e) {
    console.warn("读取本地状态失败：", e);
  }
}

// -------------------- 账号导出 / 导入 --------------------

function exportAccount() {
  const data = {
    v: 1,
    mode: state.mode,
    chips: state.chips,
    currentPair: state.currentPair,
    history: state.history.slice(-20), // 导出最近 20 条
  };
  const json = JSON.stringify(data);
  const code = "ACC-" + btoa(unescape(encodeURIComponent(json)));
  $("account-code-input").value = code;
}

function importAccount() {
  const input = $("account-code-input").value.trim();
  if (!input) {
    alert("请先粘贴账号代码。");
    return;
  }
  if (!input.startsWith("ACC-")) {
    alert("账号代码格式不正确。请确认前缀为 ACC-。");
    return;
  }
  try {
    const json = decodeURIComponent(escape(atob(input.slice(4))));
    const data = JSON.parse(json);
    if (!data || typeof data.chips !== "number") {
      throw new Error("数据不完整");
    }
    if (data.mode && MODE_CONFIG[data.mode]) state.mode = data.mode;
    state.chips = data.chips;
    if (data.currentPair && PAIRS[data.currentPair])
      state.currentPair = data.currentPair;
    if (Array.isArray(data.history)) state.history = data.history;
    saveState();
    syncUIFromState();
    alert("导入成功，已恢复筹码与历史记录。");
  } catch (e) {
    console.error(e);
    alert("账号代码解析失败，请确认是否复制完整。");
  }
}

// -------------------- 价格相关 --------------------

async function fetchOkxPrice(instId) {
  const url = `https://www.okx.com/api/v5/market/index-tickers?instId=${encodeURIComponent(
    instId
  )}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("网络错误");
  }
  const data = await res.json();
  if (!data || !Array.isArray(data.data) || !data.data[0]) {
    throw new Error("返回数据异常");
  }
  const last = Number(data.data[0].idxPx);
  if (isNaN(last)) {
    throw new Error("价格数据异常");
  }
  return last;
}

async function updateLivePrice(manual = false) {
  const pair = state.currentPair;
  const instId = PAIRS[pair];
  const priceSpan = $("current-price");
  const srcSpan = $("price-source");
  const timeSpan = $("price-updated-at");

  try {
    const price = await fetchOkxPrice(instId);
    state.priceSource = "okx";
    state.currentPrice = price;
    state.currentPriceTime = new Date();

    priceSpan.textContent = formatNumber(price, 2);
    srcSpan.textContent = "指数价格 · 来自 OKX";
    timeSpan.textContent = `最近更新：${formatTime(state.currentPriceTime)}`;
    if (manual) {
      alert("已成功连接 OKX 指数价格。");
    }
    saveState();
  } catch (e) {
    console.warn("拉取 OKX 失败，切换为本地模拟价格：", e);
    // 切到模拟价格
    state.priceSource = "mock";
    state.currentPrice = nextMockPrice(state.currentPrice);
    state.currentPriceTime = new Date();

    priceSpan.textContent = formatNumber(state.currentPrice, 2);
    srcSpan.textContent = "本地模拟价格 · 仅供娱乐";
    timeSpan.textContent = `最近更新：${formatTime(state.currentPriceTime)}`;
    if (manual) {
      alert("当前无法连接 OKX，已使用本地模拟价格。");
    }
    saveState();
  }
}

// -------------------- 回合逻辑 --------------------

function resetRoundState() {
  state.roundActive = false;
  state.roundStartTime = null;
  state.roundStartPrice = null;
  state.roundInstId = null;
  state.roundDirection = null;
  state.roundSecondsLeft = ROUND_SECONDS;

  if (state.roundTimer) {
    clearInterval(state.roundTimer);
    state.roundTimer = null;
  }

  $("countdown").textContent = "未开始";
  $("round-start-price").textContent = "--";
  $("round-end-price").textContent = "--";
}

async function startRound(direction) {
  if (state.roundActive) {
    alert("当前有正在进行的回合，请稍候。");
    return;
  }

  const betInput = $("bet-size");
  let bet = parseInt(betInput.value, 10);
  if (!bet || bet <= 0) {
    alert("请输入正确的下注筹码。");
    return;
  }
  if (bet > state.chips) {
    alert("当前筹码不足，无法下注。");
    return;
  }

  // 锁定当前交易对与起始价格
  const pair = state.currentPair;
  const instId = PAIRS[pair];

  // 如果当前价格为空，先拉一次
  if (state.currentPrice == null || state.roundInstId === null) {
    try {
      const p = await fetchOkxPrice(instId);
      state.priceSource = "okx";
      state.currentPrice = p;
      state.currentPriceTime = new Date();
      $("current-price").textContent = formatNumber(p, 2);
      $("price-source").textContent = "指数价格 · 来自 OKX";
      $("price-updated-at").textContent =
        "最近更新：" + formatTime(state.currentPriceTime);
    } catch (e) {
      console.warn("开局时无法连上 OKX，使用模拟价格：", e);
      state.priceSource = "mock";
      state.currentPrice = nextMockPrice();
      state.currentPriceTime = new Date();
      $("current-price").textContent = formatNumber(state.currentPrice, 2);
      $("price-source").textContent = "本地模拟价格 · 仅供娱乐";
      $("price-updated-at").textContent =
        "最近更新：" + formatTime(state.currentPriceTime);
    }
  }

  const startPrice = state.currentPrice ?? nextMockPrice();

  state.roundActive = true;
  state.roundStartTime = new Date();
  state.roundStartPrice = startPrice;
  state.roundInstId = instId;
  state.roundDirection = direction;
  state.roundSecondsLeft = ROUND_SECONDS;

  $("round-start-price").textContent = formatNumber(startPrice, 2);
  $("round-end-price").textContent = "--";
  $("countdown").textContent = `${state.roundSecondsLeft}s`;

  // 每秒更新倒计时
  if (state.roundTimer) clearInterval(state.roundTimer);
  state.roundTimer = setInterval(async () => {
    state.roundSecondsLeft -= 1;
    if (state.roundSecondsLeft <= 0) {
      clearInterval(state.roundTimer);
      state.roundTimer = null;
      $("countdown").textContent = "结算中...";
      await finishRound(bet);
    } else {
      $("countdown").textContent = `${state.roundSecondsLeft}s`;
    }
  }, 1000);
}

async function finishRound(bet) {
  const instId = state.roundInstId;
  let endPrice;

  try {
    endPrice = await fetchOkxPrice(instId);
  } catch (e) {
    console.warn("结算时拉取 OKX 失败，使用模拟价格：", e);
    endPrice = nextMockPrice(state.roundStartPrice);
  }

  $("round-end-price").textContent = formatNumber(endPrice, 2);
  $("countdown").textContent = "已结算";

  const diff = endPrice - state.roundStartPrice;
  let result;
  let delta = 0;

  if (diff === 0) {
    result = "draw";
    delta = 0;
  } else if ((diff > 0 && state.roundDirection === "up") ||
             (diff < 0 && state.roundDirection === "down")) {
    result = "win";
    delta = bet;
  } else {
    result = "lose";
    delta = -bet;
  }

  state.chips += delta;
  if (state.chips < 0) state.chips = 0;

  // 历史记录
  state.history.push({
    time: new Date().toISOString(),
    pair: state.currentPair,
    direction: state.roundDirection,
    startPrice: state.roundStartPrice,
    endPrice,
    bet,
    result,
    delta,
  });

  saveState();
  renderHistory();
  $("chips-value").textContent = state.chips;

  const msg =
    result === "draw"
      ? "本局打平，没有盈亏。"
      : result === "win"
      ? `恭喜，猜对方向了，本局赢得 ${delta} 筹码！`
      : `本局未猜中方向，亏损 ${Math.abs(delta)} 筹码。`;

  alert(msg);
  resetRoundState();
}

// -------------------- 渲染 --------------------

function renderHistory() {
  const tbody = $("history-body");
  tbody.innerHTML = "";
  const rows = state.history.slice(-100);
  rows.forEach((item, idx) => {
    const tr = document.createElement("tr");

    const resultClass =
      item.result === "win"
        ? "result-win"
        : item.result === "lose"
        ? "result-lose"
        : "";

    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${formatTime(item.time)}</td>
      <td>${item.pair}</td>
      <td>${item.direction === "up" ? "涨" : "跌"}</td>
      <td>${formatNumber(item.startPrice, 2)}</td>
      <td>${formatNumber(item.endPrice, 2)}</td>
      <td>${item.bet}</td>
      <td class="${resultClass}">
        ${
          item.result === "win"
            ? "赢"
            : item.result === "lose"
            ? "输"
            : "平"
        }
      </td>
      <td class="${resultClass}">
        ${item.delta > 0 ? "+" : ""}${item.delta}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function syncUIFromState() {
  $("mode-select").value = state.mode;
  $("mode-label").textContent = MODE_CONFIG[state.mode].label;
  $("chips-value").textContent = state.chips;
  $("pair-select").value = state.currentPair;

  if (state.currentPrice != null) {
    $("current-price").textContent = formatNumber(state.currentPrice, 2);
  } else {
    $("current-price").textContent = "价格加载中...";
  }
  $("price-source").textContent =
    state.priceSource === "okx"
      ? "指数价格 · 来自 OKX"
      : "本地模拟价格 · 仅供娱乐";

  if (state.currentPriceTime) {
    $("price-updated-at").textContent =
      "最近更新：" + formatTime(state.currentPriceTime);
  } else {
    $("price-updated-at").textContent = "最近更新：--";
  }

  renderHistory();
}

// -------------------- 初始化 --------------------

function init() {
  loadState();
  // 如果是第一次，用当前模式初始化筹码
  if (state.chips == null) {
    state.chips = MODE_CONFIG[state.mode].chips;
  }
  $("chips-value").textContent = state.chips;

  // 绑定事件
  $("mode-select").addEventListener("change", (e) => {
    const value = e.target.value;
    if (!MODE_CONFIG[value]) return;
    state.mode = value;
    $("mode-label").textContent = MODE_CONFIG[value].label;

    // 切换模式时，如果没有在进行中的回合，就重置筹码
    if (!state.roundActive) {
      state.chips = MODE_CONFIG[value].chips;
      $("chips-value").textContent = state.chips;
      saveState();
    } else {
      alert("当前有进行中的回合，本局结束后再切换筹码模式会重置筹码。");
    }
  });

  $("pair-select").addEventListener("change", (e) => {
    const value = e.target.value;
    if (!PAIRS[value]) return;
    state.currentPair = value;
    saveState();
    updateLivePrice(false);
  });

  $("retry-price-btn").addEventListener("click", () => {
    updateLivePrice(true);
  });

  $("guess-up-btn").addEventListener("click", () => {
    startRound("up");
  });

  $("guess-down-btn").addEventListener("click", () => {
    startRound("down");
  });

  $("reset-account-btn").addEventListener("click", () => {
    if (!confirm("确定要重置帐户吗？筹码和历史记录都会清空。")) return;
    state.chips = MODE_CONFIG[state.mode].chips;
    state.history = [];
    resetRoundState();
    saveState();
    syncUIFromState();
  });

  $("toggle-advanced-btn").addEventListener("click", () => {
    const panel = $("advanced-panel");
    panel.classList.toggle("hidden");
    $("toggle-advanced-btn").textContent = panel.classList.contains("hidden")
      ? "显示高级功能"
      : "隐藏高级功能";
  });

  $("export-account-btn").addEventListener("click", exportAccount);
  $("import-account-btn").addEventListener("click", importAccount);

  // 初始渲染
  syncUIFromState();

  // 一进来就先拉一次价格
  updateLivePrice(false);

  // 定时轮询价格（只影响展示，不影响每局结算逻辑）
  setInterval(() => {
    if (!state.roundActive) {
      // 闲置时也更新
      updateLivePrice(false);
    } else {
      // 回合中，为了不干扰锁定价格，只更新当前交易对展示，不改起始价
      updateLivePrice(false);
    }
  }, PRICE_POLL_INTERVAL);
}

document.addEventListener("DOMContentLoaded", init);
