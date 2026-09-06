// 临时测试：验证复习调度逻辑（Node 环境模拟 wx 存储与日期）
const RealDate = Date;
let fakeNow = null;
class FakeDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) {
      super(fakeNow !== null ? fakeNow : RealDate.now());
    } else {
      super(...args);
    }
  }
}
FakeDate.now = function () { return fakeNow !== null ? fakeNow : RealDate.now(); };
global.Date = FakeDate;

// 模拟微信本地存储
const storage = {};
global.wx = {
  setStorageSync: (k, v) => { storage[k] = v; },
  getStorageSync: (k) => storage[k] || ''
};

const path = require('path');
const store = require(path.join(__dirname, '..', 'utils', 'store.js'));

function setDay(y, m, d) {
  fakeNow = new RealDate(y, m - 1, d, 12, 0, 0).getTime();
}
let pass = 0, fail = 0;
function eq(actual, expected, msg) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; }
  else { fail++; console.error('FAIL:', msg, '| 期望', expected, '| 实际', actual); }
}

// ---- 场景1：单批学习与复习 ----
setDay(2026, 9, 1); // 学习日
const batch = store.nextBatch();
eq(batch.words.length, 35, '每批35词');
eq(batch.batchNo, 1, '第1批');

// 当天不应有复习
eq(store.getDueBatches().length, 0, '学习当天无复习');

store.saveLearnedBatch(batch);
// 当天再取新批次 = 第2批
const b2 = store.nextBatch();
eq(b2.batchNo, 2, '批次号递增');

// 第1天：第1次复习，全部35词
setDay(2026, 9, 2);
let s = store.buildReviewSession();
eq(s.due.length, 1, '第1天1个批次到期');
eq(s.items.length, 35, '第1次复习全部35词');
// 忘记5个（前5个词）
const forgot1 = {};
s.items.slice(0, 5).forEach(i => forgot1[i.word] = true);
store.finishReview(s, forgot1);

// 第2天：第2次复习，全部35词
setDay(2026, 9, 3);
s = store.buildReviewSession();
eq(s.items.length, 35, '第2次复习全部35词');
store.finishReview(s, {});
// 全量轮答对：上一轮忘记的词从遗忘池（错词本）移出
eq(store.getRecords()[0].wrongPool.length, 0, '全量轮答对即移出遗忘池');

// 第3天：第3次复习，全部35词，再忘2个（第10、11词）
setDay(2026, 9, 4);
s = store.buildReviewSession();
eq(s.items.length, 35, '第3次复习全部35词');
const forgot3 = {};
s.items.slice(9, 11).forEach(i => forgot3[i.word] = true);
store.finishReview(s, forgot3);
eq(store.getRecords()[0].wrongPool.length, 2, '第3次复习再错2词进入遗忘池');

// 第5天（未到第4次节点第4天已过？第4次=+4天即9月5日）
setDay(2026, 9, 5);
s = store.buildReviewSession();
eq(s.due.length, 1, '第4天(9/5)第4次复习到期');
eq(s.items.length, 2, '第4次只复习遗忘池2词');
// 答对第1个、忘记第2个 → 遗忘池剩1
const poolWords = store.getRecords()[0].wrongPool.map(w => w.w);
const forgot4 = {};
forgot4[poolWords[1]] = true;
store.finishReview(s, forgot4);
eq(store.getRecords()[0].wrongPool.length, 1, '遗忘词轮答对移出、答错保留');
eq(store.getRecords()[0].reviewsDone, 4, '已完成4次复习');

// 第6天(9/7)：第5次复习，2词
setDay(2026, 9, 7);
s = store.buildReviewSession();
eq(s.items.length, 1, '第5次复习遗忘池1词');
store.finishReview(s, {});
eq(store.getRecords()[0].wrongPool.length, 0, '第5次答对后遗忘池清空');

// 遗忘池清空后，第8天(9/9)第6次复习自动完成
setDay(2026, 9, 9);
s = store.buildReviewSession();
eq(s.items.length, 0, '遗忘池空则无复习内容');
store.finishReview(s, {});
eq(store.getRecords()[0].reviewsDone, 6, '空池轮自动计次');

// ---- 场景2：同日多批合并 ----
setDay(2026, 9, 1); // 回到学习日，学第2批（游标35起）
store.saveLearnedBatch(store.nextBatch()); // 批次2：9/1学习

setDay(2026, 9, 2); // 批次2第1次复习（批次1已完成6次，下次在第11天，不冲突）
s = store.buildReviewSession();
eq(s.due.filter(d => d.batchNo === 2).length, 1, '批次2当天到期');
eq(s.items.length, 35, '批次2全部35词');

// ---- 场景3：同日多批合并（用两个全新存储模拟）----
storage.vocab_records_junior = []; storage.vocab_cursor_junior = 0;
setDay(2026, 10, 1);
store.saveLearnedBatch(store.nextBatch()); // 批次1：10/1
store.saveLearnedBatch(store.nextBatch()); // 批次2：10/1
setDay(2026, 10, 2); // 两批的第1次复习同日到期 → 合并
s = store.buildReviewSession();
eq(s.due.length, 2, '两批同日到期');
eq(s.items.length, 70, '同日批次合并为一次复习（70词）');

// ---- 场景4：逾期补做 ----
setDay(2026, 10, 10); // 第1次复习拖到第9天，仍应补做
s = store.buildReviewSession();
eq(s.due.filter(d => d.batchNo === 2).length, 1, '逾期仍会补做');

// ---- 场景5：账号切换与词库/进度隔离 ----
eq(store.currentAccount().id, 'junior', '默认账号为初中');
eq(store.getAccounts().length, 3, '共三个账号（初中/小学/拍照生词本）');

const juniorLearned = store.getRecords().length; // 初中已有批次
setDay(2026, 10, 11);
const pBatch = store.nextBatch();
eq(pBatch.words[0].w, store.currentAccount().bank[pBatch.start].w, '初中账号下一批首词与词库顺序一致');

// 切换到小学账号
eq(store.switchAccount('primary'), true, '切换到小学账号成功');
eq(store.currentAccount().id, 'primary', '当前账号为小学');
eq(store.getRecords().length, 0, '小学账号学习记录为空（隔离）');
eq(store.getStats().totalWords, storage ? store.currentAccount().bank.length : 0, '词库总量随账号切换');

const primaryBatch = store.nextBatch();
eq(primaryBatch.batchNo, 1, '小学账号从第1批开始');
eq(primaryBatch.words[0].w, 'hello', '小学账号首词为 hello（小学词库）');
store.saveLearnedBatch(primaryBatch);

setDay(2026, 10, 12);
s = store.buildReviewSession();
eq(s.items.length, 35, '小学账号第1次复习35词');
eq(s.items[0].word, 'hello', '复习内容来自小学词库');

// 切回初中：进度不受影响
store.switchAccount('junior');
eq(store.getRecords().length, juniorLearned, '切回初中，学习进度保持不变');

// ---- 场景6：错词本聚合与手动移除 ----
storage.vocab_records_junior = []; storage.vocab_cursor_junior = 0;
setDay(2026, 11, 1);
store.saveLearnedBatch(store.nextBatch()); // 新批次：11/1
setDay(2026, 11, 2);
s = store.buildReviewSession();
const forgot6 = {};
s.items.slice(0, 3).forEach(i => forgot6[i.word] = true);
const wrong6 = s.items.slice(0, 3).map(i => i.word);
store.finishReview(s, forgot6);
eq(store.getStats().wrongCount, 3, '错词本数量=3');
eq(store.getWrongWords().length, 3, '错词本聚合3词');
eq(store.inWrongPool(wrong6[0]), true, '错词在错词本中');
eq(store.getWrongWords()[0].batches.join(','), '1', '错词标记来源批次');
store.removeWrongWord(wrong6[0]);
eq(store.getStats().wrongCount, 2, '手动移除后剩2');
eq(store.inWrongPool(wrong6[1]), true, '其余错词仍在');

// ---- 场景7：学习模式朗读文本清理与连读接口（utils/tts.js）----
const tts = require(path.join(__dirname, '..', 'utils', 'tts.js'));
eq(tts.cleanText('n. 苹果'), '苹果', '朗读文本去掉词性标注(n.)');
eq(tts.cleanText('v. 放弃；抛弃'), '放弃，抛弃', '分号转逗号便于朗读停顿');
eq(tts.cleanText('adj. 高兴的；n. 高兴'), '高兴的，高兴', '多个词性标注全部清理');
eq(tts.cleanText('int. 你好'), '你好', 'int. 感叹词词性也被清理');
eq(tts.cleanText('n. 脚（复数 feet）'), '脚', '括号里的复数/拼写注释剥离，只留主义项');
eq(tts.cleanText('v. 骑 n. 旅程'), '骑 旅程', '多义项用空格连接时保留空格待拆分');
eq(tts.cleanText('擅长……'), '擅长……', '无词性标注的释义原样保留');
eq(typeof tts.speak, 'function', 'tts.speak 接口存在');
eq(typeof tts.speakPair, 'function', 'tts.speakPair 连读报读接口存在');
eq(tts.available(), true, '有道接口方案默认可用');
eq(tts.briefText('n. 名字；名称'), '名字', '报读取首个义项（去分号段）');
eq(tts.briefText('adj. 高兴的；n. 高兴'), '高兴的', '多个义项取第一段');
eq(tts.briefText('打扰一下；请原谅'), '打扰一下', '短词命中优先');
eq(tts.briefText('excuse me'), 'excuse me', '无分隔符原样保留');
// 中文播报分段（方案②：长释义拆段连播）
eq(tts.zhParts('n. 名字；名称'), ['名字', '名称'], '中文释义拆两段（清词性标注+分词）');
eq(tts.zhParts('adj. 高兴的；n. 高兴'), ['高兴的', '高兴'], '多词性释义拆两段');
eq(tts.zhParts('擅长……'), ['擅长……'], '无分隔词原样单段');
eq(tts.zhParts('第一，第二，第三，第四，第五').length, 4, '最多拆 4 段，保留前几义项');
eq(tts.zhParts('v. 骑 n. 旅程'), ['骑', '旅程'], '用空格连接的多义项按空格拆成两段');
eq(tts.zhParts('打扫 干净的'), ['打扫', '干净的'], '空格义项拆分');
eq(tts.zhParts('n. 脚（复数 feet）'), ['脚'], '括号注释剥离后只播主义项');
eq(tts.zhParts('/ 爱，喜爱'), ['爱', '喜爱'], '开头的斜杠残屑被过滤');
eq(tts.speakPair('hello', '你好', 2, 1200), 5400, '单段中文每遍 2.7s → 2 遍总时长');
eq(tts.speakPair('hello', '名字，名称', 2, 1200), 7400, '两段中文每遍 3.7s → 2 遍总时长');

// ---- 场景8：教程总览（批次分章） ----
storage.vocab_records_junior = []; storage.vocab_cursor_junior = 0;
setDay(2026, 12, 1);
const bank8 = store.currentAccount().bank;
const ov8 = store.getOverview();
eq(ov8.totalBatches, Math.ceil(bank8.length / store.BATCH_SIZE), '总览批数=ceil(词库/35)');
eq(ov8.batches.length, ov8.totalBatches, '总览枚举全部批次');
eq(ov8.totalWords, bank8.length, '总览总词数=词库长度');
eq(ov8.learned, 0, '初始已学0词');
eq(ov8.batches[0].state, 'current', '未学前第1批为当前批');
eq(ov8.batches[0].count, 35, '首批35词');
eq(ov8.batches[1].state, 'todo', '第2批未学');
const last8 = ov8.batches[ov8.totalBatches - 1];
eq(last8.count, bank8.length - (ov8.totalBatches - 1) * store.BATCH_SIZE, '末批为剩余词数');

store.saveLearnedBatch(store.nextBatch()); // 学习第1批
let ovA = store.getOverview();
eq(ovA.batches[0].state, 'learning', '学习后第1批为复习中');
eq(ovA.batches[0].reviewsDone, 0, '第1批复习0/10');
eq(ovA.batches[1].state, 'current', '学习后第2批为当前批');
eq(ovA.batches[2].state, 'todo', '第3批未学');
eq(ovA.learned, 35, '已学35词');
eq(ovA.currentBatchNo, 2, '当前批号=2');

// 依次走完 10 次复习节点 → 第1批状态应为已完成
for (let r8 = 0; r8 < store.OFFSETS.length; r8++) {
  setDay(2026, 12, 1 + store.OFFSETS[r8]);
  store.finishReview(store.buildReviewSession(), {});
}
const ovB = store.getOverview();
eq(ovB.batches[0].state, 'done', '10次复习完成后第1批已完成');
eq(ovB.batches[0].reviewsDone, 10, '已完成10次复习');
eq(ovB.batches[0].wrongCount, 0, '全对无遗忘词');
eq(ovB.currentBatchNo, 2, '第2批仍为当前批');

// ---- 场景9：指定批次手动复习（教程总览页入口） ----
storage.vocab_records_junior = []; storage.vocab_cursor_junior = 0;
setDay(2026, 12, 20);
store.saveLearnedBatch(store.nextBatch()); // 批次1
const rec9 = store.getRecords()[0];
let s9 = store.buildBatchReviewSession(rec9.batchId);
eq(s9.due.length, 1, '手动复习仅含指定批次');
eq(s9.due[0].batchId, rec9.batchId, '批次 id 正确');
eq(s9.items.length, 35, '第1轮手动复习全部35词');
eq(s9.items[0].batchNo, 1, '词条携带批号');
// 忘2词
const f9 = {};
s9.items.slice(0, 2).forEach(function (i) { f9[i.word] = true; });
store.finishReview(s9, f9);
eq(store.getRecords()[0].reviewsDone, 1, '手动复习计为一次');
eq(store.getRecords()[0].wrongPool.length, 2, '答错进入遗忘池');
// 第2轮全对 → 遗忘池清0
s9 = store.buildBatchReviewSession(rec9.batchId);
eq(s9.items.length, 35, '第2轮仍复习全部35词');
store.finishReview(s9, {});
eq(store.getRecords()[0].wrongPool.length, 0, '全对移出遗忘池');
// 推进到 reviewsDone=3，第4轮起复习遗忘池（当前为空）
s9 = store.buildBatchReviewSession(rec9.batchId);
store.finishReview(s9, {});
s9 = store.buildBatchReviewSession(rec9.batchId);
eq(s9.due[0].reviewsDone, 3, '将进行第4轮');
eq(s9.items.length, 0, '第4轮起复习遗忘池，池空则无内容');
// 未知批次 → 空会话
eq(store.buildBatchReviewSession('nope').due.length, 0, '未知批次返回空');

// ---- 场景10：任务看板状态与错词本自由复习 ----
storage.vocab_records_junior = []; storage.vocab_cursor_junior = 0;
eq(store.getStreak(), 0, '看板：无记录连续0天');
eq(store.getLastReview(), null, '看板：无记录最近复习为null');
eq(store.getNextDueInfo(), null, '看板：无记录下一任务为null');

setDay(2026, 12, 1); // 学习日
store.saveLearnedBatch(store.nextBatch()); // 批次1
setDay(2026, 12, 2); // 第1次复习：全对
store.finishReview(store.buildReviewSession(), {});
eq(store.getLastReview().date, '2026-12-02', '看板：上次复习日期');
eq(store.getLastReview().total, 35, '看板：上次复习词数');
eq(store.getLastReview().wrong, 0, '看板：上次错词数');

setDay(2026, 12, 3); // 第2次复习：忘3个 → 产生错词
let s10 = store.buildReviewSession();
const f10 = {};
s10.items.slice(0, 3).forEach(function (i) { f10[i.word] = true; });
store.finishReview(s10, f10);
eq(store.getStats().wrongCount, 3, '看板：错词本3词');
eq(store.getStreak(), 2, '看板：连续2天复习(12/2,12/3)');
const nd10 = store.getNextDueInfo();
eq(nd10.batchNo, 1, '看板：下一任务批次');
eq(nd10.days, 1, '看板：下一任务1天后');
eq(nd10.date, '2026-12-04', '看板：下一任务日期(12/4)');

// 错词本自由复习
const fs10 = store.buildFreeReviewSession();
eq(fs10.items.length, 3, '自由复习=错词本词数');
eq(fs10.free, true, '自由会话有 free 标记');
// 词1记得、词2/3 忘记
const f10b = {};
fs10.items.slice(1).forEach(function (i) { f10b[i.word] = true; });
store.finishFreeReview(fs10, f10b);
eq(store.getStats().wrongCount, 2, '自由复习答对的词移出错词本');
eq(store.getRecords()[0].reviewsDone, 2, '自由复习不推进正式复习次数');
eq(store.getRecords()[0].wrongPool.length, 2, '忘记的词保留在遗忘池');

// 下次到期应仍按正式调度（自由复习不影响下一节点）
const nd10b = store.getNextDueInfo();
eq(nd10b.date, '2026-12-04', '自由复习后下一任务不变');

// ---- 场景11：拍照生词本动态词库（R01=A） ----
storage.vocab_photo_bank = []; // 拍照生词本清空
store.switchAccount('photo');
eq(store.currentAccount().id, 'photo', '切换到拍照生词本账号');
eq(store.currentAccount().dynamic, true, '拍照生词本为动态词库账号');
eq(store.getRecords().length, 0, '拍照生词本学习记录独立为空');
eq(store.getStats().totalWords, 0, '词库为空时总量0');
eq(store.nextBatch(), null, '空词库取不到新批次');
eq(store.getOverview().totalBatches, 0, '空词库总览0批');

eq(store.addToPhotoBank([
  { w: 'apple', m: 'n. 苹果', p: 'ˈæpl' },
  { w: 'banana', m: 'n. 香蕉' },
  { w: 'apple', m: 'n. 苹果' } // 同批重复
]), 2, '首次收录2词（同批去重）');
eq(store.getPhotoBank().length, 2, '词库现有2词');
eq(store.getPhotoBank()[0].p, 'ˈæpl', '词条保留音标');
eq(store.getPhotoBank()[0].addedAt > 0, true, '词条记录收录时间');

const pb11 = store.nextBatch();
eq(pb11.batchNo, 1, '拍照词第1批');
eq(pb11.words.length, 2, '第1批2词');
eq(pb11.words[0].w, 'apple', '按收录顺序取词');

store.saveLearnedBatch(pb11); // 学习完成，cursor → 2
eq(store.addToPhotoBank([{ w: 'apple', m: 'n. 苹果' }, { w: 'cherry', m: 'n. 樱桃' }]), 1, '已收录词不重复进库');
eq(store.getPhotoBank().length, 3, '词库增至3词');
const pb12 = store.nextBatch();
eq(pb12.batchNo, 2, '新收录词续接第2批');
eq(pb12.start, 2, '第2批从索引2开始（cursor 续接）');
eq(pb12.words.map(w => w.w).join(','), 'cherry', '第2批只含新收录词');

// 拍照词走完整复习流水线（学习日为场景10留下的 2026-12-03）
setDay(2026, 12, 4);
const s11 = store.buildReviewSession();
eq(s11.due.length, 1, '拍照词批次次日到期');
eq(s11.items.length, 2, '第1次复习全部2词');
eq(s11.items[0].phonetic, 'ˈæpl', '复习词条带音标（p 字段启用）');

// 切回静态账号：拍照词库持久、静态词库不受影响
store.switchAccount('junior');
eq(store.getPhotoBank().length, 3, '切账号后拍照词库仍在');
eq(store.currentBank().length, store.currentAccount().bank.length, '静态账号词库不受影响');

// ---- 场景12：OCR 文本解析（utils/wordParser.js） ----
const parser = require(path.join(__dirname, '..', 'utils', 'wordParser.js'));
eq(parser.tokenize('Hello, world! hello WORLD'), ['hello', 'world'], '小写化+同图去重');
eq(parser.tokenize(["I'd like 3 apples", 'T-shirt & "go"']), ["i'd", 'like', 'apples', 't-shirt', 'go'], '词内保留撇号连字符、剥离标点数字');
eq(parser.tokenize('a I x be'), ['be'], '过滤少于2字母的token');
eq(parser.tokenize('congratulations oaskolongotrybecomeokeepoliveoeveny'), ['congratulations'], '滤除超16字母OCR粘连串、保留最长正常词');
eq(parser.tokenize(''), [], '空文本无结果');
eq(parser.tokenize(null), [], 'null 安全');

const builtIn12 = [{ w: 'name', m: 'n. 名字' }, { w: 'excuse me', m: '打扰一下' }];
const photo12 = [{ w: 'apple', m: 'n. 苹果' }];
eq(parser.buildCandidates(['Name apple spring name'], builtIn12, photo12),
  [{ w: 'name', known: true }, { w: 'spring', known: false }],
  '内置命中标known(R04)、拍照已有滤掉、保持出现顺序');
eq(parser.buildCandidates(['excuse me'], builtIn12, photo12),
  [{ w: 'excuse', known: false }, { w: 'me', known: false }],
  'v1 单词粒度（R03=A）：短语按单词提取');

// ---- 场景13：有道查词解析与并发调度（utils/lookup.js） ----
const lk = require(path.join(__dirname, '..', 'utils', 'lookup.js'));
const entry13 = {
  ec: { word: [{ usphone: 'sprɪŋ', ukphone: 'sprɪŋ', trs: [
    { tr: [{ l: { i: ['n.', ' 春天；泉'] } }] },
    { tr: [{ l: { i: [{ '#text': 'v.' }, ' 跳，跃；突然弹开'] } }] },
    { tr: [{ l: { i: ['adj.', ' 有弹性的'] } }] },
    { tr: [{ l: { i: ['n.', ' 第四个义项'] } }] }
  ] }] }
};
eq(lk.parseEntry(entry13).m, 'n. 春天；泉；v. 跳，跃；突然弹开；adj. 有弹性的', '释义取前3个义项拼接');
eq(lk.parseEntry(entry13).p, 'sprɪŋ', '音标取美音');
eq(lk.parseEntry({ ec: { word: [{ trs: [] }] } }), null, '无义项返回null');
eq(lk.parseEntry({ input: 'x' }), null, '无词典词条返回null');
eq(lk.parseEntry(null), null, '空数据安全');

// lookupMany：stub wx.request（5ms 异步返回），验证并发上限、顺序保持与失败标记
const calls13 = [];
global.wx.request = function (opts) {
  calls13.push(opts.data.q);
  setTimeout(function () {
    if (opts.data.q === 'bad') return opts.fail && opts.fail();
    opts.success({ data: entry13 });
  }, 5);
};
function finish() {
  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
}
const words13 = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
const p13 = lk.lookupMany(words13);
eq(calls13.length, 4, '并发上限4（6词先发4路）');
p13
  .then(function (rs) {
    eq(rs.length, 6, '批量查词返回全部结果');
    eq(rs.map(r => r.w).join(','), words13.join(','), '结果保持入参顺序');
    eq(rs.every(r => r.ok), true, '全部查词成功');
    eq(calls13.length, 6, '全部发起请求');
    return lk.lookupMany(['go', 'bad']);
  })
  .then(function (rs) {
    eq(rs[0].ok, true, '成功词带结果');
    eq(rs[0].m, lk.parseEntry(entry13).m, '成功词条目含释义');
    eq(rs[1].ok, false, '失败词标记待补义');
    eq(rs[1].w, 'bad', '失败词保留原词');
  })
  .then(finish);
