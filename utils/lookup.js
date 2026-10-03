// 查词工具：有道词典公开 jsonapi（与 TTS 同域名，免 Key、免插件、个人未认证可用）
// 接口：GET https://dict.youdao.com/jsonapi?q=单词
//   释义：ec.word[0].trs[].tr[0].l.i[] —— 数组元素为字符串或 {#text: '...'}，
//         拼接后即含词性前缀的义项文本（如 "n. 春天；泉"）
//   音标：ec.word[0].usphone（美音，优先）/ ukphone
// 失败（网络错 / 无词典词条）统一返回 { ok: false, w }，页面标「待补义」可重试或手填。
//
// R07-A（2026-10-01 拍板）K12 释义精简：有道的每个词性块内部含全部子义与百科噪声
// （实测 spare 176 字、bottom 196 字含「底夸克」、litter 160 字含人名），对中小学学习是干扰，
// 且学习模式 TTS 会把整段释义连读 3 遍。精简规则：每词性块取首个非噪声子义（噪声 =
// '<非正式>/<古>/<澳新>' 等语域标注开头）；「【名】人名」整块跳过；最多 MAX_POS 个词性块；
// 总长超 MAX_CHARS 在子义边界收缩（首块超限保留整块，不截半句）；括号补充说明保留。
//
// 上线前需在 mp 后台「request 合法域名」加入 https://dict.youdao.com
// （downloadFile 已配置，request 是独立列表需分别添加；开发者工具模拟器不受限）。

const CONCURRENCY = 4; // 并发查词路数
const MAX_POS = 2;     // 入库释义最多保留的词性块数
const MAX_CHARS = 30;  // 释义总字数上限（登记时建议 24，实测会切掉 spare 动词义「v. 抽出，拿出（时间、金钱等）」，调至 30）
const TIMEOUT = 8000;  // 单词查词超时（毫秒）

// 拼接一条义项的文本：i 为字符串或对象的混合数组
function trText(i) {
  return (Array.isArray(i) ? i : [i]).map(function (x) {
    if (typeof x === 'string') return x;
    return (x && (x['#text'] || x.text)) || '';
  }).join('').replace(/\s+/g, ' ').trim();
}

// 词性块 → 精简义：剥离词性前缀后按「；」切子义，取首个非噪声子义并拼回前缀
//（前缀单独处理的原因：跳过首子义噪声时不能把 "v." 一起丢掉）
function compactSense(text) {
  const m = text.match(/^[a-z]{1,6}\.\s*/i);
  const prefix = m ? m[0] : '';
  const body = prefix ? text.slice(prefix.length) : text;
  const senses = body.split(/；|;/).map(function (s) { return s.trim(); }).filter(Boolean);
  if (!senses.length) return '';
  const pick = senses.filter(function (s) { return s.charAt(0) !== '<'; })[0] || senses[0];
  return (prefix + pick).replace(/\s+/g, ' ');
}

// 解析 jsonapi 返回；无词典词条（查不到）返回 null
function parseEntry(data) {
  const word = data && data.ec && data.ec.word && data.ec.word[0];
  if (!word) return null;
  const parts = [];
  const trs = word.trs || [];
  for (let i = 0; i < trs.length && parts.length < MAX_POS; i++) {
    const tr = trs[i] && trs[i].tr && trs[i].tr[0];
    const text = tr && tr.l && tr.l.i ? trText(tr.l.i) : '';
    if (!text || text.indexOf('【名】') === 0) continue; // 人名词条整块跳过
    const sense = compactSense(text);
    if (!sense) continue;
    if (parts.length && parts.join('；').length + sense.length + 1 > MAX_CHARS) break;
    parts.push(sense);
  }
  if (!parts.length) return null;
  return { m: parts.join('；'), p: word.usphone || word.ukphone || '' };
}

function request(word) {
  return new Promise(function (resolve) {
    wx.request({
      url: 'https://dict.youdao.com/jsonapi',
      data: { q: word },
      timeout: TIMEOUT,
      success: function (res) { resolve({ ok: true, data: res.data }); },
      fail: function () { resolve({ ok: false }); }
    });
  });
}

// 查单个词：成功 { ok: true, w, m, p }；失败 { ok: false, w }
function lookup(word) {
  return request(word).then(function (r) {
    const e = r.ok ? parseEntry(r.data) : null;
    return e ? { ok: true, w: word, m: e.m, p: e.p } : { ok: false, w: word };
  });
}

// 批量查词：按入参顺序返回结果数组；onProgress(done, total, result) 供进度条刷新
function lookupMany(words, onProgress) {
  const list = words || [];
  const results = new Array(list.length);
  if (!list.length) return Promise.resolve([]);
  let next = 0;
  let done = 0;
  return new Promise(function (resolve) {
    function step() {
      if (next >= list.length) return;
      const i = next++;
      lookup(list[i]).then(function (r) {
        results[i] = r;
        done++;
        if (onProgress) onProgress(done, list.length, r);
        if (done >= list.length) resolve(results);
        else step(); // 一路完成立即补位，保持并发池恒满
      });
    }
    for (let k = 0; k < Math.min(CONCURRENCY, list.length); k++) step();
  });
}

// ===================== R10 单词拓展卡（2026-10-02 拍板，落 1.3.0） =====================
// 复用同一 jsonapi 的三段拓展数据（字段实测记录见 docs/开发过程/01-待拍板议题 R10）：
//   衍生词（同根词） rel_word.rels[].rel = { pos, words: [{ word, tran }] }
//   近义词          syno.synos[].syno  = { pos, tran, ws: [{ w }] }
//   双语例句        blng_sents_part['sentence-pair'][]
//                     = { sentence, sentence-eng（目标词 <b> 高亮）, sentence-translation }
// 接口无反义词字段（antonym 不存在），按拍板不设该段。近义词是按义项分组的（tran 即该组
// 对应的义），个别简单词会混入无关义项的词（如 apple → 家伙义项的 fellow/guy），展示时
// 带上分组义即可自解释，不做过滤。
// K12 适配：例句按长度升序取最短 3 条（短句用词更简单）；近义词/衍生词每组限个。
// 缓存 vocab_link_cache 为全局键（词典数据与账号无关）：命中即不再联网，离线可复看。

const LINK_CACHE_KEY = 'vocab_link_cache';
const LINK_CACHE_MAX = 600; // 缓存词条上限（家庭使用量级远达不到，超限整体重置防膨胀）
const MAX_SENTS = 3;        // 例句条数（接口通常恰好返回 3 条）
const MAX_SYN = 4;          // 近义词每组保留个数（实测原始每组可到 5）
const MAX_REL = 4;          // 衍生词每组保留个数

// 解析 jsonapi 的拓展段；三段全缺/全空返回 null（页面显示「暂无拓展内容」）
function parseLinks(data) {
  if (!data) return null;
  const rels = [];
  ((data.rel_word && data.rel_word.rels) || []).forEach(function (r) {
    const rel = r && r.rel;
    if (!rel || !Array.isArray(rel.words)) return;
    const words = rel.words
      .map(function (x) { return { w: (x.word || '').trim(), m: (x.tran || '').trim() }; })
      .filter(function (x) { return x.w; })
      .slice(0, MAX_REL);
    if (words.length) rels.push({ pos: (rel.pos || '').trim(), words: words });
  });
  const synos = [];
  ((data.syno && data.syno.synos) || []).forEach(function (s) {
    const syn = s && s.syno;
    if (!syn || !Array.isArray(syn.ws)) return;
    const ws = syn.ws
      .map(function (x) { return (x && x.w || '').trim(); })
      .filter(Boolean)
      .slice(0, MAX_SYN);
    if (ws.length) synos.push({ pos: (syn.pos || '').trim(), tran: (syn.tran || '').trim(), ws: ws });
  });
  const sents = [];
  const pairSrc = (data.blng_sents_part && data.blng_sents_part['sentence-pair']) || [];
  pairSrc.forEach(function (p) {
    if (!p) return;
    const en = (p.sentence || '').trim();
    const cn = (p['sentence-translation'] || '').trim();
    if (!en || !cn) return;
    sents.push({ en: en, hl: (p['sentence-eng'] || '').trim() || en, cn: cn });
  });
  sents.sort(function (a, b) { return a.en.length - b.en.length; });
  const out = { rels: rels, synos: synos, sents: sents.slice(0, MAX_SENTS) };
  if (!rels.length && !synos.length && !out.sents.length) return null;
  return out;
}

// 查单个词的拓展数据：缓存命中不联网；联网查到才写缓存（查不到不写，下次重试仍会请求）
function lookupLinks(word) {
  let cache = {};
  try { cache = wx.getStorageSync(LINK_CACHE_KEY) || {}; } catch (e) { /* 读失败按未缓存处理 */ }
  if (cache[word]) return Promise.resolve({ ok: true, w: word, links: cache[word], cached: true });
  return request(word).then(function (r) {
    const links = r.ok ? parseLinks(r.data) : null;
    if (!links) return { ok: false, w: word };
    if (Object.keys(cache).length >= LINK_CACHE_MAX) cache = {};
    cache[word] = links;
    try { wx.setStorageSync(LINK_CACHE_KEY, cache); } catch (e) { /* 存储失败不影响本次展示 */ }
    return { ok: true, w: word, links: links, cached: false };
  });
}

module.exports = {
  CONCURRENCY: CONCURRENCY,
  MAX_POS: MAX_POS,
  MAX_CHARS: MAX_CHARS,
  parseEntry: parseEntry,
  lookup: lookup,
  lookupMany: lookupMany,
  parseLinks: parseLinks,
  lookupLinks: lookupLinks
};
