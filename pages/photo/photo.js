// 拍照收词：拍照/选图 → 识别（R05-A：智谱 GLM 主路线，失败自动降级 VisionKit）→ 勾选（内置命中词禁选，R04）→ 批量查义 → 收录拍照生词本
const store = require('../../utils/store.js');
const ocr = require('../../utils/ocr.js');
const llm = require('../../utils/llm.js');
const parser = require('../../utils/wordParser.js');
const lookup = require('../../utils/lookup.js');

Page({
  data: {
    stage: 'idle',     // idle → recognizing → pick → looking → result → done
    vkOk: true,        // 当前环境是否具备本地 VK 识别（不支持或鸿蒙端为 false）
    llmOk: false,      // 是否已配置 AI 深度识别（R05-A 主路线；为 true 时入口可用，含鸿蒙端）
    ohos: false,       // 鸿蒙端（VK 不可用；配置 AI 后仍可识别，仅靠网络）
    imageSrc: '',      // 本次识别的图片（预览用）
    recognizeHint: '正在识别图片中的单词…',
    candidates: [],    // [{ w, known, checked }]，known=命中内置词库（R04：标灰不可勾选）
    checkedCount: 0,
    glueCount: 0,      // 被过滤的超长粘连串段数（>0 时候选页提示结果可能不完整）
    progress: { done: 0, total: 0 },
    entries: [],       // [{ w, m, p, ok }]，ok=false 为「待补义」
    okCount: 0,
    addedCount: 0,
    knownCount: 0,     // 候选中「已收录」灰词数（R15 随批学）
    grayCount: 0,      // 本次收录进会话的灰词数（store 实际收录结果）
    totalCount: 0      // 本次拍照会话总词数（新收 + 灰词）
  },
  onShow: function () {
    // 本地 VK：鸿蒙端微信未支持 AI 模块（官方适配指南），入口预判走降级提示
    const ohos = ocr.ohos();
    this.setData({ ohos: ohos, vkOk: !ohos && ocr.supported(), llmOk: llm.configured() });
  },

  /* ---------- 拍照 / 选图 ---------- */
  choose: function (e) {
    const source = e.currentTarget.dataset.source; // camera / album
    const that = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: [source],
      // 保留原图，OCR 层按版面分块压缩；直接使用 compressed 会先损失小字细节
      sizeType: ['original'],
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
    const requestId = (this._recognizeId || 0) + 1;
    this._recognizeId = requestId;
    const llmOk = llm.configured();
    this.setData({
      stage: 'recognizing', imageSrc: src,
      recognizeHint: llmOk ? 'AI 深度识别中…' : '正在识别图片中的单词…'
    });
    // R05-A（2026-10-01）：智谱 GLM 视觉识别为主路线，任何失败（未配置/断网/接口/超时/载荷过大）
    // 自动降级 VisionKit 本地识别；两条路线产出统一走 wordParser 解析与后续流水线。
    const vkRun = function () {
      return ocr.recognize(src, function (current, total) {
        if (that._recognizeId !== requestId) return;
        that.setData({ recognizeHint: '正在识别第 ' + current + '/' + total + ' 个区域…' });
      });
    };
    const run = llmOk
      ? llm.recognize(src).catch(function (err) {
          console.log('[LLM] 主路线失败，降级本地 VK 识别：' + ((err && err.message) || err));
          if (that._recognizeId !== requestId) return Promise.reject(err);
          that.setData({ recognizeHint: 'AI 识别不可用，已切换本地识别…' });
          return vkRun();
        })
      : vkRun();
    run.then(function (result) {
      if (that._recognizeId !== requestId) return;
      // LLM 主路线返回 { words, notes }（R06-A① 自评注记）；VK 降级路线返回裸数组
      const lines = Array.isArray(result) ? result : ((result && result.words) || []);
      const notes = (result && !Array.isArray(result) && result.notes) || {};
      const accId = store.currentAccount().id;
      const queue = store.getAccountPhotoWords(accId);
      // R14：切分词典保持两教材 + 当前队列（识别/粘连还原质量不受账号维度影响）；
      // 「已收录」判定收窄到当前账号（另一教材的词允许收进当前账号）。
      // R15：队列已有词不再隐藏，与教材库已有词一并置灰（随本次拍照会话整体进批学习）
      const builtIn = store.bankOf('junior').concat(store.bankOf('primary'));
      const curSet = {};
      store.bankOf(accId).forEach(function (x) { curSet[x.w.toLowerCase()] = true; });
      queue.forEach(function (x) { curSet[x.w.toLowerCase()] = true; });
      const dict = parser.buildDict(builtIn, [], queue);
      const glue = parser.gluedList(lines, dict);
      const tokens = parser.tokenize(lines, dict);
      const candidates = parser.buildCandidates(lines, builtIn, queue)
        .map(function (c) {
          return { w: c.w, known: !!curSet[c.w.toLowerCase()], checked: !curSet[c.w.toLowerCase()], note: notes[c.w] || '' };
        });
      // [OCR] 诊断日志（回传定性用，定案后随其余 [OCR] 日志一并移除）：
      // 完整呈现 文本→token→候选 链路；已收录词仍展示并计数（R15 置灰随批学）
      console.log('[OCR] 解析 token ' + tokens.length + ' 个：' + tokens.slice(0, 200).join(',') + (tokens.length > 200 ? '…' : ''));
      if (glue.length) {
        console.log('[OCR] 粘连串过滤 ' + glue.length + ' 条：' + glue.slice(0, 8).map(function (g) {
          return g.length > 40 ? g.slice(0, 40) + '…(' + g.length + '字母)' : g;
        }).join(' | '));
      }
      console.log('[OCR] 候选 ' + candidates.length + ' 个（其中已收录置灰 ' + candidates.filter(function (c) { return c.known; }).length + ' 个）：'
        + candidates.map(function (c) { return c.w + (c.known ? '(已收录)' : ''); }).join(','));
      if (!candidates.length) {
        that.setData({ stage: 'idle', imageSrc: '' });
        // 有粘连串被过滤 = 文字被识别但串成长串（文字过小/多列粘连），与「图里没词」引导不同
        wx.showModal({
          title: glue.length ? '识别质量不足' : '没有识别到单词',
          content: glue.length
            ? '图中文字被识别成 ' + glue.length + ' 段连串文字（常见于文字过小或多列词表粘连）。建议用相机对原页面近距离重拍，或换未压缩的原图重试。'
            : '试试光线更亮、镜头更稳、距离更近，对准印刷体文字（手写体识别效果差）。',
          showCancel: false
        });
        return;
      }
      that.setData({
        stage: 'pick',
        candidates: candidates,
        checkedCount: candidates.filter(function (c) { return c.checked; }).length,
        knownCount: candidates.filter(function (c) { return c.known; }).length,
        glueCount: glue.length
      });
    }).catch(function (err) {
      if (that._recognizeId !== requestId) return;
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

  // 候选页点行右侧「修改」改单词（R08③ 2026-10-02：入口自查义结果页前移至此）：
  // 确认后更新候选行并重算「已收录」命中与勾选态；释义由后续「查询释义」统一获取
  editCandidate: function (e) {
    const idx = e.currentTarget.dataset.idx;
    const c = this.data.candidates[idx];
    if (!c) return;
    const that = this;
    wx.showModal({
      title: '修改单词：' + c.w,
      editable: true,
      content: c.w,
      placeholderText: '如：apple',
      success: function (res) {
        if (!res.confirm) return;
        const w = (res.content || '').trim().toLowerCase().replace(/\s+/g, ' ');
        if (!w || w === c.w) return;
        if (!/^[a-z][a-z' \-]*$/.test(w)) {
          return wx.showToast({ title: '仅支持英文单词或短语', icon: 'none' });
        }
        if (that.data.candidates.some(function (x, i) { return i !== idx && x.w === w; })) {
          return wx.showToast({ title: '候选中已有「' + w + '」', icon: 'none' });
        }
        // 与收录同规则：命中当前账号有效库或拍照队列 → 标灰禁选（R15：含队列已有词；
        // R09-2：已删的内置词不算命中），灰词随批学不重复收录
        const known = store.inCurrentBank(w);
        const upd = {};
        upd['candidates[' + idx + ']'] = { w: w, known: known, checked: !known, note: c.note };
        if (c.checked && !known) upd.checkedCount = that.data.checkedCount; // 勾选态保持，计数不变
        else if (c.checked && known) upd.checkedCount = that.data.checkedCount - 1;
        else if (!c.checked && !known) upd.checkedCount = that.data.checkedCount + 1;
        that.setData(upd);
      }
    });
  },

  /* ---------- R06-A②：AI 纠错（带原图核对单词拼写） ---------- */
  // 候选页长按某词 → AI 带图核对，建议不同则弹窗确认替换
  fixCandidate: function (e) {
    const idx = e.currentTarget.dataset.idx;
    const c = this.data.candidates[idx];
    if (!c || !this.data.imageSrc || !llm.configured()) return;
    const that = this;
    wx.showLoading({ title: 'AI 核对中…', mask: true });
    llm.correctWord(this.data.imageSrc, c.w).then(function (r) {
      wx.hideLoading();
      if (!r.w || r.w === c.w) {
        return wx.showModal({ title: 'AI 核对无误', content: r.note || ('「' + c.w + '」与图片一致'), showCancel: false });
      }
      wx.showModal({
        title: 'AI 纠错建议',
        content: '图中单词可能是「' + r.w + '」' + (r.note ? '（' + r.note + '）' : '') + '。是否替换？',
        success: function (res) {
          if (!res.confirm) return;
          if (that.data.candidates.some(function (x) { return x.w === r.w; })) {
            return wx.showToast({ title: '候选中已有「' + r.w + '」', icon: 'none' });
          }
          // 纠错换词与收录同规则：命中当前账号有效库或队列 → 置灰（R15 统一为 inCurrentBank，
          // 修正旧代码误查两教材导致的跨账号误灰）
          const known = store.inCurrentBank(r.w);
          const upd = {};
          upd['candidates[' + idx + ']'] = { w: r.w, known: known, checked: !known, note: r.note || c.note };
          if (c.checked && !known) upd.checkedCount = that.data.checkedCount; // 勾选态保持，计数不变
          else if (c.checked && known) upd.checkedCount = that.data.checkedCount - 1;
          else if (!c.checked && !known) upd.checkedCount = that.data.checkedCount + 1;
          that.setData(upd);
        }
      });
    }).catch(function (err) {
      wx.hideLoading();
      wx.showToast({ title: ((err && err.message) || 'AI 纠错失败').slice(0, 30), icon: 'none' });
    });
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
      // R06-B（AUTO_FIX 开关，默认关）：查义失败词自动拉取 AI 纠错建议——仅展示，点「改用它」才生效
      if (llm.AUTO_FIX && that.data.imageSrc && llm.configured()) {
        let fetched = 0;
        rs.forEach(function (r, i) {
          if (r.ok || fetched >= 5) return;
          fetched++;
          llm.correctWord(that.data.imageSrc, r.w).then(function (fix) {
            if (fix.w && fix.w !== r.w) {
              const upd = {};
              upd['entries[' + i + '].fix'] = fix;
              that.setData(upd);
            }
          }).catch(function () { /* 单词级纠错失败静默，不影响主流程 */ });
        });
      }
    });
  },

  // 用新词（AI 纠错 / AUTO_FIX 建议）替换某词条并重新查义；词条可原为已查义或待补义，okCount 按新旧状态差值增减
  relookupWord: function (idx, word) {
    const that = this;
    return lookup.lookup(word).then(function (r) {
      const old = that.data.entries[idx];
      const upd = {};
      upd['entries[' + idx + ']'] = { w: word, m: r.m || '', p: r.p || '', ok: r.ok };
      const delta = (r.ok ? 1 : 0) - (old && old.ok ? 1 : 0);
      if (delta) upd.okCount = that.data.okCount + delta;
      that.setData(upd);
    });
  },

  // 待补义词：AI 带图纠错（R06-A②）
  fixEntry: function (e) {
    const idx = e.currentTarget.dataset.idx;
    const entry = this.data.entries[idx];
    if (!entry || entry.ok || !this.data.imageSrc || !llm.configured()) return;
    const that = this;
    wx.showLoading({ title: 'AI 核对中…', mask: true });
    llm.correctWord(this.data.imageSrc, entry.w).then(function (r) {
      wx.hideLoading();
      if (!r.w || r.w === entry.w) {
        return wx.showModal({
          title: 'AI 核对无误',
          content: r.note || ('「' + entry.w + '」与图片一致；可点「重试」再查，或换清晰图重拍'),
          showCancel: false
        });
      }
      wx.showModal({
        title: 'AI 纠错建议',
        content: '图中单词可能是「' + r.w + '」' + (r.note ? '（' + r.note + '）' : '') + '。是否用它重新查义？',
        success: function (res) {
          if (res.confirm) that.relookupWord(idx, r.w);
        }
      });
    }).catch(function (err) {
      wx.hideLoading();
      wx.showToast({ title: ((err && err.message) || 'AI 纠错失败').slice(0, 30), icon: 'none' });
    });
  },

  // AUTO_FIX 建议的「改用它」（R06-B）
  applyFix: function (e) {
    const idx = e.currentTarget.dataset.idx;
    const entry = this.data.entries[idx];
    if (!entry || entry.ok || !entry.fix) return;
    this.relookupWord(idx, entry.fix.w);
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
      if (r.ok) upd.okCount = that.data.okCount + 1;
      that.setData(upd);
    });
  },

  /* ---------- 收录 ---------- */
  save: function () {
    // R15：整次拍照 = 一个学习单元。新词 = 已查到释义的勾选词（待补义词仍不收录）；
    // 灰词（「已收录」行）不重复收录，词义音标由 store 从当前账号词库/队列取快照，
    // 与新词一起按照片出现顺序存为一个拍照会话，出批时整体学习
    const entryMap = {};
    this.data.entries.forEach(function (x) { if (x.ok) entryMap[x.w] = x; });
    const list = this.data.candidates
      .filter(function (c) { return c.known || entryMap[c.w]; })
      .map(function (c) {
        return c.known
          ? { w: c.w, gray: true }
          : { w: c.w, m: entryMap[c.w].m, p: entryMap[c.w].p };
      });
    const r = store.savePhotoSession(list);
    if (!r.total) {
      wx.showToast({ title: '没有可收录的词，请先补齐释义', icon: 'none' });
      return;
    }
    this.setData({
      stage: 'done',
      addedCount: r.added,
      grayCount: r.gray,
      totalCount: r.total,
      accName: store.currentAccount().name
    });
  },

  // 去学拍照生词：词已在当前账号队列，直接回新单词页（优先出批）
  goStudy: function () {
    wx.reLaunch({ url: '/pages/new/new' });
  },

  again: function () {
    this._recognizeId = (this._recognizeId || 0) + 1;
    this.setData({
      stage: 'idle', imageSrc: '', recognizeHint: '正在识别图片中的单词…', candidates: [], checkedCount: 0,
      knownCount: 0, glueCount: 0, progress: { done: 0, total: 0 }, entries: [], okCount: 0,
      addedCount: 0, grayCount: 0, totalCount: 0
    });
  }
});
