// 配置只做「读入 + 归一 + 报问题」，不在这里决定规则行为。
import fsp from 'node:fs/promises'
import path from 'node:path'

export const DEFAULT_CONFIG = Object.freeze({
  ignore: [],
  rules: {},
  waivers: [],
  failOn: 'error',
  syntaxCheck: true,
  limits: {
    maxFileBytes: 4 * 1024 * 1024,
    largeFileWarnBytes: 5 * 1024 * 1024,
    largeFileErrorBytes: 50 * 1024 * 1024,
    maxFiles: 20000,
    maxFindings: 500,
    syntaxMaxFiles: 300,
    syntaxConcurrency: 4,
  },
  discovery: { depth: 3 },
})

const TOP_KEYS = new Set(['ignore', 'rules', 'waivers', 'failOn', 'syntaxCheck', 'limits', 'discovery'])
const LEVELS = new Set(['off', 'info', 'warn', 'error'])
const FAIL_ON = new Set(['info', 'warn', 'error'])
const LIMIT_KEYS = new Set([
  'maxFileBytes',
  'largeFileWarnBytes',
  'largeFileErrorBytes',
  'maxFiles',
  'maxFindings',
  'syntaxMaxFiles',
  'syntaxConcurrency',
])

export const CONFIG_FILE = '.pluginlint.json'

function cloneDefaults() {
  return structuredClone(DEFAULT_CONFIG)
}

function issue(rule, message, hint) {
  return { rule, file: CONFIG_FILE, line: null, message, hint }
}

export function normalizeConfig(raw, options = {}) {
  const issues = []
  const config = cloneDefaults()
  const known = options.knownRuleIds ? new Set(options.knownRuleIds) : null

  if (raw === undefined) return { config, issues }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push(issue('CFG001', '配置顶层必须是对象', '最外层写成 { ... }，不要用数组或字符串。'))
    return { config, issues }
  }

  for (const key of Object.keys(raw)) {
    if (!TOP_KEYS.has(key)) {
      issues.push(
        issue('CFG002', `不认识的配置字段 "${key}"`, `支持：${[...TOP_KEYS].join('、')}`),
      )
    }
  }

  if ('ignore' in raw) {
    if (!Array.isArray(raw.ignore) || raw.ignore.some((item) => typeof item !== 'string')) {
      issues.push(issue('CFG002', 'ignore 必须是字符串数组', '例如 "ignore": ["fixtures/**"]。'))
    } else {
      config.ignore = raw.ignore.filter((item) => item.trim() !== '')
    }
  }

  if ('rules' in raw) {
    if (!raw.rules || typeof raw.rules !== 'object' || Array.isArray(raw.rules)) {
      issues.push(issue('CFG002', 'rules 必须是对象（规则 id → 级别）', '例如 "rules": { "PAT001": "warn" }。'))
    } else {
      for (const [id, level] of Object.entries(raw.rules)) {
        if (known && !known.has(id)) {
          issues.push(issue('CFG003', `未知规则 id "${id}"`, '规则 id 区分大小写，见 README 的规则表。'))
          continue
        }
        if (!LEVELS.has(level)) {
          issues.push(issue('CFG003', `规则 "${id}" 的级别 "${level}" 无效`, '只能是 off / info / warn / error。'))
          continue
        }
        config.rules[id] = level
      }
    }
  }

  if ('waivers' in raw) {
    if (!Array.isArray(raw.waivers)) {
      issues.push(issue('CFG004', 'waivers 必须是数组', '每一项形如 { "file": "...", "rules": ["..."], "reason": "..." }。'))
    } else {
      raw.waivers.forEach((waiver, index) => {
        const label = `waivers[${index}]`
        if (!waiver || typeof waiver !== 'object' || Array.isArray(waiver)) {
          issues.push(issue('CFG004', `${label} 必须是对象`, '每一项形如 { "file": "...", "rules": ["..."], "reason": "..." }。'))
          return
        }
        if (typeof waiver.file !== 'string' || waiver.file.trim() === '') {
          issues.push(issue('CFG004', `${label} 缺少 file`, '写相对于包根的文件路径，例如 "lib/rules/patterns.mjs"。'))
        }
        if (!Array.isArray(waiver.rules) || waiver.rules.length === 0) {
          issues.push(issue('CFG004', `${label} 缺少 rules`, '至少写一个规则 id，例如 ["PAT001"]。'))
          return
        }
        const rules = []
        for (const id of waiver.rules) {
          if (typeof id !== 'string') {
            issues.push(issue('CFG004', `${label}.rules 里有非字符串项`, '规则 id 必须是字符串。'))
            continue
          }
          if (known && !known.has(id)) {
            issues.push(issue('CFG003', `${label} 引用了未知规则 "${id}"`, '规则 id 区分大小写，见 README 的规则表。'))
            continue
          }
          rules.push(id)
        }
        if (typeof waiver.reason !== 'string' || waiver.reason.trim() === '') {
          issues.push(issue('CFG004', `${label} 缺少 reason`, '必须写明为什么豁免，否则下次没人敢删。'))
          return
        }
        if (rules.length > 0 && typeof waiver.file === 'string' && waiver.file.trim() !== '') {
          config.waivers.push({ file: waiver.file, rules, reason: waiver.reason })
        }
      })
    }
  }

  if ('failOn' in raw) {
    if (!FAIL_ON.has(raw.failOn)) {
      issues.push(issue('CFG002', `failOn 的值 "${raw.failOn}" 无效`, '只能是 error / warn / info。'))
    } else {
      config.failOn = raw.failOn
    }
  }

  if ('syntaxCheck' in raw) {
    if (typeof raw.syntaxCheck !== 'boolean') {
      issues.push(issue('CFG002', 'syntaxCheck 必须是布尔值', '写 true 或 false。'))
    } else {
      config.syntaxCheck = raw.syntaxCheck
    }
  }

  if ('limits' in raw) {
    if (!raw.limits || typeof raw.limits !== 'object' || Array.isArray(raw.limits)) {
      issues.push(issue('CFG002', 'limits 必须是对象', '例如 "limits": { "maxFiles": 10000 }。'))
    } else {
      for (const [key, value] of Object.entries(raw.limits)) {
        if (!LIMIT_KEYS.has(key)) {
          issues.push(issue('CFG002', `不认识的 limits 字段 "${key}"`, `支持：${[...LIMIT_KEYS].join('、')}`))
          continue
        }
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
          issues.push(issue('CFG002', `limits.${key} 必须是正数`, '写字节数或条数。'))
          continue
        }
        if (key === 'syntaxConcurrency' && (!Number.isInteger(value) || value > 16)) {
          issues.push(issue('CFG002', 'limits.syntaxConcurrency 必须是 1–16 的整数', '并发太高只会抢 CPU。'))
          continue
        }
        config.limits[key] = value
      }
    }
  }

  if ('discovery' in raw) {
    if (options.isPackageLevel) {
      issues.push(issue('CFG004', '包级配置不能设置 discovery', 'discovery 只对扫描根生效，请放在仓库根的 .pluginlint.json。'))
    } else if (!raw.discovery || typeof raw.discovery !== 'object' || Array.isArray(raw.discovery)) {
      issues.push(issue('CFG002', 'discovery 必须是对象', '例如 "discovery": { "depth": 2 }。'))
    } else {
      if ('depth' in raw.discovery) {
        const depth = raw.discovery.depth
        if (!Number.isInteger(depth) || depth < 0 || depth > 20) {
          issues.push(issue('CFG002', 'discovery.depth 必须是 0–20 的整数', '0 表示只看扫描根本身。'))
        } else {
          config.discovery.depth = depth
        }
      }
      for (const key of Object.keys(raw.discovery)) {
        if (key !== 'depth') {
          issues.push(issue('CFG002', `不认识的 discovery 字段 "${key}"`, '目前只支持 depth。'))
        }
      }
    }
  }

  return { config, issues }
}

export async function loadConfig(dir, options = {}) {
  const file = path.join(dir, CONFIG_FILE)
  let text
  try {
    text = await fsp.readFile(file, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return { config: cloneDefaults(), issues: [], exists: false }
    return {
      config: cloneDefaults(),
      issues: [issue('CFG001', `配置读取失败：${err.message}`, '检查文件权限。')],
      exists: true,
    }
  }
  let raw
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return {
      config: cloneDefaults(),
      issues: [issue('CFG001', `配置不是合法 JSON：${err.message}`, '用 UTF-8 保存，去掉尾逗号。')],
      exists: true,
    }
  }
  const normalized = normalizeConfig(raw, options)
  return { ...normalized, exists: true }
}
