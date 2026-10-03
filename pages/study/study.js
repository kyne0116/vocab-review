// 学习模式页：每批单词确认（记入记录）后，提供两种学习方式
//  - 展示英文：显示英文单词，点击后出现中文释义并朗读中文
//  - 展示中文：显示中文释义，点击后出现英文单词并朗读英文
const store = require('../../utils/store.js');
const tts = require('../../utils/tts.js');
const lk = require('../../utils/lookup.js');

Page({
  data: {
    batch: null,       // 批次记录 {batchId, batchNo, date, words}
    mode: '',          // '' 未选择 | 'en' 展示英文 | 'cn' 展示中文
    items: [],         // [{w, p, m, revealed}]
    revealedCount: 0,
    // 拓展弹层（R10）
    linkShow: false,
    link: { w: '', p: '', m: '', loading: false, ok: false, rels: [], synos: [], sents: [] }
  },

  onLoad: function (opts) {
    const batchId = opts.batchId || '';
    const records = store.getRecords();
    let rec = null;
    for (let i = 0; i < records.length; i++) {
      if (records[i].batchId === batchId) { rec = records[i]; break; }
    }
    if (!rec) {
      wx.showToast({ title: '未找到该批次', icon: 'none' });
      setTimeout(function () { wx.navigateBack(); }, 800);
      return;
    }
    this.setData({ batch: rec });
  },

  /* ---------- 模式选择 ---------- */
  chooseEn: function () { this.startMode('en'); },
  chooseCn: function () { this.startMode('cn'); },
  // 默写模式（R13）：独立页面，携带批次上下文
  goSpell: function () {
    wx.navigateTo({
      url: '/pages/spell/spell?batchId=' + this.data.batch.batchId,
      fail: function (err) {
        wx.showToast({ title: ((err && err.errMsg) || '打开默写模式失败').slice(0, 40), icon: 'none' });
      }
    });
  },

  startMode: function (mode) {
    const items = this.data.batch.words.map(function (w) {
      return { w: w.w, p: w.p || '', m: w.m, revealed: false };
    });
    this.setData({ mode: mode, items: items, revealedCount: 0 });
  },

  /* ---------- 点击单词 ---------- */
  tapWord: function (e) {
    const idx = e.currentTarget.dataset.idx;
    const item = this.data.items[idx];
    if (!item) return;

    if (!item.revealed) {
      const obj = {};
      obj['items[' + idx + '].revealed'] = true;
      obj.revealedCount = this.data.revealedCount + 1;
      this.setData(obj);
    }

    // 点击即报读：英文 + 中文连读为一遍，共3遍、每遍间隔约1.2秒
    //（专注跟读；已翻开的词再点一次会重头报读）
    tts.speakPair(item.w, item.m, 3, 1200);
  },

  /* ---------- 全部显示 / 重新开始 ---------- */
  revealAll: function () {
    const items = this.data.items.map(function (it) {
      it.revealed = true;
      return it;
    });
    this.setData({ items: items, revealedCount: items.length });
  },

  hideAll: function () {
    const items = this.data.items.map(function (it) {
      it.revealed = false;
      return it;
    });
    this.setData({ items: items, revealedCount: 0 });
  },

  /* ---------- 行右侧操作区（R10） ---------- */
  speakWord: function (e) {
    const item = this.data.items[e.currentTarget.dataset.idx];
    if (item) tts.speakPair(item.w, item.m, 1, 800); // 快读一遍（英文 + 中文）
  },
  openLink: function (e) {
    const item = this.data.items[e.currentTarget.dataset.idx];
    if (item) this.fetchLink(item.w, item.p || '', item.m);
  },

  /* ---------- 拓展弹层（R10）：衍生词 / 近义词 / 双语例句 ---------- */
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
    tts.stopSpoken(); // 离开页面停止连读
  }
});
