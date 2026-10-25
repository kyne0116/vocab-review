# 账号与词库域

## 契约

账号来自 `data/accounts.js`，切换账号只改变当前上下文。所有可变学习数据按 `accountId` 分键。静态词删除是账号级软删除；源词库不变。

## 代码落点

`utils/store.js`：`currentAccount`、`switchAccount`、`currentBank`、`getBankEntries`、`removeWords`。页面：`pages/index`、`pages/bank`、`pages/overview`。

## 完成标准

切换账号后词库、游标、拍照队列、批次和统计互不串号；相关逻辑通过 L1。
