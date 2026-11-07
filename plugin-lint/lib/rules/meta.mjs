// 引擎直接产生的元规则：只登记 id / 分类 / 默认级别，便于配置校验和文档一致。
import { metaRule } from './util.mjs'

export const META_RULES = [
  metaRule({ id: 'WALK001', category: 'config', severity: 'info' }),
  metaRule({ id: 'WALK002', category: 'config', severity: 'info' }),
  metaRule({ id: 'WALK003', category: 'config', severity: 'info' }),
  metaRule({ id: 'WALK004', category: 'config', severity: 'warn' }),
  metaRule({ id: 'CFG001', category: 'config', severity: 'error' }),
  metaRule({ id: 'CFG002', category: 'config', severity: 'info' }),
  metaRule({ id: 'CFG003', category: 'config', severity: 'warn' }),
  metaRule({ id: 'CFG004', category: 'config', severity: 'warn' }),
  metaRule({ id: 'DISCOVER001', category: 'config', severity: 'info' }),
]
