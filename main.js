// ===== 参数设置 =====

// 合约代码 你可以换成 ETH-USDT-SWAP 等
const INST_ID = "BTC-USDT-SWAP";
// K 线周期
const BAR = "1m";
// 单局等待时间：正式版建议 60_000（60 秒），调试可以先改成 10_000 看结果
const ROUND_MS = 60_000;

// ===== 游戏状态 =====
let chips = 100.0;
let currentBet = null;
let isRoundRunning = false;

// ===== DOM 元素 =====
const chipsEl = document.getElementById("chips");
const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const btnUpEl = document.getElementById("btnUp");
const btnDownEl = document.getElementById("btnDown");

function updateChips() {
  chipsEl.textContent = chips.toFixed(1);
}

function setStatus(text) {
  statusEl.innerHTML = `<span>${text}</span>`;
}

function addLog(html) {
  const div = document.createElement("div");
  div.className = "log-entry";
  const now = new Date();
  const timeStr = now.toLocaleTimeString();
  div.innerHTML = `
    <div class="log-time">[${timeStr}]</div>
    <div>${html}</div>
  `;
  logEl.prepend(div);
}

function setButtonsDisabled(disabled) {
  const cls = "disabled";
  if (disabled) {
    btnUpEl.classList.add(cls);
    btnDownEl.classList.add(cls);
    btnUpEl.disabled = true;
    btnDownEl.disabled = true;
  } else {
    btnUpEl.classList.remove(cls);
    btnDownEl.classList.remove(cls);
    btnUpEl.disabled = false;
    btnDownEl.disabled = false;
  }
}

// 从 OKX 获取最近两根 1m K 线
async function fetchLastTwoCandles() {
  const url =
    "https://www.okx.com/api/v5/market/candles" +
    `?instId=${encodeURIComponent(INST_ID)}` +
    `&bar=${encodeURIComponent(BAR)}` +
    `&limit=2`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("HTTP " + res.status);
  }
  const json = await res.json();
  if (json.code !== "0") {
    throw new Error("OKX 返回错误 " + json.msg);
  }
  if (!Array.isArray(json.data) || json.data.length < 2) {
    throw new Error("K 线数据不足");
  }

  // data 数组：最新 K 线在索引 0，上一根在索引 1
  return json.data;
}

// direction: "up" 或 "down"
function placeBet(direction) {
  if (isRoundRunning) {
    setStatus("上一局还在结算中，稍等一下再下注");
    return;
  }

  const stakeInput = document.getElementById("stake");
  const stake = parseFloat(stakeInput.value);

  if (!Number.isFinite(stake) || stake <= 0) {
    setStatus("请输入大于 0 的筹码数量");
    return;
  }
  if (stake > chips) {
    setStatus("筹码不足，无法下注这么多");
    return;
  }

  // 扣除押注筹码
  chips -= stake;
  updateChips();

  currentBet = {
    direction, // "up" 或 "down"
    stake
  };
  isRoundRunning = true;
  setButtonsDisabled(true);

  const dirText = direction === "up" ? "涨 📈" : "跌 📉";
  setStatus(`已下注 ${stake.toFixed(1)} 筹码，方向 ${dirText}，等待 1 分钟 K 线`);
  addLog(`你下注 ${stake.toFixed(1)} 筹码，方向 ${dirText}`);

  // 等待一个周期，再抓数据结算
  setTimeout(async () => {
    try {
      const candles = await fetchLastTwoCandles();

      const [lastTs, lastO, lastH, lastL, lastC] = candles[0];
      const [prevTs, prevO, prevH, prevL, prevC] = candles[1];

      const prevClose = parseFloat(prevC);
      const lastClose = parseFloat(lastC);

      let realDirection;
      if (lastClose > prevClose) realDirection = "up";
      else if (lastClose < prevClose) realDirection = "down";
      else realDirection = "flat";

      const dirLabel =
        realDirection === "up"
          ? "涨 📈"
          : realDirection === "down"
          ? "跌 📉"
          : "持平 ➖";

      let resultMsg =
        `上一根收盘价 <span class="price-text">${prevClose}</span><br>` +
        `最新一根收盘价 <span class="price-text">${lastClose}</span><br>` +
        `实际方向 ${dirLabel}<br>`;

      if (realDirection === "flat") {
        // 持平：退还筹码
        chips += currentBet.stake;
        resultMsg += `K 线持平，本局视为平局，退还筹码 ${currentBet.stake.toFixed(1)}`;
      } else if (realDirection === currentBet.direction) {
        const profit = currentBet.stake * 0.5;
        const totalBack = currentBet.stake + profit;
        chips += totalBack;
        resultMsg += `恭喜，猜对方向！本局盈利 ${profit.toFixed(
          1
        )} 筹码，共拿回 ${totalBack.toFixed(1)}`;
      } else {
        // 猜错：已经扣过押注，不再退回
        resultMsg += `方向猜错，本局损失 ${currentBet.stake.toFixed(1)} 筹码`;
      }

      updateChips();
      addLog(resultMsg);
      setStatus("本局已结算，可以继续下一局");
    } catch (e) {
      // 行情获取失败：退还筹码
      chips += currentBet.stake;
      updateChips();
      const errMsg = `行情请求失败，已退还本局筹码。错误信息：${e.message}`;
      addLog(errMsg);
      setStatus(errMsg);
    } finally {
      currentBet = null;
      isRoundRunning = false;
      setButtonsDisabled(false);
    }
  }, ROUND_MS);
}

// 初始化
updateChips();
setStatus("等待你开始第一局下注");
