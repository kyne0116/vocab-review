const store = require('../../utils/store.js');

// 批次状态 → 展示文案 / 样式
const STATE = {
  done: { text: '已完成', cls: 'done' },
  learning: { text: '复习中', cls: 'learning' },
  current: { text: '当前批', cls: 'current' },
  todo: { text: '未学习', cls: 'todo' }
};

// 目标日期距今天数（正=未来；overview 不感知 store 内部日期工具的实现）
function daysTo(dateStr) {
  const p = dateStr.split('-');
  const t = new Date();
  const base = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  return Math.round((base - today) / 86400000);
}

function buildItem(b) {
  const s = STATE[b.state] || STATE.todo;
  const isLearned = b.state === 'done' || b.state === 'learning';
  // R21-C：批次正确率（加权综合 + 同口径趋势箭头；null = 尚无复习记录不展示）
  const accInfo = isLearned ? store.getBatchAccuracy({ reviewHistory: b.reviewHistory }) : null;
  const trendArrow = accInfo && accInfo.trend === 'up' ? ' ↑' : (accInfo && accInfo.trend === 'down' ? ' ↓' : '');
  // 复习旅程时间线：10 节点（已完成实心 / 下一节点高亮，逾期标红），三锚点日期 +
  // 啾啾站台（站在下一节点位置，走完全程站终点）
  const dots = [];
  for (let i = 0; i < b.rounds; i++) dots.push({ done: i < b.reviewsDone, today: false, overdue: false });
  let tlD0 = '';
  let tlCenter = '';
  let tlEnd = '';
  let petLeft = 0;
  if (isLearned) {
    tlD0 = b.date;
    tlEnd = store.addDays(b.date, store.OFFSETS[b.rounds - 1]);
    const nextIdx = b.reviewsDone;
    petLeft = Math.round(nextIdx / Math.max(1, b.rounds - 1) * 100);
    if (nextIdx < b.rounds) {
      const nd = store.addDays(b.date, store.OFFSETS[nextIdx]);
      dots[nextIdx].today = true;
      dots[nextIdx].overdue = nd < store.todayStr();
      const dd = daysTo(nd);
      tlCenter = dd < 0 ? '已逾期 · 今天补做' : (dd === 0 ? '今天到期' : '下次 ' + nd + '（还有 ' + dd + ' 天）');
    } else {
      petLeft = 100;
      tlCenter = '已走完全程 🎉';
    }
  }
  return {
    batchNo: b.batchNo,
    batchId: b.batchId,
    open: false,
    rangeText: '词' + (b.start + 1) + '~' + (b.end + 1),
    count: b.count,
    stateText: s.text,
    stateCls: s.cls,
    isLearned: isLearned,
    isLearning: b.state === 'learning',
    reviewsDone: b.reviewsDone,
    rounds: b.rounds,
    wrongCount: b.wrongCount,
    hasWrong: b.wrongCount > 0,
    date: b.date,
    words: b.words,
    acc: accInfo ? accInfo.acc : null,
    accTrend: accInfo && accInfo.trend ? accInfo.trend : '',
    trendArrow: trendArrow,
    dots: dots,
    tlD0: tlD0,
    tlCenter: tlCenter,
    tlEnd: tlEnd,
    petLeft: petLeft,
    // 每轮复习记录附当轮正确率（口径：本轮 1-wrong/total）
    reviewHistory: (b.reviewHistory || []).map(function (h) {
      const acc = h.total > 0 ? Math.round((1 - h.wrong / h.total) * 100) : null;
      return { round: h.round, date: h.date, total: h.total, wrong: h.wrong, accText: acc === null ? '' : acc + '%' };
    }),
    isCurrent: b.state === 'current'
  };
}

Page({
  data: {
    accName: '',
    currentBatchNo: 1,
    totalWords: 0,
    totalBatches: 0,
    learned: 0,
    remaining: 0,
    pct: 0,
    batchDots: [],
    batches: [],
    accSummary: null, // R21-C：全局正确率 + 最需巩固批次
    petEmoji: ''      // R21-C：时间线啾啾站台
  },
  onShow: function () {
    this.refresh();
  },
  refresh: function () {
    const ov = store.getOverview();
    const st = store.getStats();
    const pct = ov.totalWords === 0 ? 0 : Math.round(st.learned / ov.totalWords * 100);
    const batches = ov.batches.map(buildItem);
    const batchDots = ov.batches.map(function (b) { return { cls: b.state }; });
    this.setData({
      accName: store.currentAccount().name,
      currentBatchNo: ov.currentBatchNo,
      totalWords: ov.totalWords,
      totalBatches: ov.totalBatches,
      learned: st.learned,
      remaining: ov.totalWords - st.learned,
      pct: pct,
      batchDots: batchDots,
      batches: batches,
      accSummary: store.getAccuracySummary(),
      petEmoji: store.getPetInfo().emoji
    });
  },
  toggle: function (e) {
    const i = e.currentTarget.dataset.i;
    const key = 'batches[' + i + '].open';
    const obj = {};
    obj[key] = !this.data.batches[i].open;
    this.setData(obj);
  },
  goNew: function () { wx.navigateTo({ url: '/pages/new/new' }); },
  goReview: function (e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/review/review?batchId=' + id });
  },
  goStudy: function (e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/study/study?batchId=' + id });
  },
  // R21-C：最需巩固批次直达（点击即复习该批）
  goWeak: function (e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/review/review?batchId=' + id });
  },
  notYet: function () {
    wx.showToast({ title: '请按顺序先学前序批次', icon: 'none' });
  }
});