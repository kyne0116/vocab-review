const store = require('../../utils/store.js');
const tts = require('../../utils/tts.js');
const lk = require('../../utils/lookup.js');

Page({
  data: {
    mode: 'auto',        // auto=今日到期合并 | manual=总览指定批次 | free=错词本自由复习 | study=当日快测
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
    // R17 复习双视图：view = card（逐词卡片，默认）| list（列表通览）；快测固定 card
    view: 'card',
    listRevealed: {},  // 列表视图：已看过释义的词（与卡片视图的 revealed 互通）
    revealedCount: 0,  // 列表视图进度：已看释义词数
    forgotCount: 0,    // 列表视图：已标记忘记词数
    // R16-A 当日快测（study 模式）专用
    studyTotal: 0,     // 本批原始词数（不含忘记后重排的副本）
    firstPass: 0,      // 首次出现即答「记得」的词数
    // 任务看板（空态 empty 时展示）
    streak: 0,
    lastReview: null,
    wrongCount: 0,
    nextDue: null,
    // 复习中心（R21-D：无到期任务时的排期与正确率看板）
    forecastCells: [],   // 未来 7 天稠密排期条（无任务的日子也占格）
    accSummary: null,    // 全局正确率 + 最需巩固批次
    recentAcc: [],       // 最近 8 次复习的当次正确率（sparkline 柱高）
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
    if (options && options.study && options.batchId) {
      this.initStudy(options.batchId);
    } else if (options && options.free) {
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
      // 没有到期任务 → 复习中心（R21-D：看板 + 未来排期条 + 正确率走势 + 巩固直达）
      this.setData({
        state: 'empty',
        streak: store.getStreak(),
        lastReview: store.getLastReview(),
        wrongCount: store.getStats().wrongCount,
        nextDue: store.getNextDueInfo()
      });
      this.buildForecast();
      this.buildAccBoard();
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

  // 教材总览页手动点选某一批
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

  // R16-A 当日快测（学习页入口）：整批自测巩固。
  // 不写复习记录、不动遗忘池、不推进复习次数——初记只求脸熟，可反复做
  initStudy: function (batchId) {
    this.mode = 'study';
    this.studyBatchId = batchId;
    const rec = store.getRecords().find(function (r) { return r.batchId === batchId; });
    if (!rec) {
      this.setData({ state: 'noBatch' });
      return;
    }
    const items = rec.words.map(function (w) {
      return { word: w.w, phonetic: w.p, meaning: w.m, batchNo: rec.batchNo };
    });
    if (items.length === 0) {
      this.setData({ state: 'manualEmpty' });
      return;
    }
    this.session = { study: true, due: [], items: items };
    this.startQuiz(this.session);
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
      // R17：快测的「忘记回队尾再过」依赖顺序出题，固定卡片视图；其余模式用账号偏好
      view: this.mode === 'study' ? 'card' : store.getReviewView(),
      listRevealed: {},
      revealedCount: 0,
      forgotCount: 0,
      studyTotal: this.mode === 'study' ? session.items.length : 0,
      firstPass: 0,
      batchNos: '',
      petEmoji: store.getPetInfo().emoji // R12：答对鼓励语带宠物
    });
    this.updateExitGuard();
  },

  // R19 退出保护：复习进行中（非快测）开启系统返回询问——复习提交是全有或全无，
  // 中途退出会丢弃全部已标记结果，返回前确认一次（快测无落库，退出无损失，不启用）。
  // 拦截覆盖导航栏返回 / 安卓物理返回 / navigateBack；低版本基础库无此 API 时静默降级。
  updateExitGuard: function () {
    if (!wx.enableAlertBeforeUnload) return;
    if (this.data.state !== 'quiz' || this.mode === 'study') {
      if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload({ fail: function () {} });
      return;
    }
    const remaining = this.data.items.length - this.data.index - 1;
    const msg = this.data.view === 'list'
      ? '复习还未提交，退出将不保存已标记的结果'
      : '还有 ' + remaining + ' 词未复习，退出将不保存已标记的结果';
    wx.enableAlertBeforeUnload({ message: msg, fail: function () {} });
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
    // 释义展示状态双视图互通：卡片翻开的词切到列表视图时同样显示为已看
    const c = this.data.current;
    const listRevealed = this.data.listRevealed;
    let add = 0;
    if (c && !listRevealed[c.word]) { listRevealed[c.word] = true; add = 1; }
    this.setData({
      revealed: true,
      listRevealed: listRevealed,
      revealedCount: this.data.revealedCount + add
    });
    // 对齐学习页：显示释义即报读（复习节奏用快读一遍）
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
    // 双视图「后判覆盖先判」：列表里标了忘、卡片里又答记得 → 以卡片为准移除标记
    if (forgot) forgotMap[cur.word] = true;
    else delete forgotMap[cur.word];

    // 答对且该词在错词本：复习结束时会自动移出（auto/manual 由 finishReview 处理，free 由 finishFreeReview），即时提示
    // 快测不碰错词本（当日新学词不该在池中，防御性跳过）
    if (!forgot && this.mode !== 'study' && store.inWrongPool(cur.word)) {
      wx.showToast({ title: '已移出错词本', icon: 'none', duration: 800 });
    }
    this.setData({
      forgotMap: forgotMap,
      forgotCount: Object.keys(forgotMap).length,
      forgot: this.data.forgot + (forgot ? 1 : 0),
      remembered: this.data.remembered + (forgot ? 0 : 1),
      firstPass: this.data.firstPass + (!forgot && this.mode === 'study' && !cur.requeued ? 1 : 0),
      feedback: forgot ? 'no' : 'ok'
    });
    if (forgot) {
      // 答错轻振动（多邻国式负反馈；模拟器/不支持机型静默）
      try { wx.vibrateShort({ type: 'light', fail: function () {} }); } catch (e) { /* 低版本无此 API */ }
    }
    setTimeout(function () { this.advance(forgot); }.bind(this), 650);
  },

  // 反馈展示后进入下一词 / 收尾（R11：从 answer 拆出）
  advance: function (forgot) {
    tts.stopSpoken(); // 切词前停掉上一词的报读，避免重叠
    // R16-A 快测：忘记的词回本轮队尾，须再过一遍（同默写模式先例）
    if (this.mode === 'study' && forgot) {
      const cur = this.data.current;
      this.setData({
        items: this.data.items.concat([{
          word: cur.word, phonetic: cur.phonetic, meaning: cur.meaning, batchNo: cur.batchNo, requeued: true
        }])
      });
    }
    const next = this.data.index + 1;
    if (next < this.data.items.length) {
      this.setData({
        index: next,
        current: this.data.items[next],
        revealed: false,
        feedback: '',
        progress: Math.round(next / this.data.items.length * 100)
      });
      this.updateExitGuard(); // R19：剩余词数变化，更新返回询问文案
    } else {
      this.setData({ feedback: '' });
      this.finish();
    }
  },

  finish: function () {
    if (this.mode === 'free') {
      store.finishFreeReview(this.session, this.data.forgotMap);
    } else if (this.mode !== 'study') {
      // 快测不落任何存储（纯巩固，不推进复习进度）
      store.finishReview(this.session, this.data.forgotMap);
    }
    // R17：结果统计以 forgotMap 为准统一口径（卡片/列表/混用三种路径一致）；
    // 快测沿用 firstPass 口径（列表视图不开放快测，无混用）
    let remembered = this.data.remembered;
    let forgot = this.data.forgot;
    if (this.mode !== 'study') {
      const seen = {};
      this.data.items.forEach(function (it) { seen[it.word] = true; });
      forgot = 0;
      for (const w in this.data.forgotMap) { if (seen[w]) forgot++; }
      remembered = Object.keys(seen).length - forgot;
    }
    const nos = [];
    (this.session.due || []).forEach(function (d) { nos.push('第' + d.batchNo + '批'); });
    this.setData({
      state: 'result',
      progress: 100,
      remembered: remembered,
      forgot: forgot,
      batchNos: nos.join('、')
    });
    this.updateExitGuard(); // R19：到结果页即已落库，解除返回询问
  },

  /* ---------- R17 列表视图：整批词单通览，自控节奏 ---------- */
  // 顶部「卡片 / 列表」切换：可中途切换，判定与已看释义跨视图保留
  switchView: function (e) {
    const v = e.currentTarget.dataset.v;
    if (v === this.data.view || this.data.feedback) return; // 反馈动画期间不切
    tts.stopSpoken();
    store.setReviewView(v); // 记住账号偏好，下次进复习直接用
    this.setData({
      view: v,
      // 切回卡片时：当前词若已在列表看过释义，直接显示释义与判定按钮
      revealed: v === 'card' && this.data.current
        ? !!this.data.listRevealed[this.data.current.word]
        : false
    });
    this.updateExitGuard(); // R19：卡片/列表返回询问文案不同，切换后同步
  },

  // 按单词找词条（列表视图行内交互用；同会话内词唯一）
  findItem: function (w) {
    for (let i = 0; i < this.data.items.length; i++) {
      if (this.data.items[i].word === w) return this.data.items[i];
    }
    return null;
  },

  // 点词行：显示释义 + 朗读（与卡片「显示释义」同节奏）
  tapListWord: function (e) {
    const w = e.currentTarget.dataset.w;
    const item = this.findItem(w);
    if (!item) return;
    const listRevealed = this.data.listRevealed;
    let add = 0;
    if (!listRevealed[w]) { listRevealed[w] = true; add = 1; }
    this.setData({
      listRevealed: listRevealed,
      revealedCount: this.data.revealedCount + add
    });
    tts.speakPair(item.word, item.meaning, 1, 800);
  },

  // 列表行内「🌱 拓展」：与卡片入口同一弹层；看过释义的词才可用（与卡片 revealed 门控一致）
  openListLink: function (e) {
    const w = e.currentTarget.dataset.w;
    if (!this.data.listRevealed[w]) return;
    const item = this.findItem(w);
    if (item) this.fetchLink(item.word, item.phonetic || '', item.meaning);
  },

  // 点圆圈：标记 / 取消「忘记」（未标记 = 记得）
  toggleListForgot: function (e) {
    const w = e.currentTarget.dataset.w;
    const forgotMap = this.data.forgotMap;
    if (forgotMap[w]) delete forgotMap[w];
    else {
      forgotMap[w] = true;
      try { wx.vibrateShort({ type: 'light', fail: function () {} }); } catch (err) { /* 低版本无此 API */ }
    }
    this.setData({ forgotMap: forgotMap, forgotCount: Object.keys(forgotMap).length });
  },

  // 列表视图底部「完成复习」：与卡片流程共用 finish 收尾
  finishList: function () {
    tts.stopSpoken();
    this.finish();
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

  /* ---------- R21-D：复习中心数据（排期条 / 正确率走势 / 巩固直达） ---------- */
  // 未来 7 天稠密排期条：无任务的日子也占格（「今天的空闲也是排期的一部分」）；
  // 词数口径与到期合并一致（同日多批按词去重），逾期未做的累积到当天
  buildForecast: function () {
    const fmap = {};
    store.getReviewForecast(6).forEach(function (e) { fmap[e.date] = e; });
    const wk = ['日', '一', '二', '三', '四', '五', '六'];
    const cells = [];
    const today = store.todayStr();
    for (let i = 0; i < 7; i++) {
      const d = store.addDays(today, i);
      const p = d.split('-');
      const wd = wk[new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay()];
      const e = fmap[d];
      cells.push({
        label: i === 0 ? '今天' : (i === 1 ? '明天' : '周' + wd),
        words: e ? e.words : 0,
        has: !!e,
        overdue: !!(e && e.overdue)
      });
    }
    this.setData({ forecastCells: cells });
  },

  // 正确率看板：全局加权综合 + 最近 8 次复习的当次正确率走势（跨批按日期升序）
  buildAccBoard: function () {
    const all = [];
    store.getRecords().forEach(function (r) {
      (r.reviewHistory || []).forEach(function (h) {
        if (h.total > 0) all.push({ date: h.date, acc: Math.round((1 - h.wrong / h.total) * 100) });
      });
    });
    all.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    this.setData({
      accSummary: store.getAccuracySummary(),
      recentAcc: all.slice(-8).map(function (x) { return x.acc; })
    });
  },

  // 最需巩固批次直达（空态页内跳转用 redirectTo，复习完返回直接回首页层级）
  goWeak: function (e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.redirectTo({ url: '/pages/review/review?batchId=' + id });
  },

  goFree: function () {
    wx.redirectTo({ url: '/pages/review/review?free=1' });
  },
  goNextDue: function () {
    wx.redirectTo({ url: '/pages/review/review?batchId=' + this.data.nextDue.batchId });
  },
  // R16-A 快测结果页「再测一遍」：原批重开
  restartStudy: function () {
    this.initStudy(this.studyBatchId);
  },
  goBack: function () {
    wx.navigateBack();
  }
});