// 智谱开放平台 Key 配置模板（首次启用 AI 主路线时使用）：
//   复制本文件为同目录 llm.config.js，填入你的 apiKey。
//   llm.config.js 已被 .gitignore 排除，不会进入版本库（本仓库为公开仓库，Key 严禁直接写进代码）。
// 未创建 llm.config.js 时：AI 主路线自动停用，拍照收词走本机 VisionKit 识别，其他功能不受影响。
module.exports = {
  apiKey: '', // open.bigmodel.cn 控制台创建（建议低额度，便于泄露时撤换）
  model: 'glm-4.6v-flash', // 视觉模型（免费，2026-11 实测可用）；付费旗舰 glm-4.6v 需账户余额，更强
  baseUrl: 'https://open.bigmodel.cn' // v4 接口域名，以智谱官方文档为准
};
