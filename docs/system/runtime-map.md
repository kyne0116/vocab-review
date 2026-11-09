# 运行时地图

| 层 | 位置 | 责任 |
|---|---|---|
| 应用入口 | `app.js`、`app.json`、`app.wxss` | 全局启动和页面注册 |
| 页面 | `pages/index`、`new`、`study`、`review`、`spell`、`history`、`wrong`、`overview`、`photo`、`bank`、`guide` | 用户交互 |
| 状态与持久化 | `utils/store.js` | 账号、批次、复习、统计、本地键 |
| 拍照链路 | `utils/llm.js`、`utils/ocr.js`、`utils/wordParser.js` | 识别和候选解析 |
| 词典与声音 | `utils/lookup.js`、`utils/tts.js` | 查义、拓展、朗读 |
| 静态数据 | `data/accounts.js`、`data/primary.js`、`data/junior.js` | 账号和教材 |
| 逻辑测试 | `test/test-logic.js` | Node 可运行的行为测试 |

页面文件约束：`app.json` 注册的每个页面须同时具备同名 `.js`、`.wxml`、`.json`（`.json` 按惯例设置 `navigationBarTitleText`）。缺 `.json` 时开发者工具报「页面 json 文件缺失 … 无法注册为页面」（2026-11-09，工具 2.02.2609250 实测）。
