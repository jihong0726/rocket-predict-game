// main.js
// 简化版逻辑：一局 60 秒，按当前价格方向结算
// 价格来源：优先 OKX 实盘 mark-price，失败则使用本地模拟价格

(function () {
  const STARTING_CHIPS = {
    easy: 100,
    normal: 300,
    hard: 1000,
  };

  const ROUND_SECONDS = 60;
  const MAX_HISTORY = 100;

  const state = {
    mode: "easy",
    chips: STARTING_CHIPS.easy,
    roundNo: 0,
    currentPrice: null,
    startPrice: null,
    endPrice: null,
    roundActive: false,
    guessDirection: null, // "up" | "down"
    countdown: ROUND_SECONDS,
    countdownTimer: null,

    // 价格相关
    symbol: "BTC-USDT-SWAP",
    useRealPrice: false,
    ws: null,
    simTimer: null,

    // 账户、历史
    history: [],
  };

  // DOM refs
  const elMode = document.getElementById("mode-select");
  const elChips = document.getElementById("chips-display");
  const elPrice = document.getElementById("price-value");
  const elPriceUpdated = document.getElementById("price-updated");
  const elPriceStatus = document.getElementById("price-status");
  const elPriceModeLabel = document.getElementById("price-mode-label");
  const elReconnect = document.getElementById("btn-reconnect");

  const elCountdown = document.getElementById("countdown");
  const elStartPrice = document.getElementById("round-start-price");
  const elEndPrice = document.getElementById("round-end-price");
  const elBetInput = document.getElementById("bet-input");
  const elTip = document.getElementById("round-tip");

  const btnUp = document.getElementById("btn-guess-up");
  const btnDown = document.getElementById("btn-guess-down");
  const btnReset = document.getElementById("btn-reset-account");

  const btnToggleAdv = document.getElementById("btn-toggle-advanced");
  const advPanel = document.getElementById("advanced-panel");
  const btnExport = document.getElementById("btn-export");
  const btnImport = document.getElementById("btn-import");
  const inputExport = document.getElementById("export-code");
  const inputImport = document.getElementById("import-code");
  const historyBody = document.getElementById("history-body");

  /* ---------- 工具函数 ---------- */

  function formatTime(d) {
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

  function formatPrice(p) {
    if (p == null) return "--";
    return Number(p).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function showToast(msg) {
    // 简单 alert，方便后续换成自定义 Toast
    alert(msg);
  }

  function updateChipsDisplay() {
    elChips.textContent = state.chips.toString();
  }

  function updatePriceUI() {
    elPrice.textContent = formatPrice(state.currentPrice);
    elPriceUpdated.textContent =
      state.currentPrice == null ? "--" : formatTime(new Date());
  }

  function setPriceMode(simulated, message) {
    state.useRealPrice = !simulated;
    if (simulated) {
      elPriceModeLabel.textContent = "模拟价格";
      elPriceModeLabel.classList.remove("badge-real");
      elPriceModeLabel.classList.add("badge-sim");
      elPriceStatus.textContent =
        message || "当前使用本地模拟价格，结果仅供娱乐。";
      elReconnect.disabled = false;
    } else {
      elPriceModeLabel.textContent = "实盘价格";
      elPriceModeLabel.classList.remove("badge-sim");
      elPriceModeLabel.classList.add("badge-real");
      elPriceStatus.textContent = "已连接 OKX 实盘 mark-price。";
      elReconnect.disabled = false;
    }
  }

  /* ---------- 价格：模拟 ---------- */

  let simPrice = 30000;

  function tickSimulatedPrice() {
    // 随机波动 -0.5% ~ +0.5%
    const changeRate = (Math.random() - 0.5) * 0.01;
    simPrice = Math.max(1000, simPrice * (1 + changeRate));
    state.currentPrice = simPrice;
    updatePriceUI();
  }

  function startSimulatedLoop() {
    clearInterval(state.simTimer);
    tickSimulatedPrice(); // 立即先刷一次
    state.simTimer = setInterval(tickSimulatedPrice, 5000);
    setPriceMode(true);
  }

  /* ---------- 价格：OKX 实盘 ---------- */

  function connectRealPrice() {
    try {
      if (state.ws) {
        try {
          state.ws.close();
        } catch (e) {}
      }
      elPriceStatus.textContent = "正在连接 OKX 实盘价格...";
      elReconnect.disabled = true;

      const ws = new WebSocket("wss://ws.okx.com:8443/ws/v5/public");
      state.ws = ws;
      let subscribed = false;
      let priceReceived = false;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            op: "subscribe",
            args: [
              {
                channel: "mark-price",
                instId: state.symbol,
              },
            ],
          })
        );
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        if (msg.event === "subscribe") {
          subscribed = true;
          setPriceMode(false);
        }

        if (msg.arg && msg.arg.channel === "mark-price" && msg.data) {
          const data = msg.data[0];
          const markPx = parseFloat(data.markPx);
          if (!isNaN(markPx)) {
            priceReceived = true;
            state.currentPrice = markPx;
            updatePriceUI();
          }
        }
      };

      ws.onerror = () => {
        fallbackToSim("连接出错，已切回模拟价格。");
      };

      ws.onclose = () => {
        if (state.useRealPrice) {
          fallbackToSim("实盘价格连接已断开，自动切回模拟价格。");
        }
      };

      // 5 秒内既没有订阅成功也没价格，就视为失败
      setTimeout(() => {
        if (!subscribed || !priceReceived) {
          try {
            ws.close();
          } catch (e) {}
          if (!state.useRealPrice) {
            fallbackToSim("暂时无法获取实盘价格，继续使用模拟价格。");
          }
        }
      }, 5000);
    } catch (e) {
      console.error(e);
      fallbackToSim("浏览器不支持 WebSocket，使用模拟价格。");
    }
  }

  function fallbackToSim(message) {
    startSimulatedLoop();
    if (message) {
      elPriceStatus.textContent = message;
    }
  }

  /* ---------- 对局逻辑 ---------- */

  function ensureNotInRound() {
    if (state.roundActive) {
      showToast("本局正在进行中，请等待本局结算。");
      return false;
    }
    return true;
  }

  function startRound(direction) {
    if (!ensureNotInRound()) return;

    const bet = parseInt(elBetInput.value, 10);
    if (!bet || bet <= 0) {
      showToast("请先输入本局要下注的筹码数量。");
      return;
    }
    if (bet > state.chips) {
      showToast("下注筹码不能超过当前筹码。");
      return;
    }
    if (state.currentPrice == null) {
      showToast("当前价格尚未获取，请稍后再试或切换到模拟价格。");
      return;
    }

    state.roundActive = true;
    state.guessDirection = direction;
    state.startPrice = state.currentPrice;
    state.endPrice = null;
    state.countdown = ROUND_SECONDS;
    state.roundNo += 1;

    elStartPrice.textContent = formatPrice(state.startPrice);
    elEndPrice.textContent = "--";
    elCountdown.textContent = `${state.countdown}s`;

    elTip.textContent = "本局已开始，请等待 60 秒后自动结算。";

    btnUp.disabled = true;
    btnDown.disabled = true;
    btnReset.disabled = true;
    elMode.disabled = true;

    if (state.countdownTimer) clearInterval(state.countdownTimer);
    state.countdownTimer = setInterval(() => {
      state.countdown -= 1;
      if (state.countdown <= 0) {
        clearInterval(state.countdownTimer);
        state.countdownTimer = null;
        finishRound();
      } else {
        elCountdown.textContent = `${state.countdown}s`;
      }
    }, 1000);
  }

  function finishRound() {
    state.roundActive = false;
    state.endPrice = state.currentPrice;
    const bet = parseInt(elBetInput.value, 10) || 0;

    elEndPrice.textContent = formatPrice(state.endPrice);
    elCountdown.textContent = "已结算";

    let diff = state.endPrice - state.startPrice;
    let isUp = diff > 0;
    let result = "draw";
    let delta = 0;

    if (diff === 0) {
      result = "draw";
      delta = 0;
    } else {
      const guessedUp = state.guessDirection === "up";
      const guessRight = (guessedUp && isUp) || (!guessedUp && !isUp);
      if (guessRight) {
        result = "win";
        delta = Math.round(bet * 0.5); // 赢 0.5 倍
        state.chips += delta;
      } else {
        result = "lose";
        delta = -bet;
        state.chips += delta;
      }
    }

    updateChipsDisplay();
    appendHistory({
      no: state.roundNo,
      time: new Date(),
      direction: state.guessDirection,
      startPrice: state.startPrice,
      endPrice: state.endPrice,
      bet,
      result,
      delta,
    });

    if (result === "win") {
      elTip.textContent = `本局结算：你赢了 ${delta} 筹码 🎉`;
    } else if (result === "lose") {
      elTip.textContent = `本局结算：你输了 ${-delta} 筹码 💸`;
    } else {
      elTip.textContent = "本局结算：价格没动，本局不赢不输。";
    }

    // 筹码用完就提示
    if (state.chips <= 0) {
      state.chips = 0;
      updateChipsDisplay();
      showToast("筹码已用完，本账户已破产，可以重置账户重新开始。");
    }

    btnUp.disabled = state.chips <= 0;
    btnDown.disabled = state.chips <= 0;
    btnReset.disabled = false;
    elMode.disabled = false;

    // 自动保存
    autoSave();
  }

  function appendHistory(entry) {
    state.history.unshift(entry);
    if (state.history.length > MAX_HISTORY) {
      state.history.pop();
    }
    renderHistory();
  }

  function renderHistory() {
    historyBody.innerHTML = "";
    state.history.forEach((h, idx) => {
      const tr = document.createElement("tr");

      const cells = [
        h.no,
        formatTime(h.time),
        h.direction === "up" ? "涨" : "跌",
        formatPrice(h.startPrice),
        formatPrice(h.endPrice),
        h.bet,
        h.result === "win"
          ? "赢"
          : h.result === "lose"
          ? "输"
          : "平",
        h.delta > 0
          ? `+${h.delta}`
          : h.delta < 0
          ? h.delta.toString()
          : "0",
      ];

      cells.forEach((v, i) => {
        const td = document.createElement("td");
        td.textContent = v;
        if (i === 6 || i === 7) {
          if (h.result === "win") td.classList.add("result-win");
          if (h.result === "lose") td.classList.add("result-lose");
        }
        tr.appendChild(td);
      });

      historyBody.appendChild(tr);
    });
  }

  function resetAccount(keepMode) {
    if (!keepMode) {
      // 使用当前选择的模式
      state.mode = elMode.value;
    }
    const start = STARTING_CHIPS[state.mode] || 100;
    state.chips = start;
    state.roundNo = 0;
    state.history = [];
    state.roundActive = false;
    state.guessDirection = null;
    state.countdown = ROUND_SECONDS;
    state.startPrice = null;
    state.endPrice = null;
    elStartPrice.textContent = "--";
    elEndPrice.textContent = "--";
    elCountdown.textContent = "未开始";
    elTip.textContent = "账户已重置，可以重新开始新一轮挑战。";
    renderHistory();
    updateChipsDisplay();
    autoSave();
  }

  /* ---------- 账户导出 / 导入 ---------- */

  function makeAccountPayload() {
    return {
      v: 1,
      mode: state.mode,
      chips: state.chips,
      history: state.history.slice(0, 50), // 最多保留最近 50 条
    };
  }

  function encodeAccount(payload) {
    const json = JSON.stringify(payload);
    const b64 = btoa(encodeURIComponent(json));
    // 为了看起来像地址，加个 0x 前缀
    return "0x" + b64;
  }

  function decodeAccount(code) {
    if (!code) throw new Error("账号代码为空");
    code = code.trim();
    if (code.startsWith("0x")) code = code.slice(2);
    const json = decodeURIComponent(atob(code));
    return JSON.parse(json);
  }

  function exportAccount() {
    const payload = makeAccountPayload();
    const code = encodeAccount(payload);
    inputExport.value = code;
    showToast("账号代码已生成，请复制并妥善保存。");
  }

  function importAccount() {
    const code = inputImport.value.trim();
    if (!code) {
      showToast("请先粘贴账号代码。");
      return;
    }
    try {
      const payload = decodeAccount(code);
      if (!payload || payload.v !== 1) throw new Error("版本不匹配");

      state.mode = payload.mode || "easy";
      elMode.value = state.mode;
      state.chips = payload.chips || STARTING_CHIPS[state.mode];
      state.history = Array.isArray(payload.history) ? payload.history : [];

      renderHistory();
      updateChipsDisplay();
      elTip.textContent = "账号导入成功，可以继续你的挑战。";
      autoSave();
    } catch (e) {
      console.error(e);
      showToast("账号代码无效或已损坏，导入失败。");
    }
  }

  /* ---------- 本地存储 ---------- */

  const STORAGE_KEY = "rocket_predict_game_v1";

  function autoSave() {
    const data = {
      mode: state.mode,
      chips: state.chips,
      history: state.history,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn("保存失败：", e);
    }
  }

  function loadSave() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data) return;
      state.mode = data.mode || "easy";
      state.chips = data.chips ?? STARTING_CHIPS[state.mode];
      state.history = Array.isArray(data.history) ? data.history : [];
      elMode.value = state.mode;
      renderHistory();
      updateChipsDisplay();
    } catch (e) {
      console.warn("读取存档失败：", e);
    }
  }

  /* ---------- 事件绑定 ---------- */

  function bindEvents() {
    elMode.addEventListener("change", () => {
      const newMode = elMode.value;
      if (newMode === state.mode && state.chips > 0) return;
      if (!ensureNotInRound()) {
        elMode.value = state.mode;
        return;
      }
      if (
        confirm(
          "切换模式会重置筹码和历史记录，确定要切换吗？"
        )
      ) {
        state.mode = newMode;
        resetAccount(true);
      } else {
        elMode.value = state.mode;
      }
    });

    btnUp.addEventListener("click", () => startRound("up"));
    btnDown.addEventListener("click", () => startRound("down"));

    btnReset.addEventListener("click", () => {
      if (
        confirm(
          "确认要重置账户吗？筹码和历史记录都会清空。"
        )
      ) {
        resetAccount(false);
      }
    });

    elReconnect.addEventListener("click", () => {
      connectRealPrice();
    });

    btnToggleAdv.addEventListener("click", () => {
      const isHidden = advPanel.classList.contains("hidden");
      if (isHidden) {
        advPanel.classList.remove("hidden");
        btnToggleAdv.textContent = "隐藏高级功能";
      } else {
        advPanel.classList.add("hidden");
        btnToggleAdv.textContent = "显示高级功能";
      }
    });

    btnExport.addEventListener("click", exportAccount);
    btnImport.addEventListener("click", importAccount);
  }

  /* ---------- 初始化 ---------- */

  function init() {
    loadSave();
    updateChipsDisplay();
    updatePriceUI();
    renderHistory();
    bindEvents();

    // 默认先尝试连实盘，失败再自动切回模拟
    connectRealPrice();
    // 如果 6 秒后仍然没有成功，确保有模拟价格兜底
    setTimeout(() => {
      if (!state.useRealPrice && state.currentPrice == null) {
        startSimulatedLoop();
      }
    }, 6000);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
