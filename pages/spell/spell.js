// 默写模式（R13 三期主菜）：看中文拼写英文，错一个字母整词重打（Qwerty Learner 机制）
// 错词自动回队列尾部，须再拼对一次；实时统计首过正确率与打字速度。
const store = require('../../utils/store.js');
const tts = require('../../utils/tts.js');

Page({
  data: {
    batch: null,
    state: 'quiz',      // quiz | done
    queue: [],          // 待拼词队列（错词回尾部）
    word: null,         // 当前词 { w, m, p }
    slots: [],          // 字母槽 [{ filled, cur, space }]
    inputValue: '',
    inputFocus: true,
    total: 0,           // 总词数
    done: 0,            // 已拼对（按词去重）
    firstPass: 0,       // 一次拼对词数
    markedCount: 0,     // R22：本轮拼错过（已记入错词本）的词数
    letters: 0,         // 正确敲入字母数（速度统计）
    startedAt: 0,       // 首次输入时间戳
    wrongFlash: false,
    okFlash: '',
    petEmoji: '🥚',
    speed: 0,
    accuracy: 0
  },

  onLoad: function (opts) {
    const batchId = (opts && opts.batchId) || '';
    const records = store.getRecords();
    let rec = null;
    for (let i = 0; i < records.length; i++) {
      if (records[i].batchId === batchId) { rec = records[i]; break; }
    }
    if (!rec || !rec.words.length) {
      wx.showToast({ title: '未找到该批次', icon: 'none' });
      setTimeout(function () { wx.navigateBack(); }, 800);
      return;
    }
    this.setData({ batch: rec, petEmoji: store.getPetInfo().emoji });
    this.start();
  },

  start: function () {
    this.errorMap = {};     // 单词是否错过（首过统计）
    this.doneMap = {};      // 单词是否已拼对（进度去重）
    const queue = this.data.batch.words.map(function (w) {
      return { w: w.w, m: w.m, p: w.p || '' };
    });
    this.setData({
      queue: queue, total: queue.length, done: 0, firstPass: 0,
      letters: 0, startedAt: 0, speed: 0, state: 'quiz', okFlash: '', wrongFlash: false
    });
    this.next();
  },

  again: function () { this.start(); },

  next: function () {
    const queue = this.data.queue;
    if (!queue.length) return this.finish();
    const word = queue[0];
    this.setData({
      word: word,
      slots: word.w.split('').map(function (ch, i) {
        return { filled: false, cur: i === 0, space: ch === ' ' };
      }),
      inputValue: '',
      okFlash: '',
      wrongFlash: false,
      inputFocus: false
    });
    const that = this;
    setTimeout(function () { that.setData({ inputFocus: true }); }, 60); // 切词后重新挂起键盘
    // 出词即读：自动报读中文释义提示（取首个义项，同报读口径）。
    // 延迟 900ms 是为让上一词拼对时的英文强化朗读先播完（600ms 切词 + 900ms
    // ≈ tts 英文窗口 1500ms），不被中文提示顶掉；拼错重拼同一词不重读。
    if (this.zhTimer) clearTimeout(this.zhTimer);
    const zh = tts.briefText(word.m);
    this.zhTimer = setTimeout(function () { tts.speak(zh, 'zh_CN'); }, 900);
  },

  // 输入比对：前缀逐字符对则点亮槽位；任一位错（或超长）= 整词重打
  onSpellInput: function (e) {
    if (this.data.okFlash || !this.data.word) return;
    const v = e.detail.value || '';
    const target = this.data.word.w;
    if (!v) { this.setData({ inputValue: '' }); return; }
    if (!this.data.startedAt) this.setData({ startedAt: Date.now() });
    let ok = true;
    for (let i = 0; i < v.length; i++) {
      if (v.charAt(i).toLowerCase() !== target.charAt(i).toLowerCase()) { ok = false; break; }
    }
    if (!ok || v.length > target.length) return this.fail();
    if (v.length === target.length) return this.pass();
    const grown = v.length - this.data.inputValue.length;
    this.setData({
      inputValue: v,
      letters: this.data.letters + Math.max(0, grown),
      slots: this.data.slots.map(function (s, i) {
        return { filled: i < v.length, cur: i === v.length, space: s.space };
      })
    });
  },

  pass: function () {
    if (this.zhTimer) { clearTimeout(this.zhTimer); this.zhTimer = null; } // 快速拼对时取消排队的中文提示，先保英文强化音
    const word = this.data.word;
    const target = word.w;
    const grown = target.length - this.data.inputValue.length;
    const firstDone = !this.doneMap[target];
    this.doneMap[target] = true;
    this.setData({
      slots: this.data.slots.map(function (s) {
        return { filled: true, cur: false, space: s.space };
      }),
      okFlash: 'ok',
      letters: this.data.letters + Math.max(0, grown),
      done: this.data.done + (firstDone ? 1 : 0),
      firstPass: this.data.firstPass + (this.errorMap[target] ? 0 : 1)
    });
    tts.speak(target, 'en_US'); // 拼对读一遍强化
    const that = this;
    setTimeout(function () {
      that.setData({ queue: that.data.queue.slice(1) });
      that.next();
    }, 600);
  },

  fail: function () {
    const word = this.data.word;
    if (!this.errorMap[word.w]) {
      this.errorMap[word.w] = true;
      // 错词回队列尾部：本轮内必须再拼对一次
      this.setData({ queue: this.data.queue.concat([word]) });
    }
    try { wx.vibrateShort({ type: 'light', fail: function () {} }); } catch (e) { /* 低版本无此 API */ }
    this.setData({
      wrongFlash: true,
      inputValue: '',
      slots: this.data.slots.map(function (s, i) {
        return { filled: false, cur: i === 0, space: s.space };
      })
    });
    const that = this;
    setTimeout(function () { that.setData({ wrongFlash: false, inputFocus: false }); }, 420);
    setTimeout(function () { that.setData({ inputFocus: true }); }, 480);
  },

  finish: function () {
    const mins = this.data.startedAt ? (Date.now() - this.data.startedAt) / 60000 : 0;
    // R22：拼错过的词（整词重打过的）随本轮结束记入该批遗忘池（进错词本，幂等）；
    // 不推进复习轮次，解除走错词本统一出口
    const wrongs = Object.keys(this.errorMap || {});
    if (wrongs.length) store.markBatchWordsForgot(this.data.batch.batchId, wrongs);
    this.setData({
      state: 'done',
      speed: mins > 0.02 ? Math.round(this.data.letters / mins) : this.data.letters,
      accuracy: this.data.total ? Math.round(this.data.firstPass / this.data.total * 100) : 0,
      markedCount: wrongs.length
    });
  },

  // 听音提示：不想看中文猜的可以听读音（也给拼不出的孩子一个台阶）
  hint: function () {
    if (!this.data.word) return;
    if (this.zhTimer) { clearTimeout(this.zhTimer); this.zhTimer = null; } // 用户主动要听英文，取消排队的中文提示
    tts.speak(this.data.word.w, 'en_US');
  },

  // 点击中文释义：再读一遍提示（出词自动读的重听入口）
  readMeaning: function () {
    if (!this.data.word) return;
    if (this.zhTimer) { clearTimeout(this.zhTimer); this.zhTimer = null; }
    tts.speak(tts.briefText(this.data.word.m), 'zh_CN');
  },
  goBack: function () { wx.navigateBack(); },
  onUnload: function () {
    if (this.zhTimer) { clearTimeout(this.zhTimer); this.zhTimer = null; } // 防离页后中文提示仍触发
    tts.stopSpoken();
  }
});
