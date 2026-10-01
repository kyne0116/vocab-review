// 词库页（R09）：浏览/搜索当前账号词库，全账号支持删除（R09-2）
// （行内「删除」单删 + 勾选批量删）。删除走 store.removeWords 联动清理：
// 已学词同步移出复习批次与错词本；静态词库为软删除（vocab_deleted_<账号>）。
const store = require('../../utils/store.js');
const tts = require('../../utils/tts.js');

const PAGE_SIZE = 100; // 大词库（3400+ 词）分屏渲染，触底续载

Page({
  data: {
    accName: '',
    isPhoto: false,    // 拍照生词本（动态词库）= 可删除；静态教材账号仅浏览
    keyword: '',
    items: [],         // 完整过滤结果 [{ w, m, p, learned, done, statusText, sel }]
    viewItems: [],     // 当前渲染的截段子集（items.slice(0, limit)）
    shownCount: 0,
    total: 0,
    learnedCount: 0,
    pendingCount: 0,
    manageMode: false,
    selCount: 0,
    allSel: false
  },

  onShow: function () {
    this._sel = this._sel || {};  // 勾选集（按词存，搜索过滤不丢已勾选项）
    this._limit = PAGE_SIZE;
    const acc = store.currentAccount();
    this.setData({ accName: acc.name, isPhoto: !!acc.dynamic });
    this.refresh();
  },

  refresh: function () {
    const sel = this._sel;
    const kw = (this.data.keyword || '').trim().toLowerCase();
    const entries = store.getBankEntries();
    if (this.data.isPhoto) entries.reverse(); // 拍照本按收录倒序（最新在前）；教材库保持课本顺序
    const matched = entries.filter(function (x) {
      return !kw || x.w.toLowerCase().indexOf(kw) !== -1 || (x.m || '').indexOf(kw) !== -1;
    });
    const items = matched.map(function (x) {
      return {
        w: x.w, m: x.m, p: x.p,
        learned: x.learned,
        done: x.done,
        statusText: x.learned ? ('第' + x.batchNo + '批·' + (x.done ? '已完成' : '复习中')) : '待学习',
        sel: !!sel[x.w]
      };
    });
    const viewItems = items.slice(0, this._limit);
    const selCount = items.filter(function (x) { return x.sel; }).length;
    const learnedCount = entries.filter(function (x) { return x.learned; }).length;
    this.setData({
      items: items,
      viewItems: viewItems,
      shownCount: viewItems.length,
      total: entries.length,
      learnedCount: learnedCount,
      pendingCount: entries.length - learnedCount,
      selCount: selCount,
      allSel: items.length > 0 && selCount === items.length
    });
  },

  // 触底续载（大词库分屏渲染）
  onReachBottom: function () {
    if (this._limit < this.data.items.length) {
      this._limit += PAGE_SIZE;
      this.refresh();
    }
  },

  /* ---------- 搜索 ---------- */
  onSearch: function (e) {
    this.setData({ keyword: e.detail.value });
    this._limit = PAGE_SIZE; // 新搜索从头渲染
    this.refresh();
  },
  clearSearch: function () {
    this.setData({ keyword: '' });
    this._limit = PAGE_SIZE;
    this.refresh();
  },

  /* ---------- 行交互 ---------- */
  tapRow: function (e) {
    if (this.data.manageMode) return this.toggleSel(e);
    const it = this.data.viewItems[e.currentTarget.dataset.idx];
    if (!it) return;
    tts.speakPair(it.w, it.m, 1, 1200); // 同错词本：点单词中英连读
  },

  toggleSel: function (e) {
    const it = this.data.viewItems[e.currentTarget.dataset.idx];
    if (!it) return;
    if (this._sel[it.w]) delete this._sel[it.w];
    else this._sel[it.w] = true;
    this.refresh();
  },

  toggleManage: function () {
    if (this.data.manageMode) this._sel = {}; // 退出管理清空勾选
    this.setData({ manageMode: !this.data.manageMode });
    this.refresh();
  },

  // 全选/取消全选：作用于当前搜索的全部结果（含未渲染部分），便于搜出同类词一次清掉
  selectAll: function () {
    const sel = this._sel;
    const target = !this.data.allSel;
    this.data.items.forEach(function (x) {
      if (target) sel[x.w] = true;
      else delete sel[x.w];
    });
    this.refresh();
  },

  /* ---------- 删除（全账号，R09-2） ---------- */
  // 单个删除：行右侧「删除」按钮（确认弹窗兜底防误触）
  deleteOne: function (e) {
    const it = this.data.viewItems[e.currentTarget.dataset.idx];
    if (!it) return;
    const that = this;
    wx.showModal({
      title: '删除「' + it.w + '」？',
      content: it.learned
        ? '该词已在复习批次中，删除后将同时从复习与错词本移除，历史学习记录保留。'
        : '删除后该词不再进入学习。',
      success: function (res) {
        if (!res.confirm) return;
        store.removeWords([it.w]);
        wx.showToast({ title: '已删除', icon: 'none' });
        that.refresh();
      }
    });
  },

  deleteSelected: function () {
    const selItems = this.data.items.filter(function (x) { return x.sel; });
    if (!selItems.length) {
      return wx.showToast({ title: '请先勾选要删除的词', icon: 'none' });
    }
    const learned = selItems.filter(function (x) { return x.learned; }).length;
    const that = this;
    wx.showModal({
      title: '删除选中的 ' + selItems.length + ' 个词？',
      content: learned
        ? '其中 ' + learned + ' 个已进入复习批次，将同时从复习与错词本移除，历史学习记录保留。'
        : '删除后这些词不再进入学习。',
      success: function (res) {
        if (!res.confirm) return;
        const r = store.removeWords(selItems);
        wx.showToast({
          title: '已删除 ' + r.removed + ' 词' + (r.learned ? '（' + r.learned + ' 词移出复习）' : ''),
          icon: 'none'
        });
        that._sel = {};
        that.setData({ manageMode: false });
        that.refresh();
      }
    });
  }
});
