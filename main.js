// ======================= 配置 =========================

const MODE_CONFIG = {
  easy: { label: "简单", initialChips: 100 },
  normal: { label: "普通", initialChips: 50 },
  hard: { label: "困难", initialChips: 20 },
};

const SYMBOL = "BTC-USDT-SWAP"; // 仅展示文字用
const OKX_API =
  "https://www.okx.com/api/v5/market/index-tickers?instId=BTC-USDT";

// 本地存储键
const STORAGE_KEYS = {
  CURRENT_ACCOUNT_ID: "rocket_game_current_account_id",
  ACCOUNT_PREFIX: "rocket_game_account_",
};

// 生成 0x 开头 42 字符“账号地址”
function generateAccountId() {
  const hex = "0123456789abcdef";
  let s = "0x";
  for (let i = 0; i < 40; i++) {
    s += hex[Math.floor(Math.random() * hex.length)];
  }
  return s;
}

// ======================= 状态 =========================

const state = {
  mode: "easy",
  chips: MODE_CONFIG.easy.initialChips,
  roundId: 0,
  roundActive: false,
  roundDirection: null, // "up" | "down"
  roundStake: 10,
  roundStartPrice: null,
  roundEndPrice: null,
  countdownSec: 0,
  countdownTimer: null,

  currentPrice: null,
  lastPriceUpdateTime: null,
  priceSource: "unknown", // "real" | "sim" | "unknown"

  history: [], // {no,time,direction,startPrice,endPrice,bet,result,delta}
};

// ======================= DOM =========================

const el = {};

document.addEventListener("DOMContentLoaded", () => {
  // 绑定元素
  el.modeSelect = document.getElementById("modeSelect");
  el.chipDisplay = document.getElementById("chipDisplay");
  el.currentPrice = document.getElementById("currentPrice");
  el.priceSourceLabel = document.getElementById("priceSourceLabel");
  el.priceUpdateTime = document.getElementById("priceUpdateTime");
  el.priceHint = document.getElementById("priceHint");
  el.btnRetryPrice = document.getElementById("btnRetryPrice");

  el.pairName = document.getElementById("pairName");

  el.stakeInput = document.getElementById("stakeInput");
  el.stakeValue = document.getElementById("stakeValue");
  el.btnUp = document.getElementById("btnUp");
  el.btnDown = document.getElementById("btnDown");

  el.roundStartPrice = document.getElementById("roundStartPrice");
  el.roundEndPrice = document.getElementById("roundEndPrice");
  el.countdownLabel = document.getElementById("countdownLabel");
  el.roundStatusNote = document.getElementById("roundStatusNote");

  el.btnResetAccount = document.getElementById("btnResetAccount");

  el.historyBody = document.getElementById("historyBody");
  el.historyEmpty = document.getElementById("historyEmpty");

  el.toggleAdvancedBtn = document.getElementById("toggleAdvancedBtn");
  el.advancedPanel = document.getElementById("advancedPanel");
  el.btnExportAccount = document.getElementById("btnExportAccount");
  el.btnImportAccount = document.getElementById("btnImportAccount");
  el.exportCodeDisplay = document.getElementById("exportCodeDisplay");
  el.importCodeInput = document.getElementById("importCodeInput");

  // 初始化 UI
  el.pairName.textContent = SYMBOL;
  el.modeSelect.value = state.mode;
  updateChipsUI();
  updateStakeUI();
  renderHistory();
  updateRoundUI();
  updatePriceUI();

  // 事件绑定
  el.modeSelect.addEventListener("change", onModeChange);
  el.stakeInput.addEventListener("input", onStakeChange);
  el.btnUp.addEventListener("click", () => startRound("up"));
  el.btnDown.addEventListener("click", () => startRound("down"));
  el.btnResetAccount.addEventListener("click", resetAccount);

  el.btnRetryPrice.addEventListener("click", () => {
    priceRetryManual();
  });

  el.toggleAdvancedBtn.addEventListener("click", toggleAdvancedPanel);
  el.btnExportAccount.addEventListener("click", exportAccount);
  el.btnImportAccount.addEventListener("click", importAccount);

  // 默认尝试连接一次实盘
  fetchRealPrice(true);

  // 如果本地已有当前账号 id，尝试加载
  const existingId = localStorage.getItem(STORAGE_KEYS.CURRENT_ACCOUNT_ID);
  if (existingId) {
    const k = STORAGE_KEYS.ACCOUNT_PREFIX + existingId;
    const raw = localStorage.getItem(k);
    if (raw) {
      try {
        const data = JSON.parse(raw);
        restoreFromAccountData(data);
        el.exportCodeDisplay.textContent = existingId;
      } catch (e) {
        console.error("自动加载账号失败：", e);
      }
    }
  }
});

// ======================= 价格相关 =========================

// 手动点击“尝试连接实盘价格”
function priceRetryManual() {
  el.priceHint.textContent = "正在尝试连接实盘价格…";
  fetchRealPrice(false);
}

// 获取实盘价格；失败则保持/切换为模拟价格
async function fetchRealPrice(initialCall) {
  try {
    const resp = await fetch(OKX_API);
    if (!resp.ok) throw new Error("HTTP status " + resp.status);
    const json = await resp.json();
    if (!json.data || !json.data[0]) throw new Error("no data");

    const last = parseFloat(json.data[0].last);
    if (Number.isNaN(last)) throw new Error("invalid price");

    state.currentPrice = last;
    state.lastPriceUpdateTime = new Date();
    state.priceSource = "real";

    updatePriceUI();

    if (initialCall) {
      el.priceHint.textContent = "已连接实盘价格。";
    } else {
      el.priceHint.textContent = "已切换为实盘价格。";
    }

    return last;
  } catch (err) {
    console.warn("获取 OKX 价格失败，使用模拟价格：", err);

    // 如果之前没有价格，就初始化一个模拟价格
    if (state.currentPrice == null) {
      state.currentPrice = 50000 + Math.random() * 10000;
    }
    state.priceSource = "sim";
    state.lastPriceUpdateTime = new Date();
    updatePriceUI();

    el.priceHint.textContent =
      "当前为模拟价格模式，如需切换为实盘，请点击上方按钮重试连接。";

    return null;
  }
}

// 每次新开一局时，如果仍然是模拟价格，就轻微随机波动
function applySimulatedMove() {
  if (state.priceSource !== "sim") return;
  if (state.currentPrice == null) {
    state.currentPrice = 50000 + Math.random() * 10000;
  }
  const pct = (Math.random() - 0.5) * 0.01; // ±1%
  state.currentPrice = state.currentPrice * (1 + pct);
  state.lastPriceUpdateTime = new Date();
  updatePriceUI();
}

// ======================= UI 更新 =========================

function formatTime(d) {
  if (!d) return "--";
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

function updatePriceUI() {
  const p = state.currentPrice;
  el.currentPrice.textContent =
    p == null ? "--" : p.toLocaleString(undefined, { maximumFractionDigits: 2 });

  el.priceUpdateTime.textContent = state.lastPriceUpdateTime
    ? formatTime(state.lastPriceUpdateTime)
    : "--";

  el.priceSourceLabel.classList.remove(
    "price-source-real",
    "price-source-sim"
  );
  if (state.priceSource === "real") {
    el.priceSourceLabel.textContent = "实盘价格";
    el.priceSourceLabel.classList.add("price-source-real");
  } else if (state.priceSource === "sim") {
    el.priceSourceLabel.textContent = "模拟价格";
    el.priceSourceLabel.classList.add("price-source-sim");
  } else {
    el.priceSourceLabel.textContent = "--";
  }
}

function updateChipsUI() {
  el.chipDisplay.textContent = state.chips.toLocaleString();
  // 限制滑条最大值不能超过筹码
  const maxStake = Math.max(1, Math.floor(state.chips));
  el.stakeInput.max = String(maxStake);
  if (state.roundStake > maxStake) {
    state.roundStake = maxStake;
  }
  el.stakeInput.value = String(state.roundStake);
  updateStakeUI();
}

function updateStakeUI() {
  el.stakeValue.textContent = state.roundStake;
}

function updateRoundUI() {
  el.roundStartPrice.textContent =
    state.roundStartPrice == null
      ? "--"
      : state.roundStartPrice.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        });
  el.roundEndPrice.textContent =
    state.roundEndPrice == null
      ? "--"
      : state.roundEndPrice.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        });

  if (!state.roundActive) {
    el.countdownLabel.textContent = "未开始";
  }
}

function renderHistory() {
  const list = state.history;
  el.historyBody.innerHTML = "";

  if (!list.length) {
    el.historyEmpty.style.display = "block";
    return;
  }
  el.historyEmpty.style.display = "none";

  list
    .slice()
    .reverse()
    .forEach((row) => {
      const tr = document.createElement("tr");

      const dirLabel = row.direction === "up" ? "涨" : "跌";
      const dirClass =
        row.direction === "up"
          ? "history-direction-up"
          : "history-direction-down";

      const resultClass =
        row.result === "win" ? "history-result-win" : "history-result-lose";

      const pnlClass =
        row.delta > 0 ? "history-pnl-positive" : "history-pnl-negative";

      tr.innerHTML = `
        <td>${row.no}</td>
        <td>${row.time}</td>
        <td class="${dirClass}">${dirLabel}</td>
        <td>${row.startPrice.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })}</td>
        <td>${row.endPrice.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })}</td>
        <td>${row.bet}</td>
        <td class="${resultClass}">${row.result === "win" ? "赢" : "输"}</td>
        <td class="${pnlClass}">${row.delta > 0 ? "+" : ""}${row.delta}</td>
      `;
      el.historyBody.appendChild(tr);
    });
}

// ======================= 模式 / 账户 =========================

function onModeChange() {
  const newMode = el.modeSelect.value;
  if (!MODE_CONFIG[newMode]) return;

  if (state.roundActive) {
    const ok = confirm(
      "当前局尚未结束，切换模式会重置筹码并清空历史记录，确定切换？"
    );
    if (!ok) {
      el.modeSelect.value = state.mode;
      return;
    }
  }

  state.mode = newMode;
  state.chips = MODE_CONFIG[newMode].initialChips;
  state.history = [];
  state.roundId = 0;
  state.roundActive = false;
  state.roundStartPrice = null;
  state.roundEndPrice = null;
  clearCountdown();

  el.roundStatusNote.textContent = "模式已切换，新的对局从当前模式开始。";

  updateChipsUI();
  updateRoundUI();
  renderHistory();
  saveAccountIfAny();
}

function resetAccount() {
  const ok = confirm(
    "确定要重置账户吗？将根据当前模式重新发放起始筹码，并清空历史记录。"
  );
  if (!ok) return;

  state.chips = MODE_CONFIG[state.mode].initialChips;
  state.history = [];
  state.roundId = 0;
  state.roundActive = false;
  state.roundStartPrice = null;
  state.roundEndPrice = null;
  clearCountdown();

  el.roundStatusNote.textContent = "账户已重置，可以重新开始游戏。";

  updateChipsUI();
  updateRoundUI();
  renderHistory();
  saveAccountIfAny();
}

// 自动保存当前账号
function saveAccountIfAny() {
  const accountId = localStorage.getItem(STORAGE_KEYS.CURRENT_ACCOUNT_ID);
  if (!accountId) return;

  const key = STORAGE_KEYS.ACCOUNT_PREFIX + accountId;
  const payload = {
    id: accountId,
    mode: state.mode,
    chips: state.chips,
    roundId: state.roundId,
    history: state.history,
  };
  localStorage.setItem(key, JSON.stringify(payload));
}

// 导出账号 - 生成 / 复用 accountId，并持久化
function exportAccount() {
  let accountId = localStorage.getItem(STORAGE_KEYS.CURRENT_ACCOUNT_ID);
  if (!accountId) {
    accountId = generateAccountId();
    localStorage.setItem(STORAGE_KEYS.CURRENT_ACCOUNT_ID, accountId);
  }

  const key = STORAGE_KEYS.ACCOUNT_PREFIX + accountId;
  const payload = {
    id: accountId,
    mode: state.mode,
    chips: state.chips,
    roundId: state.roundId,
    history: state.history,
  };
  localStorage.setItem(key, JSON.stringify(payload));

  el.exportCodeDisplay.textContent = accountId;
  alert("账号已导出并保存到本机浏览器，请妥善保管这串账号代码。");
}

// 导入账号
function importAccount() {
  const code = (el.importCodeInput.value || "").trim();

  if (!code || code.length !== 42 || !code.startsWith("0x")) {
    alert("请输入合法的 42 字符账号代码（以 0x 开头）。");
    return;
  }

  const key = STORAGE_KEYS.ACCOUNT_PREFIX + code;
  const raw = localStorage.getItem(key);
  if (!raw) {
    alert("在本机浏览器中找不到这个账号对应的数据。");
    return;
  }

  try {
    const data = JSON.parse(raw);
    restoreFromAccountData(data);

    // 记为当前账号
    localStorage.setItem(STORAGE_KEYS.CURRENT_ACCOUNT_ID, code);
    el.exportCodeDisplay.textContent = code;

    el.roundStatusNote.textContent = "账号已导入，可以继续游戏。";
  } catch (e) {
    console.error(e);
    alert("导入失败：存储数据已损坏。");
  }
}

function restoreFromAccountData(data) {
  state.mode = data.mode || "easy";
  if (!MODE_CONFIG[state.mode]) state.mode = "easy";
  state.chips = Number.isFinite(+data.chips)
    ? Math.max(0, Math.floor(data.chips))
    : MODE_CONFIG[state.mode].initialChips;
  state.roundId = Number.isFinite(+data.roundId) ? data.roundId : 0;
  state.history = Array.isArray(data.history) ? data.history : [];

  state.roundActive = false;
  state.roundDirection = null;
  state.roundStake = 10;
  state.roundStartPrice = null;
  state.roundEndPrice = null;
  clearCountdown();

  el.modeSelect.value = state.mode;
  updateChipsUI();
  updateRoundUI();
  renderHistory();
}

// ======================= 高级面板 =========================

function toggleAdvancedPanel() {
  const hidden = el.advancedPanel.classList.contains("hidden");
  if (hidden) {
    el.advancedPanel.classList.remove("hidden");
    el.toggleAdvancedBtn.textContent = "隐藏高级功能";
  } else {
    el.advancedPanel.classList.add("hidden");
    el.toggleAdvancedBtn.textContent = "显示高级功能";
  }
}

// ======================= 猜涨跌核心逻辑 =========================

function onStakeChange() {
  const maxStake = Math.max(1, Math.floor(state.chips));
  let v = parseInt(el.stakeInput.value, 10);
  if (!Number.isFinite(v) || v < 1) v = 1;
  if (v > maxStake) v = maxStake;
  state.roundStake = v;
  el.stakeInput.value = String(v);
  updateStakeUI();
}

function clearCountdown() {
  if (state.countdownTimer) {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  }
}

// direction: "up" | "down"
async function startRound(direction) {
  if (state.roundActive) {
    alert("本局还在倒计时中，请等待结束后再下注。");
    return;
  }
  if (state.chips <= 0) {
    alert("筹码已经用完，请重置账户或者导入其他账号。");
    return;
  }

  const stake = state.roundStake;
  if (stake <= 0 || stake > state.chips) {
    alert("下注筹码必须大于 0 且不超过当前筹码。");
    return;
  }

  // 开局前先尝试拉一次价格；失败就用模拟价格
  const price = await fetchRealPrice(false);
  if (price == null) {
    // 仍为模拟模式，顺手做一次随机波动
    applySimulatedMove();
  }

  state.roundActive = true;
  state.roundDirection = direction;
  state.roundStartPrice = state.currentPrice;
  state.roundEndPrice = null;
  state.countdownSec = 60;
  state.roundId += 1;

  el.roundStatusNote.textContent =
    "本局已开始，倒计时结束后会根据结束价格结算。";

  updateRoundUI();
  updateChipsUI();

  el.countdownLabel.textContent = state.countdownSec + " 秒";

  clearCountdown();
  state.countdownTimer = setInterval(async () => {
    state.countdownSec -= 1;
    if (state.countdownSec <= 0) {
      clearCountdown();
      await finishRound();
    } else {
      el.countdownLabel.textContent = state.countdownSec + " 秒";
    }
  }, 1000);
}

async function finishRound() {
  // 结束时再尝试获取一次价格；失败则模拟波动
  const price = await fetchRealPrice(false);
  if (price == null) {
    applySimulatedMove();
  }

  state.roundEndPrice = state.currentPrice;
  state.roundActive = false;

  const dir = state.roundDirection;
  const stake = state.roundStake;
  const startP = state.roundStartPrice;
  const endP = state.roundEndPrice;

  let result = "lose";
  let delta = -stake;

  if (startP != null && endP != null) {
    if (dir === "up" && endP > startP) {
      result = "win";
      delta = Math.round(stake * 0.5);
    } else if (dir === "down" && endP < startP) {
      result = "win";
      delta = Math.round(stake * 0.5);
    }
  }

  state.chips += delta;
  if (state.chips < 0) state.chips = 0;

  const now = new Date();
  const dirLabel = dir === "up" ? "涨" : "跌";

  state.history.push({
    no: state.history.length + 1,
    time: formatTime(now),
    direction: dir,
    startPrice: startP,
    endPrice: endP,
    bet: stake,
    result,
    delta,
  });

  updateChipsUI();
  updateRoundUI();
  renderHistory();
  saveAccountIfAny();

  el.countdownLabel.textContent = "已结算";

  const resultText = result === "win" ? "赢" : "输";
  const deltaText = (delta > 0 ? "+" : "") + delta;

  el.roundStatusNote.textContent = `本局方向：${dirLabel}，结果：${resultText}（盈亏：${deltaText} 筹码）。`;

  if (state.chips <= 0) {
    el.roundStatusNote.textContent +=
      " 筹码已经用完，可以导出记录留念，或重置账户重新开始。";
  }
}
