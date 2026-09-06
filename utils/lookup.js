// 查词工具：有道词典公开 jsonapi（与 TTS 同域名，免 Key、免插件、个人未认证可用）
// 接口：GET https://dict.youdao.com/jsonapi?q=单词
//   释义：ec.word[0].trs[].tr[0].l.i[] —— 数组元素为字符串或 {#text: '...'}，
//         拼接后即含词性前缀的义项文本（如 "n. 春天；泉"）
//   音标：ec.word[0].usphone（美音，优先）/ ukphone
// 失败（网络错 / 无词典词条）统一返回 { ok: false, w }，页面标「待补义」可重试或手填。
//
// 上线前需在 mp 后台「request 合法域名」加入 https://dict.youdao.com
// （downloadFile 已配置，request 是独立列表需分别添加；开发者工具模拟器不受限）。

const CONCURRENCY = 4; // 并发查词路数
const MAX_SENSES = 3;  // 入库释义最多保留的义项数
const TIMEOUT = 8000;  // 单词查词超时（毫秒）

// 拼接一条义项的文本：i 为字符串或对象的混合数组
function trText(i) {
  return (Array.isArray(i) ? i : [i]).map(function (x) {
    if (typeof x === 'string') return x;
    return (x && (x['#text'] || x.text)) || '';
  }).join('').replace(/\s+/g, ' ').trim();
}

// 解析 jsonapi 返回；无词典词条（查不到）返回 null
function parseEntry(data) {
  const word = data && data.ec && data.ec.word && data.ec.word[0];
  if (!word) return null;
  const parts = [];
  const trs = word.trs || [];
  for (let i = 0; i < trs.length && parts.length < MAX_SENSES; i++) {
    const tr = trs[i] && trs[i].tr && trs[i].tr[0];
    const text = tr && tr.l && tr.l.i ? trText(tr.l.i) : '';
    if (text) parts.push(text);
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

module.exports = {
  CONCURRENCY: CONCURRENCY,
  MAX_SENSES: MAX_SENSES,
  parseEntry: parseEntry,
  lookup: lookup,
  lookupMany: lookupMany
};
