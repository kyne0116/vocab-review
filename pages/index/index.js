const store = require('../../utils/store.js');

Page({
  data: {
    accountName: '',
    accountDesc: '',
    learned: 0,
    totalWords: 0,
    dueCount: 0,
    todayItems: 0,
    wrongCount: 0,
    overviewCount: 0,
    overviewPct: 0,
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
    // R18：家庭榜加名次（已按已学词数降序，前三奖牌、其后序号）
    const medals = ['🥇', '🥈', '🥉'];
    const family = store.getAccountsOverview().map(function (f, i) {
      f.rank = i < 3 ? medals[i] : String(i + 1);
      return f;
    });
    // R21-B：新单词入口预告（nextBatch 只读推演无副作用：拍照会话优先 → 静态批）
    const nb = store.nextBatch();
    const newPreview = nb
      ? (nb.photo ? '📷 先学拍照批 · ' + nb.words.length + ' 词' : '第 ' + nb.batchNo + ' 批 · ' + nb.words.length + ' 词')
      : '词库已全部学完 🎉';
    // R21-B：复习排期预告（未来两日到期词数；今天无任务时下一节点兜底）
    const fc = store.getReviewForecast(2).filter(function (e) { return e.days > 0; });
    const forecastText = fc.map(function (e) {
      return (e.days === 1 ? '明天 ' : '后天 ') + e.words + ' 词';
    }).join(' · ');
    let reviewDesc;
    if (s.todayItems > 0) {
      reviewDesc = '今天待复习 ' + s.todayItems + ' 词';
    } else if (fc.length) {
      reviewDesc = (fc[0].days === 1 ? '明天' : '后天') + '有 ' + fc[0].words + ' 词到期';
    } else {
      const nd = store.getNextDueInfo();
      reviewDesc = nd ? nd.days + ' 天后有复习任务' : '复习任务已全部完成 🎉';
    }
    this.setData({
      accountName: s.account.name,
      accountDesc: s.account.desc,
      learned: s.learned,
      totalWords: s.totalWords,
      dueCount: s.dueCount,
      todayItems: s.todayItems,
      wrongCount: s.wrongCount,
      overviewCount: ov.totalBatches,
      overviewPct: pct,
      newPreview: newPreview,
      reviewDesc: reviewDesc,
      forecastText: forecastText,
      streak: store.getStreak(),
      pet: store.getPetInfo(),
      family: family,
      currentAccountId: store.currentAccount().id
    });
  },

  // 家庭榜行点击 = 切换到该账号（R13；R18 起为首页唯一的切换入口）
  pickAccount: function (e) {
    const id = e.currentTarget.dataset.id;
    if (!id || id === this.data.currentAccountId) return;
    if (store.switchAccount(id)) {
      const hit = this.data.family.filter(function (f) { return f.id === id; })[0];
      wx.showToast({ title: '已切换：' + (hit ? hit.name : ''), icon: 'none', duration: 1200 });
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
  chooseAccount: function () {
    const that = this;
    wx.showActionSheet({
      itemList: store.getAccounts().map(function (a) { return a.name; }),
      success: function (res) {
        const account = store.getAccounts()[res.tapIndex];
        if (!account || account.id === store.currentAccount().id) return;
        store.switchAccount(account.id);
        that.refresh();
        wx.showToast({ title: '已切换：' + account.name, icon: 'none' });
      }
    });
  },
  resetProgress: function () {
    const that = this;
    wx.showModal({
      title: '重新开始学习？',
      content: '将清空当前账号的学习、复习、错词和拍照收词数据，恢复为教材初始状态。',
      confirmText: '确认初始化',
      confirmColor: '#e64340',
      success: function (res) {
        if (!res.confirm) return;
        store.resetAccountProgress(store.currentAccount().id);
        that.refresh();
        wx.showToast({ title: '已恢复初始状态', icon: 'none' });
      }
    });
  },
  showGuide: function () {
    wx.navigateTo({ url: '/pages/guide/guide' });
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
