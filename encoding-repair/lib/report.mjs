// 报告：Markdown 给人看，JSON 给工具/CI 看。
const ACTION_TEXT = {
  'would-fix': '待修',
  fixed: '已修复',
  report: '需人工确认',
  error: '失败',
  'skipped-large': '跳过',
}

function conclusion(report) {
  if (report.counts.errors > 0) return '部分失败'
  if (report.fix) {
    if (report.counts.fixed > 0) return `已修复 ${report.counts.fixed} 个文件`
    if (report.counts.reported > 0) return '没有可自动修的文件，但有需要人工确认的文件'
    return '无需处理'
  }
  if (report.counts.fixable > 0) return `发现 ${report.counts.fixable} 个可修文件（dry-run，未写入）`
  if (report.counts.reported > 0) return '没有可自动修的文件，但有需要人工确认的文件'
  return '无需处理'
}

function renderPackage(pkg, limit) {
  const lines = []
  lines.push(`### ${pkg.name}`)
  lines.push('')
  lines.push(`目录：\`${pkg.dir}\``)
  lines.push('')
  lines.push(
    `文件 ${pkg.counts.files}，干净 ${pkg.counts.clean}，可修 ${pkg.counts.fixable}，已修 ${pkg.counts.fixed}，` +
      `需人工 ${pkg.counts.reported}，二进制 ${pkg.counts.binary}，错误 ${pkg.counts.errors}`,
  )
  lines.push('')

  const visible = pkg.entries.slice(0, limit)
  if (visible.length > 0) {
    lines.push('| 文件 | 检测 | 置信度 | 处理 | 说明 |')
    lines.push('|---|---|---|---|---|')
    for (const entry of visible) {
      lines.push(
        `| \`${entry.file}\` | ${entry.encoding} | ${entry.confidence} | ${ACTION_TEXT[entry.action] || entry.action} | ${entry.reason.replace(/\|/g, '\\|')} |`,
      )
    }
    if (pkg.entries.length > visible.length) lines.push(`| … | | | | 还有 ${pkg.entries.length - visible.length} 条，用 json 或 out 看完整报告 |`)
    lines.push('')
  }

  if (pkg.errors.length > 0) {
    lines.push('错误：')
    lines.push('')
    for (const error of pkg.errors) lines.push(`- \`${error.file}\`：${error.message}`)
    lines.push('')
  }
  return lines
}

export function renderMarkdown(report, { limit = 30 } = {}) {
  const lines = []
  lines.push('# 编码修复自检')
  lines.push('')
  lines.push(`结论：**${conclusion(report)}**`)
  lines.push('')
  lines.push(
    `模式：${report.fix ? '写回（已留 .bak）' : 'dry-run（只报告，不改文件）'}　` +
      `包 ${report.packages.length} 个　检查 ${report.counts.files} 个文件　` +
      `可修 ${report.counts.fixable}　已修 ${report.counts.fixed}　需人工 ${report.counts.reported}　错误 ${report.counts.errors}`,
  )
  lines.push('')
  lines.push(`生成时间：${report.generatedAt}`)
  lines.push('')

  const globalErrors = []
  for (const pkg of report.packages) {
    lines.push(...renderPackage(pkg, limit))
    for (const error of pkg.errors) globalErrors.push({ pkg: pkg.name, ...error })
  }

  if (report.packages.length === 0) {
    lines.push('没有发现插件包。')
    lines.push('')
  }

  if (!report.fix && report.counts.fixable > 0) {
    lines.push('---')
    lines.push('')
    lines.push('这是 dry-run。确认上面的文件后，用 `encoding_repair` 的 `fix: true` 或 CLI `--fix` 写回；每个文件会先留 `.bak`。')
    lines.push('')
  }

  return lines.join('\n')
}

export { conclusion }
