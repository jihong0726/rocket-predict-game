// ========= 基础状态 =========
const STORAGE_KEY = "rocketPredictGameState_v2";

const MODE_CONFIG = {
  easy: { name: "简单", chips: 100 },
  normal: { name: "普通", chips: 60 },
  hard: { name: "困难", chips: 30 }
};

const DEFAULT_STATE = {
  mode: "easy",
  chips: MODE_CONFIG.easy.chips,
  round: 0,
  pair: "BTC-USDT",
  lastPrice: null,
  useSimulated: false,
  history: [] // {no,time,dir,start,end,bet,result,delta}
};

let state = { ...DEFAULT_STATE };

// ========= 工具函数 =========

function formatNumber(num) {
  if (num == null || Number.isNaN(num)) return "--";
  return Number(num).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatTime(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "--";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("Save state failed:", e);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state = { ...DEFAULT_STATE, ...parsed };
  } catch (e) {
    console.warn("Load state failed, use default:", e);
    state = { ...DEFAULT_STATE };
  }
}

// ========= DOM 缓存 =========
const dom = {};

function cacheDom() {
  dom.modeSelect = document.getElementById("modeSelect");
  dom.currentChips = document.getElementById("currentChips");

  dom.pairSelect = document.getElementById("pairSelect");
  dom.currentPrice = document.getElementById("currentPrice");
  dom.lastUpdated = document.getElementById("lastUpdated");
  dom.priceSourceTag = document.getElementById("priceSourceTag");
  dom.retryPriceBtn = document.getElementById("retryPriceBtn");

  dom.roundCountdown = document.getElementById("roundCountdown");
  dom.roundStartPrice = document.getElementById("roundStartPrice");
  dom.roundEndPrice = document.getElementById("roundEndPrice");

  dom.betInput = document.getElementById("betInput");
  dom.btnUp = document.getElementById("btnUp");
  dom.btnDown = document.getElementById("btnDown");
  dom.resetAccountBtn = document.getElementById("resetAccountBtn");

  dom.historyBody = document.getElementById("historyBody");
  dom.advancedToggleBtn = document.getElementById("advancedToggleBtn");
  dom.advancedPanel = document.getElementById("advancedPanel");

  dom.exportAccountBtn = document.getElementById("exportAccountBtn");
  dom.exportCodeInput = document.getElementById("exportCodeInput");
  dom.importCodeInput = document.getElementById("importCodeInput");
  dom.importAccountBtn = document.getElementById("importAccountBtn");
}

// ========= 行情获取 =========

async function fetchOkxPrice() {
  const instId = state.pair; // 如 BTC-USDT
  const url = `https://www.okx.com/api/v5/market/index-tickers?instId=${encodeURIComponent(
    instId
  )}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("network error");
    const data = await res.json();
    const ticker = data?.data?.[0];
    const px = ticker ? Number(ticker.idxPx || ticker.last || ticker.close) : NaN;
    if (!px || Number.isNaN(px)) throw new Error("price empty");

    state.lastPrice = px;
    state.useSimulated = false;
    const now = new Date();
    dom.currentPrice.textContent = formatNumber(px);
    dom.priceSourceTag.style.display = "none";
    dom.lastUpdated.textContent = `最近更新：${formatTime(now.toISOString())}`;
    saveState();
  } catch (e) {
    console.warn("Fetch OKX price failed, use simulated:", e);
    // 模拟价格：如果有上一次价格，在此基础上随机波动；否则给个默认值
    let px = state.lastPrice;
    if (!px) {
      px = instId.startsWith("BTC") ? 90000 : 3000;
    }
    const change = 1 + (Math.random() - 0.5) * 0.004; // ±0.2%
    px = px * change;
    state.lastPrice = px;
    state.useSimulated = true;

    const now = new Date();
    dom.currentPrice.textContent = formatNumber(px);
    dom.priceSourceTag.style.display = "";
    dom.lastUpdated.textContent = `最近更新：${formatTime(now.toISOString())}（模拟）`;
    saveState();
  }
}

// ========= UI 更新 =========

function updateModeUI() {
  if (dom.modeSelect) {
    dom.modeSelect.value = state.mode;
  }
}

function updateChipsUI() {
  if (!dom.currentChips) return;
  dom.currentChips.textContent = `${state.chips} 筹码`;
}

function updateRoundInfoUI(start, end) {
  if (dom.roundCountdown) {
    dom.roundCountdown.textContent = "已结束";
  }
  if (dom.roundStartPrice) {
    dom.roundStartPrice.textContent = formatNumber(start);
  }
  if (dom.roundEndPrice) {
    dom.roundEndPrice.textContent = formatNumber(end);
  }
}

function renderHistory() {
  if (!dom.historyBody) return;
  dom.historyBody.innerHTML = "";

  state.history.forEach((item) => {
    const tr = document.createElement("tr");

    const tdNo = document.createElement("td");
    tdNo.textContent = item.no;
    tr.appendChild(tdNo);

    const tdTime = document.createElement("td");
    tdTime.textContent = formatTime(item.time);
    tr.appendChild(tdTime);

    const tdDir = document.createElement("td");
    tdDir.textContent = item.dir;
    tr.appendChild(tdDir);

    const tdStart = document.createElement("td");
    tdStart.textContent = formatNumber(item.start);
    tr.appendChild(tdStart);

    const tdEnd = document.createElement("td");
    tdEnd.textContent = formatNumber(item.end);
    tr.appendChild(tdEnd);

    const tdBet = document.createElement("td");
    tdBet.textContent = item.bet;
    tr.appendChild(tdBet);

    const tdResult = document.createElement("td");
    tdResult.textContent = item.result;
    tdResult.style.color = item.result === "赢" ? "#4ade80" : "#f97373";
    tr.appendChild(tdResult);

    const tdDelta = document.createElement("td");
    tdDelta.textContent = item.delta > 0 ? `+${item.delta}` : `${item.delta}`;
    tdDelta.className =
      item.delta > 0 ? "profit-positive" : item.delta < 0 ? "profit-negative" : "";
    tr.appendChild(tdDelta);

    dom.historyBody.appendChild(tr);
  });
}

// ========= 游戏逻辑 =========

function getInitialChipsByMode(mode) {
  return MODE_CONFIG[mode]?.chips ?? MODE_CONFIG.easy.chips;
}

function resetAccount(keepMode = true) {
  const mode = keepMode ? state.mode : "easy";
  state = {
    ...DEFAULT_STATE,
    mode,
    chips: getInitialChipsByMode(mode),
    pair: state.pair
  };
  saveState();
  updateModeUI();
  updateChipsUI();
  renderHistory();
  updateRoundInfoUI(null, null);
  if (dom.roundCountdown) dom.roundCountdown.textContent = "未开始";
}

function placeBet(direction) {
  if (!state.lastPrice) {
    alert("当前价格尚未加载成功，请先点击“如果价格异常，可重新尝试连接”。");
    return;
  }

  const raw = dom.betInput ? dom.betInput.value : "0";
  let bet = parseInt(raw, 10);
  if (!Number.isFinite(bet) || bet <= 0) {
    alert("请输入大于 0 的筹码数量。");
    return;
  }

  if (bet > state.chips) {
    alert("筹码不足，请调整下注数量或重置账户。");
    return;
  }

  const startPrice = state.lastPrice;
  // 随机生成结束价（±0.2%）
  const changeFactor = 1 + (Math.random() - 0.5) * 0.004;
  const endPrice = startPrice * changeFactor;

  const isUp = direction === "up";
  const win = isUp ? endPrice > startPrice : endPrice < startPrice;
  const delta = win ? bet : -bet;

  state.chips += delta;
  state.round += 1;

  const record = {
    no: state.round,
    time: new Date().toISOString(),
    dir: isUp ? "涨" : "跌",
    start: startPrice,
    end: endPrice,
    bet,
    result: win ? "赢" : "输",
    delta
  };

  // 最新的排在最上方
  state.history.unshift(record);
  // 只保留最近 30 局，避免导出代码太长
  state.history = state.history.slice(0, 30);

  saveState();
  updateChipsUI();
  updateRoundInfoUI(startPrice, endPrice);
  renderHistory();

  if (state.chips <= 0) {
    alert("本局已结算：筹码已用完，本账号游戏结束，可以重置账户重新开始。");
  }
}

// ========= 账号导出 / 导入 =========

// 紧凑编码：只导出必要字段，并用 base64-url 编码
function encodeAccountState() {
  const compact = {
    v: 2,
    m: state.mode,
    c: state.chips,
    r: state.round,
    p: state.pair,
    // 只导出最近 20 条历史记录，进一步压缩长度
    h: state.history.slice(0, 20).map((x) => [
      x.time,
      x.dir,
      Number(x.start.toFixed(2)),
      Number(x.end.toFixed(2)),
      x.bet,
      x.result,
      x.delta
    ])
  };
  const json = JSON.stringify(compact);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  const b64url = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  // 加个前缀方便识别
  return "RP2-" + b64url;
}

function decodeAccountState(code) {
  if (!code || typeof code !== "string") throw new Error("empty");
  if (!code.startsWith("RP2-")) throw new Error("prefix");
  const b64url = code.slice(4);
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const json = decodeURIComponent(escape(atob(b64)));
  const compact = JSON.parse(json);
  if (!compact || compact.v !== 2) throw new Error("version");

  const nextState = { ...DEFAULT_STATE };
  nextState.mode = compact.m || "easy";
  nextState.chips = Number.isFinite(compact.c)
    ? compact.c
    : getInitialChipsByMode(nextState.mode);
  nextState.round = compact.r || 0;
  nextState.pair = compact.p || "BTC-USDT";

  nextState.history =
    (compact.h || []).map((arr, idx) => ({
      no: nextState.round - idx > 0 ? nextState.round - idx : idx + 1,
      time: arr[0],
      dir: arr[1],
      start: arr[2],
      end: arr[3],
      bet: arr[4],
      result: arr[5],
      delta: arr[6]
    })) || [];

  return nextState;
}

// ========= 事件绑定 =========

function bindEvents() {
  if (dom.modeSelect) {
    dom.modeSelect.addEventListener("change", () => {
      const newMode = dom.modeSelect.value;
      if (!MODE_CONFIG[newMode]) return;
      if (
        confirm(
          `切换为「${MODE_CONFIG[newMode].name}」模式将重置筹码与历史记录，是否继续？`
        )
      ) {
        state.mode = newMode;
        resetAccount(true);
      } else {
        dom.modeSelect.value = state.mode;
      }
    });
  }

  if (dom.pairSelect) {
    dom.pairSelect.addEventListener("change", () => {
      state.pair = dom.pairSelect.value;
      saveState();
      fetchOkxPrice();
    });
  }

  if (dom.retryPriceBtn) {
    dom.retryPriceBtn.addEventListener("click", () => {
      fetchOkxPrice();
    });
  }

  if (dom.btnUp) {
    dom.btnUp.addEventListener("click", () => placeBet("up"));
  }
  if (dom.btnDown) {
    dom.btnDown.addEventListener("click", () => placeBet("down"));
  }

  if (dom.resetAccountBtn) {
    dom.resetAccountBtn.addEventListener("click", () => {
      if (confirm("确定要重置账户吗？当前筹码和历史记录都会清空。")) {
        resetAccount(true);
      }
    });
  }

  if (dom.advancedToggleBtn && dom.advancedPanel) {
    dom.advancedToggleBtn.addEventListener("click", () => {
      const visible = dom.advancedPanel.style.display !== "none";
      dom.advancedPanel.style.display = visible ? "none" : "block";
      dom.advancedToggleBtn.textContent = visible ? "显示高级功能" : "收起高级功能";
    });
  }

  if (dom.exportAccountBtn && dom.exportCodeInput) {
    dom.exportAccountBtn.addEventListener("click", () => {
      try {
        const code = encodeAccountState();
        dom.exportCodeInput.value = code;
        dom.exportCodeInput.focus();
        dom.exportCodeInput.select();
        // 尝试自动复制（失败也没关系）
        document.execCommand("copy");
        alert("账号导出成功，可以复制这串代码保存。");
      } catch (e) {
        console.error("Export account failed:", e);
        alert("导出失败，请稍后重试。");
      }
    });
  }

  if (dom.importAccountBtn && dom.importCodeInput) {
    dom.importAccountBtn.addEventListener("click", () => {
      const code = dom.importCodeInput.value.trim();
      if (!code) {
        alert("请先粘贴要导入的账号代码。");
        return;
      }
      try {
        const next = decodeAccountState(code);
        state = { ...state, ...next };
        saveState();
        updateModeUI();
        updateChipsUI();
        renderHistory();
        updateRoundInfoUI(null, null);
        if (dom.pairSelect) dom.pairSelect.value = state.pair;
        alert("账号导入成功，已恢复筹码和最近历史记录。");
      } catch (e) {
        console.error("Import account failed:", e);
        alert("导入失败：代码格式不正确或已损坏。");
      }
    });
  }
}

// ========= 初始化 =========

function init() {
  cacheDom();
  loadState();
  updateModeUI();
  updateChipsUI();
  renderHistory();
  updateRoundInfoUI(null, null);
  if (dom.pairSelect) dom.pairSelect.value = state.pair || "BTC-USDT";
  if (dom.roundCountdown) dom.roundCountdown.textContent = "未开始";
  bindEvents();
  fetchOkxPrice();
}

document.addEventListener("DOMContentLoaded", init);
