# 存储契约

| 键 | 内容 | 隔离 |
|---|---|---|
| `vocab_account` | 当前账号 id | 全局 |
| `vocab_records_<id>` | 批次快照、复习历史、遗忘池 | 账号 |
| `vocab_cursor_<id>` | 教材游标 | 账号 |
| `vocab_photo_words_<id>` | 拍照词队列 | 账号 |
| `vocab_photo_sessions_<id>` | 照片会话 | 账号 |
| `vocab_batch_extras_<id>` | 教材当前批手动补充词（完成学习时清空） | 账号 |
| `vocab_deleted_<id>` | 静态词软删除集合 | 账号 |
| `vocab_review_view_<id>` | 复习视图偏好 | 账号 |
| `vocab_link_cache` | 有道拓展缓存 | 全局 |

词条格式为 `{ w, m, p? }`。业务键按英文大小写不敏感比较，展示保留快照原文。
