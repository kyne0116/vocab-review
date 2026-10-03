const store = require('./utils/store.js');

App({
  onLaunch: function () {
    // R14 一次性迁移：旧「拍照生词本」账号数据并入初中账号（有标记防重跑，源键保留）
    store.migratePhotoAccount('junior');
  },
  globalData: {}
});

// ---- 实现时间戳（宪法见 AGENTS.md 强制规则 8）----
// agent 每轮完成代码实现后，把下一行时间更新为本机当前时间（年月日+时分秒）。
// 仅作代码内的最后实现标记；小程序界面不显示任何版本内容。
// 最后实现：2026-10-03 19:35:27
