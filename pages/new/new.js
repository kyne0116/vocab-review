const store = require('../../utils/store.js');
const tts = require('../../utils/tts.js');

Page({
  data: {
    batch: null,
    today: '',
    accountName: '',
    totalWords: 0,
    learnBtn: '开始学习',   // 右上角按钮文字（仅自动顺读模式显示）
    learnActive: false,      // 是否在自动连播学习中
    learnIdx: -1,           // 自动学习当前高亮的单词索引（-1 表示无）
    scrollInto: '',         // scroll-view 滚动定位到当前词
    mode: 'manual'          // 播报模式：manual=手动点读（默认） | auto=自动顺读
  },
  onShow: function () {
    const batch = store.nextBatch();
    const account = store.currentAccount();
    this.setData({
      batch: batch,
      today: store.todayStr(),
      accountName: account.name,
      totalWords: store.getStats().totalWords
    });
  },
  // 切换播报模式：手动点读 / 自动顺读
  switchMode: function (e) {
    const m = e.currentTarget.dataset.mode;
    if (m === this.data.mode) return;
    if (m === 'manual' && this.data.learnActive) {
      this.stopLearn(); // 正在自动连播，切回手动先停下
    }
    this.setData({ mode: m, learnIdx: -1 });
  },

  // 点击列表任意位置（英文/中文/空白）：
  //   手动点读：只报读该词（英文 + 中文，释义自动分段）3 遍，读完即停
  //   自动顺读：从该行开始向后逐词连播，直到最后一个词或手动停止
  tapWord: function (e) {
    const idx = e.currentTarget.dataset.idx;
    const words = this.data.batch && this.data.batch.words;
    const w = words && words[idx];
    if (!w) return;
    if (this.data.mode === 'auto') {
      this.startAuto(idx);
    } else {
      this.setData({ learnIdx: idx }); // 高亮反馈当前点读的词
      tts.speakPair(w.w, w.m, 3, 1200);
    }
  },

  /* ---------- 自动连播学习 ---------- */
  toggleLearn: function () {
    if (this.data.learnActive) {
      this.stopLearn();
    } else {
      this.startLearn();
    }
  },
  startLearn: function () {
    this.startAuto(0); // 「开始学习」：从第1个词开始，逐词连读
  },
  startAuto: function (i) {
    const words = this.data.batch.words;
    if (!words || !words.length || i < 0) return;
    if (this.autoTimer) clearTimeout(this.autoTimer); // 切换起点，旧的接力计时作废
    const w = words[i];
    const dur = this.speakAt(i, w, 3);
    const that = this;
    this.autoTimer = setTimeout(function () { that.readNext(i + 1); }, dur);
  },
  readNext: function (i) {
    const words = this.data.batch.words;
    if (!this.data.learnActive || i >= words.length) return this.stopLearn();
    const w = words[i];
    const dur = this.speakAt(i, w, 3); // 每个单词：英文 + 中文连读 3 遍
    const that = this;
    this.autoTimer = setTimeout(function () { that.readNext(i + 1); }, dur);
  },
  speakAt: function (i, w, times) {
    this.setData({ learnActive: true, learnBtn: '停止学习', learnIdx: i, scrollInto: 'w-' + i });
    // 中文释义在 tts 内部自动按「，；」分段连播；返回预计时长，供连播按实际进度等待
    return tts.speakPair(w.w, w.m, times, 1200);
  },
  stopLearn: function () {
    if (this.autoTimer) { clearTimeout(this.autoTimer); this.autoTimer = null; }
    tts.stopSpoken();
    this.setData({ learnActive: false, learnBtn: '开始学习', learnIdx: -1, scrollInto: '' });
  },

  onUnload: function () {
    this.stopLearn(); // 离开页面停止连读与自动学习
  },

  onDone: function () {
    const that = this;
    wx.showModal({
      title: '确认完成学习',
      content: '将记录本批 ' + this.data.batch.words.length + ' 个单词及今天日期，并开始10次间隔复习。',
      success: function (res) {
        if (!res.confirm) return;
        store.saveLearnedBatch(that.data.batch);
        wx.showToast({ title: '已记录', icon: 'success' });
        // 确认后进入该批的学习模式（展示英文 / 展示中文 两种方式）
        setTimeout(function () {
          const records = store.getRecords();
          const rec = records[records.length - 1];
          wx.redirectTo({ url: '/pages/study/study?batchId=' + rec.batchId });
        }, 600);
      }
    });
  }
});
