import fsp from 'node:fs/promises'
import path from 'node:path'
import { repair } from './repair.mjs'
import { conclusion, renderMarkdown } from './report.mjs'

export const USAGE = `用法：encoding-repair [dirs...] [选项]

  把插件里 GBK / UTF-16 / UTF-8 BOM 的文件转回 UTF-8。
  默认 dry-run，只报告；--fix 才写文件，并在同目录留 .bak。

选项：
  --root <dir>    扫描根，自动发现插件包（与位置参数二选一）
  --depth <n>     发现深度，默认 3
  --fix           写回（默认只报告）
  --json          输出 JSON
  --out <dir>     把报告写到目录（encoding-repair-report.md 与 .json）
  --limit <n>     报告最多展示多少条，默认 30
  --quiet         只输出结论一行
  --help, -h      显示这段帮助
`

class UsageError extends Error {}

function takeValue(argv, index, name) {
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new UsageError(`${name} 需要一个值`)
  return value
}

function parseArgs(argv) {
  const options = {
    dirs: [],
    root: null,
    depth: null,
    fix: false,
    json: false,
    out: null,
    limit: 30,
    quiet: false,
    help: false,
  }
  let positionalOnly = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (positionalOnly) {
      options.dirs.push(arg)
      continue
    }
    if (arg === '--') {
      positionalOnly = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--fix') {
      options.fix = true
      continue
    }
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg === '--quiet') {
      options.quiet = true
      continue
    }
    if (arg === '--root') {
      options.root = takeValue(argv, i, '--root')
      i += 1
      continue
    }
    if (arg === '--depth') {
      const raw = takeValue(argv, i, '--depth')
      const value = Number(raw)
      if (!Number.isInteger(value) || value < 0 || value > 20) throw new UsageError('--depth 必须是 0–20 的整数')
      options.depth = value
      i += 1
      continue
    }
    if (arg === '--out') {
      options.out = takeValue(argv, i, '--out')
      i += 1
      continue
    }
    if (arg === '--limit') {
      const raw = takeValue(argv, i, '--limit')
      const value = Number(raw)
      if (!Number.isInteger(value) || value < 1 || value > 500) throw new UsageError('--limit 必须是 1–500 的整数')
      options.limit = value
      i += 1
      continue
    }
    if (arg.startsWith('-')) throw new UsageError(`不认识的选项：${arg}`)
    options.dirs.push(arg)
  }
  if (options.root && options.dirs.length > 0) throw new UsageError('--root 与位置参数目录只能给一个')
  return options
}

function exitCode(report) {
  if (report.counts.errors > 0) return 1
  if (report.verdict === 'fixable') return 1
  return 0
}

export async function runCli(argv, io = {}) {
  const cwd = io.cwd ?? process.cwd()
  const stdout = io.stdout ?? ((text) => process.stdout.write(text))
  const stderr = io.stderr ?? ((text) => process.stderr.write(text))

  let options
  try {
    options = parseArgs(argv)
  } catch (err) {
    stderr(`encoding-repair: ${err.message}\n\n${USAGE}`)
    return 2
  }

  if (options.help) {
    stdout(USAGE)
    return 0
  }

  const request = { fix: options.fix }
  if (options.dirs.length > 0) request.dirs = options.dirs.map((dir) => path.resolve(cwd, dir))
  else {
    request.root = path.resolve(cwd, options.root ?? cwd)
    if (options.depth !== null) request.depth = options.depth
  }

  try {
    const report = await repair(request)
    const markdown = renderMarkdown(report, { limit: options.limit })
    if (options.quiet) {
      stdout(`${conclusion(report)}\n`)
    } else if (options.json) {
      stdout(`${JSON.stringify(report, null, 2)}\n`)
    } else {
      stdout(markdown)
    }

    if (options.out) {
      const outDir = path.resolve(cwd, options.out)
      await fsp.mkdir(outDir, { recursive: true })
      await fsp.writeFile(path.join(outDir, 'encoding-repair-report.md'), markdown, 'utf8')
      await fsp.writeFile(path.join(outDir, 'encoding-repair-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    }

    return exitCode(report)
  } catch (err) {
    stderr(`encoding-repair: ${err.message}\n`)
    return 2
  }
}
