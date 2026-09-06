const store = require('../../utils/store.js');

Page({
  data: {
    batchSize: store.BATCH_SIZE,
    accountName: '',
    accountDesc: '',
    learned: 0,
    batches: 0,
    totalWords: 0,
    dueCount: 0,
    todayItems: 0,
    wrongCount: 0,
    overviewCount: 0,
    overviewPct: 0,
    batchDots: []
  },
  onShow: function () {
    this.refresh();
  },
  refresh: function () {
    const s = store.getStats();
    const ov = store.getOverview();
    const pct = ov.totalWords === 0 ? 0 : Math.round(s.learned / ov.totalWords * 100);
    const dots = ov.batches.map(function (b) {
      return { cls: b.state }; // done / learning / current / todo
    });
    this.setData({
      accountName: s.account.name,
      accountDesc: s.account.desc,
      learned: s.learned,
      batches: s.batches,
      totalWords: s.totalWords,
      dueCount: s.dueCount,
      todayItems: s.todayItems,
      wrongCount: s.wrongCount,
      overviewCount: ov.totalBatches,
      overviewPct: pct,
      batchDots: dots
    });
  },
  onSwitchAccount: function () {
    const accounts = store.getAccounts();
    const names = accounts.map(function (a) { return a.name; });
    const that = this;
    wx.showActionSheet({
      itemList: names,
      success: function (res) {
        const target = accounts[res.tapIndex];
        if (!target || target.id === store.currentAccount().id) return;
        store.switchAccount(target.id);
        wx.showToast({ title: '已切换：' + target.name, icon: 'none' });
        that.refresh();
      }
    });
  },
  goNew: function () { wx.navigateTo({ url: '/pages/new/new' }); },
  goPhoto: function () { wx.navigateTo({ url: '/pages/photo/photo' }); },
  goReview: function () { wx.navigateTo({ url: '/pages/review/review' }); },
  goHistory: function () { wx.navigateTo({ url: '/pages/history/history' }); },
  goWrong: function () { wx.navigateTo({ url: '/pages/wrong/wrong' }); },
  goOverview: function () { wx.navigateTo({ url: '/pages/overview/overview' }); }
});
