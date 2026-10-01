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
    },
    {
      id: 'photo',
      name: '拍照生词本',
      desc: '拍照识别收录的生词（动态词库）',
      dynamic: true // 无静态 bank，词条存本地存储键 vocab_photo_bank
    }
  ]
};
