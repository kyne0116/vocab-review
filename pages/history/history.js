const store = require('../../utils/store.js');

Page({
  data: {
    records: [],
    accountName: ''
  },
  onShow: function () {
    // 新的批次排前面（当前账号）
    const records = store.getRecords().slice().reverse();
    records.forEach(function (r) { r.open = false; });
    this.setData({
      records: records,
      accountName: store.currentAccount().name
    });
  },
  goStudy: function (e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/study/study?batchId=' + id });
  },
  toggle: function (e) {
    const id = e.currentTarget.dataset.id;
    const records = this.data.records;
    for (let i = 0; i < records.length; i++) {
      if (records[i].batchId === id) {
        const key = 'records[' + i + '].open';
        const obj = {};
        obj[key] = !records[i].open;
        this.setData(obj);
        return;
      }
    }
  }
});
