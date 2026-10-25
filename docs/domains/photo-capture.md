# 拍照收词域

## 契约

图片进入 GLM 识别；失败时进入 VisionKit OCR。文本经过候选提取、去重和噪声过滤，用户确认后批量查义。查义失败的词不能收录。已存在词显示为已收录，可随照片会话学习；照片会话保持顺序并作为整体批次优先。

## 代码落点

`pages/photo`、`utils/llm.js`、`utils/ocr.js`、`utils/wordParser.js`、`utils/lookup.js`、`utils/store.js` 的照片会话函数。

## 完成标准

候选、查义、收录、失败降级和账号隔离均有 L0/L1 证据；摄像头、隐私弹窗、真实网络和设备 OCR 只能由 L3/L4 证明。
