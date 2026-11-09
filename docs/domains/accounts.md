# 账号与词库域

## 契约

账号来自 `data/accounts.js`，切换账号只改变当前上下文（`vocab_account` 指针）。所有可变学习数据按 `accountId` 分键。静态词删除是账号级软删除；源词库不变。

切换只允许发生在首页（页面栈底）：首页是唯一持有切换入口的页面，其余页面从首页进入、返回首页时已销毁。切换后首页整体重读（`refresh`），词库、游标、批次、拍照队列、删词、补充词、视图偏好、宠物档位互不串号；家庭榜（`getAccountsOverview`）不切账号、直接按各账号键名读取。头部卡「切换账号 ▸」仅滚动定位到家庭榜（`wx.pageScrollTo` + selector），切换仍由家庭榜行点按完成。

「一键初始化」（`resetAccountProgress`）只清空当前账号的全部账号级键（records / cursor / photo_words / photo_sessions / deleted / review_view / batch_extras / pet_stage），另一账号数据、全局键与当前账号指针不受影响；`vocab_photo_migrated` 迁移标记保留（防旧数据重迁）。新增账号级存储键时必须同步加入该函数的清理清单（场景 27 按 `vocab_` 前缀 + 账号后缀取全集断言，漏项会测试失败）。

## 代码落点

`utils/store.js`：`currentAccount`、`switchAccount`、`resetAccountProgress`、`currentBank`、`getBankEntries`、`removeWords`、`getAccountsOverview`。页面：`pages/index`（家庭榜行点按切换 + `goFamily` 滚动）、`pages/bank`、`pages/overview`。

## 完成标准

切换账号后词库、游标、拍照队列、批次和统计互不串号；相关逻辑通过 L1。测试场景 5、21、27：两账号交替学习/复习/删词/补词/收词/改偏好互不影响、来回切换 20 次仅指针变化、一键初始化只清当前账号（含变异验证：漏清键、键改全局、误清所有账号均被抓）。`goFamily` 滚动与切换刷新为页面级交互，L1 由 Node 页面模拟覆盖，滚动定位与切换动画以 L2 模拟器为准（2026-11-09 未做）。

## 修复记录

- 2026-11-09：首页头部卡「切换账号 ▸」绑定不存在的 `goFamily`，点击无反应（R18 收敛入口时遗留）。按 README 既定行为补 `goFamily`：`wx.pageScrollTo` 滚动到家庭榜，不新增切换路径。验证：L1 页面模拟（调用参数、只滚动不切换、家庭榜点按仍可切换）；滚动定位真机表现属 L3，未验证。
