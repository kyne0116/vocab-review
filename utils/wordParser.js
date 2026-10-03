// 拍照收词：OCR 文本 → 候选单词提取与过滤（纯逻辑，Node 可直接测试）
// 规则（docs/产品方案/01-拍照收词产品方案.md「解析与过滤规则」）：
//   非字母字符为分隔符，词内保留撇号/连字符（don't、T-shirt）；统一小写；
//   过滤少于 2 个字母的 token；同图重复词去重（保持出现顺序）；
//   已在拍照生词本中的词直接滤掉；命中内置词库的词标灰「已收录」且不可收录（R04 拍板）。
//
// 粘连还原（2026-10-01 真机日志定性：VK 静态模式把整块文本返回为一条无空格/换行的连串，
// 字母识别基本正确但分隔符丢失；圈选符 ○ 被识为大写 O / 数字 0 粘在词前，如 Ospare/Odialog）：
//   ① 词中「小写后跟大写」（真单词内不出现）= 圈选符粘连边界，按此切块；
//   ② 块首剥离圈选符：大写 O / 数字 0 直接剥；小写 o 有歧义（obey 首字母），仅剥离后命中词典才剥；
//   ③ 块内再用词典（内置词库 + 拍照生词本）最长匹配切分：
//      ≤16 字母的块仅接受「无残段的完整词典分解」（provecough→prove+cough），
//      有残段则整块原样保留为候选——防止词典短词把真词误切（position→po+sit+ion，2026-10-01 实测）；
//      >16 字母的块必须切分，未命中残段 2~16 字母原样保留，交有道查义词典裁决；
//   ④ 无标记超长串（>16 字母）的全部切分依据都来自词典：覆盖率 <1/3 视为噪声整串丢弃（计入粘连串）；
//      有标记串的边界来自圈选符像素级证据，不受覆盖率限制；
//   ⑤ ≤16 字母的完整 token 不做词典切分（防止 homework→home+work、background→back+ground 误拆真词）。

const MIN_LETTERS = 2;  // 最少字母数（撇号/连字符不计）
const MAX_LETTERS = 16; // 最多字母数：滤掉圈词/批改符（O、X）粘连出的超长 OCR 串（F6 第七轮真机数据，
                        // 粘连串普遍 30+ 字母），正常英文最长约 15 字母（congratulations）
const MIN_SEG_WORD = 3;    // 词典切分最小命中词长：排除 an/as 等超短词，降低把噪声切成短词的误切率
const COVER_RATIO = 1 / 3; // 无标记超长串的词典覆盖率下限，低于按噪声整串丢弃

// 提取 token：字母开头结尾，词内可含 ' ’ - 连接的字母段
const TOKEN_RE = /[a-zA-Z]+(?:['’\-][a-zA-Z]+)*/g;
// 词中「小写+大写」组合：真单词内不出现，是圈选符被识为 O 后与后续词粘连的边界证据
const MARKER_RE = /[a-z][A-Z]/;

function letterCount(token) {
  let n = 0;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) n++;
  }
  return n;
}

function toSet(arr) {
  const s = {};
  (arr || []).forEach(function (x) { s[typeof x === 'string' ? x : x.w] = true; });
  return s;
}

// 合并多个词表为切分词典（入参元素为 {w} 对象或字符串，键统一小写）
function buildDict() {
  const d = {};
  Array.prototype.forEach.call(arguments, function (list) {
    (list || []).forEach(function (x) {
      d[(typeof x === 'string' ? x : x.w).toLowerCase()] = true;
    });
  });
  return d;
}

function hasMarker(token) { return MARKER_RE.test(token); }

// 按「小写后跟大写」边界切块（圈选符粘连处断开）
function splitAtMarkers(token) {
  const parts = [];
  let start = 0;
  for (let i = 1; i < token.length; i++) {
    if (MARKER_RE.test(token[i - 1] + token[i])) {
      parts.push(token.slice(start, i));
      start = i;
    }
  }
  parts.push(token.slice(start));
  return parts.filter(function (p) { return /[a-zA-Z]/.test(p); });
}

// 块首圈选符剥离：大写 O / 数字 0 必为标记直接剥；小写 o 仅在剥离后命中词典时剥（保护 obey 等真词）
function stripMark(chunk, dict) {
  if (/^[O0]/.test(chunk)) return chunk.slice(1);
  if (/^o/.test(chunk) && dict[chunk.slice(1)]) return chunk.slice(1);
  return chunk;
}

// 词典贪心切分（最长优先）：按出现顺序返回 残段/命中词 混排的 pieces；covered = 命中词总字母数。
// 残段的去留由调用方按块长决定（≤16 块只接受纯词典分解，>16 块保留 2~16 字母残段）。
function segmentRun(s, dict) {
  const pieces = [];
  let i = 0, junkStart = 0, covered = 0;
  while (i < s.length) {
    let hit = null;
    for (let len = Math.min(MAX_LETTERS, s.length - i); len >= MIN_SEG_WORD; len--) {
      const w = s.slice(i, i + len);
      if (dict[w]) { hit = w; break; }
    }
    if (hit) {
      if (i > junkStart) pieces.push(s.slice(junkStart, i));
      pieces.push(hit);
      covered += hit.length;
      i += hit.length;
      junkStart = i;
    } else {
      i++;
    }
  }
  if (junkStart < s.length) pieces.push(s.slice(junkStart));
  return { pieces: pieces, covered: covered };
}

// 单个 OCR token → 候选词数组；返回 null = 整串按噪声丢弃（由调用方计入粘连串）
function extractWords(raw, dict) {
  const d = dict || {};
  // 完整 ≤16 且无标记：原样保留（含词典命中与未命中，后者交查义词典裁决）
  if (letterCount(raw) <= MAX_LETTERS && !hasMarker(raw)) {
    return [stripMark(raw, d).toLowerCase()];
  }
  const markerRun = hasMarker(raw);
  const pieces = [];
  let covered = 0, total = 0;
  splitAtMarkers(raw).forEach(function (chunk) {
    const c = stripMark(chunk, d).toLowerCase();
    if (!c) return;
    total += c.length;
    if (d[c]) { pieces.push(c); covered += c.length; return; } // 整块恰为词典词
    if (c.length > MAX_LETTERS) {
      // 超长块必须切分：命中词 + 2~16 字母残段原样保留（超长残段与 1 字母碎屑丢弃）
      const seg = segmentRun(c, d);
      seg.pieces.forEach(function (p) {
        if (d[p] || (p.length >= MIN_LETTERS && p.length <= MAX_LETTERS)) pieces.push(p);
      });
      covered += seg.covered;
      return;
    }
    // ≤16 块仅接受无残段的完整词典分解；有任何残段则整块保留，防止词典短词误切真词（position→po+sit+ion）
    const seg = segmentRun(c, d);
    const clean = seg.pieces.length > 0 && seg.pieces.every(function (p) { return d[p] && p.length >= MIN_SEG_WORD; });
    if (clean) {
      seg.pieces.forEach(function (p) { pieces.push(p); });
      covered += seg.covered;
    } else {
      pieces.push(c);
    }
  });
  if (!markerRun && total > 0 && covered / total < COVER_RATIO) return null;
  return pieces;
}

// 多段 OCR 文本 → { words: 去重候选词数组（小写、按出现顺序）, glued: 按噪声丢弃的粘连串原文 }
function parseTokens(texts, dict) {
  const list = Array.isArray(texts) ? texts : [texts];
  const d = dict || {};
  const seen = {};
  const out = [];
  const glued = [];
  list.forEach(function (t) {
    const m = (t || '').match(TOKEN_RE) || [];
    m.forEach(function (raw) {
      const pieces = extractWords(raw, d);
      if (pieces === null) { glued.push(raw); return; }
      pieces.forEach(function (p) {
        const w = (p || '').toLowerCase();
        if (seen[w] || letterCount(w) < MIN_LETTERS || letterCount(w) > MAX_LETTERS) return;
        seen[w] = true;
        out.push(w);
      });
    });
  });
  return { words: out, glued: glued };
}

function tokenize(texts, dict) {
  return parseTokens(texts, dict).words;
}

// 按噪声丢弃的粘连串原文列表（「识别质量不足」提示计数 + [OCR] 日志回传依据）
function gluedList(texts, dict) {
  return parseTokens(texts, dict).glued;
}

function gluedCount(texts, dict) {
  return gluedList(texts, dict).length;
}

// 生成确认页候选列表：
//   builtInWords 内置词库词条（{w,m} 数组），命中的词 known=true（标灰「已收录」，不可勾选）
//   photoWords   拍照生词本已有词条，R15 起不再滤除（灰显随批学），是否标灰由页面按
//   「当前账号」判定（parser 层无账号概念，known 仅表示命中传入的内置词表）
//   切分词典 = 内置词库 + 拍照生词本（两者都是真实词表，拍照本随使用增长、切分覆盖逐步提升）
function buildCandidates(texts, builtInWords, photoWords) {
  const builtIn = toSet(builtInWords);
  const dict = buildDict(builtInWords, photoWords);
  return parseTokens(texts, dict).words
    .map(function (w) { return { w: w, known: !!builtIn[w] }; });
}

module.exports = {
  MIN_LETTERS: MIN_LETTERS,
  MAX_LETTERS: MAX_LETTERS,
  COVER_RATIO: COVER_RATIO,
  tokenize: tokenize,
  buildDict: buildDict,
  gluedList: gluedList,
  gluedCount: gluedCount,
  buildCandidates: buildCandidates
};
