// 发布版本信息：微信不向上传版本号提供运行时 API，此处为「代码内镜像」——
// 每次在开发者工具「上传」时与此处同步修改（版本号保持一致），首页底部展示供家人核对。
// 发布时间精确到秒：一天多次上传也能区分；填「上传」那一刻的时间即可。
const APP_VERSION = '1.1.0';
const RELEASE_TIME = '2026-10-01 21:20:22';

App({
  onLaunch: function () {},
  globalData: {
    appVersion: APP_VERSION,
    releaseTime: RELEASE_TIME
  }
});
