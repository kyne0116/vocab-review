const store = require('../../utils/store.js');

// R24 学习进度页：四格统计（自首页迁移，R23 口径）+ 并行批次十轮时间线明细。
// 数据全部由 store.getParallelBatches / getStats 现算，无独立存储。
Page({
  data: {
    // 四格统计（可点入词库页对应分类清单）
    learned: 0,
    totalWords: 0,
    learning: 0,
    mastered: 0,
    statsTip: '',
    activeCount: 0,
    batches: [],        // 在学批（learning + consolidating），含十轮时间线
    graduatedCount: 0,
    graduatedRows: [],  // 毕业批（默认折叠）
    showGraduated: false
  },
  onShow: function () {
    this.refresh();
  },
  refresh: function () {
    const s = store.getStats();
    const pb = store.getParallelBatches();
    const batches = pb.active.map(function (b) {
      let nextLine = '';
      if (b.state === 'learning') {
        nextLine = '下一轮 ' + b.nextDate.slice(5) + ' · 第 ' + b.nextRound + ' 轮 · ' + b.nextWords + ' 词';
      } else {
        nextLine = '下一轮巩固 ' + b.nextDate.slice(5) + ' · ' + b.nextWords + ' 词';
      }
      if (b.nextOverdueDays > 0) nextLine += '（已逾期 ' + b.nextOverdueDays + ' 天）';
      else if (b.nextDueToday) nextLine += '（今日）';
      const rounds = b.rounds;
      return {
        batchNo: b.batchNo,
        count: b.count,
        dateShort: b.date.slice(5),
        dayN: b.dayN,
        reviewsDone: b.reviewsDone,
        rounds: rounds,
        pct: Math.round(b.reviewsDone / rounds * 100),
        consolidating: b.state === 'consolidating',
        wrongCount: b.wrongCount,
        nextLine: nextLine,
        nextOverdue: b.nextOverdueDays > 0,
        finalShort: b.finalDate.slice(5),
        cells: b.timeline.map(function (t) {
          return {
            round: t.round,
            cons: t.cons,
            status: t.status,
            dateShort: (t.doneDate || t.planDate).slice(5),
            isFinal: !t.cons && t.round === rounds
          };
        })
      };
    });
    const graduatedRows = pb.graduated.map(function (b) {
      const done = b.timeline[b.rounds - 1];
      return {
        batchNo: b.batchNo,
        count: b.count,
        dateShort: b.date.slice(5),
        gradShort: ((done && done.doneDate) || b.finalDate).slice(5)
      };
    });
    // R23 统计动态鼓励行（原首页逻辑迁移，口径不变）
    let statsTip;
    if (s.learned === 0) statsTip = '✨ 学完第一批词，这里就会亮起来';
    else if (s.learning === 0) statsTip = '🎉 全部掌握，词海遨游！';
    else if (s.mastered === 0) statsTip = '🎓 完成十轮复习的词，会毕业到已掌握';
    else statsTip = '💪 再坚持复习，已掌握就会越来越多';
    this.setData({
      learned: s.learned,
      totalWords: s.totalWords,
      learning: s.learning,
      mastered: s.mastered,
      statsTip: statsTip,
      activeCount: pb.activeCount,
      batches: batches,
      graduatedCount: graduatedRows.length,
      graduatedRows: graduatedRows
    });
  },
  toggleGraduated: function () {
    this.setData({ showGraduated: !this.data.showGraduated });
  },
  // 四格 → 词库页分类清单（cat=learned/learning/mastered，空=全部），与词库页 chips 互切
  goBankList: function (e) {
    const cat = e.currentTarget.dataset.cat || '';
    wx.navigateTo({
      url: '/pages/bank/bank' + (cat ? '?filter=' + cat : ''),
      fail: function (err) {
        wx.showToast({ title: ((err && err.errMsg) || '打开词库页失败').slice(0, 40), icon: 'none' });
      }
    });
  }
});
