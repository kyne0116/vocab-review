const store = require('../../utils/store.js');

Page({
  data: {
    accountName: '',
    accountDesc: '',
    streak: 0,
    // R24 Hero：今日学习三态（todo / done / graduated）与任务构成
    mission: null,
    tomorrowText: '',
    // R24 学习进度卡：并行批次摘要（最多展示 3 行，点入进度页看时间线明细）
    activeCount: 0,
    progressRows: [],
    pet: null,        // R12 宠物养成
    petBounce: false,
    wrongCount: 0,
    family: [],       // R13 家庭榜
    currentAccountId: ''
  },
  onShow: function () {
    this.refresh();
    this.checkPetUp(); // R12：检测进化并庆祝
  },
  refresh: function () {
    const s = store.getStats();
    const m = store.getTodayMission();
    // R18：家庭榜加名次（已按已学词数降序，前三奖牌、其后序号）
    const medals = ['🥇', '🥈', '🥉'];
    const family = store.getAccountsOverview().map(function (f, i) {
      f.rank = i < 3 ? medals[i] : String(i + 1);
      return f;
    });
    // R24 明日预告文案：明天/后天/N天后 · 第X批第N轮（>10 为巩固轮）· 词数
    let tomorrowText = '';
    if (m.tomorrow) {
      const when = m.tomorrow.days === 1 ? '明天' : (m.tomorrow.days === 2 ? '后天' : m.tomorrow.days + ' 天后');
      const round = m.tomorrow.round > store.OFFSETS.length ? '巩固轮' : '第 ' + m.tomorrow.round + ' 轮';
      tomorrowText = when + '：第 ' + m.tomorrow.batchNo + ' 批 ' + round + ' · ' + m.tomorrow.words + ' 词';
    }
    // R24 进度卡行：批号 · 第X天 · X/10轮 · 状态点（逾期红/今日绿/巩固紫）· 毕业 MM-DD
    const pb = store.getParallelBatches();
    const progressRows = pb.active.slice(0, 3).map(function (b) {
      let flag = '';
      if (b.state === 'consolidating') flag = b.nextDueToday ? '巩固 · 今日' : '巩固中';
      else if (b.nextDueToday) flag = b.nextOverdueDays > 0 ? '逾期 ' + b.nextOverdueDays + ' 天' : '今日第 ' + b.nextRound + ' 轮';
      return {
        batchNo: b.batchNo,
        dayN: b.dayN,
        reviewsDone: b.reviewsDone,
        rounds: b.rounds,
        pct: Math.round(b.reviewsDone / b.rounds * 100),
        flag: flag,
        overdue: b.nextDueToday && b.nextOverdueDays > 0,
        finalShort: b.finalDate.slice(5),
        consolidating: b.state === 'consolidating'
      };
    });
    this.setData({
      accountName: s.account.name,
      accountDesc: s.account.desc,
      streak: store.getStreak(),
      mission: m,
      tomorrowText: tomorrowText,
      activeCount: pb.activeCount,
      progressRows: progressRows,
      pet: store.getPetInfo(),
      wrongCount: s.wrongCount,
      family: family,
      currentAccountId: store.currentAccount().id
    });
  },

  // R24 Hero 主按钮：先做到期复习，复习完由复习页衔接进新单词页；无到期直接学新
  goToday: function () {
    const m = this.data.mission;
    if (!m) return;
    if (m.hasReview) {
      wx.navigateTo({ url: '/pages/review/review?today=1' });
    } else if (m.hasNew) {
      wx.navigateTo({ url: '/pages/new/new' });
    }
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
  // 头部卡「切换账号 ▸」只负责滚动到家庭榜，切换仍由家庭榜行点按完成（R18）
  goFamily: function () {
    wx.pageScrollTo({ selector: '.family-card', duration: 300 });
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
  goProgress: function () { wx.navigateTo({ url: '/pages/progress/progress' }); },
  goPhoto: function () { wx.navigateTo({ url: '/pages/photo/photo' }); },
  goHistory: function () { wx.navigateTo({ url: '/pages/history/history' }); },
  goWrong: function () { wx.navigateTo({ url: '/pages/wrong/wrong' }); },
  goOverview: function () { wx.navigateTo({ url: '/pages/overview/overview' }); },
  goBank: function () { wx.navigateTo({ url: '/pages/bank/bank' }); }
});
