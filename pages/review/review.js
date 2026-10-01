const store = require('../../utils/store.js');

Page({
  data: {
    mode: 'auto',        // auto=今日到期合并 | manual=总览指定批次 | free=错词本自由复习
    state: 'empty',      // empty | noBatch | manualEmpty | manualDone | autoDone | freeEmpty | quiz | result
    items: [],
    index: 0,
    current: null,
    revealed: false,
    progress: 0,
    forgotMap: {},
    remembered: 0,
    forgot: 0,
    batchNos: '',
    // 任务看板（空态 empty 时展示）
    streak: 0,
    lastReview: null,
    wrongCount: 0,
    nextDue: null
  },
  session: null,

  onLoad: function (options) {
    if (options && options.free) {
      this.initFree();
    } else if (options && options.batchId) {
      this.initManual(options.batchId);
    } else {
      this.initAuto();
    }
  },

  // 首页/复习入口：今日到期的批次（自动合并）
  initAuto: function () {
    this.mode = 'auto';
    const session = store.buildReviewSession();
    this.session = session;

    if (session.due.length === 0) {
      // 没有到期任务 → 任务看板
      this.setData({
        state: 'empty',
        streak: store.getStreak(),
        lastReview: store.getLastReview(),
        wrongCount: store.getStats().wrongCount,
        nextDue: store.getNextDueInfo()
      });
      return;
    }
    if (session.items.length === 0) {
      // 到期批次的遗忘池都为空：本轮复习自动完成
      store.finishReview(session, {});
      this.setData({ state: 'autoDone' });
      return;
    }
    this.startQuiz(session);
  },

  // 教程总览页手动点选某一批
  initManual: function (batchId) {
    this.mode = 'manual';
    const rec = store.getRecords().find(function (r) { return r.batchId === batchId; });
    if (!rec) {
      this.setData({ state: 'noBatch' });
      return;
    }
    if (rec.reviewsDone >= store.OFFSETS.length) {
      this.setData({ state: 'manualDone' });
      return;
    }
    const session = store.buildBatchReviewSession(batchId);
    if (session.items.length === 0) {
      // 第4轮起只复习遗忘池，池为空则无需复习
      this.setData({ state: 'manualEmpty' });
      return;
    }
    this.startQuiz(session);
  },

  // 错词本自由复习（看板入口）
  initFree: function () {
    this.mode = 'free';
    const session = store.buildFreeReviewSession();
    this.session = session;
    if (session.items.length === 0) {
      this.setData({ state: 'freeEmpty' });
      return;
    }
    this.startQuiz(session);
  },

  startQuiz: function (session) {
    this.setData({
      mode: this.mode,
      state: 'quiz',
      items: session.items,
      index: 0,
      current: session.items[0],
      revealed: false,
      progress: 0,
      forgotMap: {},
      remembered: 0,
      forgot: 0,
      batchNos: ''
    });
  },

  // 该词所属批次本次是第几次复习（1~10）；自由复习无轮次概念
  roundOf: function (batchNo) {
    if (this.mode === 'free') return '-';
    const due = (this.session && this.session.due) || [];
    for (let i = 0; i < due.length; i++) {
      if (due[i].batchNo === batchNo) return due[i].reviewsDone + 1;
    }
    return '-';
  },

  onReveal: function () {
    this.setData({ revealed: true });
  },

  onRemember: function () {
    this.answer(false);
  },
  onForget: function () {
    this.answer(true);
  },

  answer: function (forgot) {
    const cur = this.data.current;
    const forgotMap = this.data.forgotMap;
    if (forgot) forgotMap[cur.word] = true;

    // 答对且该词在错词本：复习结束时会自动移出（auto/manual 由 finishReview 处理，free 由 finishFreeReview），即时提示
    if (!forgot && store.inWrongPool(cur.word)) {
      wx.showToast({ title: '已移出错词本', icon: 'none', duration: 800 });
    }
    this.setData({ forgotMap: forgotMap, forgot: this.data.forgot + (forgot ? 1 : 0), remembered: this.data.remembered + (forgot ? 0 : 1) });

    const next = this.data.index + 1;
    if (next < this.data.items.length) {
      this.setData({
        index: next,
        current: this.data.items[next],
        revealed: false,
        progress: Math.round(next / this.data.items.length * 100)
      });
    } else {
      this.finish();
    }
  },

  finish: function () {
    if (this.mode === 'free') {
      store.finishFreeReview(this.session, this.data.forgotMap);
    } else {
      store.finishReview(this.session, this.data.forgotMap);
    }
    const nos = [];
    (this.session.due || []).forEach(function (d) { nos.push('第' + d.batchNo + '批'); });
    this.setData({
      state: 'result',
      progress: 100,
      batchNos: nos.join('、')
    });
  },

  goFree: function () {
    wx.redirectTo({ url: '/pages/review/review?free=1' });
  },
  goNextDue: function () {
    wx.redirectTo({ url: '/pages/review/review?batchId=' + this.data.nextDue.batchId });
  },
  goBack: function () {
    wx.navigateBack();
  }
});