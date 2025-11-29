// ========== 常量 & 初始状态 ==========
const STORAGE_KEY = "rocket_predict_state_v3";

// 模式配置
const MODES = {
  easy: { label: "简单（起始 100 筹码）", startChips: 100 },
  normal: { label: "普通（起始 60 筹码）", startChips: 60 },
  hard: { label: "困难（起始 30 筹码）", startChips: 30 },
};

const DEFAULT_STATE = {
  version: 1,
  mode: "easy",
  baseChips: MODES.easy.startChips,
  currentChips: MODES.easy.startChips,
  accountIndex: 1,
  selectedPair: "BTC-USDT",
  // 正在进行的这一局
  currentRound: null, // { id, pair, direction, stake, startPrice, startAt, timerId, deadline }
  // 统计
  stats: {
    totalGames: 0,
    totalWins: 0,
    maxStreak: 0,
    currentStreak: 0,
    totalPnl: 0,
  },
  // 历史记录（完整存储，但渲染时只展示最近 20）
  history: [], // { id, time, pair, direction, startPrice, endPrice, stake, result, pnl }
};

let state = loadState();

// 实时价格缓存
const priceCache = {
  "BTC-USDT": { price: null, updatedAt: null, source: "okx" },
  "ETH-USDT": { price: null, updatedAt: null, source: "okx" },
};

// 倒计时定时器
let countdownInterval = null;

// ========== 工具函数 ==========

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const obj = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULT_STATE),
      ...obj,
      stats: { ...structuredClone(DEFAULT_STATE.stats), ...(obj.stats || {}) },
      history: Array.isArray(obj.history) ? obj.history : [],
    };
  } catch (e) {
    console.error("loadState error:", e);
    return structuredClone(DEFAULT_STATE);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function formatTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

function formatPrice(v) {
  if (v == null || isNaN(v)) return "--";
  return v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPnl(v) {
  if (v === 0) return "0";
  return (v > 0 ? "+" : "") + v.toString();
}

// 生成一个简短的本地账号代码（ACC-xxxx）
function generateShortAccountCode(fullPayload) {
  const json = JSON.stringify(fullPayload);
  const fullBase64 = btoa(encodeURIComponent(json));
  // 使用前 32 位作为 key
  const shortKey = fullBase64.slice(0, 32);
  // 把完整数据藏在 localStorage 里，key 携带短码
  localStorage.setItem(`rocket_predict_backup_${shortKey}`, fullBase64);
  return `ACC-${shortKey}`;
}

function decodeShortAccountCode(code) {
  if (!code || typeof code !== "string") return null;
  const trimmed = code.trim();
  if (!trimmed.startsWith("ACC-")) return null;
  const shortKey = trimmed.slice(4);
  const fullBase64 = localStorage.getItem(
    `rocket_predict_backup_${shortKey}`
  );
  if (!fullBase64) return null;
  try {
    const json = decodeURIComponent(atob(fullBase64));
    return JSON.parse(json);
  } catch (e) {
    console.error("decodeShortAccountCode error", e);
    return null;
  }
}

// ========== DOM 引用 ==========

// 左侧
const modeSelect = document.getElementById("mode-select");
const btnChangeMode = document.getElementById("btn-change-mode");
const infoCurrentChips = document.getElementById("info-current-chips");
const infoAccountIndex = document.getElementById("info-account-index");
const btnResetAccount = document.getElementById("btn-reset-account");

const pairSelect = document.getElementById("pair-select");
const currentPriceEl = document.getElementById("current-price");
const priceSourceEl = document.getElementById("price-source");
const priceUpdatedAtEl = document.getElementById("price-updated-at");
const btnRefreshPrice = document.getElementById("btn-refresh-price");

const roundCountdownEl = document.getElementById("round-countdown");
const roundStartPriceEl = document.getElementById("round-start-price");
const roundEndPriceEl = document.getElementById("round-end-price");
const stakeInput = document.getElementById("stake-input");
const btnBetUp = document.getElementById("btn-bet-up");
const btnBetDown = document.getElementById("btn-bet-down");

// 右侧
const statTotalGamesEl = document.getElementById("stat-total-games");
const statWinRateEl = document.getElementById("stat-win-rate");
const statMaxStreakEl = document.getElementById("stat-max-streak");
const statTotalPnlEl = document.getElementById("stat-total-pnl");

const historyBody = document.getElementById("history-body");

const btnToggleAdvanced = document.getElementById("btn-toggle-advanced");
const advancedArea = document.getElementById("advanced-area");
const exportCodeInput = document.getElementById("export-code");
const btnGenerateExport = document.getElementById("btn-generate-export");
const importCodeInput = document.getElementById("import-code");
const btnImportAccount = document.getElementById("btn-import-account");

// ========== 价格相关 ==========
async function fetchOkxPrice(instId) {
  const url = `https://www.okx.com/api/v5/market/index-tickers?instId=${encodeURIComponent(
    instId
  )}`;
  const resp = await fetch(url, { mode: "cors" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  const item = (data.data && data.data[0]) || null;
  if (!item || !item.idxPx) throw new Error("No idxPx");
  return parseFloat(item.idxPx);
}

// 简单本地模拟价格：在上一次基础上随机波动
function simulatePrice(pair) {
  const cache = priceCache[pair];
  let base = cache.price ?? (pair === "BTC-USDT" ? 90000 : 3500);
  const drift = pair === "BTC-USDT" ? 200 : 10;
  const rand = (Math.random() - 0.5) * drift;
  base = Math.max(1, base + rand);
  return base;
}

async function updatePrice(pair, { manual = false } = {}) {
  const cache = priceCache[pair];
  let price;
  let source = "okx";

  try {
    price = await fetchOkxPrice(pair);
  } catch (e) {
    console.warn("OKX price failed, using simulate:", e);
    price = simulatePrice(pair);
    source = "mock";
  }

  cache.price = price;
  cache.updatedAt = Date.now();
  cache.source = source;

  if (state.selectedPair === pair) {
    renderCurrentPrice();
  }

  if (manual) {
    if (source === "okx") {
      alert("已成功从 OKX 获取最新指数价格。");
    } else {
      alert("暂时无法连接 OKX，当前价格为本地模拟。");
    }
  }
}

function renderCurrentPrice() {
  const pair = state.selectedPair;
  const cache = priceCache[pair];

  if (!cache.price) {
    currentPriceEl.textContent = "--";
    priceSourceEl.textContent = "指数价格：正在加载...";
    priceUpdatedAtEl.textContent = "最近更新：--";
    return;
  }

  currentPriceEl.textContent = formatPrice(cache.price);
  priceSourceEl.textContent =
    cache.source === "okx"
      ? "指数价格：来自 OKX"
      : "当前价格：本地模拟（OKX 暂不可用）";
  priceUpdatedAtEl.textContent =
    "最近更新：" + formatTime(cache.updatedAt || Date.now());
}

// ========== 渲染 ==========
function renderAccountArea() {
  modeSelect.value = state.mode;
  infoCurrentChips.textContent = state.currentChips.toString();
  infoAccountIndex.textContent = state.accountIndex.toString();
}

function renderRoundArea() {
  const r = state.currentRound;
  if (!r) {
    roundCountdownEl.textContent = "未开始";
    roundStartPriceEl.textContent = "--";
    roundEndPriceEl.textContent = "--";
    btnBetUp.disabled = false;
    btnBetDown.disabled = false;
    stakeInput.disabled = false;
  } else {
    roundStartPriceEl.textContent = formatPrice(r.startPrice);
    roundEndPriceEl.textContent = "--";
    btnBetUp.disabled = true;
    btnBetDown.disabled = true;
    stakeInput.disabled = true;
  }
}

function renderStats() {
  const s = state.stats;
  statTotalGamesEl.textContent = s.totalGames.toString();
  if (s.totalGames === 0) {
    statWinRateEl.textContent = "--";
  } else {
    const rate = (s.totalWins / s.totalGames) * 100;
    statWinRateEl.textContent =
      rate.toFixed(1).replace(/\.0$/, "") + "%";
  }
  statMaxStreakEl.textContent = s.maxStreak.toString();
  statTotalPnlEl.textContent = formatPnl(s.totalPnl);
}

function renderHistory() {
  historyBody.innerHTML = "";

  if (!state.history.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 9;
    td.textContent = "暂无对局记录";
    td.style.textAlign = "center";
    td.style.color = "#6b7280";
    tr.appendChild(td);
    historyBody.appendChild(tr);
    return;
  }

  // 最近 20 局，倒序显示（最新在上）
  const items = state.history.slice(-20).slice().reverse();

  for (const item of items) {
    const tr = document.createElement("tr");

    const cells = [
      item.id,
      formatTime(item.time),
      item.pair,
      item.direction === "up" ? "涨" : "跌",
      formatPrice(item.startPrice),
      formatPrice(item.endPrice),
      item.stake.toString(),
      item.result === "win" ? "赢" : "输",
      formatPnl(item.pnl),
    ];

    cells.forEach((val, idx) => {
      const td = document.createElement("td");
      td.textContent = val;

      // 方向 / 结果 / 盈亏 上下颜色
      if (idx === 3) {
        td.className =
          item.direction === "up" ? "tag-up" : "tag-down";
      } else if (idx === 7) {
        td.className =
          item.result === "win" ? "tag-up" : "tag-down";
      } else if (idx === 8) {
        if (item.pnl > 0) td.className = "pnl-pos";
        else if (item.pnl < 0) td.className = "pnl-neg";
      }

      tr.appendChild(td);
    });

    historyBody.appendChild(tr);
  }
}

function renderAll() {
  renderAccountArea();
  renderCurrentPrice();
  renderRoundArea();
  renderStats();
  renderHistory();
}

// ========== 业务逻辑 ==========

function changeMode(newMode) {
  if (!MODES[newMode]) return;
  state.mode = newMode;
  state.baseChips = MODES[newMode].startChips;
  state.currentChips = MODES[newMode].startChips;
  state.accountIndex = 1;
  state.currentRound = null;
  state.stats = structuredClone(DEFAULT_STATE.stats);
  state.history = [];
  clearCountdown();
  saveState();
  renderAll();
}

function resetAccount() {
  if (
    !confirm(
      "确定要重置账户吗？当前筹码、统计和历史记录都会被清空。"
    )
  ) {
    return;
  }
  state.currentChips = state.baseChips;
  state.accountIndex = 1;
  state.currentRound = null;
  state.stats = structuredClone(DEFAULT_STATE.stats);
  state.history = [];
  clearCountdown();
  saveState();
  renderAll();
}

function clearCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

// 开始新的一局
async function startRound(direction) {
  if (state.currentRound) {
    alert("当前还有一局在进行中，请等待结算。");
    return;
  }

  const stake = Math.floor(Number(stakeInput.value) || 0);
  if (stake <= 0) {
    alert("请先设置本局下注筹码（> 0）。");
    return;
  }
  if (stake > state.currentChips) {
    alert("当前筹码不足，无法下注。");
    return;
  }

  const pair = state.selectedPair;

  // 确保有起始价格（优先从 cache，没有就先获取一次）
  if (!priceCache[pair].price) {
    await updatePrice(pair);
  }
  const startPrice = priceCache[pair].price;
  if (!startPrice) {
    alert("暂时无法获取价格，请稍后重试。");
    return;
  }

  const now = Date.now();
  const id =
    (state.history.length ? state.history[state.history.length - 1].id : 0) +
    1;

  state.currentRound = {
    id,
    pair,
    direction, // up / down
    stake,
    startPrice,
    startAt: now,
    deadline: now + 60 * 1000,
  };

  // 扣掉筹码（先锁定）
  state.currentChips -= stake;

  saveState();
  setupCountdown();
  renderAll();
}

// 设置 1 秒一次的倒计时
function setupCountdown() {
  clearCountdown();
  const r = state.currentRound;
  if (!r) return;

  function tick() {
    const now = Date.now();
    const remain = Math.max(0, Math.floor((r.deadline - now) / 1000));
    if (remain <= 0) {
      roundCountdownEl.textContent = "结算中...";
      clearCountdown();
      // 走结算逻辑
      settleCurrentRound();
    } else {
      roundCountdownEl.textContent = remain + " 秒";
    }
  }

  tick();
  countdownInterval = setInterval(tick, 1000);
}

// 结算当前这局
async function settleCurrentRound() {
  const r = state.currentRound;
  if (!r) return;

  // 使用“本局锁定的交易对”来获取结束价格
  await updatePrice(r.pair);
  const endPrice = priceCache[r.pair].price ?? r.startPrice;
  roundEndPriceEl.textContent = formatPrice(endPrice);

  const isUp = endPrice > r.startPrice;
  const isDown = endPrice < r.startPrice;
  let result = "draw";
  let pnl = 0;

  if (isUp || isDown) {
    const userUp = r.direction === "up";
    const win = (isUp && userUp) || (isDown && !userUp);
    result = win ? "win" : "lose";
    pnl = win ? r.stake : -r.stake;
  } else {
    // 不涨不跌，视为和局，筹码退回
    result = "draw";
    pnl = 0;
  }

  // 和局：返还筹码；胜：返还 + 奖励；负：之前已经扣掉，不再加回
  if (pnl >= 0) {
    state.currentChips += r.stake + pnl;
  }

  // 更新统计（累计）
  const s = state.stats;
  s.totalGames += 1;
  if (result === "win") {
    s.totalWins += 1;
    s.currentStreak += 1;
    if (s.currentStreak > s.maxStreak) {
      s.maxStreak = s.currentStreak;
    }
  } else if (result === "lose") {
    s.currentStreak = 0;
  }
  s.totalPnl += pnl;

  // 写入历史
  const historyItem = {
    id: r.id,
    time: r.startAt,
    pair: r.pair,
    direction: r.direction,
    startPrice: r.startPrice,
    endPrice,
    stake: r.stake,
    result,
    pnl,
  };
  state.history.push(historyItem);
  // 防止无限增长，最多保留 200 条
  if (state.history.length > 200) {
    state.history = state.history.slice(-200);
  }

  // 清空当前局
  state.currentRound = null;

  saveState();
  renderAll();
}

// ========== 高级功能：账号导出 / 导入 ==========

function handleGenerateExport() {
  const payload = {
    version: 1,
    mode: state.mode,
    baseChips: state.baseChips,
    currentChips: state.currentChips,
    accountIndex: state.accountIndex,
    stats: state.stats,
    history: state.history,
  };
  const code = generateShortAccountCode(payload);
  exportCodeInput.value = code;
}

function handleImportAccount() {
  const code = importCodeInput.value;
  const payload = decodeShortAccountCode(code);
  if (!payload) {
    alert("无法解析这个账号代码，可能只在原来的设备上可用。");
    return;
  }

  state.mode = payload.mode || state.mode;
  state.baseChips = payload.baseChips || MODES[state.mode].startChips;
  state.currentChips =
    typeof payload.currentChips === "number"
      ? payload.currentChips
      : state.baseChips;
  state.accountIndex =
    typeof payload.accountIndex === "number"
      ? payload.accountIndex
      : 1;
  state.stats = {
    ...structuredClone(DEFAULT_STATE.stats),
    ...(payload.stats || {}),
  };
  state.history = Array.isArray(payload.history)
    ? payload.history
    : [];
  state.currentRound = null;
  clearCountdown();
  saveState();
  renderAll();
  alert("账号导入成功，只在本设备可用。");
}

// ========== 事件绑定 ==========

modeSelect.addEventListener("change", (e) => {
  const newMode = e.target.value;
  changeMode(newMode);
});

btnChangeMode.addEventListener("click", () => {
  const currentKeys = Object.keys(MODES);
  const idx = currentKeys.indexOf(state.mode);
  const next = currentKeys[(idx + 1) % currentKeys.length];
  changeMode(next);
  modeSelect.value = next;
});

btnResetAccount.addEventListener("click", resetAccount);

pairSelect.addEventListener("change", (e) => {
  state.selectedPair = e.target.value;
  saveState();
  renderCurrentPrice();
  updatePrice(state.selectedPair);
});

btnRefreshPrice.addEventListener("click", () => {
  updatePrice(state.selectedPair, { manual: true });
});

btnBetUp.addEventListener("click", () => {
  startRound("up");
});

btnBetDown.addEventListener("click", () => {
  startRound("down");
});

// 高级区展开折叠
btnToggleAdvanced.addEventListener("click", () => {
  const hidden = advancedArea.classList.toggle("hidden");
  btnToggleAdvanced.textContent = hidden
    ? "显示高级功能"
    : "隐藏高级功能";
});

btnGenerateExport.addEventListener("click", handleGenerateExport);
btnImportAccount.addEventListener("click", handleImportAccount);

// ========== 初始化 ==========

(function init() {
  // 恢复 UI 状态
  modeSelect.value = state.mode;
  pairSelect.value = state.selectedPair;
  renderAll();

  // 一进来先拉一次价格
  updatePrice(state.selectedPair).catch(() => {
    // 如果失败，后续会用本地模拟
  });
})();
