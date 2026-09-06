// 拍照收词：OCR 文本 → 候选单词提取与过滤（纯逻辑，Node 可直接测试）
// 规则（docs/产品方案/01-拍照收词产品方案.md「解析与过滤规则」）：
//   非字母字符为分隔符，词内保留撇号/连字符（don't、T-shirt）；统一小写；
//   过滤少于 2 个字母的 token；同图重复词去重（保持出现顺序）；
//   已在拍照生词本中的词直接滤掉；命中内置词库的词标灰「已收录」且不可收录（R04 拍板）。

const MIN_LETTERS = 2;  // 最少字母数（撇号/连字符不计）
const MAX_LETTERS = 16; // 最多字母数：滤掉圈词/批改符（O、X）粘连出的超长 OCR 串（F6 第七轮真机数据，
                        // 粘连串普遍 30+ 字母），正常英文最长约 15 字母（congratulations）

// 提取 token：字母开头结尾，词内可含 ' ’ - 连接的字母段
const TOKEN_RE = /[a-zA-Z]+(?:['’\-][a-zA-Z]+)*/g;

function letterCount(token) {
  let n = 0;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) n++;
  }
  return n;
}

// 多段 OCR 文本 → 去重候选词数组（小写、按出现顺序）
function tokenize(texts) {
  const list = Array.isArray(texts) ? texts : [texts];
  const seen = {};
  const out = [];
  list.forEach(function (t) {
    const m = (t || '').match(TOKEN_RE) || [];
    m.forEach(function (raw) {
      const w = raw.toLowerCase();
      if (seen[w] || letterCount(w) < MIN_LETTERS || letterCount(w) > MAX_LETTERS) return;
      seen[w] = true;
      out.push(w);
    });
  });
  return out;
}

function toSet(arr) {
  const s = {};
  (arr || []).forEach(function (x) { s[typeof x === 'string' ? x : x.w] = true; });
  return s;
}

// 生成确认页候选列表：
//   builtInWords 内置词库词条（{w,m} 数组），命中的词 known=true（标灰「已收录」，不可勾选）
//   photoWords   拍照生词本已有词条，命中的词直接滤掉不显示
function buildCandidates(texts, builtInWords, photoWords) {
  const builtIn = toSet(builtInWords);
  const photo = toSet(photoWords);
  return tokenize(texts)
    .filter(function (w) { return !photo[w]; })
    .map(function (w) { return { w: w, known: !!builtIn[w] }; });
}

module.exports = {
  MIN_LETTERS: MIN_LETTERS,
  tokenize: tokenize,
  buildCandidates: buildCandidates
};
