// OCR provider：微信 VisionKit 端上静态图识别（ADR-001 主路线，R02=A 已拍板）
// 免 Key、免认证、图片不出设备；识别不达标时以相同接口签名切换备选 provider（百度 OCR）。
// 流程：图片路径 → 小图按短边放大（长边 ≤ MAX_EDGE 的压缩/截图副本，封顶 MAX_UPSCALE）
//       → 按版面分块（以放大后的有效尺寸计算，每块长边上限 MAX_EDGE，边界有少量重叠）
//       → 离屏 canvas 绘制并压缩 → getImageData(RGBA)
//       → VKSession(track.OCR mode 2) runOCR → updateAnchors 事件返回 VKOCRAnchor[].text
// 注意：VKSession 在开发者工具模拟器不可用，OCR 链路必须真机验证（F6/F7）。
// F6 教训（2026-09-06）：wx.isVKSupport 参数是 VK 版本 'v1'/'v2'，不是能力名——
// 传 'OCR' 恒返回 false，导致所有真机被误判为不支持（官方文档 wx.isVKSupport 页）。
// runOCR 官方无回调参数，结果通过 session.on('updateAnchors') 事件返回（官方 OCR 检测指南）。
// errno=2003000 教训（2026-09-06，官方 VKSession.start 码表）：2003000=会话不可用，
// 相机权限另有专用码 2003001/2003002；处置 = 相机 scope 预检 + 启动失败销毁重建会话重试。

const MAX_EDGE = 1280;   // 单块长边上限（控制内存与识别耗时）
const MIN_SHORT_EDGE = 640; // 小图放大目标短边：压缩/截图副本字高不足（963×246 词表图实测字高仅 ~9px，全图漏出 1 词），拉大后回到可识别区间
const MAX_UPSCALE = 3;   // 放大上限：超过后插值增益有限，耗时与内存反而上涨
const TILE_OVERLAP = 48; // 分块重叠，避免边界处切断单词
const RUN_TIMEOUT = 6000;  // 单块 runOCR 等待 updateAnchors 的超时（毫秒）
const RECOGNIZE_TIMEOUT = 25000; // 整张图片识别总时限，避免多块累计后长时间无反馈
const IMAGE_LOAD_TIMEOUT = 5000; // 单块图片解码 / canvas 读取超时
const START_ATTEMPTS = 2;  // 会话启动尝试次数（首启 + 销毁重建重试 1 次）
const RETRY_DELAY = 300;   // 两次启动尝试间隔（毫秒），留时间给引擎回收
const START_TIMEOUT = 8000; // start 回调未返回时的单次启动上限

// 官方 VKSession.start 回调 status 码表（developers.weixin.qq.com VKSession.start 页）
const ERRNO_DESC = {
  104: '用户取消授权——重新操作并在弹窗中允许',
  112: '接口未在隐私协议中声明——隐私指引审核通过后生效',
  1025: '小程序隐私接口被封禁',
  2000000: '系统错误',
  2000001: '参数错误',
  2000002: '设备不支持',
  2000003: '系统不支持',
  2000004: '设备不支持',
  2003000: '会话不可用——VisionKit 会话初始化失败，已自动重建会话重试仍失败；鸿蒙端微信暂未支持 AI 模块（官方适配指南），其他机型端上 OCR 可能不可用',
  2003001: '系统相机权限未开启——手机系统设置 → 微信 → 相机',
  2003002: '小程序相机权限未开启——小程序右上角「···」→ 设置 → 摄像头'
};

function errnoText(n) {
  return ERRNO_DESC[n] ? '（' + ERRNO_DESC[n] + '）' : '';
}

function sdkVersion() {
  try {
    if (wx.getAppBaseInfo) return wx.getAppBaseInfo().SDKVersion || '';
    return (wx.getSystemInfoSync && wx.getSystemInfoSync().SDKVersion) || '';
  } catch (e) { return ''; }
}

function sdkAtLeast(min) { // min 形如 '2.27.0'
  const a = sdkVersion().split('.');
  const b = min.split('.');
  for (let i = 0; i < b.length; i++) {
    const x = parseInt(a[i] || '0', 10);
    const y = parseInt(b[i] || '0', 10);
    if (x !== y) return x > y;
  }
  return true;
}

// 环境是否具备 VK OCR 条件：基础库 ≥ 2.27.0（OCR track 门槛）且设备支持 VisionKit（v1 或 v2 任一）。
// isVKSupport 查的是 VK 版本支持而非 OCR 能力；个别机型级不可用会在 start/runOCR 阶段以 errno 暴露。
function supported() {
  if (!wx.createVKSession || !wx.isVKSupport) return false;
  if (!sdkAtLeast('2.27.0')) return false;
  return !!(wx.isVKSupport('v1') || wx.isVKSupport('v2'));
}

// 鸿蒙端检测（方案1 拍板 2026-09-06）：官方《HarmonyOS 适配指南》指定判据 platform === 'ohos'，
// 真机 system 实测为 "OpenHarmony(OS) X.Y" 前缀；开发者工具模拟鸿蒙时 platform 为 devtools、system == 'HarmonyOS'。
// 鸿蒙微信未实现 AI 模块（官方接口支持表），VK OCR 会话必失败（F6 六/七轮双机实测 2003000）；
// 微信鸿蒙端支持 AI 模块后移除此预判即可恢复（运维手册踩坑 #14）。
function ohos() {
  try {
    const d = (wx.getDeviceInfo && wx.getDeviceInfo()) ||
              (wx.getSystemInfoSync && wx.getSystemInfoSync()) || {};
    const sys = d.system || '';
    return d.platform === 'ohos' || sys.indexOf('OpenHarmony') === 0 || sys === 'HarmonyOS';
  } catch (e) { return false; }
}

let session = null;
let pending = null; // { resolve, timer }：本次 runOCR 等待 updateAnchors 的挂起项
let recognizeQueue = Promise.resolve(); // VKSession 单会话串行化，避免连续选图互相覆盖 pending

function linesFrom(anchors) {
  return (anchors || []).map(function (x) { return (x.text || '').trim(); })
    .filter(function (t) { return t; });
}

// 日志用：识别文本原文摘要（JSON 序列化保留换行/空格原貌，超长截断并标注总长）
function briefText(lines) {
  const s = JSON.stringify(lines);
  return s.length > 600 ? s.slice(0, 600) + '…(共 ' + s.length + ' 字符)' : s;
}

function createSession() {
  const currentSession = wx.createVKSession({ track: { OCR: { mode: 2 } } });
  session = currentSession;
  // 官方静态图模式：每调一次 runOCR 触发一次 updateAnchors 事件
  currentSession.on('updateAnchors', function (anchors) {
    if (session !== currentSession) return;
    if (!pending) return;
    const p = pending; pending = null;
    clearTimeout(p.timer);
    const lines = linesFrom(anchors);
    console.log('[OCR] 收到结果：' + lines.length + ' 行，耗时 ' + (Date.now() - p.t0) + 'ms');
    p.resolve(lines);
  });
  return session;
}

function getSession() {
  return session || createSession();
}

function destroySession() {
  if (session) {
    try { if (session.destroy) session.destroy(); } catch (e) { /* 忽略销毁异常，反正要丢弃 */ }
  }
  session = null;
  started = false;
}

// 相机 scope 预检：VK 会话走相机管线，静态图模式部分机型也要求摄像头授权（社区对策 + errno 2003002）。
// 已授权直接过；从未询问则弹授权；曾拒绝则给出开启路径（wx.authorize 对已拒绝不再弹窗）。
function ensureCameraScope() {
  return new Promise(function (resolve, reject) {
    if (!wx.getSetting) return resolve();
    wx.getSetting({
      success: function (res) {
        const cam = res.authSetting['scope.camera'];
        if (cam === true) return resolve();
        if (cam === false) {
          return reject(new Error('摄像头授权未开启：请在小程序右上角「···」→「设置」中开启「摄像头」后重试'));
        }
        if (!wx.authorize) return resolve();
        wx.authorize({
          scope: 'scope.camera',
          success: function () { resolve(); },
          fail: function () {
            reject(new Error('摄像头授权未开启：请在小程序右上角「···」→「设置」中开启「摄像头」后重试'));
          }
        });
      },
      fail: function () { resolve(); } // 查询失败不阻塞，交给 start 的 errno 兜底
    });
  });
}

let started = false;
function attemptStart(attempt) {
  return new Promise(function (resolve, reject) {
    // 官方签名 start(errno => ...)：失败返回 errno 数字，成功返回 null
    let settled = false;
    const timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      console.log('[OCR] 会话启动超时，准备重建');
      destroySession();
      if (attempt < START_ATTEMPTS) {
        return setTimeout(function () {
          attemptStart(attempt + 1).then(resolve, reject);
        }, RETRY_DELAY);
      }
      reject(new Error('VKSession 启动超时，请重启微信后重试'));
    }, START_TIMEOUT);
    getSession().start(function (errno) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!errno) {
        started = true;
        console.log('[OCR] 会话启动成功');
        return resolve();
      }
      const n = (errno && typeof errno === 'object') ? errno.errMsg : errno;
      console.log('[OCR] 启动失败 errno=', n);
      if (attempt < START_ATTEMPTS) {
        // 会话级失败（如 2003000 会话不可用）常见于偶发初始化失败：销毁重建后重试
        destroySession();
        setTimeout(function () {
          attemptStart(attempt + 1).then(resolve, reject);
        }, RETRY_DELAY);
        return;
      }
      reject(new Error('VKSession 启动失败，errno=' + n + errnoText(n)));
    });
  });
}

function ensureStart() {
  if (started) return Promise.resolve();
  return ensureCameraScope().then(function () {
    return attemptStart(1);
  });
}

function getImageInfo(src) {
  return new Promise(function (resolve, reject) {
    wx.getImageInfo({
      src: src,
      success: resolve,
      fail: function (e) { reject(new Error('读取图片失败：' + (e && e.errMsg))); }
    });
  });
}

// 小图放大倍数：长边 ≤ MAX_EDGE 且短边不足 MIN_SHORT_EDGE 时按短边补齐，封顶 MAX_UPSCALE；
// 大图（长边 > MAX_EDGE）返回 1，走原有降采样分块路径，不对已清晰的原图做无谓放大。
// 例：963×246 词表截图 → ×2.6 ≈ 2504×640，字高 ~9px → ~22px，且放大后触发按列分块。
function upscaleFor(width, height) {
  if (Math.max(width, height) > MAX_EDGE) return 1;
  return Math.min(MAX_UPSCALE, Math.max(1, MIN_SHORT_EDGE / Math.min(width, height)));
}

// 将超宽/超高图片切成带少量重叠的块；每块独立 OCR，避免整页缩小后跨栏粘连。
// 入参为「有效尺寸」（= 原图尺寸 × upscaleFor 倍数）：小图放大后若超过 MAX_EDGE，
// 自然进入分块路径，无需单独的小图版式规则。
function regionsFor(width, height) {
  if (width <= MAX_EDGE && height <= MAX_EDGE) {
    return [{ x: 0, y: 0, width: width, height: height }];
  }
  // 宽版词表通常按列排词；块宽收紧到图高的约 85%，尽量保证一块只含一列。
  // 上下限避免普通横图被切得过碎，也避免超长横幅整行粘连。
  const maxTileWidth = Math.min(MAX_EDGE, Math.max(480, Math.round(height * 0.85)));
  const maxTileHeight = Math.min(MAX_EDGE, Math.max(480, Math.round(width * 0.85)));
  const cols = Math.max(1, Math.ceil(width / maxTileWidth));
  const rows = Math.max(1, Math.ceil(height / maxTileHeight));
  const out = [];
  for (let row = 0; row < rows; row++) {
    const y = Math.floor(row * height / rows);
    const y2 = Math.ceil((row + 1) * height / rows);
    for (let col = 0; col < cols; col++) {
      const x = Math.floor(col * width / cols);
      const x2 = Math.ceil((col + 1) * width / cols);
      out.push({
        x: Math.max(0, x - (col ? TILE_OVERLAP : 0)),
        y: Math.max(0, y - (row ? TILE_OVERLAP : 0)),
        width: Math.min(width, x2 + (col < cols - 1 ? TILE_OVERLAP : 0)) - Math.max(0, x - (col ? TILE_OVERLAP : 0)),
        height: Math.min(height, y2 + (row < rows - 1 ? TILE_OVERLAP : 0)) - Math.max(0, y - (row ? TILE_OVERLAP : 0))
      });
    }
  }
  return out;
}

// 图片区域 → 压缩后的像素数据 { data: ArrayBuffer, width, height }
// region 坐标基于放大后的有效尺寸，绘制时按 upscale 映射回源图坐标
function loadImageData(src, region, upscale) {
  return new Promise(function (resolve, reject) {
    let settled = false;
    const timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      const err = new Error('图片处理超时，请重试');
      err.code = 'OCR_IMAGE_TIMEOUT';
      reject(err);
    }, IMAGE_LOAD_TIMEOUT);
    const scale = Math.min(1, MAX_EDGE / Math.max(region.width, region.height));
    const w = Math.max(1, Math.round(region.width * scale));
    const h = Math.max(1, Math.round(region.height * scale));
    const canvas = wx.createOffscreenCanvas({ type: '2d', width: w, height: h });
    const ctx = canvas.getContext('2d');
    try { ctx.imageSmoothingQuality = 'high'; } catch (e) { /* 低版本基础库忽略，退回默认插值 */ }
    const img = canvas.createImage();
    img.onload = function () {
      if (settled) return;
      const u = upscale || 1;
      const sx = Math.max(0, Math.round(region.x / u));
      const sy = Math.max(0, Math.round(region.y / u));
      const sw = Math.min(img.width - sx, region.width / u);
      const sh = Math.min(img.height - sy, region.height / u);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
      const d = ctx.getImageData(0, 0, w, h);
      settled = true;
      clearTimeout(timer);
      resolve({ data: d.data.buffer, width: w, height: h });
    };
    img.onerror = function () {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('图片加载失败'));
    };
    img.src = src;
  });
}

function recognizeFrame(img) {
  return new Promise(function (resolve, reject) {
    console.log('[OCR] runOCR 已派发：' + img.width + 'x' + img.height);
    pending = {
      resolve: resolve,
      t0: Date.now(),
      timer: setTimeout(function () {
        if (pending) {
          pending = null;
          console.log('[OCR] 超时：' + RUN_TIMEOUT + 'ms 未收到 updateAnchors，已重置会话');
          destroySession();
          const err = new Error('OCR 超时（未收到识别结果）');
          err.code = 'OCR_TIMEOUT';
          reject(err);
        }
      }, RUN_TIMEOUT)
    };
    const currentSession = getSession();
    currentSession.runOCR(
      { frameBuffer: img.data, width: img.width, height: img.height },
      function (a, b) {
        if (session !== currentSession) return;
        const anchors = Array.isArray(a) ? a : (Array.isArray(b) ? b : null);
        if (!anchors || !pending) return;
        const p = pending; pending = null;
        clearTimeout(p.timer);
        p.resolve(linesFrom(anchors));
      }
    );
  });
}

// 识别静态图：imageSrc 为本地临时文件路径，返回识别文本行数组
function recognize(imageSrc, onProgress) {
  function run() {
    return getImageInfo(imageSrc).then(function (info) {
      const upscale = upscaleFor(info.width, info.height);
      const effW = Math.round(info.width * upscale);
      const effH = Math.round(info.height * upscale);
      const regions = regionsFor(effW, effH);
      console.log('[OCR] 源图 ' + info.width + 'x' + info.height + '，放大 ' + upscale.toFixed(2) + ' 倍 → ' + effW + 'x' + effH + '，分 ' + regions.length + ' 块');
      const deadline = Date.now() + RECOGNIZE_TIMEOUT;
      return ensureStart().then(function () {
        const lines = [];
        let lastError = null;
        function next(i) {
          if (i >= regions.length || Date.now() >= deadline) {
            if (lines.length) return Promise.resolve(lines);
            return Promise.reject(lastError || new Error('OCR 未在限定时间内返回结果，请调整图片后重试'));
          }
          if (onProgress) onProgress(i + 1, regions.length);
          return loadImageData(imageSrc, regions[i], upscale).then(recognizeFrame).then(function (part) {
            // 诊断日志（真机回传定性用，定案后随其余 [OCR] 日志一并移除）：打印每块识别文本原文
            console.log('[OCR] 块 ' + (i + 1) + '/' + regions.length + ' 识别文本：' + briefText(part));
            part.forEach(function (line) { lines.push(line); });
            return next(i + 1);
          }).catch(function (err) {
            // 某一块未返回事件时继续尝试后续区域；已有结果仍可正常进入候选页。
            if (!err || err.code !== 'OCR_TIMEOUT') throw err;
            lastError = err;
            console.log('[OCR] 跳过超时分块：' + (i + 1) + '/' + regions.length);
            return ensureStart().then(function () { return next(i + 1); });
          });
        }
        return next(0);
      });
    });
  }
  const queued = recognizeQueue.then(run, run);
  recognizeQueue = queued.catch(function () { /* 当前请求失败不阻塞下一张图 */ });
  return queued;
}

module.exports = {
  MAX_EDGE: MAX_EDGE,
  MIN_SHORT_EDGE: MIN_SHORT_EDGE,
  MAX_UPSCALE: MAX_UPSCALE,
  ERRNO_DESC: ERRNO_DESC,
  supported: supported,
  ohos: ohos,
  upscaleFor: upscaleFor,   // 以下两函数导出供 L1 测试（纯函数，不依赖 wx）
  regionsFor: regionsFor,
  recognize: recognize
};
