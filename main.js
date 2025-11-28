// ---------------------- 配置与状态 ----------------------

const MODES = {
  easy: { label: "简单", startChips: 100 },
  normal: { label: "普通", startChips: 60 },
  hard: { label: "困难", startChips: 30 }
};

const ROUND_DURATION_SECONDS = 60; // 每局倒计时秒数
const MAX_EXPORTED_HISTORY = 20; // 导出时最多带多少条历史

const OKX_INDEX_API =
  "https://www.okx.com/api/v5/market/index-tickers?instId=BTC-USDT";

const gameState = {
  mode: "easy",
  chips: 0,
  currentPrice: null,
  isLivePrice: false,
  round: {
    active: false,
    direction: null, // "up" | "down"
    startPrice: null,
    endPrice: null,
    bet: 10,
    remainingSeconds: ROUND_DURATION_SECONDS,
    timerId: null
  },
  history: []
};

// DOM 引用
let modeSelectEl;
let chipsEl;
let priceEl;
let priceUpdatedEl;
let priceStatusEl;
let retryPriceBtn;
let countdownEl;
let roundStartPriceEl;
let roundEndPriceEl;
let betInputEl;
let btnUpEl;
let btnDownEl;
let btnResetAccountEl;
let historyBodyEl;
let btnToggleAdvancedEl;
let advancedPanelEl;
let btnExportAccountEl;
let exportCodeEl;
let btnCopyExportEl;
let importCodeEl;
let btnImportAccountEl;

// ---------------------- 工具函数 ----------------------

function formatPrice(price) {
  if (price == null || Number.isNaN(price)) return "--";
  return Number(price).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatTime(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

function formatCountdown(seconds) {
  if (seconds <= 0) return "00:00";
  const m = String(Math.floor(seconds / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function randomWalkPrice(basePrice) {
  if (!basePrice || Number.isNaN(basePrice)) {
    basePrice = 90000; // 默认起点
  }
  const delta = (Math.random() - 0.5) * 200; // ±100 美金浮动
  let next = basePrice + delta;
  if (next < 1000) next = 1000;
  return next;
}

function showToast(message) {
  alert(message); // 简单版，后续你想做成小浮层也可以
}

// ---------------------- 价格相关 ----------------------

async function fetchLivePrice() {
  try {
    const res = await fetch(OKX_INDEX_API);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    const data = json && json.data && json.data[0];
    const px = data && parseFloat(data.idxPx);
    if (!isFinite(px)) throw new Error("invalid price");
    gameState.currentPrice = px;
    updatePriceUI(true);
  } catch (err) {
    console.error("fetch price failed:", err);
    // 如果从未有过价格，用模拟价格起个头
    if (!gameState.currentPrice) {
      gameState.currentPrice = randomWalkPrice(90000);
    }
    updatePriceUI(false);
  }
}

function updatePriceUI(isLiveNow) {
  const now = new Date();

  if (typeof isLiveNow === "boolean") {
    gameState.isLivePrice = isLiveNow;
  }

  const price = gameState.currentPrice;
  if (priceEl) {
    priceEl.textContent = formatPrice(price);
  }

  if (priceUpdatedEl) {
    priceUpdatedEl.textContent = formatTime(now);
  }

  if (priceStatusEl) {
    priceStatusEl.classList.remove("live", "simulated");
    if (gameState.isLivePrice) {
      priceStatusEl.textContent = "实盘 · 来自 OKX 指数";
      priceStatusEl.classList.add("live");
      retryPriceBtn.classList.remove("hidden");
      retryPriceBtn.textContent = "如果价格异常，可重新尝试连接";
    } else {
      priceStatusEl.textContent = "模拟价格 · 未连接到实盘";
      priceStatusEl.classList.add("simulated");
      retryPriceBtn.classList.remove("hidden");
      retryPriceBtn.textContent = "尝试重新连接实盘价格";
    }
  }
}

// 模拟价格定时漂移（仅在模拟模式下）
function tickSimulatedPrice() {
  if (gameState.isLivePrice) return;
  gameState.currentPrice = randomWalkPrice(gameState.currentPrice);
  updatePriceUI(false);
}

// ---------------------- 游戏逻辑 ----------------------

function applyMode(modeKey, isReset) {
  const mode = MODES[modeKey] || MODES.easy;
  gameState.mode = modeKey;

  if (isReset) {
    gameState.chips = mode.startChips;
    gameState.history = [];
    stopRound();
  }

  updateChipsUI();
  renderHistory();
}

function updateChipsUI() {
  if (chipsEl) {
    chipsEl.textContent = gameState.chips;
  }
}

function ensureBet() {
  let bet = parseInt(betInputEl.value, 10);
  if (!Number.isFinite(bet) || bet <= 0) bet = 1;
  if (bet > gameState.chips) bet = gameState.chips;
  if (bet < 1) bet = 1;
  betInputEl.value = bet;
  gameState.round.bet = bet;
  return bet;
}

function canStartRound() {
  if (gameState.round.active) {
    showToast("当前已有一局进行中，请稍候结束再操作。");
    return false;
  }
  if (gameState.chips <= 0) {
    showToast("筹码已经用完啦，可以点击右侧【重置账户】重新开始。");
    return false;
  }
  const bet = ensureBet();
  if (bet > gameState.chips) {
    showToast("筹码不足，无法完成本次下注。");
    return false;
  }
  return true;
}

function startRound(direction) {
  if (!canStartRound()) return;

  const bet = ensureBet();
  const startPrice = gameState.currentPrice || randomWalkPrice(90000);

  gameState.round.active = true;
  gameState.round.direction = direction;
  gameState.round.startPrice = startPrice;
  gameState.round.endPrice = null;
  gameState.round.remainingSeconds = ROUND_DURATION_SECONDS;

  if (roundStartPriceEl) {
    roundStartPriceEl.textContent = formatPrice(startPrice);
  }
  if (roundEndPriceEl) {
    roundEndPriceEl.textContent = "--";
  }
  if (countdownEl) {
    countdownEl.textContent = formatCountdown(
      gameState.round.remainingSeconds
    );
  }

  // 倒计时
  if (gameState.round.timerId) {
    clearInterval(gameState.round.timerId);
  }
  gameState.round.timerId = setInterval(() => {
    gameState.round.remainingSeconds -= 1;
    if (gameState.round.remainingSeconds <= 0) {
      finishRound();
    } else if (countdownEl) {
      countdownEl.textContent = formatCountdown(
        gameState.round.remainingSeconds
      );
    }
  }, 1000);
}

function stopRound() {
  if (gameState.round.timerId) {
    clearInterval(gameState.round.timerId);
    gameState.round.timerId = null;
  }
  gameState.round.active = false;
  gameState.round.direction = null;
  gameState.round.startPrice = null;
  gameState.round.endPrice = null;
  gameState.round.remainingSeconds = ROUND_DURATION_SECONDS;

  if (countdownEl) countdownEl.textContent = "未开始";
  if (roundStartPriceEl) roundStartPriceEl.textContent = "--";
  if (roundEndPriceEl) roundEndPriceEl.textContent = "--";
}

function finishRound() {
  if (!gameState.round.active) return;

  if (gameState.round.timerId) {
    clearInterval(gameState.round.timerId);
    gameState.round.timerId = null;
  }

  // 结束价：当前价（如果没有，则再随机一次）
  const endPrice =
    gameState.currentPrice != null
      ? gameState.currentPrice
      : randomWalkPrice(gameState.round.startPrice);

  gameState.round.endPrice = endPrice;
  if (roundEndPriceEl) {
    roundEndPriceEl.textContent = formatPrice(endPrice);
  }
  if (countdownEl) {
    countdownEl.textContent = "本局已结束";
  }

  const dir = gameState.round.direction;
  const bet = gameState.round.bet;
  const start = gameState.round.startPrice;
  let result = "draw";
  let delta = 0;

  if (endPrice > start && dir === "up") {
    result = "win";
    delta = bet;
  } else if (endPrice < start && dir === "down") {
    result = "win";
    delta = bet;
  } else if (endPrice === start) {
    result = "draw";
    delta = 0;
  } else {
    result = "loss";
    delta = -bet;
  }

  gameState.chips += delta;
  if (gameState.chips < 0) gameState.chips = 0;
  updateChipsUI();

  addHistoryRecord({
    time: Date.now(),
    direction: dir,
    startPrice: start,
    endPrice,
    bet,
    result,
    delta
  });

  gameState.round.active = false;
}

function addHistoryRecord(record) {
  gameState.history.unshift(record);
  renderHistory();
}

function renderHistory() {
  if (!historyBodyEl) return;

  historyBodyEl.innerHTML = "";

  gameState.history.forEach((item, index) => {
    const tr = document.createElement("tr");

    const dirText = item.direction === "up" ? "涨" : "跌";
    let resultText = "";
    let resultClass = "";
    if (item.result === "win") {
      resultText = "赢";
      resultClass = "text-win";
    } else if (item.result === "loss") {
      resultText = "输";
      resultClass = "text-loss";
    } else {
      resultText = "平";
      resultClass = "text-draw";
    }

    const cells = [
      index + 1,
      formatTime(item.time),
      dirText,
      formatPrice(item.startPrice),
      formatPrice(item.endPrice),
      item.bet,
      resultText,
      item.delta > 0 ? `+${item.delta}` : item.delta
    ];

    cells.forEach((value, idx) => {
      const td = document.createElement("td");
      td.textContent = value;
      if (idx === 6 || idx === 7) {
        td.classList.add(resultClass);
      }
      tr.appendChild(td);
    });

    historyBodyEl.appendChild(tr);
  });
}

// ---------------------- 导出 / 导入 ----------------------

function encodeAccountState() {
  const stateForExport = {
    v: 1,
    m: gameState.mode,
    c: gameState.chips,
    h: gameState.history.slice(0, MAX_EXPORTED_HISTORY)
  };
  const json = JSON.stringify(stateForExport);

  // 使用 base64 + 去掉多余符号，前缀 0x 表示这是导出的代码
  const b64 = btoa(encodeURIComponent(json));
  const compact = b64.replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return "0x" + compact;
}

function decodeAccountState(code) {
  if (!code || typeof code !== "string") {
    throw new Error("empty code");
  }
  if (code.startsWith("0x")) {
    code = code.slice(2);
  }
  const b64 = code.replace(/-/g, "+").replace(/_/g, "/");
  const padded =
    b64 + "===".slice((b64.length + 3) % 4); // 补齐 base64 长度
  const json = decodeURIComponent(atob(padded));
  const obj = JSON.parse(json);
  return obj;
}

function exportAccount() {
  try {
    const code = encodeAccountState();
    if (exportCodeEl) {
      exportCodeEl.value = code;
    }
    showToast("账户代码已生成，可以复制保存。");
  } catch (err) {
    console.error("export failed:", err);
    showToast("导出失败，请稍后再试。");
  }
}

function importAccount() {
  const code = importCodeEl.value.trim();
  if (!code) {
    showToast("请输入要导入的账户代码。");
    return;
  }
  try {
    const obj = decodeAccountState(code);
    if (!obj || typeof obj !== "object") {
      throw new Error("invalid object");
    }

    const modeKey = MODES[obj.m] ? obj.m : "easy";
    gameState.mode = modeKey;
    if (typeof obj.c === "number" && obj.c >= 0) {
      gameState.chips = Math.floor(obj.c);
    } else {
      gameState.chips = MODES[modeKey].startChips;
    }
    if (Array.isArray(obj.h)) {
      gameState.history = obj.h;
    } else {
      gameState.history = [];
    }

    stopRound();
    modeSelectEl.value = modeKey;
    updateChipsUI();
    renderHistory();

    showToast("账户导入成功。");
  } catch (err) {
    console.error("import failed:", err);
    showToast("导入失败，请检查代码是否完整或是否输入正确。");
  }
}

// ---------------------- 初始化 ----------------------

function bindEvents() {
  modeSelectEl.addEventListener("change", () => {
    const newMode = modeSelectEl.value;
    const mode = MODES[newMode] || MODES.easy;
    const confirmReset = confirm(
      `切换到「${mode.label}」模式并重置筹码为 ${mode.startChips} 吗？\n当前历史记录将被清空。`
    );
    if (confirmReset) {
      applyMode(newMode, true);
    } else {
      modeSelectEl.value = gameState.mode;
    }
  });

  betInputEl.addEventListener("change", ensureBet);

  btnUpEl.addEventListener("click", () => startRound("up"));
  btnDownEl.addEventListener("click", () => startRound("down"));

  btnResetAccountEl.addEventListener("click", () => {
    const mode = MODES[gameState.mode];
    const ok = confirm(
      `确定要重置账户吗？\n筹码将恢复到「${mode.label}」模式的初始值 ${mode.startChips}，历史记录会被清空。`
    );
    if (ok) {
      applyMode(gameState.mode, true);
    }
  });

  retryPriceBtn.addEventListener("click", () => {
    fetchLivePrice();
  });

  btnToggleAdvancedEl.addEventListener("click", () => {
    const isHidden = advancedPanelEl.classList.contains("hidden");
    if (isHidden) {
      advancedPanelEl.classList.remove("hidden");
      btnToggleAdvancedEl.textContent = "隐藏高级功能";
    } else {
      advancedPanelEl.classList.add("hidden");
      btnToggleAdvancedEl.textContent = "显示高级功能";
    }
  });

  btnExportAccountEl.addEventListener("click", exportAccount);
  btnCopyExportEl.addEventListener("click", () => {
    if (!exportCodeEl.value) {
      showToast("请先生成账户代码。");
      return;
    }
    exportCodeEl.select();
    document.execCommand("copy");
    showToast("账户代码已复制到剪贴板。");
  });
  btnImportAccountEl.addEventListener("click", importAccount);
}

function initDomRefs() {
  modeSelectEl = document.getElementById("mode-select");
  chipsEl = document.getElementById("current-chips");
  priceEl = document.getElementById("current-price");
  priceUpdatedEl = document.getElementById("price-updated-time");
  priceStatusEl = document.getElementById("price-status");
  retryPriceBtn = document.getElementById("btn-retry-price");
  countdownEl = document.getElementById("round-countdown");
  roundStartPriceEl = document.getElementById("round-start-price");
  roundEndPriceEl = document.getElementById("round-end-price");
  betInputEl = document.getElementById("bet-amount");
  btnUpEl = document.getElementById("btn-up");
  btnDownEl = document.getElementById("btn-down");
  btnResetAccountEl = document.getElementById("btn-reset-account");
  historyBodyEl = document.getElementById("history-body");
  btnToggleAdvancedEl = document.getElementById("btn-toggle-advanced");
  advancedPanelEl = document.getElementById("advanced-panel");
  btnExportAccountEl = document.getElementById("btn-export-account");
  exportCodeEl = document.getElementById("export-code");
  btnCopyExportEl = document.getElementById("btn-copy-export");
  importCodeEl = document.getElementById("import-code");
  btnImportAccountEl = document.getElementById("btn-import-account");

  // 防御：如果有任何一个关键元素没找到，直接报错方便排查
  const required = [
    modeSelectEl,
    chipsEl,
    priceEl,
    priceUpdatedEl,
    priceStatusEl,
    retryPriceBtn,
    countdownEl,
    roundStartPriceEl,
    roundEndPriceEl,
    betInputEl,
    btnUpEl,
    btnDownEl,
    btnResetAccountEl,
    historyBodyEl,
    btnToggleAdvancedEl,
    advancedPanelEl,
    btnExportAccountEl,
    exportCodeEl,
    btnCopyExportEl,
    importCodeEl,
    btnImportAccountEl
  ];

  if (required.some((el) => !el)) {
    console.error("DOM element missing", { required });
    showToast("页面元素加载异常，请检查 index.html 与 main.js 是否匹配。");
  }
}

function init() {
  initDomRefs();
  bindEvents();

  // 默认模式
  applyMode("easy", true);
  betInputEl.value = gameState.round.bet;

  // 先随机一个本地价格，避免空白
  gameState.currentPrice = randomWalkPrice(90000);
  updatePriceUI(false);

  // 尝试连接实盘价格
  fetchLivePrice();
  // 定期刷新实盘价格
  setInterval(() => {
    fetchLivePrice();
  }, 15000);

  // 模拟模式下的价格漂移
  setInterval(() => {
    tickSimulatedPrice();
  }, 7000);
}

document.addEventListener("DOMContentLoaded", init);
