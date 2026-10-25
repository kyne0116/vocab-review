# 学习与批次域

教材批次默认 35 词；未完成照片会话优先且不受该上限限制。完成学习时写入不可变词条快照，并推进相应队列或游标。学习模式和自由复习不改变正式调度。

代码落点：`utils/store.js` 的 `nextBatch`、`saveLearnedBatch`，页面 `pages/new`、`pages/study`、`pages/history`。验收：批次优先级、游标推进、快照稳定性通过 L1。
