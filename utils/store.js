// 核心存储与复习调度逻辑（多账号版）
// 每个账号绑定一个词库，学习进度与记录完全独立
const ACCOUNTS = require('../data/accounts.js');

const BATCH_SIZE = 35;                              // 每批新单词数量
const OFFSETS = [1, 2, 3, 4, 6, 8, 11, 13, 16, 21]; // 10次复习所在天（学习日为第0天）
const FULL_REVIEW_ROUNDS = 3;                       // 前3次复习全部内容，后7次复习遗忘词

const KEY_ACCOUNT = 'vocab_account';                // 当前账号id
const KEY_PHOTO_BANK = 'vocab_photo_bank';          // 拍照生词本动态词库（photo 账号专用）

/* ---------- 账号 ---------- */
function getAccounts() {
  return ACCOUNTS.list;
}
function currentAccount() {
  const id = wx.getStorageSync(KEY_ACCOUNT);
  const list = ACCOUNTS.list;
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i];
  }
  return list[0]; // 默认第一个账号
}
function switchAccount(id) {
  const list = ACCOUNTS.list;
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) {
      wx.setStorageSync(KEY_ACCOUNT, id);
      return true;
    }
  }
  return false;
}

/* ---------- 拍照生词本（动态词库账号） ---------- */
function getPhotoBank() {
  return wx.getStorageSync(KEY_PHOTO_BANK) || [];
}

// 收录拍照词：与已有词去重后追加 { w, m, p, addedAt }，返回实际新增条数
function addToPhotoBank(words) {
  const bank = getPhotoBank();
  const seen = {};
  bank.forEach(function (w) { seen[w.w] = true; });
  const added = [];
  (words || []).forEach(function (w) {
    if (!w || !w.w || seen[w.w]) return;
    seen[w.w] = true;
    added.push({ w: w.w, m: w.m || '', p: w.p || '', addedAt: Date.now() });
  });
  if (added.length) wx.setStorageSync(KEY_PHOTO_BANK, bank.concat(added));
  return added.length;
}

// 当前账号词库：静态账号用绑定词库，动态账号（拍照生词本）读本地存储
function currentBank() {
  const acc = currentAccount();
  return acc.dynamic ? getPhotoBank() : acc.bank;
}

/* ---------- 存取（按账号隔离） ---------- */
function recKey() { return 'vocab_records_' + currentAccount().id; }
function curKey() { return 'vocab_cursor_' + currentAccount().id; }

function getRecords() {
  return wx.getStorageSync(recKey()) || [];
}
function saveRecords(rs) {
  wx.setStorageSync(recKey(), rs);
}
function getCursor() {
  return wx.getStorageSync(curKey()) || 0;
}
function setCursor(c) {
  wx.setStorageSync(curKey(), c);
}

/* ---------- 日期工具 ---------- */
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function strToDate(s) {
  const p = s.split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}
function addDays(dateStr, days) {
  const d = strToDate(dateStr);
  d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
// b - a 的天数差
function diffDays(a, b) {
  return Math.round((strToDate(b) - strToDate(a)) / 86400000);
}

/* ---------- 新单词 ---------- */
// 取下一批单词（按当前账号词库顺序），词库用完返回 null
function nextBatch() {
  const words = currentBank();
  const cursor = getCursor();
  if (cursor >= words.length) return null;
  const list = words.slice(cursor, cursor + BATCH_SIZE);
  return {
    batchNo: getRecords().length + 1,
    start: cursor,
    end: cursor + list.length - 1,
    words: list
  };
}

// 学习完成后记录：日期 + 内容 + 复习进度
function saveLearnedBatch(batch) {
  const rs = getRecords();
  rs.push({
    batchId: 'b' + Date.now(),
    batchNo: rs.length + 1,
    date: todayStr(),
    start: batch.start,
    end: batch.end,
    words: batch.words,        // 内容快照，词库改动不影响历史
    reviewsDone: 0,            // 已完成复习次数（0~10）
    wrongPool: [],             // 遗忘池：做错/忘记的词
    reviewHistory: []          // 每次复习的记录 {date, round, total, wrong}
  });
  saveRecords(rs);
  setCursor(batch.end + 1);
}

/* ---------- 复习调度 ---------- */
// 今天到期的批次（含逾期补做）
function getDueBatches() {
  const today = todayStr();
  return getRecords().filter(function (r) {
    return r.reviewsDone < OFFSETS.length &&
      diffDays(r.date, today) >= OFFSETS[r.reviewsDone];
  });
}

// 构建今天的复习内容：多批到期则合并，重复单词去重
function buildReviewSession() {
  const due = getDueBatches();
  const seen = {};
  const items = [];
  due.forEach(function (r) {
    // 第1~3次复习全部单词；第4次起只复习遗忘池
    const source = r.reviewsDone < FULL_REVIEW_ROUNDS ? r.words : r.wrongPool;
    source.forEach(function (w) {
      if (seen[w.w]) return;
      seen[w.w] = true;
      items.push({ word: w.w, phonetic: w.p, meaning: w.m, batchNo: r.batchNo });
    });
  });
  return { due: due, items: items };
}

// 完成复习：forgotMap = { 单词: true(忘记) }
function finishReview(session, forgotMap) {
  const rs = getRecords();
  session.due.forEach(function (due) {
    const rec = rs.find(function (x) { return x.batchId === due.batchId; });
    if (!rec) return;
    const round = rec.reviewsDone; // 本次是第 round+1 次复习
    let source;
    if (round < FULL_REVIEW_ROUNDS) {
      source = rec.words;
      // 全量复习轮：忘记的词进入遗忘池；答对的词从遗忘池移出（错词本同步移除）
      rec.wrongPool = rec.wrongPool.filter(function (x) { return !!forgotMap[x.w]; });
      source.forEach(function (w) {
        if (forgotMap[w.w] && !rec.wrongPool.some(function (x) { return x.w === w.w; })) {
          rec.wrongPool.push(w);
        }
      });
    } else {
      source = rec.wrongPool;
      // 遗忘词复习轮：答对移出遗忘池，答错保留
      rec.wrongPool = rec.wrongPool.filter(function (w) { return !!forgotMap[w.w]; });
    }
    const total = source.length;
    const wrong = source.filter(function (w) { return !!forgotMap[w.w]; }).length;
    rec.reviewHistory.push({ date: todayStr(), round: round + 1, total: total, wrong: wrong });
    rec.reviewsDone = round + 1;
  });
  saveRecords(rs);
}

/* ---------- 指定批次复习（教程进度页手动点选某一批，不依赖到期调度） ---------- */
function buildBatchReviewSession(batchId) {
  const rec = getRecords().find(function (r) { return r.batchId === batchId; });
  if (!rec) return { due: [], items: [] };
  // 前3次复习全部单词，第4次起复习遗忘池
  const source = rec.reviewsDone < FULL_REVIEW_ROUNDS ? rec.words : rec.wrongPool;
  const items = source.map(function (w) {
    return { word: w.w, phonetic: w.p, meaning: w.m, batchNo: rec.batchNo };
  });
  return { due: [rec], items: items };
}

/* ---------- 错词本（全局聚合各批次遗忘池，按词去重） ---------- */
function getWrongWords() {
  const map = {};
  getRecords().forEach(function (r) {
    r.wrongPool.forEach(function (w) {
      if (!map[w.w]) {
        map[w.w] = { word: w.w, phonetic: w.p || '', meaning: w.m, batches: [] };
      }
      if (map[w.w].batches.indexOf(r.batchNo) === -1) {
        map[w.w].batches.push(r.batchNo);
      }
    });
  });
  return Object.keys(map).map(function (k) { return map[k]; });
}

function inWrongPool(word) {
  return getRecords().some(function (r) {
    return r.wrongPool.some(function (w) { return w.w === word; });
  });
}

// 逐词"我会了"：从所有批次的遗忘池中移除该词
function removeWrongWord(word) {
  const rs = getRecords();
  let removed = 0;
  rs.forEach(function (r) {
    const before = r.wrongPool.length;
    r.wrongPool = r.wrongPool.filter(function (w) { return w.w !== word; });
    removed += before - r.wrongPool.length;
  });
  if (removed > 0) saveRecords(rs);
  return removed;
}

/* ---------- 教程总览（整库批次分章：让用户看到全貌与每批状态） ---------- */
function getOverview() {
  const bank = currentBank();
  const records = getRecords();
  const cursor = getCursor();
  const rounds = OFFSETS.length;
  const totalBatches = Math.ceil(bank.length / BATCH_SIZE);
  const batches = [];
  for (let b = 0; b < totalBatches; b++) {
    const start = b * BATCH_SIZE;
    const end = Math.min(start + BATCH_SIZE, bank.length) - 1;
    const rec = records.find(function (r) { return r.batchNo === b + 1; });
    let state;
    if (rec) {
      state = rec.reviewsDone >= rounds ? 'done' : 'learning';
    } else if (start === cursor) {
      state = 'current'; // 下一批：打开「新单词」就是它
    } else {
      state = 'todo';
    }
    batches.push({
      batchNo: b + 1,
      batchId: rec ? rec.batchId : '',
      start: start,
      end: end,
      count: end - start + 1,
      state: state,
      reviewsDone: rec ? rec.reviewsDone : 0,
      rounds: rounds,
      wrongCount: rec ? rec.wrongPool.length : 0,
      date: rec ? rec.date : '',
      words: bank.slice(start, end + 1),
      reviewHistory: rec ? rec.reviewHistory : []
    });
  }
  return {
    totalBatches: totalBatches,
    totalWords: bank.length,
    learned: cursor,           // 已学到第 cursor 个词
    learnedBatches: records.length,
    currentBatchNo: records.length + 1,
    batches: batches
  };
}

// 移除逐词"我会了"之外，还支持自由复习：答对的词从错词本移出（不推进任何复习次数）
// session 来自 buildFreeReviewSession()，forgotMap = { 单词: true(忘记) }
function finishFreeReview(session, forgotMap) {
  const rs = getRecords();
  let changed = false;
  (session.items || []).forEach(function (it) {
    if (forgotMap[it.word]) return; // 忘记：留在错词本等待后续正式复习
    // 记得：从所有批次遗忘池移除该词（错词本自动移出）
    rs.forEach(function (r) {
      const before = r.wrongPool.length;
      r.wrongPool = r.wrongPool.filter(function (w) { return w.w !== it.word; });
      if (r.wrongPool.length !== before) changed = true;
    });
  });
  if (changed) saveRecords(rs);
}

// 错词本自由复习：把全局错词本（聚合去重）作为自测内容，不依赖到期调度
function buildFreeReviewSession() {
  const items = getWrongWords().map(function (w) {
    return {
      word: w.word,
      phonetic: w.phonetic,
      meaning: w.meaning,
      batchNo: w.batches && w.batches[0] ? w.batches[0] : 0
    };
  });
  return { items: items, free: true };
}

/* ---------- 复习看板（无到期任务时的状态页） ---------- */
function fmtDay(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

// 上次复习：所有批次复习记录里最晚的一次
function getLastReview() {
  let last = null;
  getRecords().forEach(function (r) {
    (r.reviewHistory || []).forEach(function (h) {
      if (!last || h.date > last.date) {
        last = { date: h.date, batchNo: r.batchNo, total: h.total, wrong: h.wrong };
      }
    });
  });
  return last;
}

// 下一次到期：未来最近的一个复习节点（今天无到期时看板显示用）
function getNextDueInfo() {
  const today = todayStr();
  let best = null;
  getRecords().forEach(function (r) {
    if (r.reviewsDone >= OFFSETS.length) return;
    const node = addDays(r.date, OFFSETS[r.reviewsDone]);
    const days = diffDays(today, node);
    if (days > 0 && (!best || days < best.days)) {
      best = { batchNo: r.batchNo, batchId: r.batchId, date: node, days: days };
    }
  });
  return best;
}

// 连续学习天数：有复习记录的连续天（今天未复习不视为断）
function getStreak() {
  const days = {};
  getRecords().forEach(function (r) {
    (r.reviewHistory || []).forEach(function (h) { days[h.date] = true; });
  });
  const d = new Date();
  if (!days[fmtDay(d)]) d.setDate(d.getDate() - 1);
  let s = 0;
  while (days[fmtDay(d)]) { s++; d.setDate(d.getDate() - 1); }
  return s;
}

/* ---------- 统计 ---------- */
function getStats() {
  const rs = getRecords();
  const learned = rs.reduce(function (s, r) { return s + r.words.length; }, 0);
  const session = buildReviewSession();
  return {
    account: currentAccount(),
    batches: rs.length,
    learned: learned,
    totalWords: currentBank().length,
    dueCount: session.due.length,
    todayItems: session.items.length,
    wrongCount: getWrongWords().length
  };
}

module.exports = {
  BATCH_SIZE: BATCH_SIZE,
  OFFSETS: OFFSETS,
  FULL_REVIEW_ROUNDS: FULL_REVIEW_ROUNDS,
  todayStr: todayStr,
  addDays: addDays,
  getAccounts: getAccounts,
  currentAccount: currentAccount,
  switchAccount: switchAccount,
  currentBank: currentBank,
  getPhotoBank: getPhotoBank,
  addToPhotoBank: addToPhotoBank,
  nextBatch: nextBatch,
  saveLearnedBatch: saveLearnedBatch,
  getDueBatches: getDueBatches,
  buildReviewSession: buildReviewSession,
  finishReview: finishReview,
  buildBatchReviewSession: buildBatchReviewSession,
  getRecords: getRecords,
  getStats: getStats,
  getOverview: getOverview,
  buildFreeReviewSession: buildFreeReviewSession,
  finishFreeReview: finishFreeReview,
  getLastReview: getLastReview,
  getNextDueInfo: getNextDueInfo,
  getStreak: getStreak,
  getWrongWords: getWrongWords,
  inWrongPool: inWrongPool,
  removeWrongWord: removeWrongWord
};
