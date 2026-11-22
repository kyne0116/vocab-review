// 智谱开放平台 Key 配置模板（首次启用 AI 主路线时使用）：
//   复制本文件为同目录 llm.config.js，填入你的 apiKey。
//   llm.config.js 已被 .gitignore 排除，不会进入版本库（本仓库为公开仓库，Key 严禁直接写进代码）。
// 未创建 llm.config.js 时：AI 主路线自动停用，拍照收词走本机 VisionKit 识别，其他功能不受影响。
module.exports = {
  apiKey: '', // 主 Key（免费模型 glm-4.6v-flash；open.bigmodel.cn 控制台创建，建议低额度便于撤换）
  model: 'glm-4.6v-flash', // 免费主路线；失败自动按 fallbacks 顺序切换收费 Key
  baseUrl: 'https://open.bigmodel.cn', // v4 接口域名，以智谱官方文档为准
  // 回退链（可选，2026-11-21）：主路线失败（429 限流/余额不足/网络错误）后依次尝试，
  // 顺序靠前优先；model 缺省用付费旗舰 glm-4.6v
  fallbacks: [
    // { apiKey: '', model: 'glm-4.6v' }
  ]
};
