// 简单前端逻辑版：
// - 模式选择影响起始筹码（100 / 60 / 30）
// - 价格使用本地“随机走动”模拟，每秒更新一次
// - 每 60 秒一局：开始时锁定起始价，60 秒后对比结束价
// - 猜对：赢 0.5 倍筹码；猜错：输掉下注筹码
// - 支持账户重置、导出 / 导入账号（使用 0x 开头 42 字符伪地址，对应 localStorage）

(function () {
  const MODE_CONFIG = {
    easy: 100,
    normal: 60,
    hard: 30,
  };

  const ONE_ROUND_SECONDS = 60; // 一局 60s，可根据需要改

  const els = {
    mode: document.getElementById("mode"),
    chips: document.getElementById("chips"),
    symbol: document.getElementById("symbol"),

    price: document.getElementById("price"),
    lastUpdate: document.getElementById("last-update"),
    btnConnect: document.getElementById("btn-connect"),

    countdown: document.getElementById("countdown"),
    roundStartPrice: document.getElementById("round-start-price"),
    roundEndPrice: document.getElementById("round-end-price"),

    betAmount: document.getElementById("bet-amount"),
    btnLong: document.getElementById("btn-long"),
    btnShort: document.getElementById("btn-short"),
    btnResetAccount: document.getElementById("btn-reset-account"),

    roundResult: document.getElementById("round-result"),

    btnExport: document.getElementById("btn-export"),
    btnShowCode: document.getElementById("btn-show-code"),
    exportCodeDisplay: document.getElementById("export-code-display"),
    importCodeInput: document.getElementById("import-code"),
    btnImport: document.getElementById("btn-import"),

    historyBody: document.getElementById("history-body"),
  };

  // 当前状态
  const state = {
    mode: "easy",
    startingChips: MODE_CONFIG.easy,
    chips: MODE_CONFIG.easy,
    symbol: "BTC-USDT-SWAP",

    // 价格相关
    price: null,
    lastUpdate: null,
    priceTimer: null,

    // 轮次相关
    roundTimer: null,
    roundRemaining: ONE_ROUND_SECONDS,
    roundActive: false,
    roundStartPrice: null,
    roundEndPrice: null,
    betDirection: null, // "long" / "short"
    betAmount: 10,

    history: [],
    accountCode: null, // 0x 开头伪地址（42 字符）
  };

  /* ---------- 工具函数 ---------- */

  function fmtPrice(v) {
    if (v == null) return "--";
    return v.toFixed(2);
  }

  function fmtTime(ts) {
    if (!ts) return "--";
    const d = new Date(ts);
    const pad = (n) => (n < 10 ? "0" + n : "" + n);
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

  function randomAddressLike() {
    // 0x + 40 位十六进制
    const chars = "0123456789abcdef";
    let s = "0x";
    for (let i = 0; i < 40; i++) {
      s += chars[Math.floor(Math.random() * chars.length)];
    }
    return s;
  }

  function saveAccountToLocalStorage(code) {
    if (!code) return;
    const key = "rocket_game_account_" + code;
    const data = {
      mode: state.mode,
      startingChips: state.startingChips,
      chips: state.chips,
      history: state.history,
      // 注意：这里不保存当前轮的状态，导入后从新一轮开始
    };
    localStorage.setItem(key, JSON.stringify(data));
  }

  function loadAccountFromLocalStorage(code) {
    const key = "rocket_game_account_" + code;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error("parse account failed", e);
      return null;
    }
  }

  /* ---------- UI 刷新 ---------- */

  function renderChips() {
    els.chips.textContent = state.chips;
  }

  function renderPrice() {
    els.price.textContent = fmtPrice(state.price);
    els.lastUpdate.textContent = fmtTime(state.lastUpdate);
  }

  function renderRoundInfo() {
    if (!state.roundActive) {
      els.countdown.textContent = "未开始";
      els.roundStartPrice.textContent = "--";
      els.roundEndPrice.textContent = "--";
    } else {
      els.countdown.textContent = state.roundRemaining + " 秒";
      els.roundStartPrice.textContent = fmtPrice(state.roundStartPrice);
      els.roundEndPrice.textContent =
        state.roundEndPrice == null ? "--" : fmtPrice(state.roundEndPrice);
    }
  }

  function renderHistory() {
    els.historyBody.innerHTML = "";
    state.history.forEach((row, idx) => {
      const tr = document.createElement("tr");

      const tdIndex = document.createElement("td");
      tdIndex.textContent = idx + 1;
      tr.appendChild(tdIndex);

      const tdTime = document.createElement("td");
      tdTime.textContent = row.time;
      tr.appendChild(tdTime);

      const tdDir = document.createElement("td");
      const spanDir = document.createElement("span");
      spanDir.className = "tag " + (row.direction === "long" ? "long" : "short");
      spanDir.textContent = row.direction === "long" ? "涨" : "跌";
      tdDir.appendChild(spanDir);
      tr.appendChild(tdDir);

      const tdStart = document.createElement("td");
      tdStart.textContent = fmtPrice(row.startPrice);
      tr.appendChild(tdStart);

      const tdEnd = document.createElement("td");
      tdEnd.textContent = fmtPrice(row.endPrice);
      tr.appendChild(tdEnd);

      const tdBet = document.createElement("td");
      tdBet.textContent = row.bet;
      tr.appendChild(tdBet);

      const tdRes = document.createElement("td");
      const spanRes = document.createElement("span");
      spanRes.className = "tag " + (row.win ? "win" : "lose");
      spanRes.textContent = row.win ? "赢" : "输";
      tdRes.appendChild(spanRes);
      tr.appendChild(tdRes);

      const tdPnL = document.createElement("td");
      tdPnL.textContent = (row.pnL > 0 ? "+" : "") + row.pnL;
      tr.appendChild(tdPnL);

      els.historyBody.appendChild(tr);
    });
  }

  function setRoundResult(text) {
    els.roundResult.textContent = text;
  }

  function refreshAll() {
    renderChips();
    renderPrice();
    renderRoundInfo();
    renderHistory();
  }

  /* ---------- 价格模拟 ---------- */

  function startPriceFeed() {
    // 模拟初始价格
    if (state.price == null) {
      state.price = 30000 + Math.random() * 2000;
      state.lastUpdate = Date.now();
      renderPrice();
    }

    if (state.priceTimer) {
      clearInterval(state.priceTimer);
    }

    // 每秒随机波动一点
    state.priceTimer = setInterval(() => {
      const drift = (Math.random() - 0.5) * 50; // +- 25 左右
      state.price = Math.max(1, state.price + drift);
      state.lastUpdate = Date.now();
      renderPrice();
    }, 1000);

    els.btnConnect.textContent = "已连接（本地模拟）";
    els.btnConnect.disabled = true;
  }

  /* ---------- 回合 / 下注 ---------- */

  function canStartRound() {
    if (state.roundActive) return false;
    if (state.price == null) return false;
    const bet = parseInt(state.betAmount, 10) || 0;
    if (bet <= 0) return false;
    if (bet > state.chips) return false;
    if (!state.betDirection) return false;
    return true;
  }

  function startRound() {
    if (!canStartRound()) {
      alert("请先选择方向并确保筹码足够。");
      return;
    }

    // 锁定本局参数
    state.roundActive = true;
    state.roundRemaining = ONE_ROUND_SECONDS;
    state.roundStartPrice = state.price;
    state.roundEndPrice = null;

    setRoundResult("本局已开始，等待结束价…");
    renderRoundInfo();

    if (state.roundTimer) {
      clearInterval(state.roundTimer);
    }

    state.roundTimer = setInterval(() => {
      state.roundRemaining -= 1;

      if (state.roundRemaining <= 0) {
        clearInterval(state.roundTimer);
        state.roundTimer = null;
        finishRound();
      } else {
        renderRoundInfo();
      }
    }, 1000);
  }

  function finishRound() {
    if (!state.roundActive) return;

    state.roundActive = false;
    state.roundEndPrice = state.price;
    renderRoundInfo();

    const start = state.roundStartPrice;
    const end = state.roundEndPrice;
    const bet = parseInt(state.betAmount, 10) || 0;
    if (bet <= 0) return;

    const up = end > start;
    const guessedUp = state.betDirection === "long";
    const guessedDown = state.betDirection === "short";

    let win = false;
    if (end === start) {
      // 打平退还筹码
      setRoundResult("本局价格未变化，筹码退回。");
      win = null;
    } else if ((up && guessedUp) || (!up && guessedDown)) {
      // 猜对：赢 0.5 倍
      const profit = Math.round(bet * 0.5);
      state.chips += profit;
      setRoundResult(`恭喜猜对！本局盈利 +${profit} 筹码。`);
      win = true;
      // 记录历史
      state.history.unshift({
        time: fmtTime(Date.now()),
        direction: state.betDirection,
        startPrice: start,
        endPrice: end,
        bet,
        win: true,
        pnL: profit,
      });
    } else {
      // 猜错：输掉下注筹码
      state.chips -= bet;
      setRoundResult(`很可惜猜错了，本局亏损 -${bet} 筹码。`);
      win = false;
      state.history.unshift({
        time: fmtTime(Date.now()),
        direction: state.betDirection,
        startPrice: start,
        endPrice: end,
        bet,
        win: false,
        pnL: -bet,
      });
    }

    // 清理 / 刷新
    renderChips();
    renderHistory();

    // 筹码用完
    if (state.chips <= 0) {
      state.chips = 0;
      renderChips();
      alert("筹码已经用完，本轮游戏结束。可以点击“重置账户”重新开始。");
    }

    // 每次结束自动保存一次（如果已有账号代码）
    if (state.accountCode) {
      saveAccountToLocalStorage(state.accountCode);
    }
  }

  /* ---------- 事件绑定 ---------- */

  // 模式选择：更改起始筹码并重置账户
  els.mode.addEventListener("change", () => {
    const mode = els.mode.value;
    state.mode = mode;
    state.startingChips = MODE_CONFIG[mode] || 100;
    const ok = confirm(
      `切换到「${mode === "easy" ? "简单" : mode === "normal" ? "普通" : "困难"}」模式？\n\n这会重置你的账户筹码为 ${state.startingChips}，当前筹码与历史记录将清空。`
    );
    if (ok) {
      resetAccount(true);
    } else {
      // 恢复 select
      els.mode.value = state.mode;
    }
  });

  // 下注金额变化
  els.betAmount.addEventListener("input", () => {
    const v = parseInt(els.betAmount.value, 10);
    state.betAmount = isNaN(v) ? 0 : v;
  });

  // 猜涨/猜跌按钮
  function selectDirection(dir) {
    state.betDirection = dir;
    // UI 高亮
    if (dir === "long") {
      els.btnLong.classList.add("primary");
      els.btnShort.classList.remove("primary");
    } else {
      els.btnShort.classList.add("primary");
      els.btnLong.classList.remove("primary");
    }

    // 每次选择方向时，如果条件满足就立即开局
    if (!state.roundActive) {
      startRound();
    }
  }

  els.btnLong.addEventListener("click", () => selectDirection("long"));
  els.btnShort.addEventListener("click", () => selectDirection("short"));

  // 重置账户
  function resetAccount(keepAccountCode) {
    // 停止计时器
    if (state.roundTimer) {
      clearInterval(state.roundTimer);
      state.roundTimer = null;
    }

    state.chips = state.startingChips;
    state.betDirection = null;
    state.betAmount = 10;
    els.betAmount.value = "10";

    state.roundActive = false;
    state.roundRemaining = ONE_ROUND_SECONDS;
    state.roundStartPrice = null;
    state.roundEndPrice = null;

    els.btnLong.classList.remove("primary");
    els.btnShort.classList.remove("primary");
    setRoundResult("本局结果会显示在这里");
    state.history = [];

    if (!keepAccountCode) {
      state.accountCode = null;
      els.exportCodeDisplay.textContent = "";
    }

    refreshAll();
  }

  els.btnResetAccount.addEventListener("click", () => {
    const ok = confirm("确定要重置账户吗？筹码与历史记录都会清空。");
    if (!ok) return;
    resetAccount(false);
  });

  // 导出账号
  els.btnExport.addEventListener("click", () => {
    if (!state.accountCode) {
      state.accountCode = randomAddressLike();
    }
    saveAccountToLocalStorage(state.accountCode);
    alert("账号已导出并保存到本机浏览器。可以点击下方按钮查看账号代码。");
  });

  // 显示导出账号代码
  els.btnShowCode.addEventListener("click", () => {
    if (!state.accountCode) {
      alert("你还没有导出过账号，请先点击「导出账号」。");
      return;
    }
    els.exportCodeDisplay.textContent = state.accountCode;
  });

  // 导入账号
  els.btnImport.addEventListener("click", () => {
    const code = els.importCodeInput.value.trim();
    if (!code) {
      alert("请输入账号代码。");
      return;
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(code)) {
      alert("账号代码格式错误，需要是 0x 开头、40 位十六进制字符。");
      return;
    }

    const data = loadAccountFromLocalStorage(code);
    if (!data) {
      alert("未在本机浏览器找到这个账号代码的数据。");
      return;
    }

    state.mode = data.mode || "easy";
    state.startingChips = data.startingChips || MODE_CONFIG[state.mode] || 100;
    state.chips = data.chips || state.startingChips;
    state.history = Array.isArray(data.history) ? data.history : [];
    state.accountCode = code;

    els.mode.value = state.mode;
    setRoundResult("账号导入成功，已经恢复筹码和历史记录。");
    refreshAll();
  });

  /* ---------- 初始化 ---------- */

  function init() {
    state.mode = els.mode.value;
    state.startingChips = MODE_CONFIG[state.mode] || 100;
    state.chips = state.startingChips;
    state.betAmount = parseInt(els.betAmount.value, 10) || 10;

    refreshAll();
    startPriceFeed();
  }

  init();
})();
