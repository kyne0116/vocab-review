# 变更影响图

| 任务信号 | 先读 | 代码入口 | 必做验证 |
|---|---|---|---|
| 账号、词库、批次、复习、遗忘池、错词本、统计 | `domains/accounts.md`、`domains/learning.md`、`domains/review.md` | `utils/store.js` | `node test/test-logic.js` |
| 拍照、OCR、候选词、查义、收录 | `domains/photo-capture.md` | `pages/photo`、`utils/llm.js`、`utils/ocr.js`、`utils/wordParser.js`、`utils/lookup.js` | L0/L1；真实链路需 L3/L4 |
| 朗读、拓展、例句 | `domains/feedback.md` | `utils/tts.js`、`utils/lookup.js` | L0；域名与真机需 L3 |
| 页面和导航 | `system/runtime-map.md` | `pages/<name>`、`app.json` | L0/L2 |
| 网络域名、Key、微信后台 | `system/external-services.md`、`operations/` | 配置与平台 | L3/L4 |
