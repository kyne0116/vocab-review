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
    batchDots: [],
    versionLine: ''
  },
  onShow: function () {
    this.refresh();
    this.setData({ versionLine: this.buildVersionLine() });
  },
  // 首页底部版本行：代码内镜像版本号（上传时同步修改 app.js）+ 运行渠道（开发/体验/正式版）
  buildVersionLine: function () {
    const g = getApp().globalData;
    let envText = '';
    try {
      const env = wx.getAccountInfoSync().miniProgram.envVersion;
      envText = { develop: '开发版', trial: '体验版', release: '正式版' }[env] || '';
    } catch (e) { /* 低版本基础库无此 API，仅省略渠道 */ }
    return 'v' + g.appVersion + '（' + g.releaseTime + '）' + (envText ? ' · ' + envText : '');
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
  goOverview: function () { wx.navigateTo({ url: '/pages/overview/overview' }); },
  // 词库总量 → 词库页：浏览/搜索当前账号词库；拍照生词本还可在其中删除（R09）
  goBank: function () {
    wx.navigateTo({
      url: '/pages/bank/bank',
      // navigateTo 失败默认静默；显式报错便于区分「包体未含新页面（需完整重编译）」等问题
      fail: function (err) {
        wx.showToast({ title: ((err && err.errMsg) || '打开词库页失败').slice(0, 40), icon: 'none' });
      }
    });
  }
});
