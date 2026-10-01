// 拍照收词：智谱 GLM 视觉识别 provider（R05-A 主路线，2026-10-01 拍板，ADR-002）
// 直连智谱开放平台：免插件、免服务器、不依赖微信认证；红线②唯一豁免 = API Key
//（用户显式接受包体可被反编译提取的风险；Key 须低额度、可撤换）。
// **Key 存放**：utils/llm.config.js（.gitignore 排除，不入库——仓库为公开仓库，2026-10-01 实测）。
// 首次启用：复制 utils/llm.config.example.js 为 llm.config.js 并填 Key（见 README「拍照收词」）。
// 未配置 Key / 断网 / 接口失败 / 载荷过大时，由拍照页自动降级 VisionKit 本地识别（utils/ocr.js）。
// R06（2026-10-01 拍板 = A 方案 + B 开关默认关，C 全量二次评估不做）：
//   ① 识别自带自评注记（note：注记还原说明 / 低置信），候选页对用户透明展示；
//   ② correctWord 单词级带图纠错（待补义词「AI 纠错」入口 / 候选页长按）；
//   ③ AUTO_FIX=true 时查义失败词自动拉取纠错建议（仅展示，用户点「改用它」才生效）。

const DEFAULT_MODEL = 'glm-4v-flash';
const DEFAULT_BASE_URL = 'https://open.bigmodel.cn';
let cfg = { apiKey: '', model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL };
try { cfg = require('./llm.config.js'); } catch (e) { /* 未创建配置文件：AI 主路线停用，走 VK */ }
cfg.apiKey = cfg.apiKey || '';
cfg.model = cfg.model || DEFAULT_MODEL;
cfg.baseUrl = cfg.baseUrl || DEFAULT_BASE_URL;

const TIMEOUT = 20000;           // 视觉模型首字延迟较高，总时限 20s，超时降级本地识别
const MAX_B64 = 6 * 1024 * 1024; // base64 载荷上限（约对应 4.5MB 原图），超出直接降级
const MAX_SEND_EDGE = 1600;      // 发送前压缩到的长边上限（控制载荷与 token 费用；词表类图片足够）
const AUTO_FIX = false;          // R06-B 开关（默认关）：查义失败词自动拉取 AI 纠错建议（仅展示，点「改用它」生效）

const PROMPT = [
  '识别图片中所有英文单词（多为课本或练习册词表，部分词前有圈选圈等标记，忽略标记本身）。',
  '规则：1) 只输出图片中实际存在的英文单词，全部小写；',
  '2) 教材拼写注记还原为完整拼写，如 dialog(ue)→dialogue、hono(u)r→honor；',
  '3) 不输出中文、句子、数字、标点或解释，不编造图片中不存在的词；',
  '4) 与图片原文不一致（做过注记还原）或拿不准的词，在 note 里说明原图写法或标注「低置信」，其余 note 留空。',
  '输出格式：只输出 JSON 数组，每项为 {"w":"单词","note":""}，',
  '例如 [{"w":"spring","note":""},{"w":"dialogue","note":"原图 dialog(ue)，已还原完整拼写"}]。'
].join('\n');

function errOf(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function configured() {
  return typeof cfg.apiKey === 'string' && cfg.apiKey.length >= 20;
}

function getImageInfo(src) {
  return new Promise(function (resolve, reject) {
    wx.getImageInfo({
      src: src,
      success: resolve,
      fail: function (e) { reject(errOf('LLM_IMAGE_INFO', '读取图片失败：' + (e && e.errMsg))); }
    });
  });
}

// 大图压缩到长边 ≤ MAX_SEND_EDGE（小图直传）；压缩失败退回原图，超大由 MAX_B64 兜底
function compress(src, info) {
  return new Promise(function (resolve) {
    if (Math.max(info.width, info.height) <= MAX_SEND_EDGE) return resolve(src);
    const opts = { src: src, quality: 80 };
    if (info.width >= info.height) opts.compressedWidth = MAX_SEND_EDGE;
    else opts.compressedHeight = MAX_SEND_EDGE;
    opts.success = function (res) { resolve(res.tempFilePath); };
    opts.fail = function () { resolve(src); };
    try { wx.compressImage(opts); } catch (e) { resolve(src); }
  });
}

function mimeOf(path) {
  return /\.png$/i.test(path || '') ? 'png' : 'jpeg';
}

function fileBase64(path) {
  return new Promise(function (resolve, reject) {
    try {
      wx.getFileSystemManager().readFile({
        filePath: path,
        encoding: 'base64',
        success: function (res) { resolve(res.data); },
        fail: function (e) { reject(errOf('LLM_READ_FAIL', '读取图片文件失败：' + (e && e.errMsg))); }
      });
    } catch (e) {
      reject(errOf('LLM_READ_FAIL', '读取图片文件失败：' + (e && e.message)));
    }
  });
}

function requestLLM(b64, mime, prompt) {
  return new Promise(function (resolve, reject) {
    wx.request({
      url: cfg.baseUrl + '/api/paas/v4/chat/completions',
      method: 'POST',
      timeout: TIMEOUT,
      header: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.apiKey
      },
      data: {
        model: cfg.model,
        temperature: 0.1,
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: 'data:image/' + mime + ';base64,' + b64 } },
            { type: 'text', text: prompt }
          ]
        }]
      },
      success: function (res) {
        if (res.statusCode !== 200) {
          return reject(errOf('LLM_HTTP_' + res.statusCode, 'AI 接口返回 ' + res.statusCode + '（'
            + (res.data && res.data.error && res.data.error.message || '无错误详情') + '）'));
        }
        const content = res.data && res.data.choices && res.data.choices[0]
          && res.data.choices[0].message && res.data.choices[0].message.content;
        if (!content) return reject(errOf('LLM_BAD_RESPONSE', 'AI 接口返回结构异常'));
        resolve(content);
      },
      fail: function (e) {
        reject(errOf('LLM_REQUEST_FAIL', 'AI 请求失败：' + ((e && e.errMsg) || '网络错误')));
      }
    });
  });
}

// 模型返回内容 → 单词数组（容忍代码围栏 / 数组外附带说明 / 非严格 JSON）
function parseWords(content) {
  if (content == null) return [];
  let text = String(content).trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const s = text.indexOf('[');
  const e = text.lastIndexOf(']');
  if (s !== -1 && e > s) {
    try {
      const arr = JSON.parse(text.slice(s, e + 1));
      if (Array.isArray(arr)) {
        return arr.filter(function (x) { return typeof x === 'string' && x.trim(); })
          .map(function (x) { return x.trim(); });
      }
    } catch (err) { /* 非严格 JSON，落到兜底解析 */ }
  }
  const quoted = text.match(/["']([^"']+)["']/g);
  if (quoted && quoted.length) {
    return quoted.map(function (q) { return q.slice(1, -1).trim(); }).filter(Boolean);
  }
  return text.split(/[\n,、;；]+/).map(function (x) { return x.trim(); }).filter(Boolean);
}

// 识别返回 → [{ w, note }]（R06-A① 自评注记）；容忍字符串项 / 围栏 / 非严格 JSON，兜底走 parseWords
function parseEntries(content) {
  if (content == null) return [];
  let text = String(content).trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const s = text.indexOf('[');
  const e = text.lastIndexOf(']');
  if (s !== -1 && e > s) {
    try {
      const arr = JSON.parse(text.slice(s, e + 1));
      if (Array.isArray(arr)) {
        const out = [];
        arr.forEach(function (x) {
          if (typeof x === 'string') {
            if (x.trim()) out.push({ w: x.trim(), note: '' });
          } else if (x && typeof x === 'object' && typeof x.w === 'string' && x.w.trim()) {
            out.push({ w: x.w.trim(), note: (typeof x.note === 'string' ? x.note.trim() : '') });
          }
        });
        if (out.length) return out;
      }
    } catch (err) { /* 非严格 JSON，落到 parseWords 兜底 */ }
  }
  return parseWords(content).map(function (w) { return { w: w, note: '' }; });
}

// 纠错返回（JSON 对象）→ { w, note }；解析失败返回 null（R06-A②）
function parseCorrection(content) {
  if (content == null) return null;
  let text = String(content).trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s !== -1 && e > s) {
    try {
      const o = JSON.parse(text.slice(s, e + 1));
      if (o && typeof o.w === 'string' && o.w.trim()) {
        return { w: o.w.trim().toLowerCase(), note: (typeof o.note === 'string' ? o.note.trim() : '') };
      }
    } catch (err) { /* 落兜底 */ }
  }
  const q = text.match(/["']([a-zA-Z][a-zA-Z'’\-]{1,15})["']/);
  return q ? { w: q[1].toLowerCase(), note: '' } : null;
}

// 识别 / 纠错共用：图片 → 压缩 → { b64, mime }
function prepare(imageSrc) {
  let mime = 'jpeg';
  return getImageInfo(imageSrc)
    .then(function (info) { return compress(imageSrc, info); })
    .then(function (path) { mime = mimeOf(path); return fileBase64(path); })
    .then(function (b64) { return { b64: b64, mime: mime }; });
}

// 识别静态图：imageSrc 为本地临时文件路径。
// 返回 { words: [...], notes: { 词: 注记 } }（R06-A①：notes 仅含有注记的词）；VK 降级路线返回裸数组，由拍照页归一。
function recognize(imageSrc) {
  if (!configured()) return Promise.reject(errOf('LLM_UNCONFIGURED', '未配置 AI 识别 Key'));
  return prepare(imageSrc).then(function (p) {
    if (p.b64.length > MAX_B64) throw errOf('LLM_TOO_LARGE', '图片过大，切换本地识别');
    console.log('[LLM] 请求派发：' + cfg.model + '，base64 ' + Math.round(p.b64.length / 1024) + 'KB');
    return requestLLM(p.b64, p.mime, PROMPT);
  }).then(function (content) {
    const entries = parseEntries(content);
    const words = entries.map(function (x) { return x.w; });
    const notes = {};
    entries.forEach(function (x) { if (x.note) notes[x.w.toLowerCase()] = x.note; });
    console.log('[LLM] 识别返回 ' + words.length + ' 词：' + words.slice(0, 60).join(','));
    const noted = Object.keys(notes);
    if (noted.length) console.log('[LLM] 自评注记 ' + noted.length + ' 条：' + noted.join(','));
    if (!words.length) throw errOf('LLM_EMPTY', 'AI 未识别到单词');
    return { words: words, notes: notes };
  });
}

// R06-A②：单词级带图纠错——核对图中该单词拼写（括号注记按完整拼写计），返回 { w, note }
function fixPromptOf(word) {
  return '请仔细查看图片，核对英文单词「' + word + '」的拼写是否与图中一致。'
    + '要求：1) 以图片实际内容为准，教材括号注记按完整拼写计（如 dialog(ue) 计作 dialogue）；'
    + '2) 若图中真实拼写与「' + word + '」不同，返回图中真实拼写；相同则原样返回；'
    + '3) 不编造图中不存在的词。\n'
    + '输出格式：只输出 JSON 对象 {"w":"单词","note":"简短说明"}。';
}

function correctWord(imageSrc, word) {
  if (!configured()) return Promise.reject(errOf('LLM_UNCONFIGURED', '未配置 AI 识别 Key'));
  return prepare(imageSrc).then(function (p) {
    if (p.b64.length > MAX_B64) throw errOf('LLM_TOO_LARGE', '图片过大');
    console.log('[LLM] 纠错请求：' + word);
    return requestLLM(p.b64, p.mime, fixPromptOf(word));
  }).then(function (content) {
    const r = parseCorrection(content);
    console.log('[LLM] 纠错「' + word + '」→ ' + (r ? r.w + (r.note ? '（' + r.note + '）' : '') : '无结果'));
    if (!r || !r.w) throw errOf('LLM_FIX_EMPTY', 'AI 未返回纠错结果');
    return r;
  });
}

module.exports = {
  MODEL: cfg.model,
  BASE_URL: cfg.baseUrl,
  TIMEOUT: TIMEOUT,
  MAX_SEND_EDGE: MAX_SEND_EDGE,
  AUTO_FIX: AUTO_FIX,
  configured: configured,
  parseWords: parseWords,
  parseEntries: parseEntries,
  parseCorrection: parseCorrection,
  recognize: recognize,
  correctWord: correctWord
};
