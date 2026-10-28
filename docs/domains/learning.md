# 学习与批次域

教材批次默认 35 词；未完成照片会话优先且不受该上限限制。新单词页可增删当前批单词：添加经有道查义后由 `addToCurrentBatch` 加入当前待学批（拍照批追加进会话；教材批记为手动补充词 `vocab_batch_extras_<id>`，出批时合并进批末、完成学习随快照记入后清空，不占游标）；删除与词库页同义（`removeWords` 账号级联动清理）。完成学习时写入不可变词条快照，并推进相应队列或游标。学习模式和自由复习不改变正式调度。

代码落点：`utils/store.js` 的 `nextBatch`、`addToCurrentBatch`、`saveLearnedBatch`、`removeWords`，页面 `pages/new`、`pages/study`、`pages/history`。验收：批次优先级、游标推进、快照稳定性、手动补充词与删除联动通过 L1。
