// 拍照收词：拍照/选图 → OCR 识别 → 勾选（内置命中词禁选，R04）→ 批量查义 → 收录拍照生词本
const store = require('../../utils/store.js');
const ocr = require('../../utils/ocr.js');
const parser = require('../../utils/wordParser.js');
const lookup = require('../../utils/lookup.js');
const junior = require('../../data/junior.js');
const primary = require('../../data/primary.js');

Page({
  data: {
    stage: 'idle',     // idle → recognizing → pick → looking → result → done
    vkOk: true,        // 当前环境是否可进入识别流程（不支持或鸿蒙端为 false）
    ohos: false,       // 鸿蒙端（微信未支持 AI 模块，入口降级提示；方案1 拍板 2026-09-06）
    imageSrc: '',      // 本次识别的图片（预览用）
    candidates: [],    // [{ w, known, checked }]，known=命中内置词库（R04：标灰不可勾选）
    checkedCount: 0,
    progress: { done: 0, total: 0 },
    entries: [],       // [{ w, m, p, ok }]，ok=false 为「待补义」
    okCount: 0,
    addedCount: 0
  },
  onShow: function () {
    // 鸿蒙端微信未支持 AI 模块，VK OCR 必失败（F6 六/七轮实测 2003000）——入口预判走降级提示
    const ohos = ocr.ohos();
    this.setData({ ohos: ohos, vkOk: !ohos && ocr.supported() });
  },

  /* ---------- 拍照 / 选图 ---------- */
  choose: function (e) {
    const source = e.currentTarget.dataset.source; // camera / album
    const that = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: [source],
      sizeType: ['compressed'],
      success: function (res) {
        that.recognizeImage(res.tempFiles[0].tempFilePath);
      },
      fail: function (err) {
        // 用户取消不提示；权限/隐私问题给引导
        const msg = (err && err.errMsg) || '';
        if (msg.indexOf('cancel') !== -1) return;
        wx.showModal({
          title: '无法访问相机或相册',
          content: '请确认已允许小程序使用相机/相册（首次使用微信会弹窗询问；也可在右上角「…」→设置中开启）。',
          showCancel: false
        });
      }
    });
  },

  recognizeImage: function (src) {
    const that = this;
    this.setData({ stage: 'recognizing', imageSrc: src });
    ocr.recognize(src).then(function (lines) {
      const candidates = parser.buildCandidates(lines, junior.concat(primary), store.getPhotoBank())
        .map(function (c) { return { w: c.w, known: c.known, checked: !c.known }; });
      if (!candidates.length) {
        that.setData({ stage: 'idle', imageSrc: '' });
        wx.showModal({
          title: '没有识别到单词',
          content: '试试光线更亮、镜头更稳、距离更近，对准印刷体文字（手写体识别效果差）。',
          showCancel: false
        });
        return;
      }
      that.setData({
        stage: 'pick',
        candidates: candidates,
        checkedCount: candidates.filter(function (c) { return c.checked; }).length
      });
    }).catch(function (err) {
      that.setData({ stage: 'idle', imageSrc: '' });
      wx.showModal({ title: '识别失败', content: (err && err.message) || '请重试', showCancel: false });
    });
  },

  /* ---------- 勾选（R04：内置命中词不可勾选） ---------- */
  toggle: function (e) {
    const idx = e.currentTarget.dataset.idx;
    const c = this.data.candidates[idx];
    if (!c || c.known) return;
    const upd = {};
    upd['candidates[' + idx + '].checked'] = !c.checked;
    upd.checkedCount = this.data.checkedCount + (c.checked ? -1 : 1);
    this.setData(upd);
  },

  /* ---------- 批量查义 ---------- */
  lookupMeanings: function () {
    const words = this.data.candidates.filter(function (c) { return c.checked; })
      .map(function (c) { return c.w; });
    if (!words.length) return;
    const that = this;
    this.setData({ stage: 'looking', progress: { done: 0, total: words.length } });
    lookup.lookupMany(words, function (done, total) {
      that.setData({ progress: { done: done, total: total } });
    }).then(function (rs) {
      that.setData({
        stage: 'result',
        entries: rs,
        okCount: rs.filter(function (r) { return r.ok; }).length
      });
    });
  },

  // 待补义词：单独重试
  retryOne: function (e) {
    const idx = e.currentTarget.dataset.idx;
    const entry = this.data.entries[idx];
    if (!entry || entry.ok) return;
    const that = this;
    lookup.lookup(entry.w).then(function (r) {
      const upd = {};
      upd['entries[' + idx + ']'] = r;
      upd.okCount = that.data.okCount + 1;
      that.setData(upd);
    });
  },

  // 待补义词：手动输入释义
  editMeaning: function (e) {
    const idx = e.currentTarget.dataset.idx;
    const entry = this.data.entries[idx];
    if (!entry) return;
    const that = this;
    wx.showModal({
      title: '补充释义：' + entry.w,
      editable: true,
      placeholderText: '如：n. 苹果',
      success: function (res) {
        if (!res.confirm) return;
        const m = (res.content || '').trim();
        if (!m) return;
        const upd = {};
        upd['entries[' + idx + ']'] = { w: entry.w, m: m, p: entry.p || '', ok: true };
        if (!entry.ok) upd.okCount = that.data.okCount + 1;
        that.setData(upd);
      }
    });
  },

  /* ---------- 收录 ---------- */
  save: function () {
    // 只收录已拿到释义的词；待补义词填入释义后才会进入收录
    const words = this.data.entries.filter(function (x) { return x.ok; })
      .map(function (x) { return { w: x.w, m: x.m, p: x.p }; });
    if (!words.length) {
      wx.showToast({ title: '没有可收录的词，请先补充释义', icon: 'none' });
      return;
    }
    const added = store.addToPhotoBank(words);
    this.setData({ stage: 'done', addedCount: added });
  },

  // 去拍照生词本学习：切账号并回到新单词页
  goStudy: function () {
    store.switchAccount('photo');
    wx.reLaunch({ url: '/pages/new/new' });
  },

  again: function () {
    this.setData({
      stage: 'idle', imageSrc: '', candidates: [], checkedCount: 0,
      progress: { done: 0, total: 0 }, entries: [], okCount: 0, addedCount: 0
    });
  },

  goVkTest: function () { wx.navigateTo({ url: '/pages/vktest/vktest' }); }
});
