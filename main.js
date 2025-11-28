// ===== 全局状态 =====
const MODE_CONFIG = {
  easy: 100,
  normal: 60,
  hard: 30,
};

let mode = "easy";
let chips = MODE_CONFIG[mode];
let currentPrice = null;
let usingMockPrice = false;

let countdownTimer = null;
let countdownRemaining = 0;
let roundRunning = false;
let roundStartPrice = null;

let history = []; // {no,time,direction,startPrice,endPrice,bet,result,delta}

document.addEventListener("DOMContentLoaded", init);

// ===== 初始化 =====
function init() {
  const els = getElements();

  const bind = (el, event, handler) => {
    if (!el) {
      console.warn("missing element for event", event);
      return;
    }
    el.addEventListener(event, handler);
  };

  bind(els.modeSelect, "change", () => {
    const newMode = els.modeSelect.value || "easy";
    if (roundRunning) {
      alert("本局还没结束，暂时不能切换模式。");
      els.modeSelect.value = mode;
      return;
    }
    const ok = confirm("切换模式会重置筹码和历史记录，确定吗？");
    if (!ok) {
      els.modeSelect.value = mode;
      return;
    }
    mode = newMode;
    resetAccount(true);
  });

  bind(els.symbolSelect, "change", () => {
    fetchPrice(true);
  });

  bind(els.btnUp, "click", () => startRound("up"));
  bind(els.btnDown, "click", () => startRound("down"));

  bind(els.resetAccountBtn, "click", () => resetAccount());

  bind(els.retryPriceBtn, "click", () => fetchPrice(true));

  bind(els.toggleAdvancedBtn, "click", () => toggleAdvanced());

  bind(els.exportBtn, "click", () => exportAccount());
  bind(els.importBtn, "click", () => importAccount());

  loadStateFromLocal();

  els.modeSelect.value = mode;
  updateChipsUI();
  renderHistory();

  fetchPrice(true);
}

// ===== DOM 获取 =====
function getElements() {
  return {
    modeSelect: document.getElementById("modeSelect"),
    chipsDisplay: document.getElementById("chipsDisplay"),
    symbolSelect: document.getElementById("symbolSelect"),
    priceStatusLabel: document.getElementById("priceStatusLabel"),
    priceBox: document.getElementById("priceBox"),
    priceHint: document.getElementById("priceHint"),

    countdownText: document.getElementById("countdownText"),
    startPrice: document.getElementById("startPrice"),
    endPrice: document.getElementById("endPrice"),
    betInput: document.getElementById("betInput"),

    btnUp: document.getElementById("btnUp"),
    btnDown: document.getElementById("btnDown"),
    resetAccountBtn: document.getElementById("resetAccountBtn"),
    retryPriceBtn: document.getElementById("retryPriceBtn"),

    historyTableBody: document
      .getElementById("historyTable")
      ?.querySelector("tbody"),

    toggleAdvancedBtn: document.getElementById("toggleAdvancedBtn"),
    advancedSection: document.getElementById("advancedSection"),
    exportBtn: document.getElementById("exportBtn"),
    importBtn: document.getElementById("importBtn"),
    accountCodeBox: document.getElementById("accountCodeBox"),
    accountCode: document.getElementById("accountCode"),
    accountCodeInput: document.getElementById("accountCodeInput"),
  };
}

// ===== 价格相关 =====
async function fetchPrice(forceReal = false) {
  const els = getElements();
  const symbol = els.symbolSelect?.value || "BTC-USDT";

  if (els.priceStatusLabel) {
    els.priceStatusLabel.textContent = "当前价格加载中...";
  }

  const url =
    "https://www.okx.com/api/v5/market/index-tickers?instId=" +
    encodeURIComponent(symbol);

  try {
    const res = await fetch(url);
    const json = await res.json();

    if (!json || !json.data || !json.data[0]) {
      throw new Error("empty data");
    }

    const row = json.data[0];
    const px = row.idxPx || row.last || row.close;
    if (!px) throw new Error("no price field");

    currentPrice = parseFloat(px);
    usingMockPrice = false;
  } catch (e) {
    console.warn("实盘价格获取失败，使用本地模拟价格", e);
    if (!currentPrice || forceReal) {
      currentPrice = generateMockPrice(symbol);
    }
    usingMockPrice = true;
  }

  updatePriceUI();
}

function generateMockPrice(symbol) {
  if (symbol.startsWith("BTC")) {
    return 90000 + Math.random() * 2000;
  }
  if (symbol.startsWith("ETH")) {
    return 3000 + Math.random() * 100;
  }
  return 100 + Math.random() * 10;
}

function updatePriceUI() {
  const els = getElements();
  if (!els.priceBox || !els.priceStatusLabel || !els.priceHint) return;

  if (!currentPrice) {
    els.priceBox.textContent = "--";
    els.priceStatusLabel.textContent = "当前价格：--";
    return;
  }

  els.priceBox.textContent = formatPrice(currentPrice);

  if (usingMockPrice) {
    els.priceStatusLabel.textContent = "当前价格（本地模拟）";
    els.priceHint.textContent =
      "当前无法连接 OKX 指数价格，本局将使用本地模拟价格，仅供娱乐。";
  } else {
    els.priceStatusLabel.textContent = "当前价格（OKX 指数）";
    els.priceHint.textContent =
      "优先使用 OKX 实盘指数价格；若无法连接，将使用本地模拟价格，仅供娱乐。";
  }
}

function formatPrice(v) {
  return Number(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ===== 游戏逻辑 =====
function startRound(direction) {
  const els = getElements();
  if (roundRunning) {
    alert("本局还没结束哦～");
    return;
  }

  if (!currentPrice) {
    alert("当前价格还没有加载成功，请稍后再试或点重试按钮。");
    return;
  }

  let bet = parseInt(els.betInput?.value || "0", 10);
  if (!bet || bet <= 0) {
    alert("请输入有效的下注筹码数量。");
    return;
  }

  if (bet > chips) {
    alert("筹码不足，先重置账户或减少下注金额。");
    return;
  }

  roundRunning = true;
  roundStartPrice = currentPrice;
  chips -= bet;
  updateChipsUI();

  if (els.startPrice) els.startPrice.textContent = formatPrice(roundStartPrice);
  if (els.endPrice) els.endPrice.textContent = "--";

  countdownRemaining = 60;
  if (els.countdownText) els.countdownText.textContent = "60 秒";

  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(async () => {
    countdownRemaining--;
    if (!els.countdownText) return;

    if (countdownRemaining <= 0) {
      clearInterval(countdownTimer);
      els.countdownText.textContent = "已结束";
      await endRound(direction, bet);
    } else {
      els.countdownText.textContent = countdownRemaining + " 秒";
    }
  }, 1000);
}

async function endRound(direction, bet) {
  await fetchPrice(false);

  const els = getElements();
  const endPrice = currentPrice || roundStartPrice;
  if (els.endPrice) els.endPrice.textContent = formatPrice(endPrice);

  const isWin =
    direction === "up"
      ? endPrice > roundStartPrice
      : endPrice < roundStartPrice;

  let delta = isWin ? bet : -bet;
  if (isWin) {
    chips += bet * 2;
  }
  updateChipsUI();

  addHistoryRecord(direction, roundStartPrice, endPrice, bet, isWin, delta);
  saveStateToLocal();
  roundRunning = false;
  roundStartPrice = null;
}

// ===== 账户 / 模式 =====
function resetAccount(fromModeChange = false) {
  const els = getElements();
  if (!fromModeChange) {
    const ok = confirm("确定要重置账户吗？筹码和历史记录都会清空。");
    if (!ok) return;
  }

  chips = MODE_CONFIG[mode] || 100;
  history = [];
  roundRunning = false;
  roundStartPrice = null;
  countdownRemaining = 0;

  if (els.countdownText) els.countdownText.textContent = "未开始";
  if (els.startPrice) els.startPrice.textContent = "--";
  if (els.endPrice) els.endPrice.textContent = "--";

  updateChipsUI();
  renderHistory();
  saveStateToLocal();
}

function updateChipsUI() {
  const els = getElements();
  if (els.chipsDisplay) {
    els.chipsDisplay.textContent = chips.toString();
  }
}

// ===== 历史记录 =====
function addHistoryRecord(direction, startPrice, endPrice, bet, isWin, delta) {
  const now = new Date();
  const timeStr = now.toISOString().replace("T", " ").slice(0, 19);

  const rec = {
    no: history.length + 1,
    time: timeStr,
    direction: direction === "up" ? "涨" : "跌",
    startPrice,
    endPrice,
    bet,
    result: isWin ? "赢" : "输",
    delta,
  };

  history.unshift(rec);
  renderHistory();
}

function renderHistory() {
  const els = getElements();
  if (!els.historyTableBody) return;

  els.historyTableBody.innerHTML = "";
  history.forEach((rec) => {
    const tr = document.createElement("tr");

    const tdNo = document.createElement("td");
    tdNo.textContent = rec.no;

    const tdTime = document.createElement("td");
    tdTime.textContent = rec.time;

    const tdDir = document.createElement("td");
    tdDir.textContent = rec.direction;

    const tdStart = document.createElement("td");
    tdStart.textContent = formatPrice(rec.startPrice);

    const tdEnd = document.createElement("td");
    tdEnd.textContent = formatPrice(rec.endPrice);

    const tdBet = document.createElement("td");
    tdBet.textContent = rec.bet.toString();

    const tdResult = document.createElement("td");
    tdResult.textContent = rec.result;
    tdResult.className = rec.result === "赢" ? "win" : "lose";

    const tdDelta = document.createElement("td");
    tdDelta.textContent = (rec.delta > 0 ? "+" : "") + rec.delta;
    tdDelta.className = rec.delta > 0 ? "win" : "lose";

    tr.appendChild(tdNo);
    tr.appendChild(tdTime);
    tr.appendChild(tdDir);
    tr.appendChild(tdStart);
    tr.appendChild(tdEnd);
    tr.appendChild(tdBet);
    tr.appendChild(tdResult);
    tr.appendChild(tdDelta);

    els.historyTableBody.appendChild(tr);
  });
}

// ===== 本地存储 =====
function saveStateToLocal() {
  try {
    const els = getElements();
    const state = {
      mode,
      chips,
      history,
      symbol: els.symbolSelect?.value || "BTC-USDT",
    };
    localStorage.setItem("rocketPredictStateV1", JSON.stringify(state));
  } catch (e) {
    console.warn("saveState error", e);
  }
}

function loadStateFromLocal() {
  try {
    const raw = localStorage.getItem("rocketPredictStateV1");
    if (!raw) return;
    const data = JSON.parse(raw);

    mode = data.mode || "easy";
    chips = typeof data.chips === "number" ? data.chips : MODE_CONFIG[mode];
    history = Array.isArray(data.history) ? data.history : [];

    const els = getElements();
    if (els.modeSelect) els.modeSelect.value = mode;
    if (els.symbolSelect && data.symbol) els.symbolSelect.value = data.symbol;
  } catch (e) {
    console.warn("loadState error", e);
  }
}

// ===== 高级功能：导出 / 导入 =====
function toggleAdvanced() {
  const els = getElements();
  if (!els.advancedSection || !els.toggleAdvancedBtn) return;

  const isHidden = els.advancedSection.classList.contains("hidden");
  if (isHidden) {
    els.advancedSection.classList.remove("hidden");
    els.toggleAdvancedBtn.textContent = "隐藏高级功能";
  } else {
    els.advancedSection.classList.add("hidden");
    els.toggleAdvancedBtn.textContent = "显示高级功能";
  }
}

function exportAccount() {
  const els = getElements();
  try {
    const state = {
      mode,
      chips,
      history,
      symbol: els.symbolSelect?.value || "BTC-USDT",
    };
    const json = JSON.stringify(state);
    let code = btoa(json);
    code = code.replace(/=+$/, "");

    if (els.accountCode) {
      els.accountCode.value = code;
    }
    if (els.accountCodeBox) {
      els.accountCodeBox.classList.remove("hidden");
    }
    alert("账号代码已生成，可以复制保存。");
  } catch (e) {
    console.error("export error", e);
    alert("导出失败，请稍后重试。");
  }
}

function importAccount() {
  const els = getElements();
  if (!els.accountCodeInput) return;

  const raw = (els.accountCodeInput.value || "").trim();
  if (!raw) {
    alert("请先粘贴账号代码。");
    return;
  }

  try {
    let code = raw;
    while (code.length % 4 !== 0) code += "=";

    const json = atob(code);
    const data = JSON.parse(json);

    mode = data.mode || "easy";
    chips =
      typeof data.chips === "number" && data.chips >= 0
        ? data.chips
        : MODE_CONFIG[mode];
    history = Array.isArray(data.history) ? data.history : [];

    const els2 = getElements();
    if (els2.modeSelect) els2.modeSelect.value = mode;
    if (els2.symbolSelect && data.symbol) els2.symbolSelect.value = data.symbol;

    updateChipsUI();
    renderHistory();
    saveStateToLocal();

    alert("导入成功！");
  } catch (e) {
    console.error("import error", e);
    alert("账号代码无效，导入失败。");
  }
}
