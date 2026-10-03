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
    streak: 0,
    pet: null,        // R12 宠物养成
    petBounce: false,
    family: [],       // R13 家庭榜
    currentAccountId: ''
  },
  onShow: function () {
    this.refresh();
    this.checkPetUp(); // R12：检测进化并庆祝
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
      batchDots: dots,
      streak: store.getStreak(),
      pet: store.getPetInfo(),
      family: store.getAccountsOverview(),
      currentAccountId: store.currentAccount().id
    });
  },

  // 家庭榜行点击 = 切换到该账号（R13）
  pickAccount: function (e) {
    const id = e.currentTarget.dataset.id;
    if (!id || id === this.data.currentAccountId) return;
    if (store.switchAccount(id)) {
      wx.showToast({ title: '已切换', icon: 'none', duration: 800 });
      this.refresh();
      this.checkPetUp();
    }
  },

  /* ---------- R12 宠物养成 ---------- */
  // 进化检测：与上次看到的档位（vocab_pet_stage_<accountId>）比较，升档弹庆祝，降档（删词等）静默对齐
  checkPetUp: function () {
    if (!this.data.pet) return;
    const key = 'vocab_pet_stage_' + store.currentAccount().id;
    let last = '';
    try { last = wx.getStorageSync(key); } catch (e) { return; }
    const stage = this.data.pet.stage;
    if (last === '' || last === null) {
      try { wx.setStorageSync(key, stage); } catch (e) { /* 存储失败跳过庆祝检测 */ }
      return;
    }
    if (stage !== last) {
      if (stage > last) {
        const info = this.data.pet;
        wx.showModal({
          title: '🎉 进化时刻',
          content: '啾啾进化为 ' + info.emoji + ' ' + info.name + '！继续带它飞向词海吧！',
          showCancel: false,
          confirmText: '太棒了'
        });
      }
      try { wx.setStorageSync(key, stage); } catch (e) { /* 同上 */ }
    }
  },
  tapPet: function () {
    const that = this;
    this.setData({ petBounce: true });
    setTimeout(function () { that.setData({ petBounce: false }); }, 700);
    const lines = ['今天也要一起背单词哦！', '每学会一个词，我就长大一点点！', '复习做得棒，我最开心啦！', '带我飞向更大的词海吧！'];
    wx.showToast({ title: lines[Math.floor(Math.random() * lines.length)], icon: 'none', duration: 2000 });
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
