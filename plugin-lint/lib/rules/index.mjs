// 规则注册表：所有规则只在这里汇总一次，配置校验与文档都读它。
import { META_RULES } from './meta.mjs'
import { MANIFEST_RULES } from './manifest.mjs'
import { PATCH_RULES } from './patch.mjs'
import { PATH_RULES } from './paths.mjs'
import { ENCODING_RULES } from './encoding.mjs'

export const RULES = [...META_RULES, ...MANIFEST_RULES, ...PATCH_RULES, ...PATH_RULES, ...ENCODING_RULES]
export const RULE_BY_ID = new Map(RULES.map((rule) => [rule.id, rule]))
export const PACKAGE_RULES = RULES.filter((rule) => rule.kind === 'package' && typeof rule.run === 'function')
export const TEXT_RULES = RULES.filter((rule) => rule.kind === 'text' && typeof rule.run === 'function')
