// F6 最小验证页：真机实测 VisionKit 静态图 OCR 印刷体识别率（临时页面，验证完成后移除）
// 使用方式：开发者工具「预览」→ 真机扫码进入 → 首页「拍照收词」→ 底部「识别能力验证页」
const ocr = require('../../utils/ocr.js');

Page({
  data: {
    sdk: '',        // 基础库版本
    v1: null,       // wx.isVKSupport('v1') 结果
    v2: null,       // wx.isVKSupport('v2') 结果
    vkOk: null,     // ocr.supported() 综合判定
    device: '',     // 手机品牌+型号（F6 第四轮起自动上报）
    system: '',     // 操作系统及版本（是否鸿蒙的关键判据）
    wechat: '',     // 微信客户端版本
    imageSrc: '',
    running: false,
    elapsed: 0,     // 识别耗时（毫秒）
    lines: [],      // 识别文本行
    error: ''
  },
  onLoad: function () {
    // isVKSupport 参数只有 'v1'/'v2'（查 VK 版本支持）；OCR 门槛 = 基础库 ≥ 2.27.0
    const info = ocr.vkInfo();
    this.setData({ sdk: info.sdk, v1: info.v1, v2: info.v2, vkOk: ocr.supported() });
    // 机型自动上报（F6 第四轮）：errno=2003000 定位需要机型/系统信息（OpenHarmony 有 OCR 失败先例），
    // 人工回传三轮未果，改为复制结果自带，避免再漏。
    let dev = {};
    try {
      dev = (wx.getDeviceInfo && wx.getDeviceInfo()) ||
            (wx.getSystemInfoSync && wx.getSystemInfoSync()) || {};
    } catch (e) { dev = {}; }
    let wechat = '';
    try { wechat = (wx.getAppBaseInfo && wx.getAppBaseInfo().version) || ''; } catch (e) {}
    this.setData({
      device: [dev.brand, dev.model].filter(Boolean).join(' '),
      system: dev.system || '',
      wechat: wechat
    });
  },

  choose: function (e) {
    const source = e.currentTarget.dataset.source;
    const that = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: [source],
      sizeType: ['compressed'],
      success: function (res) { that.run(res.tempFiles[0].tempFilePath); },
      fail: function (err) {
        const msg = (err && err.errMsg) || '';
        if (msg.indexOf('cancel') !== -1) return;
        that.setData({ error: '选图失败：' + msg });
      }
    });
  },

  run: function (src) {
    const that = this;
    const t0 = Date.now();
    this.setData({ running: true, imageSrc: src, lines: [], elapsed: 0, error: '' });
    ocr.recognize(src).then(function (lines) {
      that.setData({ running: false, elapsed: Date.now() - t0, lines: lines });
    }).catch(function (err) {
      that.setData({ running: false, elapsed: Date.now() - t0, error: (err && err.message) || String(err) });
    });
  },

  // 一键复制验证结果（手机上直接粘贴回传给开发者）
  copyResult: function () {
    const d = this.data;
    const text = [
      'VK OCR 验证结果（F6）',
      '时间: ' + new Date().toLocaleString(),
      '基础库: ' + d.sdk,
      '手机: ' + (d.device || '未知'),
      '系统: ' + (d.system || '未知'),
      '微信: ' + (d.wechat || '未知'),
      "isVKSupport('v1'): " + d.v1,
      "isVKSupport('v2'): " + d.v2,
      'supported(): ' + d.vkOk,
      '耗时(ms): ' + d.elapsed,
      '识别行数: ' + d.lines.length,
      d.error ? '错误: ' + d.error : '',
      '---- 识别内容 ----',
      d.lines.join('\n')
    ].filter(function (s) { return s !== ''; }).join('\n');
    wx.setClipboardData({ data: text });
  }
});
