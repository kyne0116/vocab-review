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

/* ---------- 拍照生词（R14：并入当前账号；R15：拍照会话整体出批） ---------- */
// 每个真人账号两条存储：队列 vocab_photo_words_<accountId>（{ w, m, p, addedAt }，去重与
// 词库页展示）+ 拍照会话 vocab_photo_sessions_<accountId>（{ id, createdAt, words }，一次
// 拍照的完整词单，含已收录灰词快照）。nextBatch 以会话为单位整体出批（「拍了就学」，
// R15 起不受 BATCH_SIZE 限制），学完由 saveLearnedBatch 移除会话，全部学完回落教材顺序。
function photoWordsKey(id) { return 'vocab_photo_words_' + id; }
function photoSessionsKey(id) { return 'vocab_photo_sessions_' + id; }

function getAccountPhotoWords(id) {
  return wx.getStorageSync(photoWordsKey(id)) || [];
}

// 会话键首次读取时初始化：R14 遗留的未学队列词自动包成一个历史会话（继续优先学习）
function getPhotoSessions(id) {
  const v = wx.getStorageSync(photoSessionsKey(id));
  if (v !== '' && v !== null && v !== undefined) return v;
  const rs = wx.getStorageSync('vocab_records_' + id) || [];
  const learned = {};
  rs.forEach(function (r) { r.words.forEach(function (x) { learned[x.w] = true; }); });
  const pending = (wx.getStorageSync(photoWordsKey(id)) || []).filter(function (x) { return !learned[x.w]; });
  const init = pending.length ? [{ id: 'legacy-' + id, createdAt: Date.now(), words: pending }] : [];
  wx.setStorageSync(photoSessionsKey(id), init);
  return init;
}

// R15：收录一次拍照 = 建立一个「拍照会话」。list = [{ w, gray?, m?, p? }]（候选页出现顺序）：
// 新词（gray 空）与有效库/队列去重后入队列并进会话；灰词不入队列、不重复收录，词义音标
// 从当前账号词库/队列取快照（不耗查义额度）。返回 { added, gray, total }，total=0 = 无可收录。
function savePhotoSession(list) {
  const acc = currentAccount();
  const bank = bankOf(acc.id);
  const queue = getAccountPhotoWords(acc.id);
  const seen = {};
  bank.forEach(function (x) { seen[x.w.toLowerCase()] = true; });
  queue.forEach(function (x) { seen[x.w.toLowerCase()] = true; });
  function findSaved(w) {
    const lw = (w || '').toLowerCase();
    for (var i = 0; i < bank.length; i++) if (bank[i].w.toLowerCase() === lw) return bank[i];
    for (var j = 0; j < queue.length; j++) if (queue[j].w.toLowerCase() === lw) return queue[j];
    return null;
  }
  const words = [];
  const added = [];
  let gray = 0;
  (list || []).forEach(function (it) {
    if (!it || !it.w) return;
    const lw = it.w.toLowerCase();
    if (it.gray) {
      const src = findSaved(it.w);
      if (!src) return; // 词库/队列已无此词（如收录前被删）→ 跳过
      gray++;
      words.push({ w: src.w, m: src.m || '', p: src.p || '' });
      return;
    }
    if (seen[lw]) return;
    seen[lw] = true;
    added.push({ w: it.w, m: it.m || '', p: it.p || '', addedAt: Date.now() });
    words.push({ w: it.w, m: it.m || '', p: it.p || '' });
  });
  if (added.length) wx.setStorageSync(photoWordsKey(acc.id), queue.concat(added));
  if (!words.length) return { added: 0, gray: 0, total: 0 };
  const sessions = getPhotoSessions(acc.id);
  sessions.push({ id: 's' + Date.now() + '-' + sessions.length, createdAt: Date.now(), words: words });
  wx.setStorageSync(photoSessionsKey(acc.id), sessions);
  return { added: added.length, gray: gray, total: words.length };
}

// 纯新词收录（等价于 savePhotoSession 全新词；保留旧入口兼容迁移等调用）
function addToAccountPhoto(words) {
  return savePhotoSession(words || []).added;
}

// 当前账号未学拍照词（队列中尚未进入任何批次快照的词；R15 后出批由会话驱动，本函数
// 仅用于队列体检与迁移断言）
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
    const migratedUnlearned = [];
    bank.forEach(function (x) {
      if (!x || !x.w || seen[x.w.toLowerCase()] || migratedLearned[x.w]) return;
      seen[x.w.toLowerCase()] = true;
      queue.push({ w: x.w, m: x.m || '', p: x.p || '', addedAt: x.addedAt || Date.now() });
      migratedUnlearned.push({ w: x.w, m: x.m || '', p: x.p || '' });
    });
    wx.setStorageSync(photoWordsKey(targetId), queue);
    // R15：会话键已初始化时迁移的未学词同步包成会话；未初始化则由首次读取的
    // legacy 初始化自动包裹（生产时序：onLaunch 先迁移、页面再读会话，走后者）
    if (migratedUnlearned.length && wx.getStorageSync(photoSessionsKey(targetId)) !== '') {
      const sessions = getPhotoSessions(targetId);
      sessions.push({ id: 'mig-' + Date.now() + '-' + sessions.length, createdAt: Date.now(), words: migratedUnlearned });
      wx.setStorageSync(photoSessionsKey(targetId), sessions);
    }
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
// （R15 起一词可属多批——拍照批含已收录灰词，状态显示所在最新批次）。batchNo=0 表示待学习。
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
  // R15：待学会话词单同步清理（词删则移出会话，会话删空则整会话移除）
  const sessions = getPhotoSessions(acc.id);
  let sesChanged = false;
  const keptSessions = [];
  sessions.forEach(function (s) {
    const ws = (s.words || []).filter(function (x) { return !set[x.w]; });
    if (ws.length !== (s.words || []).length) sesChanged = true;
    if (ws.length) keptSessions.push({ id: s.id, createdAt: s.createdAt, words: ws });
  });
  if (sesChanged) wx.setStorageSync(photoSessionsKey(acc.id), keptSessions);
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

/* ---------- 界面偏好（按账号隔离，R17 复习双视图） ---------- */
// 'card'=逐词卡片（默认） | 'list'=列表通览；页面内可随时切换，此处记住各账号偏好
function reviewViewKey() { return 'vocab_review_view_' + currentAccount().id; }
function getReviewView() {
  return wx.getStorageSync(reviewViewKey()) === 'list' ? 'list' : 'card';
}
function setReviewView(v) {
  wx.setStorageSync(reviewViewKey(), v === 'list' ? 'list' : 'card');
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
// 取下一批单词：R15 起待学拍照会话整体优先出批（一次拍照 = 一个学习单元，「拍了就学」，
// 不受 BATCH_SIZE 限制——用户拍板：识别多少学多少），会话学完回落静态词库顺序（游标
// 推进）。词库与队列都用完返回 null。
function nextBatch() {
  const ses = getPhotoSessions(currentAccount().id).find(function (s) { return s.words && s.words.length; });
  if (ses) {
    return {
      batchNo: getRecords().length + 1,
      start: -1, end: -1, // 拍照批不占静态游标
      words: ses.words,
      photo: true,
      sessionId: ses.id
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
    batchId: 'b' + Date.now() + '-' + rs.length, // 带序号防同毫秒连学两批撞 id
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
  if (batch.photo) {
    // R15：会话整体出批，学完即从待学会话列表移除
    if (batch.sessionId) {
      const id = currentAccount().id;
      wx.setStorageSync(photoSessionsKey(id), getPhotoSessions(id).filter(function (s) {
        return s.id !== batch.sessionId;
      }));
    }
  } else {
    setCursor(batch.end + 1); // 静态批推进游标；拍照批不动（R14）
  }
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
    const wrongList = source.filter(function (w) { return !!forgotMap[w.w]; });
    // R21：逐词记录忘记词（forgot 数组）——批次正确率口径之外提供词级历史，
    // 供顽固词排行统计；旧记录无此字段由读取方容错
    rec.reviewHistory.push({
      date: todayStr(), round: round + 1, total: total, wrong: wrongList.length,
      forgot: wrongList.map(function (w) { return w.w; })
    });
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

// R15：一词可属多批（拍照批含已收录灰词），已学词数按词去重统计（防宠物/家庭榜虚增）
function distinctLearnedCount(rs) {
  const set = {};
  rs.forEach(function (r) { r.words.forEach(function (x) { set[x.w] = true; }); });
  return Object.keys(set).length;
}

/* ---------- 教程总览（整库批次分章：让用户看到全貌与每批状态） ---------- */
// R09：已学批次直接按记录快照成章（删除词条后仍与实际复习内容一致，也修复了
// 拍照本「末批不满后再收录」时旧算法按词库下标重切导致的错位）；待学批次：拍照会话
// 各整体成批（R15：优先、不受 35 词上限），静态词从游标起按 35 词切分，首个待学批为
// 当前批。编号在快照/词库间连续累计，静态账号（词库不变、批次恒满 35）输出与旧算法一致。
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
  // 待学批与 nextBatch 一致：拍照会话各整体成批（优先、不与静态混批，R15 不受 35 上限），
  // 静态词另起批次按 35 切分（R14）
  function pushPending(list) {
    batches.push({
      batchNo: batches.length + 1,
      batchId: '',
      start: idx,
      end: idx + list.length - 1,
      count: list.length,
      state: batches.length === records.length ? 'current' : 'todo', // 首个待学批：打开「新单词」就是它
      reviewsDone: 0,
      rounds: rounds,
      wrongCount: 0,
      date: '',
      words: list,
      reviewHistory: []
    });
    idx += list.length;
  }
  getPhotoSessions(currentAccount().id).forEach(function (s) {
    if (s.words && s.words.length) pushPending(s.words);
  });
  const staticPending = bank.slice(cursor);
  for (var p = 0; p < staticPending.length; p += BATCH_SIZE) {
    pushPending(staticPending.slice(p, p + BATCH_SIZE));
  }
  const totalWords = bank.length + getAccountPhotoWords(currentAccount().id).length;
  return {
    totalBatches: batches.length,
    totalWords: totalWords,
    learned: distinctLearnedCount(records), // R15：按词去重（灰词在旧批已计，不因拍照批重复计数）
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
// 成长驱动 = 当前账号累计已学词数（R15：按词去重——拍照批含已收录灰词，防重复计数
// 虚增档位）；只升不降展示，词删除导致的档位回落由页面静默对齐存量记录。门槛参数为
// 拍脑袋的趣味值，可调。
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
  const learned = distinctLearnedCount(getRecords());
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
// streak 与 getStreak 同算法、pet 档位与 getPetInfo 同门槛，仅数据源改为指定账号的
// 存储键；learned 同 R15 按词去重
function getAccountsOverview() {
  return ACCOUNTS.list.map(function (acc) {
    const rs = wx.getStorageSync('vocab_records_' + acc.id) || [];
    const learned = distinctLearnedCount(rs);
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

/* ---------- 正确率与排期（R21：批次正确率聚合 / 复习排期推演 / 顽固词） ---------- */
// 批次正确率口径：加权综合 = 1 - Σwrong/Σtotal（跨已发生复习轮次）。前 3 轮考全量、
// 后 7 轮只考遗忘池（total 口径不同），trend 仅在同口径轮次内比较，防止「第 4 轮起只
// 考错词、通过率天然低」被误读为退步。返回 null = 尚无复习记录。
// rec 可传完整 record，也可传 { reviewHistory } 摘录（总览页用法）。
function getBatchAccuracy(rec) {
  const hs = (rec && rec.reviewHistory) || [];
  if (!hs.length) return { rounds: 0, acc: null, lastAcc: null, trend: null, wrongSum: 0, totalSum: 0 };
  let wrongSum = 0, totalSum = 0;
  hs.forEach(function (h) { wrongSum += h.wrong || 0; totalSum += h.total || 0; });
  const last = hs[hs.length - 1];
  const lastAcc = last.total > 0 ? Math.round((1 - last.wrong / last.total) * 100) : null;
  const acc = totalSum > 0 ? Math.round((1 - wrongSum / totalSum) * 100) : null;
  const isFullRound = function (r) { return r <= FULL_REVIEW_ROUNDS; };
  let pW = 0, pT = 0;
  for (let i = 0; i < hs.length - 1; i++) {
    if (isFullRound(hs[i].round) !== isFullRound(last.round)) continue;
    pW += hs[i].wrong || 0; pT += hs[i].total || 0;
  }
  let trend = null;
  if (pT > 0 && lastAcc !== null) {
    const prev = Math.round((1 - pW / pT) * 100);
    trend = lastAcc - prev > 5 ? 'up' : (prev - lastAcc > 5 ? 'down' : 'flat');
  }
  return { rounds: hs.length, acc: acc, lastAcc: lastAcc, trend: trend, wrongSum: wrongSum, totalSum: totalSum };
}

// 全局正确率汇总：加权综合 + 最佳 / 最需巩固批次（仅有复习记录的批参评）+ 按轮次分布
// （byRound 的 full 标志区分全量轮/巩固轮，页面分段展示防误读）
function getAccuracySummary() {
  const rs = getRecords();
  let wrongSum = 0, totalSum = 0;
  const byRound = {};
  const perBatch = [];
  rs.forEach(function (rec) {
    const a = getBatchAccuracy(rec);
    if (a.rounds === 0) return;
    wrongSum += a.wrongSum;
    totalSum += a.totalSum;
    perBatch.push({ batchNo: rec.batchNo, batchId: rec.batchId, acc: a.acc, wrongCount: rec.wrongPool.length });
    (rec.reviewHistory || []).forEach(function (h) {
      if (!byRound[h.round]) byRound[h.round] = { round: h.round, wrong: 0, total: 0 };
      byRound[h.round].wrong += h.wrong || 0;
      byRound[h.round].total += h.total || 0;
    });
  });
  const rounds = Object.keys(byRound).map(function (k) {
    const b = byRound[k];
    return {
      round: b.round, full: b.round <= FULL_REVIEW_ROUNDS, total: b.total, wrong: b.wrong,
      acc: b.total > 0 ? Math.round((1 - b.wrong / b.total) * 100) : null
    };
  }).sort(function (a, b) { return a.round - b.round; });
  let bestBatch = null;
  let weakBatches = [];
  if (perBatch.length) {
    const sorted = perBatch.slice().sort(function (a, b) { return a.acc - b.acc; });
    weakBatches = sorted.slice(0, 3);
    bestBatch = sorted[sorted.length - 1];
  }
  return {
    acc: totalSum > 0 ? Math.round((1 - wrongSum / totalSum) * 100) : null,
    batchesCounted: perBatch.length,
    bestBatch: bestBatch,
    weakBatches: weakBatches,
    byRound: rounds
  };
}

// 复习排期推演（静态）：每个未完成批次只推「下一个」复习节点（date + OFFSETS[reviewsDone]），
// 与 getDueBatches 同口径；逾期（节点 < 今天）归入今天并标 overdue；同日多批按词去重计词数
// （与今日到期合并口径一致，R15 灰词跨批不虚计）。days = 今天之后仍推演的天数上限。
// FSRS 接入后重写本函数即可——页面只消费 { date, words } 聚合，不感知调度模型。
function getReviewForecast(days) {
  const today = todayStr();
  const range = days || 7;
  const map = {};
  getRecords().forEach(function (r) {
    if (r.reviewsDone >= OFFSETS.length) return;
    if (r.words.length === 0 && r.wrongPool.length === 0) return; // 整批删空不再排期（同 getDueBatches）
    const src = r.reviewsDone < FULL_REVIEW_ROUNDS ? r.words : r.wrongPool;
    if (!src.length) return; // 空轮批到期即自动完成，不进排期预告
    const node = addDays(r.date, OFFSETS[r.reviewsDone]);
    const d = diffDays(today, node);
    if (d > range) return;
    const key = d < 0 ? today : node; // 逾期批次归入今天聚合（与 getDueBatches 补做语义一致）
    if (!map[key]) map[key] = { date: key, days: Math.max(0, d), overdue: d < 0, words: {}, batches: [] };
    src.forEach(function (w) { if (w && w.w) map[key].words[w.w] = true; });
    map[key].batches.push({ batchNo: r.batchNo, batchId: r.batchId, words: src.length });
  });
  return Object.keys(map).sort().map(function (k) {
    const e = map[k];
    return { date: e.date, days: e.days, overdue: e.overdue, words: Object.keys(e.words).length, batches: e.batches };
  });
}

// 顽固词排行：历史复习中反复答错（forgot 计数 ≥ 2）的词。数据源 = reviewHistory[].forgot
// （R21 起 finishReview 逐词记录，旧记录无此字段自然跳过）；inPool = 当前是否仍在遗忘池
// （答对一次即出池，但历史答错次数保留）。释义音标取最近一次答错所在批的快照反查。
function getStubbornWords(limit) {
  const n = limit || 10;
  const map = {};
  const rs = getRecords();
  rs.forEach(function (rec) {
    (rec.reviewHistory || []).forEach(function (h) {
      (h.forgot || []).forEach(function (w) {
        if (!map[w]) map[w] = { count: 0, lastDate: '', m: '', p: '', batches: {} };
        const it = map[w];
        it.count++;
        if (!it.lastDate || h.date > it.lastDate) {
          it.lastDate = h.date;
          const hit = rec.words.filter(function (x) { return x.w === w; })[0];
          if (hit) { it.m = hit.m || ''; it.p = hit.p || ''; }
        }
        it.batches[rec.batchNo] = true;
      });
    });
  });
  const pool = {};
  rs.forEach(function (r) { r.wrongPool.forEach(function (w) { pool[w.w] = true; }); });
  return Object.keys(map).map(function (w) {
    const it = map[w];
    return {
      word: w, meaning: it.m, phonetic: it.p, count: it.count, lastDate: it.lastDate,
      inPool: !!pool[w],
      batches: Object.keys(it.batches).map(Number).sort(function (a, b) { return a - b; })
    };
  }).filter(function (x) { return x.count >= 2; }) // 顽固 = 反复错；错过一次已出池的词不占位
    .sort(function (a, b) { return b.count - a.count || (a.lastDate < b.lastDate ? 1 : -1); })
    .slice(0, n);
}

/* ---------- 统计 ---------- */
function getStats() {
  const rs = getRecords();
  const session = buildReviewSession();
  return {
    account: currentAccount(),
    batches: rs.length,
    learned: distinctLearnedCount(rs), // R15：按词去重（拍照批含已收录灰词）
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
  getPhotoSessions: getPhotoSessions,
  addToAccountPhoto: addToAccountPhoto,
  savePhotoSession: savePhotoSession,
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
  getBatchAccuracy: getBatchAccuracy,
  getAccuracySummary: getAccuracySummary,
  getReviewForecast: getReviewForecast,
  getStubbornWords: getStubbornWords,
  getPetInfo: getPetInfo,
  getAccountsOverview: getAccountsOverview,
  PET_STAGES: PET_STAGES,
  getWrongWords: getWrongWords,
  inWrongPool: inWrongPool,
  removeWrongWord: removeWrongWord,
  getReviewView: getReviewView,
  setReviewView: setReviewView
};
