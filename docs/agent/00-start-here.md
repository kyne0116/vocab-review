# Agent 起点

你正在维护一个免插件、免服务器、零 npm 依赖的个人微信小程序。先完成本页，再进入任务分支。

## 执行顺序

1. 读取 [系统总览](../system/overview.md)，确认任务属于哪个业务域。
2. 读取对应 [业务域契约](../domains/)，再查看代码入口和数据影响。
3. 读取 [变更影响图](change-impact-map.md)，列出需要同步的文档、测试和配置。
4. 先修改契约，再实现代码；涉及 `utils/store.js` 或调度逻辑必须运行 `node test/test-logic.js`。
5. 按 [验证矩阵](verification-matrix.md) 记录最高真实验证等级。
6. 完成代码实现后，把 `app.js` 最后一行更新为本机时间戳 `YYYY-MM-DD HH:MM:SS`；纯文档变更不更新。

## 硬约束

- 不改变 `project.config.json` 的 appid，`urlCheck` 保持 `false`。
- 本地键使用 `vocab_` 前缀，并按账号隔离。
- 真实密钥只允许存在于被 gitignore 的 `utils/llm.config.js`；模板必须同步维护。
- 新网络域名必须同步更新根 README 和 [外部服务契约](../system/external-services.md)。
- 不提交截图、日志、临时脚本、覆盖率报告或个人数据。

## 完成标准

修改文件、行为变化、验证命令、通过结果、未验证事项和用户下一步都已写入对应契约或历史记录。
