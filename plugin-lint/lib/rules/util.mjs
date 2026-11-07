// 规则构造器与所有规则共享的常量；规则只声明元数据，执行逻辑在各自文件里。
export const CHECKLISTS = [
  { id: 'manifest', title: '清单与入口完整' },
  { id: 'patch', title: '补丁与注册' },
  { id: 'paths', title: '路径可移植' },
  { id: 'encoding', title: '编码统一' },
  { id: 'deps', title: '依赖完整' },
  { id: 'secrets', title: '无凭证泄露' },
  { id: 'repo', title: '仓库卫生' },
  { id: 'display', title: '文档与展示' },
  { id: 'syntax', title: '语法可加载' },
  { id: 'config', title: '配置与豁免' },
]

export function packageRule(definition) {
  return Object.freeze({ kind: 'package', ...definition })
}

export function textRule(definition) {
  return Object.freeze({ kind: 'text', ...definition })
}

export function metaRule(definition) {
  return Object.freeze({ kind: 'meta', ...definition })
}

export function severityFor(rule, scope = 'runtime') {
  const declared = rule.severity
  if (typeof declared === 'string') return declared
  if (declared && typeof declared === 'object') {
    return declared[scope] ?? declared.runtime ?? 'warn'
  }
  return 'warn'
}

export function finding(fields) {
  return fields
}

export function lineAt(text, index) {
  let line = 1
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1
  }
  return line
}

export function countSeverities(findings) {
  const counts = { error: 0, warn: 0, info: 0 }
  for (const item of findings) {
    if (item.severity in counts) counts[item.severity] += 1
  }
  return counts
}

export function buildChecklist(findings, { syntaxCheck = true } = {}) {
  return CHECKLISTS.map((item) => {
    const own = findings.filter((entry) => entry.category === item.id)
    const error = own.filter((entry) => entry.severity === 'error').length
    const warn = own.filter((entry) => entry.severity === 'warn').length
    let status = error > 0 ? 'fail' : warn > 0 ? 'warn' : 'pass'
    if (item.id === 'syntax' && syntaxCheck === false) status = 'skipped'
    return { id: item.id, title: item.title, status, error, warn }
  })
}
