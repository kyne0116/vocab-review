// OCR provider：微信 VisionKit 端上静态图识别（ADR-001 主路线，R02=A 已拍板）
// 免 Key、免认证、图片不出设备；识别不达标时以相同接口签名切换备选 provider（百度 OCR）。
// 流程：图片路径 → 离屏 canvas 绘制并压缩（长边上限 MAX_EDGE）→ getImageData(RGBA)
//       → VKSession(track.OCR mode 2) runOCR → updateAnchors 事件返回 VKOCRAnchor[].text
// 注意：VKSession 在开发者工具模拟器不可用，OCR 链路必须真机验证（F6/F7）。
// F6 教训（2026-09-06）：wx.isVKSupport 参数是 VK 版本 'v1'/'v2'，不是能力名——
// 传 'OCR' 恒返回 false，导致所有真机被误判为不支持（官方文档 wx.isVKSupport 页）。
// runOCR 官方无回调参数，结果通过 session.on('updateAnchors') 事件返回（官方 OCR 检测指南）。
// errno=2003000 教训（2026-09-06，官方 VKSession.start 码表）：2003000=会话不可用，
// 相机权限另有专用码 2003001/2003002；处置 = 相机 scope 预检 + 启动失败销毁重建会话重试。

const MAX_EDGE = 1280;   // 压缩后长边上限（控制内存与识别耗时）
const RUN_TIMEOUT = 10000; // runOCR 后等待 updateAnchors 事件的超时（毫秒）
const START_ATTEMPTS = 2;  // 会话启动尝试次数（首启 + 销毁重建重试 1 次）
const RETRY_DELAY = 300;   // 两次启动尝试间隔（毫秒），留时间给引擎回收

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

// 验证页展示用：基础库版本 + v1/v2 检测结果
function vkInfo() {
  return {
    sdk: sdkVersion(),
    v1: !!(wx.isVKSupport && wx.isVKSupport('v1')),
    v2: !!(wx.isVKSupport && wx.isVKSupport('v2'))
  };
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

function linesFrom(anchors) {
  return (anchors || []).map(function (x) { return (x.text || '').trim(); })
    .filter(function (t) { return t; });
}

function createSession() {
  session = wx.createVKSession({ track: { OCR: { mode: 2 } } });
  // 官方静态图模式：每调一次 runOCR 触发一次 updateAnchors 事件
  session.on('updateAnchors', function (anchors) {
    if (!pending) return;
    const p = pending; pending = null;
    clearTimeout(p.timer);
    p.resolve(linesFrom(anchors));
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
    getSession().start(function (errno) {
      if (!errno) { started = true; return resolve(); }
      const n = (errno && typeof errno === 'object') ? errno.errMsg : errno;
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

// 图片 → 压缩后的像素数据 { data: ArrayBuffer, width, height }
function loadImageData(src) {
  return new Promise(function (resolve, reject) {
    wx.getImageInfo({
      src: src,
      success: function (info) {
        const scale = Math.min(1, MAX_EDGE / Math.max(info.width, info.height));
        const w = Math.round(info.width * scale);
        const h = Math.round(info.height * scale);
        const canvas = wx.createOffscreenCanvas({ type: '2d', width: w, height: h });
        const ctx = canvas.getContext('2d');
        const img = canvas.createImage();
        img.onload = function () {
          ctx.drawImage(img, 0, 0, w, h);
          const d = ctx.getImageData(0, 0, w, h);
          resolve({ data: d.data.buffer, width: w, height: h });
        };
        img.onerror = function () { reject(new Error('图片加载失败')); };
        img.src = src;
      },
      fail: function (e) { reject(new Error('读取图片失败：' + (e && e.errMsg))); }
    });
  });
}

// 识别静态图：imageSrc 为本地临时文件路径，返回识别文本行数组
function recognize(imageSrc) {
  return loadImageData(imageSrc).then(function (img) {
    return ensureStart().then(function () {
      return new Promise(function (resolve, reject) {
        pending = {
          resolve: resolve,
          timer: setTimeout(function () {
            if (pending) { pending = null; reject(new Error('OCR 超时（未收到识别结果）')); }
          }, RUN_TIMEOUT)
        };
        getSession().runOCR(
          { frameBuffer: img.data, width: img.width, height: img.height },
          function (a, b) {
            // 官方 runOCR 无回调参数，结果走 updateAnchors；保留兼容分支以防个别版本回调返回 anchors
            const anchors = Array.isArray(a) ? a : (Array.isArray(b) ? b : null);
            if (!anchors || !pending) return;
            const p = pending; pending = null;
            clearTimeout(p.timer);
            p.resolve(linesFrom(anchors));
          }
        );
      });
    });
  });
}

module.exports = {
  MAX_EDGE: MAX_EDGE,
  ERRNO_DESC: ERRNO_DESC,
  supported: supported,
  vkInfo: vkInfo,
  ohos: ohos,
  recognize: recognize
};
