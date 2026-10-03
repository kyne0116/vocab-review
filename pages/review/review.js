const store = require('../../utils/store.js');
const tts = require('../../utils/tts.js');
const lk = require('../../utils/lookup.js');

Page({
  data: {
    mode: 'auto',        // auto=今日到期合并 | manual=总览指定批次 | free=错词本自由复习
    state: 'empty',      // empty | noBatch | manualEmpty | manualDone | autoDone | freeEmpty | quiz | result
    items: [],
    index: 0,
    current: null,
    revealed: false,
    feedback: '',      // R11 即时反馈：'' | 'ok' | 'no'（动画期间防连点）
    progress: 0,
    forgotMap: {},
    remembered: 0,
    forgot: 0,
    batchNos: '',
    // 任务看板（空态 empty 时展示）
    streak: 0,
    lastReview: null,
    wrongCount: 0,
    nextDue: null,
    // 打卡日历（R11）
    calYear: 0,
    calMonth: 0,
    calCells: [],
    // 拓展弹层（R10）
    linkShow: false,
    link: { w: '', p: '', m: '', loading: false, ok: false, rels: [], synos: [], sents: [] }
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
      this.buildCalendar();
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
      feedback: '',
      progress: 0,
      forgotMap: {},
      remembered: 0,
      forgot: 0,
      batchNos: '',
      petEmoji: store.getPetInfo().emoji // R12：答对鼓励语带宠物
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
    // 对齐学习页：显示释义即报读（复习节奏用快读一遍）
    const c = this.data.current;
    if (c) tts.speakPair(c.word, c.meaning, 1, 800);
  },

  // 点词重读一遍（英文 + 中文）
  readCurrent: function () {
    const c = this.data.current;
    if (c) tts.speakPair(c.word, c.meaning, 1, 800);
  },

  onRemember: function () {
    this.answer(false);
  },
  onForget: function () {
    this.answer(true);
  },

  answer: function (forgot) {
    if (this.data.feedback) return; // 反馈动画期间防连点
    const cur = this.data.current;
    const forgotMap = this.data.forgotMap;
    if (forgot) forgotMap[cur.word] = true;

    // 答对且该词在错词本：复习结束时会自动移出（auto/manual 由 finishReview 处理，free 由 finishFreeReview），即时提示
    if (!forgot && store.inWrongPool(cur.word)) {
      wx.showToast({ title: '已移出错词本', icon: 'none', duration: 800 });
    }
    this.setData({
      forgotMap: forgotMap,
      forgot: this.data.forgot + (forgot ? 1 : 0),
      remembered: this.data.remembered + (forgot ? 0 : 1),
      feedback: forgot ? 'no' : 'ok'
    });
    if (forgot) {
      // 答错轻振动（多邻国式负反馈；模拟器/不支持机型静默）
      try { wx.vibrateShort({ type: 'light', fail: function () {} }); } catch (e) { /* 低版本无此 API */ }
    }
    setTimeout(function () { this.advance(); }.bind(this), 650);
  },

  // 反馈展示后进入下一词 / 收尾（R11：从 answer 拆出）
  advance: function () {
    tts.stopSpoken(); // 切词前停掉上一词的报读，避免重叠
    const next = this.data.index + 1;
    if (next < this.data.items.length) {
      this.setData({
        index: next,
        current: this.data.items[next],
        revealed: false,
        feedback: '',
        progress: Math.round(next / this.data.items.length * 100)
      });
    } else {
      this.setData({ feedback: '' });
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

  /* ---------- 拓展弹层（R10）：显示释义后可查看衍生词 / 近义词 / 例句 ---------- */
  openQuizLink: function () {
    const c = this.data.current;
    if (c && this.data.revealed) this.fetchLink(c.word, c.phonetic || '', c.meaning);
  },
  fetchLink: function (w, p, m) {
    this.setData({
      linkShow: true,
      link: { w: w, p: p, m: m, loading: true, ok: false, rels: [], synos: [], sents: [] }
    });
    lk.lookupLinks(w).then(function (r) {
      // 响应回来时弹层可能已关闭或已切词，过期结果直接丢弃
      if (!this.data.linkShow || this.data.link.w !== w) return;
      const base = { w: w, p: p, m: m, loading: false, ok: r.ok, rels: [], synos: [], sents: [] };
      if (r.ok) {
        base.rels = r.links.rels;
        base.synos = r.links.synos;
        base.sents = r.links.sents;
      }
      this.setData({ link: base });
    }.bind(this));
  },
  retryLink: function () {
    const l = this.data.link;
    if (l && l.w) this.fetchLink(l.w, l.p, l.m);
  },
  closeLink: function () {
    tts.stopSpoken();
    this.setData({ linkShow: false });
  },
  speakLinkWord: function () {
    if (this.data.link.w) tts.speak(this.data.link.w, 'en_US');
  },
  readSentence: function (e) {
    tts.speak(e.currentTarget.dataset.en, 'en_US');
  },
  onUnload: function () {
    tts.stopSpoken(); // 离开页面停止朗读
  },

  /* ---------- 打卡日历（R11）：学习/复习过的日期点亮 ---------- */
  buildCalendar: function () {
    const active = {};
    store.getActiveDays().forEach(function (d) { active[d] = true; });
    const now = new Date();
    const y = this.data.calYear || now.getFullYear();
    const m = this.data.calMonth || now.getMonth() + 1;
    const first = new Date(y, m - 1, 1);
    const daysInMonth = new Date(y, m, 0).getDate();
    const pad2 = function (n) { return n < 10 ? '0' + n : '' + n; };
    const today = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
    const cells = [];
    for (let i = 0; i < first.getDay(); i++) cells.push({ d: 0, cls: 'blank' }); // 周日开头补空位
    for (let d = 1; d <= daysInMonth; d++) {
      const key = y + '-' + pad2(m) + '-' + pad2(d);
      let cls = '';
      if (active[key]) cls = 'fill';
      if (key === today) cls += ' today';
      else if (!cls && key > today) cls = 'future';
      cells.push({ d: d, cls: cls });
    }
    this.setData({ calYear: y, calMonth: m, calCells: cells });
  },
  calPrev: function () {
    let y = this.data.calYear, m = this.data.calMonth - 1;
    if (m < 1) { y--; m = 12; }
    this.setData({ calYear: y, calMonth: m });
    this.buildCalendar();
  },
  calNext: function () {
    const now = new Date();
    if (this.data.calYear === now.getFullYear() && this.data.calMonth === now.getMonth() + 1) return; // 不看未来
    let y = this.data.calYear, m = this.data.calMonth + 1;
    if (m > 12) { y++; m = 1; }
    this.setData({ calYear: y, calMonth: m });
    this.buildCalendar();
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