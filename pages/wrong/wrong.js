// 错词本：全局聚合各批次遗忘池，按词去重
// 复习时点"忘记"自动收录，点"记得"自动移出；这里也可逐词手动移出
const store = require('../../utils/store.js');
const tts = require('../../utils/tts.js');

Page({
  data: {
    items: [],  // [{word, phonetic, meaning, batchText}]
    total: 0
  },

  onShow: function () {
    this.refresh();
  },

  refresh: function () {
    const items = store.getWrongWords().map(function (it) {
      it.batchText = '第' + it.batches.join('、') + '批';
      return it;
    });
    this.setData({ items: items, total: items.length });
  },

  // 点击单词：英文 + 中文连读一遍（快速回顾）
  tapWord: function (e) {
    const it = this.data.items[e.currentTarget.dataset.idx];
    if (!it) return;
    tts.speakPair(it.word, it.meaning, 1, 1200);
  },

  // 我已会：从错词本移出
  onKnow: function (e) {
    const it = this.data.items[e.currentTarget.dataset.idx];
    if (!it) return;
    store.removeWrongWord(it.word);
    wx.showToast({ title: '已移出错词本', icon: 'none' });
    this.refresh();
  }
});