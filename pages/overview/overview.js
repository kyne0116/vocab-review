const store = require('../../utils/store.js');

// 批次状态 → 展示文案 / 样式
const STATE = {
  done: { text: '已完成', cls: 'done' },
  learning: { text: '复习中', cls: 'learning' },
  current: { text: '当前批', cls: 'current' },
  todo: { text: '未学习', cls: 'todo' }
};

function buildItem(b) {
  const s = STATE[b.state] || STATE.todo;
  // 复习进度点阵：10 个圆点，已完成的实心，未到的灰
  const dots = [];
  for (let i = 0; i < b.rounds; i++) {
    dots.push({ done: i < b.reviewsDone });
  }
  const isLearned = b.state === 'done' || b.state === 'learning';
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
    reviewHistory: b.reviewHistory,
    dots: dots,
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
    batches: []
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
      batches: batches
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
  notYet: function () {
    wx.showToast({ title: '请按顺序先学前序批次', icon: 'none' });
  }
});