// 朗读（文本转语音）工具
// 基于「有道词典」公开发音接口，无需 API Key、无需插件，个人未认证小程序也可用：
//   - 英文单词/短语：https://dict.youdao.com/dictvoice?audio=VOLleyball&type=2   （type=1 英音 / type=2 美音）
//   - 中文词条：     https://dict.youdao.com/speech?le=zh&audio=你好            （仅词典收录的词语有效）
//
// 真机使用前需在小程序后台配置「服务器域名」→「downloadFile 合法域名」，加入：
//   https://dict.youdao.com
// 开发者工具模拟器不受域名校验限制，可直接发声。
//
// 局限：中文接口只覆盖词典收录的词语，长句 / 生僻短语可能无返回（只是没有声音，
// 不报错、不影响其他功能）；英文单词与常见短语发音稳定。

// ★ 发音配置：英文朗读声线（有道 dictvoice 接口）
//   type=2 → 美式发音   type=1 → 英式发音
// 想切换口味只改这一行即可，全应用（点词、连播、学习模式）同步生效
const EN_VOICE_TYPE = 2; // 2=美式  1=英式

let audio = null;    // 内部音频播放器
let timers = [];     // 连读报读的定时器句柄

function available() {
  return true; // 不再依赖插件，只要联网且域名配置正确即可用
}

// 停止正在进行的连读报读（重复点击 / 离开页面时调用）
function stopSpoken() {
  timers.forEach(function (t) { clearTimeout(t); });
  timers = [];
}

function play(url) {
  try {
    if (!audio) {
      audio = wx.createInnerAudioContext();
      audio.obeyMuteSwitch = false; // 静音模式下仍可朗读
    }
    audio.stop();
    audio.src = url;
    audio.play();
  } catch (e) { /* 播放失败则忽略 */ }
}

// 清理释义文本：去掉词性标注、剥离括号注释、统一分号，
// 使中文朗读更自然、更可能命中词条
// 例：'v. 骑 n. 旅程' → '骑 旅程'（多义项用空格连接的，由 zhParts 按空格拆分）
// 例：'n. 脚（复数 feet）' → '脚'（括号里的复数/拼写提示不朗读，乱拆会失真）
function cleanText(text) {
  return (text || '')
    .replace(/\b(n|v|vt|vi|adj|adv|prep|pron|conj|num|art|interj|int|aux|abbr)\b\./gi, ' ')
    .replace(/[；;]\s*/g, '，')
    .replace(/[（(][^（）()]*[）)]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// 朗读报读文本：取释义的首个义项。有道中文发音只对词典收录的"单个词语"生效，
// 完整释义常带"；。"等分隔符导致无返回（静默无声），故报读时只取第一段：
// 例：'n. 名字；名称' → '名字'；'adj. 高兴的；n. 高兴' → '高兴的'
function briefText(text) {
  const c = cleanText(text);              // 先去词性标注、分号转逗号
  const first = c.split(/[，,]/)[0];
  return (first || c).trim();
}

function buildUrl(text, lang) {
  const enc = encodeURIComponent(text);
  if (lang === 'en_US') {
    return 'https://dict.youdao.com/dictvoice?audio=' + enc + '&type=' + EN_VOICE_TYPE;
  }
  return 'https://dict.youdao.com/speech?le=zh&audio=' + enc;
}

// 朗读文本：lang = 'zh_CN'（中文）或 'en_US'（英文）
function speak(text, lang) {
  if (!text) return;
  play(buildUrl(text, lang));
}

// 中文释义拆分：按「，、空格」等分隔符把释义拆成多个"单段"，逐段连播。
// 有道中文发音只对词典收录的"单个词语"生效，带空格的组合串 / 长句会静默；
// 拆开逐段播音时改读"主要内容"，多义项（含用空格连接的）也都能读出来。
// 例：'v. 骑 n. 旅程' → '骑 旅程' → ['骑', '旅程']；'打扫 干净的' → 两段
const EN_WINDOW = 1500; // 英文起播后到本遍中文第一段间的时间窗口
const SEG_GAP = 1000;   // 段与段之间的间隔（覆盖单段播放时长）
const MAX_PARTS = 4;    // 单词释义最多拆几段连播（保留前几个义项，避免拖慢连播节奏）
function zhParts(text) {
  return cleanText(text || '')
    .split(/[，,。、\s]+/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return /[一-龥]/.test(s); }) // 只保留含中文的段，丢掉"/"、英文等残屑
    .slice(0, MAX_PARTS);
}

// 连读报读（学习/新词/错词本）："英文 + 中文(可拆多段)"为一遍，遍间停 gap 毫秒，共 times 遍
// 示例：speakPair('hello', '你好', 3, 1200) → 英 · 中 →1.2s→ 英 · 中 →1.2s→ 英 · 中
//       speakPair('abandon', 'v. 放弃；抛弃', 1, 1200) → 英 · "放弃"→"抛弃"（分段连播）
// 返回预计总时长（毫秒），供连播调度按实际进度等待（词义越多轮越长）
function speakPair(enText, zhText, times, gap) {
  stopSpoken(); // 重复点击立即重头开始
  const en = (enText || '').trim();
  const zh = zhParts(zhText);
  if (!en && !zh.length) return 0;
  const n = times || 3;
  const g = gap || 1200;
  // 每遍时长 = 英文窗口 + 中文段组 + 遍间停顿（段数越多本遍越长）
  const zhSpan = Math.max(0, zh.length - 1) * SEG_GAP;
  const round = EN_WINDOW + zhSpan + g;
  for (let i = 0; i < n; i++) {
    const base = i * round;
    if (en) timers.push(setTimeout(function () { play(buildUrl(en, 'en_US')); }, base));
    zh.forEach(function (seg, j) {
      timers.push(setTimeout(function () {
        play(buildUrl(seg, 'zh_CN'));
      }, base + EN_WINDOW + j * SEG_GAP));
    });
  }
  return n * round;
}

module.exports = {
  available: available,
  speak: speak,
  stopSpoken: stopSpoken,
  speakPair: speakPair,
  cleanText: cleanText,
  briefText: briefText,
  zhParts: zhParts
};