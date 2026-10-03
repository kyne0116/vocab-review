// 账号配置：每个账号绑定一个词库，学习进度与记录完全独立
const junior = require('./junior.js');
const primary = require('./primary.js');

module.exports = {
  list: [
    {
      id: 'junior',
      name: '初中人教版',
      desc: '初中人教版单词短语 + 高频考点',
      bank: junior
    },
    {
      id: 'primary',
      name: '小学人教版',
      desc: '小学人教版单词短语 + 高频考点',
      bank: primary
    }
    // R14（2026-10-02）：拍照生词不再作为独立账号，直接并入当前账号的优先学习队列
    // （vocab_photo_words_<accountId>）；旧 photo 账号数据由 store.migratePhotoAccount 迁移。
  ]
};
