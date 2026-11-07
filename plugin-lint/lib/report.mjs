// 报告层：只做聚合、判定与渲染，不再读盘。
import { createRequire } from 'node:module'

const pkg = createRequire(import.meta.url)('../package.json')

export const TOOL = Object.freeze({ name: pkg.name, version: pkg.version })

const RANK = { info: 0, warn: 1, error: 2 }

export function verdictOf(findings, failOn = 'error') {
  if (failOn === 'none') return 'publishable'
  const threshold = RANK[failOn] ?? RANK.error
  return findings.some((item) => RANK[item.severity] >= threshold) ? 'blocked' : 'publishable'
}

export function buildReport({
  packages = [],
  topFindings = [],
  now = new Date(),
  tool = TOOL,
  failOn = 'error',
} = {}) {
  const counts = { error: 0, warn: 0, info: 0 }
  for (const item of packages) {
    counts.error += item.counts.error
    counts.warn += item.counts.warn
    counts.info += item.counts.info
  }
  for (const item of topFindings) {
    if (item.severity in counts) counts[item.severity] += 1
  }
  const waived = packages.reduce((sum, item) => sum + item.waived, 0)
  const disabledRules = [...new Set(packages.flatMap((item) => item.disabledRules ?? []))].sort()
  const blocked =
    packages.some((item) => item.verdict === 'blocked') ||
    verdictOf(topFindings, failOn) === 'blocked'

  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    tool: { name: tool.name, version: tool.version },
    verdict: blocked ? 'blocked' : 'publishable',
    counts,
    waived,
    disabledRules,
    findings: topFindings,
    packages,
  }
}

function escapeCell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim()
}

function location(item) {
  if (!item.file) return '—'
  return item.line ? `${item.file}:${item.line}` : item.file
}

function findingTable(findings, limit) {
  const lines = ['| 级别 | 规则 | 位置 | 问题 | 修法 |', '|---|---|---|---|---|']
  for (const item of findings.slice(0, limit)) {
    lines.push(
      `| ${item.severity} | ${item.rule} | ${escapeCell(location(item))} | ${escapeCell(item.message)} | ${escapeCell(item.hint)} |`,
    )
  }
  return lines
}

function checklistLines(checklist) {
  return checklist.map((item) => {
    const box = item.status === 'pass' ? 'x' : item.status === 'skipped' ? '-' : ' '
    let suffix = ''
    if (item.status === 'fail') suffix = `（${item.error} error）`
    else if (item.status === 'warn') suffix = `（${item.warn} warn）`
    else if (item.status === 'skipped') suffix = '（已关闭）'
    return `- [${box}] ${item.title}${suffix}`
  })
}

export function renderMarkdown(report, { limit = 12 } = {}) {
  const lines = ['# 插件发布前自检', '']
  const conclusion = report.verdict === 'blocked' ? '不可发' : '可发'
  lines.push(
    `结论：**${conclusion}**（${report.packages.length} 个包，${report.counts.error} error / ${report.counts.warn} warn / ${report.counts.info} info；waived ${report.waived}）`,
  )
  lines.push(`生成时间：${report.generatedAt}  工具：${report.tool.name} ${report.tool.version}`)
  lines.push('')

  if (report.disabledRules.length > 0) {
    lines.push(`> 本次有 ${report.disabledRules.length} 条规则被关闭：${report.disabledRules.join('、')}`)
    lines.push('')
  }

  if (report.findings.length > 0) {
    lines.push('## 扫描级问题', '')
    lines.push(...findingTable(report.findings, limit))
    lines.push('')
  }

  for (const item of report.packages) {
    lines.push(`## ${item.name} — ${item.verdict === 'blocked' ? '不可发' : '可发'}`, '')
    lines.push(`目录：\`${item.dir}\``)
    lines.push(
      `文件：发布 ${item.files.published} / 忽略 ${item.files.ignored} / 裁剪 ${item.files.pruned} / 二进制 ${item.files.binary} / 文本 ${item.files.text} / 超大跳过 ${item.files.large}`,
    )
    lines.push('')
    if (item.truncated) {
      lines.push('> findings 超过 maxFindings，下面只展示一部分；判定按全量。')
      lines.push('')
    }
    if (item.findings.length === 0) {
      lines.push('没有发现问题。', '')
    } else {
      lines.push(...findingTable(item.findings, limit))
      lines.push('')
    }
    lines.push('### 检查单', '')
    lines.push(...checklistLines(item.checklist))
    lines.push('')
  }

  return `${lines.join('\n').trimEnd()}\n`
}
