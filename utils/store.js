// 核心存储与复习调度逻辑（多账号版）
// 每个账号绑定一个词库，学习进度与记录完全独立
const ACCOUNTS = require('../data/accounts.js');

const BATCH_SIZE = 35;                              // 每批新单词数量
const OFFSETS = [1, 2, 3, 4, 6, 8, 11, 13, 16, 21]; // 10次复习所在天（学习日为第0天）
const FULL_REVIEW_ROUNDS = 3;                       // 前3次复习全部内容，后7次复习遗忘词

const KEY_ACCOUNT = 'vocab_account';                // 当前账号id
// R14：拍照生词并入当前账号，原独立 photo 账号退役。以下为迁移源键（旧 photo 账号
// 数据，migratePhotoAccount 读取；迁移后保留不删 + 标记防重跑，误迁可换目标重跑）
const KEY_PHOTO_BANK = 'vocab_photo_bank';
const KEY_PHOTO_RECORDS = 'vocab_records_photo';

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

/* ---------- 拍照生词（R14：并入当前账号的优先学习队列，原独立 photo 账号退役） ---------- */
// 每个真人账号自己的队列 vocab_photo_words_<accountId>（{ w, m, p, addedAt }）；
// 未学拍照词在 nextBatch 中优先于静态教材词（保持「拍了就学」），学完自动回落教材顺序。
function photoWordsKey(id) { return 'vocab_photo_words_' + id; }

function getAccountPhotoWords(id) {
  return wx.getStorageSync(photoWordsKey(id)) || [];
}

// 收录拍照词到当前账号：与该账号有效静态库、已有队列去重后追加，返回实际新增条数
function addToAccountPhoto(words) {
  const acc = currentAccount();
  const queue = getAccountPhotoWords(acc.id);
  const seen = {};
  bankOf(acc.id).forEach(function (x) { seen[x.w.toLowerCase()] = true; });
  queue.forEach(function (x) { seen[x.w.toLowerCase()] = true; });
  const added = [];
  (words || []).forEach(function (w) {
    if (!w || !w.w || seen[w.w.toLowerCase()]) return;
    seen[w.w.toLowerCase()] = true;
    added.push({ w: w.w, m: w.m || '', p: w.p || '', addedAt: Date.now() });
  });
  if (added.length) wx.setStorageSync(photoWordsKey(acc.id), queue.concat(added));
  return added.length;
}

// 当前账号未学拍照词（队列中尚未进入任何批次快照的词）
function unlearnedPhotoWords() {
  const learned = {};
  getRecords().forEach(function (r) {
    r.words.forEach(function (x) { learned[x.w] = true; });
  });
  return getAccountPhotoWords(currentAccount().id).filter(function (x) { return !learned[x.w]; });
}

// 当前账号「已收录」判定（拍照页标灰用）：有效静态库或本账号队列命中（忽略大小写）
function inCurrentBank(word) {
  const w = (word || '').toLowerCase();
  if (!w) return false;
  if (currentBank().some(function (x) { return x.w.toLowerCase() === w; })) return true;
  return getAccountPhotoWords(currentAccount().id).some(function (x) { return x.w.toLowerCase() === w; });
}

// R14 一次性迁移：旧「拍照生词本」账号（词库 + 学习记录）并入目标账号。
// 未学词 → 目标账号队列；学习记录（快照/遗忘池/复习历史）追加进目标账号，批次号
// 接续重排、batchId 重生成避免冲突。源键保留不删 + vocab_photo_migrated 标记防重跑。
// 迁移了数据返回 true；无数据或已迁移返回 false。
function migratePhotoAccount(targetId) {
  if (wx.getStorageSync('vocab_photo_migrated')) return false;
  const bank = wx.getStorageSync(KEY_PHOTO_BANK);
  const rs = wx.getStorageSync(KEY_PHOTO_RECORDS);
  const hasBank = bank && bank.length;
  const hasRecords = rs && rs.length;
  if (!hasBank && !hasRecords) {
    wx.setStorageSync('vocab_photo_migrated', true);
    return false;
  }
  // ① 未学词并入目标队列（跳过目标静态库 / 队列已有的词，以及随记录迁移的已学词）
  const seen = {};
  bankOf(targetId).forEach(function (x) { seen[x.w.toLowerCase()] = true; });
  const queue = getAccountPhotoWords(targetId);
  queue.forEach(function (x) { seen[x.w.toLowerCase()] = true; });
  if (hasBank) {
    const migratedLearned = {};
    rs.forEach(function (rec) {
      rec.words.forEach(function (x) { migratedLearned[x.w] = true; });
    });
    bank.forEach(function (x) {
      if (!x || !x.w || seen[x.w.toLowerCase()] || migratedLearned[x.w]) return;
      seen[x.w.toLowerCase()] = true;
      queue.push({ w: x.w, m: x.m || '', p: x.p || '', addedAt: x.addedAt || Date.now() });
    });
    wx.setStorageSync(photoWordsKey(targetId), queue);
  }
  // ② 学习记录追加进目标账号（start/end 置 -1 表示拍照来源，不占静态游标语义）
  if (hasRecords) {
    const target = wx.getStorageSync('vocab_records_' + targetId) || [];
    let no = target.length;
    rs.forEach(function (rec) {
      no++;
      target.push({
        batchId: 'm' + no + '-' + rec.batchId,
        batchNo: no,
        date: rec.date,
        start: -1,
        end: -1,
        words: rec.words,
        reviewsDone: rec.reviewsDone,
        wrongPool: rec.wrongPool,
        reviewHistory: rec.reviewHistory || []
      });
    });
    wx.setStorageSync('vocab_records_' + targetId, target);
  }
  wx.setStorageSync('vocab_photo_migrated', true);
  return true;
}

// 词库页数据（R09）：当前账号词条附学习状态，状态从批次快照反查
// （收录/词库内无重复，一词至多属于一个批次）。batchNo=0 表示待学习。
// 拍照与静态账号通用（R09-2：全账号可删）。
function getBankEntries() {
  const status = {};
  getRecords().forEach(function (rec) {
    rec.words.forEach(function (x) {
      status[x.w] = { batchNo: rec.batchNo, done: rec.reviewsDone >= OFFSETS.length };
    });
  });
  return currentBank().map(function (x) {
    const st = status[x.w];
    return {
      w: x.w, m: x.m, p: x.p, addedAt: x.addedAt,
      learned: !!st,
      batchNo: st ? st.batchNo : 0,
      done: st ? st.done : false
    };
  }).concat(getAccountPhotoWords(currentAccount().id).map(function (x) {
    // R14：拍照词附在静态词之后，状态同样快照反查；photo=true 供词库页打「拍照」标
    const st = status[x.w];
    return {
      w: x.w, m: x.m, p: x.p, addedAt: x.addedAt,
      learned: !!st,
      batchNo: st ? st.batchNo : 0,
      done: st ? st.done : false,
      photo: true
    };
  }));
}

/* ---------- 词库（含静态库软删除，R09-2：全账号可删） ---------- */
// 静态词库是源文件不可改，删除词记录在 vocab_deleted_<accountId>（词数组），
// 加载时过滤；photo 账号 bank 本就在存储中，直接改写、无需软删除。
function getDeletedSet(id) {
  const set = {};
  (wx.getStorageSync('vocab_deleted_' + id) || []).forEach(function (w) { set[w] = true; });
  return set;
}

// 指定账号的有效词库（静态 = 绑定词库过滤已删词）
function bankOf(id) {
  const list = ACCOUNTS.list;
  for (let i = 0; i < list.length; i++) {
    if (list[i].id !== id) continue;
    const del = getDeletedSet(list[i].id);
    return list[i].bank.filter(function (x) { return !del[x.w]; });
  }
  return [];
}

// 当前账号词库
function currentBank() {
  return bankOf(currentAccount().id);
}

// 词库页删除词条（当前账号，R09-2 + R14）：待学词移出后续学习；已学词联动清理
// （批次快照 words 与遗忘池移除，复习与错词本自动不含，reviewHistory 历史保留）。
// 静态词 = 软删除 + 游标左移；拍照词 = 从队列真实移除（不动静态游标）。
// 返回 { removed, learned } 供页面提示。
function removeWords(words) {
  const acc = currentAccount();
  const set = {};
  (words || []).forEach(function (x) {
    const w = typeof x === 'string' ? x : (x && x.w);
    if (w) set[w] = true;
  });
  if (!Object.keys(set).length) return { removed: 0, learned: 0 };
  // 拍照词队列：真实移除（已学快照过滤在下方统一处理）
  const queue = getAccountPhotoWords(acc.id);
  const keptQ = queue.filter(function (x) { return !set[x.w]; });
  if (keptQ.length !== queue.length) wx.setStorageSync(photoWordsKey(acc.id), keptQ);
  // 静态词库：软删除
  const bank = currentBank();
  const kept = bank.filter(function (x) { return !set[x.w]; });
  if (kept.length !== bank.length) {
    const del = getDeletedSet(acc.id);
    bank.forEach(function (x) { if (set[x.w]) del[x.w] = true; });
    wx.setStorageSync('vocab_deleted_' + acc.id, Object.keys(del));
  }
  // 已学静态词删除 → 游标左移（删除数）；已学拍照词删除 → 不动游标，仅计入提示
  const cursor = getCursor();
  let learned = 0;
  for (let i = 0; i < Math.min(cursor, bank.length); i++) {
    if (set[bank[i].w]) learned++;
  }
  const snapSet = {};
  getRecords().forEach(function (r) { r.words.forEach(function (x) { snapSet[x.w] = true; }); });
  const queueLearned = queue.filter(function (x) { return set[x.w] && snapSet[x.w]; }).length;
  if (learned || queueLearned) {
    if (learned) setCursor(cursor - learned);
    const rs = getRecords();
    rs.forEach(function (rec) {
      rec.words = rec.words.filter(function (x) { return !set[x.w]; });
      rec.wrongPool = rec.wrongPool.filter(function (x) { return !set[x.w]; });
    });
    saveRecords(rs);
  }
  return {
    removed: (bank.length - kept.length) + (queue.length - keptQ.length),
    learned: learned + queueLearned
  };
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
// 取下一批单词：R14 起当前账号未学拍照词优先成批（「拍了就学」），队列空后回落
// 静态词库顺序（游标推进）。词库与队列都用完返回 null。
function nextBatch() {
  const fresh = unlearnedPhotoWords();
  if (fresh.length) {
    const list = fresh.slice(0, BATCH_SIZE);
    return {
      batchNo: getRecords().length + 1,
      start: -1, end: -1, // 拍照批不占静态游标
      words: list,
      photo: true
    };
  }
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
  if (!batch.photo) setCursor(batch.end + 1); // 拍照批不动静态游标（R14）
}

/* ---------- 复习调度 ---------- */
// 今天到期的批次（含逾期补做）
function getDueBatches() {
  const today = todayStr();
  return getRecords().filter(function (r) {
    // R09：整批词条被删除后（words 与遗忘池皆空）不再产生到期任务
    if (r.words.length === 0 && r.wrongPool.length === 0) return false;
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
// R09：已学批次直接按记录快照成章（删除词条后仍与实际复习内容一致，也修复了
// 拍照本「末批不满后再收录」时旧算法按词库下标重切导致的错位）；待学批次从游标
// 起按 35 词切分，首个待学批为当前批。编号在快照/词库间连续累计，静态账号
// （词库不变、批次恒满 35）输出与旧算法一致。
function getOverview() {
  const bank = currentBank();
  const records = getRecords();
  const cursor = getCursor();
  const rounds = OFFSETS.length;
  const batches = [];
  let idx = 0;
  records.forEach(function (rec) {
    batches.push({
      batchNo: rec.batchNo,
      batchId: rec.batchId,
      start: idx,
      end: idx + rec.words.length - 1,
      count: rec.words.length,
      state: rec.reviewsDone >= rounds ? 'done' : 'learning',
      reviewsDone: rec.reviewsDone,
      rounds: rounds,
      wrongCount: rec.wrongPool.length,
      date: rec.date,
      words: rec.words,
      reviewHistory: rec.reviewHistory
    });
    idx += rec.words.length;
  });
  // 待学批与 nextBatch 一致：拍照词独立成批（优先），静态词另起批次，不混批（R14）
  const photoPending = unlearnedPhotoWords();
  const staticPending = bank.slice(cursor);
  function pushPending(list) {
    for (let p = 0; p < list.length; p += BATCH_SIZE) {
      const count = Math.min(BATCH_SIZE, list.length - p);
      batches.push({
        batchNo: batches.length + 1,
        batchId: '',
        start: idx,
        end: idx + count - 1,
        count: count,
        state: batches.length === records.length ? 'current' : 'todo', // 首个待学批：打开「新单词」就是它
        reviewsDone: 0,
        rounds: rounds,
        wrongCount: 0,
        date: '',
        words: list.slice(p, p + BATCH_SIZE),
        reviewHistory: []
      });
      idx += count;
    }
  }
  pushPending(photoPending);
  pushPending(staticPending);
  const pending = photoPending.concat(staticPending);
  const totalWords = bank.length + getAccountPhotoWords(currentAccount().id).length;
  return {
    totalBatches: batches.length,
    totalWords: totalWords,
    learned: totalWords - pending.length, // R14：含已学拍照词（静态游标只覆盖教材词）
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

// 学习日历（R11 打卡）：所有有学习（批次创建日）或复习记录的日期，'YYYY-MM-DD' 升序去重数组
function getActiveDays() {
  const days = {};
  getRecords().forEach(function (r) {
    days[r.date] = true;
    (r.reviewHistory || []).forEach(function (h) { days[h.date] = true; });
  });
  return Object.keys(days).sort();
}

/* ---------- 宠物养成（R12，R11 二期）：纯本地正向激励 ---------- */
// 成长驱动 = 当前账号累计已学词数（各批快照 words 之和）；只升不降展示，词删除导致
// 的档位回落由页面静默对齐存量记录。门槛参数为拍脑袋的趣味值，可调。
var PET_STAGES = [
  { min: 0,   emoji: '🥚', name: '蛋·沉睡中' },
  { min: 35,  emoji: '🐣', name: '破壳' },
  { min: 105, emoji: '🐥', name: '幼崽' },
  { min: 210, emoji: '🐤', name: '少年' },
  { min: 350, emoji: '🐦', name: '成年' },
  { min: 560, emoji: '🦅', name: '传说' }
];

// 当前账号宠物状态：{ stage, emoji, name, learned, nextEmoji, nextName, remaining, pct, maxed }
function getPetInfo() {
  const learned = getRecords().reduce(function (s, r) { return s + r.words.length; }, 0);
  let stage = 0;
  for (let i = 0; i < PET_STAGES.length; i++) {
    if (learned >= PET_STAGES[i].min) stage = i;
  }
  const cur = PET_STAGES[stage];
  const nxt = PET_STAGES[stage + 1] || null;
  const pct = nxt
    ? Math.min(100, Math.round((learned - cur.min) / (nxt.min - cur.min) * 100))
    : 100;
  return {
    stage: stage,
    emoji: cur.emoji,
    name: cur.name,
    learned: learned,
    nextEmoji: nxt ? nxt.emoji : '',
    nextName: nxt ? nxt.name : '',
    remaining: nxt ? nxt.min - learned : 0,
    pct: pct,
    maxed: !nxt
  };
}

/* ---------- 家庭榜（R13：不切账号读取各账号进度） ---------- */
// 各账号 { id, name, dynamic, learned, streak, petEmoji }，按已学词数降序；
// streak 与 getStreak 同算法、pet 档位与 getPetInfo 同门槛，仅数据源改为指定账号的存储键
function getAccountsOverview() {
  return ACCOUNTS.list.map(function (acc) {
    const rs = wx.getStorageSync('vocab_records_' + acc.id) || [];
    const learned = rs.reduce(function (s, r) { return s + r.words.length; }, 0);
    const days = {};
    rs.forEach(function (r) {
      (r.reviewHistory || []).forEach(function (h) { days[h.date] = true; });
    });
    const d = new Date();
    if (!days[fmtDay(d)]) d.setDate(d.getDate() - 1);
    let streak = 0;
    while (days[fmtDay(d)]) { streak++; d.setDate(d.getDate() - 1); }
    let stage = 0;
    for (let i = 0; i < PET_STAGES.length; i++) {
      if (learned >= PET_STAGES[i].min) stage = i;
    }
    return {
      id: acc.id,
      name: acc.name,
      learned: learned,
      streak: streak,
      petEmoji: PET_STAGES[stage].emoji
    };
  }).sort(function (a, b) { return b.learned - a.learned; });
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
    totalWords: currentBank().length + getAccountPhotoWords(currentAccount().id).length,
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
  bankOf: bankOf,
  removeWords: removeWords,
  getAccountPhotoWords: getAccountPhotoWords,
  addToAccountPhoto: addToAccountPhoto,
  unlearnedPhotoWords: unlearnedPhotoWords,
  inCurrentBank: inCurrentBank,
  migratePhotoAccount: migratePhotoAccount,
  getBankEntries: getBankEntries,
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
  getActiveDays: getActiveDays,
  getPetInfo: getPetInfo,
  getAccountsOverview: getAccountsOverview,
  PET_STAGES: PET_STAGES,
  getWrongWords: getWrongWords,
  inWrongPool: inWrongPool,
  removeWrongWord: removeWrongWord
};
