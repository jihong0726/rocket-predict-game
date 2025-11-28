// main.js

// ====================== 基本配置 ======================
const OKX_INDEX_URL =
  'https://www.okx.com/api/v5/market/index-tickers?instId=BTC-USDT';

const GAME_CONFIG = {
  modes: {
    easy: { label: '简单', startChips: 200 },
    normal: { label: '普通', startChips: 100 },
    hard: { label: '困难', startChips: 50 }
  },
  // 模拟价格初始值（连不上实盘就从这里开始）
  simulated: {
    startPrice: 30000,
    minMove: -80,
    maxMove: 80
  },
  // 每回合 1 分钟，纯前端不做计时，只是逻辑说明
  payoutRate: 1 // 投 1 个筹码，赢 +0.5，输 -1
};

// ====================== 游戏状态 ======================
const state = {
  mode: 'normal',
  chips: 0,
  initialChips: 0,
  // 价格相关
  priceSource: 'simulated', // 'live' or 'simulated'
  currentPrice: GAME_CONFIG.simulated.startPrice,
  lastPrice: GAME_CONFIG.simulated.startPrice,
  // 历史记录
  history: [],
  roundNo: 0,
  // 当前回合
  currentBetDirection: null, // 'up' | 'down'
  currentBetAmount: 0,
  isRoundActive: false,
  // 模拟价格用的偏移
  simTick: 0
};

// ====================== DOM 获取 ======================
const els = {};

function cacheElements() {
  els.modeSelect = document.getElementById('mode-select');
  els.modeLabel = document.getElementById('mode-label');
  els.chipsVal = document.getElementById('chips-val');
  els.sourceBadge = document.getElementById('source-badge');
  els.priceText = document.getElementById('price-text');
  els.retryBtn = document.getElementById('retry-live-btn');

  els.betInput = document.getElementById('bet-amount');
  els.btnUp = document.getElementById('btn-up');
  els.btnDown = document.getElementById('btn-down');
  els.btnReveal = document.getElementById('btn-reveal');

  els.logArea = document.getElementById('log-area');

  // 隐藏的导入 / 导出入口（例如点击标题 5 次才出现）
  els.hiddenTrigger = document.getElementById('hidden-trigger');
  els.accountPanel = document.getElementById('account-panel');
  els.exportBtn = document.getElementById('btn-export');
  els.importBtn = document.getElementById('btn-import');
  els.accountCodeInput = document.getElementById('account-code');
}

// ====================== 工具函数 ======================
function logLine(text) {
  if (!els.logArea) return;
  const line = document.createElement('div');
  line.textContent = text;
  els.logArea.prepend(line);
}

function formatPrice(p) {
  if (!isFinite(p)) return '-';
  return p.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// 简单随机数
function randInRange(min, max) {
  return min + Math.random() * (max - min);
}

// ====================== 抓 OKX 实盘价格 ======================
async function fetchLivePrice() {
  try {
    els.sourceBadge.textContent = '连接中…';
    els.sourceBadge.className = 'badge badge-loading';

    const resp = await fetch(OKX_INDEX_URL, { method: 'GET' });
    if (!resp.ok) {
      throw new Error('HTTP ' + resp.status);
    }

    const json = await resp.json();

    // OKX 标准返回格式：{ code, msg, data: [ { idxPx, ... } ] }
    if (!json || !Array.isArray(json.data) || json.data.length === 0) {
      throw new Error('返回结构异常');
    }

    const ticker = json.data[0];
    const idxPx = parseFloat(ticker.idxPx); // 指数价格字段 :contentReference[oaicite:1]{index=1}
    if (!isFinite(idxPx) || idxPx <= 0) {
      throw new Error('价格异常: ' + ticker.idxPx);
    }

    state.lastPrice = state.currentPrice || idxPx;
    state.currentPrice = idxPx;
    state.priceSource = 'live';

    updatePriceUI();
    logLine(
      `[实盘] 成功更新价格：${formatPrice(idxPx)} (来源 OKX Index)`
    );
  } catch (err) {
    console.error('fetchLivePrice error:', err);
    useSimulatedPrice(true);
  }
}

// 如果实盘失败 / 首次进入，就用模拟价格
function useSimulatedPrice(fromError = false) {
  state.priceSource = 'simulated';

  if (!state.currentPrice || !isFinite(state.currentPrice)) {
    state.currentPrice = GAME_CONFIG.simulated.startPrice;
    state.lastPrice = state.currentPrice;
  }

  updatePriceUI();

  if (fromError) {
    logLine(
      '[提示] 无法连接 OKX 实盘价格，将使用模拟价格（可点击“重试连接实盘”按钮再试）'
    );
  }
}

// 生成下一根模拟 K 线价格
function nextSimulatedPrice() {
  const cfg = GAME_CONFIG.simulated;
  const move = randInRange(cfg.minMove, cfg.maxMove);
  state.lastPrice = state.currentPrice;
  state.currentPrice = Math.max(1, state.currentPrice + move);
}

// ====================== UI 更新 ======================
function updatePriceUI() {
  if (!els.priceText || !els.sourceBadge) return;

  const priceStr = formatPrice(state.currentPrice);

  if (state.priceSource === 'live') {
    els.priceText.textContent = `当前指数价格（实盘）：$${priceStr}`;
    els.sourceBadge.textContent = '实盘价格';
    els.sourceBadge.className = 'badge badge-live';
  } else {
    els.priceText.textContent = `当前指数价格（模拟）：$${priceStr}`;
    els.sourceBadge.textContent = '模拟价格';
    els.sourceBadge.className = 'badge badge-sim';
  }
}

function updateChipsUI() {
  if (!els.chipsVal) return;
  els.chipsVal.textContent = state.chips;
}

// ====================== 模式切换 ======================
function initModeFromSelect() {
  const mode = els.modeSelect.value || 'normal';
  const cfg = GAME_CONFIG.modes[mode] || GAME_CONFIG.modes.normal;
  state.mode = mode;
  state.chips = cfg.startChips;
  state.initialChips = cfg.startChips;
  state.history = [];
  state.roundNo = 0;
  state.currentBetDirection = null;
  state.currentBetAmount = 0;
  state.isRoundActive = false;

  if (els.modeLabel) {
    els.modeLabel.textContent = `当前模式：${cfg.label}（起始筹码：${cfg.startChips}）`;
  }
  updateChipsUI();
  logLine(`已切换模式为【${cfg.label}】，筹码重置为 ${cfg.startChips}`);
}

// ====================== 一局逻辑 ======================
function startRound(direction) {
  const betAmount = parseInt(els.betInput.value, 10);
  if (!Number.isFinite(betAmount) || betAmount <= 0) {
    alert('请输入正确的下注筹码数量');
    return;
  }
  if (betAmount > state.chips) {
    alert('筹码不足');
    return;
  }
  if (state.isRoundActive) {
    alert('当前回合尚未结束，请先结算');
    return;
  }

  state.currentBetDirection = direction;
  state.currentBetAmount = betAmount;
  state.isRoundActive = true;

  state.roundNo += 1;
  // 本轮起始价 = 当前价格
  state.lastPrice = state.currentPrice;

  logLine(
    `第 ${state.roundNo} 局：下注【${direction === 'up' ? '看涨' : '看跌'}】，筹码 ${betAmount}，起始价：$${formatPrice(
      state.lastPrice
    )}`
  );
}

// 结算一局
function revealNextCandle() {
  if (!state.isRoundActive) {
    alert('请先下注');
    return;
  }

  // 如果是实盘，可以在这里再次抓一次价格；
  // 简化起见：不等 1 分钟，直接抓一次 / 或模拟一次
  if (state.priceSource === 'live') {
    // 实盘模式下再抓一次，如果失败自动切模拟
    fetchLivePrice().then(() => finishRound());
  } else {
    // 模拟模式下自己推一格
    nextSimulatedPrice();
    finishRound();
  }
}

// 真正结算逻辑
function finishRound() {
  const start = state.lastPrice;
  const end = state.currentPrice;
  const dir = state.currentBetDirection;
  const bet = state.currentBetAmount;

  if (!state.isRoundActive || !dir || bet <= 0) return;

  const wentUp = end > start;
  const wentDown = end < start;

  let result = 'draw';
  let deltaChips = 0;

  if ((wentUp && dir === 'up') || (wentDown && dir === 'down')) {
    // 赢：筹码 +0.5 * bet
    const profit = bet * GAME_CONFIG.payoutRate;
    deltaChips = profit;
    state.chips += profit;
    result = 'win';
  } else if (wentUp === wentDown) {
    // 完全相等，当平局
    result = 'draw';
  } else {
    // 输：筹码 -bet
    deltaChips = -bet;
    state.chips -= bet;
    result = 'lose';
  }

  // 记录历史
  const record = {
    no: state.roundNo,
    time: new Date().toISOString(),
    direction: dir,
    startPrice: start,
    endPrice: end,
    bet,
    result,
    delta: deltaChips
  };
  state.history.push(record);

  let resText =
    result === 'win'
      ? `胜利！此局盈亏：+${deltaChips} 筹码`
      : result === 'lose'
      ? `失败！此局盈亏：${deltaChips} 筹码`
      : '平局，筹码不变';

  logLine(
    `第 ${record.no} 局结算：开盘 $${formatPrice(
      start
    )} → 收盘 $${formatPrice(end)}，结果：${resText}，当前总筹码：${
      state.chips
    }`
  );

  state.isRoundActive = false;
  state.currentBetDirection = null;
  state.currentBetAmount = 0;
  updateChipsUI();
  updatePriceUI();
}

// ====================== 账号导出 / 导入 ======================
// 为了避免你之前说的“导出代码太长”——直接导出 JSON 字符串，然后再 base64 一次压缩一下。
// accountCode 大概 2~3 行，可复制。

function buildAccountSnapshot() {
  return {
    v: 1,
    mode: state.mode,
    chips: state.chips,
    initialChips: state.initialChips,
    history: state.history
  };
}

function encodeAccount(snapshot) {
  const jsonStr = JSON.stringify(snapshot);
  // Base64 编码，减少符号，让复制更安全
  return btoa(encodeURIComponent(jsonStr));
}

function decodeAccount(code) {
  try {
    const jsonStr = decodeURIComponent(atob(code.trim()));
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error('decodeAccount error', e);
    return null;
  }
}

function onExportAccount() {
  const snap = buildAccountSnapshot();
  const code = encodeAccount(snap);

  els.accountCodeInput.value = code;
  els.accountCodeInput.select();
  document.execCommand('copy');

  alert('账号已导出并复制到剪贴板，可保存这串代码以便日后导入。');
}

function onImportAccount() {
  const code = els.accountCodeInput.value.trim();
  if (!code) {
    alert('请先粘贴账号代码');
    return;
  }
  const snap = decodeAccount(code);
  if (!snap || snap.v !== 1) {
    alert('账号代码无效或版本不匹配');
    return;
  }

  state.mode = snap.mode || 'normal';
  state.chips = snap.chips || 0;
  state.initialChips = snap.initialChips || 0;
  state.history = Array.isArray(snap.history) ? snap.history : [];
  state.roundNo = state.history.length;
  state.currentBetDirection = null;
  state.currentBetAmount = 0;
  state.isRoundActive = false;

  // 同步模式下拉
  if (els.modeSelect && GAME_CONFIG.modes[state.mode]) {
    els.modeSelect.value = state.mode;
  }
  if (els.modeLabel) {
    const cfg = GAME_CONFIG.modes[state.mode];
    els.modeLabel.textContent = `当前模式：${cfg.label}（起始筹码：${cfg.startChips}）`;
  }

  updateChipsUI();
  logLine('成功导入账号，已恢复筹码与历史记录。');
}

// ====================== 隐藏面板触发逻辑 ======================
// 比如：点击标题 5 次，才显示导出 / 导入面板
let hiddenClickCount = 0;
function onHiddenTriggerClick() {
  hiddenClickCount += 1;
  if (hiddenClickCount >= 5) {
    els.accountPanel.classList.add('visible');
    logLine('已解锁账号导入/导出功能面板。');
  }
}

// ====================== 初始化 ======================
function bindEvents() {
  // 模式切换
  els.modeSelect.addEventListener('change', () => {
    initModeFromSelect();
  });

  // 实盘重试按钮
  els.retryBtn.addEventListener('click', () => {
    fetchLivePrice();
  });

  // 下注按钮
  els.btnUp.addEventListener('click', () => startRound('up'));
  els.btnDown.addEventListener('click', () => startRound('down'));
  els.btnReveal.addEventListener('click', () => revealNextCandle());

  // 隐藏触发（比如标题 DOM）
  els.hiddenTrigger.addEventListener('click', onHiddenTriggerClick);

  // 账号导出 / 导入
  els.exportBtn.addEventListener('click', onExportAccount);
  els.importBtn.addEventListener('click', onImportAccount);
}

function init() {
  cacheElements();
  bindEvents();
  initModeFromSelect();

  // 首次尝试抓一次实盘价格
  fetchLivePrice().catch(() => {
    // 出错时 fallback，在 fetchLivePrice 里已经处理过了
  });
}

document.addEventListener('DOMContentLoaded', init);
