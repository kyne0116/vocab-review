# 外部服务契约

| 服务 | 用途 | 域名 | 约束 |
|---|---|---|---|
| 有道词典 | 查义、拓展、TTS | `dict.youdao.com` | 需配置 request/downloadFile 合法域名；免 Key |
| 智谱 GLM | 视觉识别、纠错建议 | `open.bigmodel.cn` | Key 只从本地未入库配置读取；失败降级 OCR；2026-11-08 起模型 glm-4.6v-flash（4.5V/4.6V 系列自动关思考模式），L3 真机验证通过 |
| VisionKit | 端上 OCR 降级 | 设备能力 | 需真机验证，模拟器不作结论 |

新增域名必须同步更新根 README 和本文件，并记录 L3/L4 验证状态。
