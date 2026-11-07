import fsp from 'node:fs/promises'
import path from 'node:path'
import { lint } from './engine.mjs'
import { renderMarkdown } from './report.mjs'

export const USAGE = `用法：plugin-lint [dirs...] [选项]

  插件发布前自检：检查清单、补丁、路径、编码、依赖、凭证、仓库卫生与语法。

选项：
  --root <dir>       扫描根，自动发现插件包（与位置参数二选一）
  --depth <n>        发现深度，默认 3
  --json             输出 JSON
  --out <dir>        把报告写到目录（plugin-lint-report.md 与 .json）
  --fail-on <level>  error | warn | info | none，默认 error
  --no-syntax        关闭语法检查
  --quiet            只输出结论一行
  --help, -h         显示这段帮助
`

class UsageError extends Error {}

function takeValue(argv, index, name) {
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new UsageError(`${name} 需要一个值`)
  }
  return value
}

function parseArgs(argv) {
  const options = {
    dirs: [],
    root: null,
    depth: null,
    json: false,
    out: null,
    failOn: null,
    syntax: true,
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
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg === '--quiet') {
      options.quiet = true
      continue
    }
    if (arg === '--no-syntax') {
      options.syntax = false
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
      if (!Number.isInteger(value) || value < 0 || value > 20) {
        throw new UsageError('--depth 必须是 0–20 的整数')
      }
      options.depth = value
      i += 1
      continue
    }
    if (arg === '--out') {
      options.out = takeValue(argv, i, '--out')
      i += 1
      continue
    }
    if (arg === '--fail-on') {
      const value = takeValue(argv, i, '--fail-on')
      if (!['error', 'warn', 'info', 'none'].includes(value)) {
        throw new UsageError('--fail-on 只能是 error / warn / info / none')
      }
      options.failOn = value
      i += 1
      continue
    }
    if (arg.startsWith('-')) throw new UsageError(`不认识的选项：${arg}`)
    options.dirs.push(arg)
  }
  if (options.root && options.dirs.length > 0) {
    throw new UsageError('--root 与位置参数目录只能给一个')
  }
  return options
}

function conclusion(report) {
  return report.verdict === 'blocked' ? '不可发' : '可发'
}

export async function runCli(argv, io = {}) {
  const cwd = io.cwd ?? process.cwd()
  const stdout = io.stdout ?? ((text) => process.stdout.write(text))
  const stderr = io.stderr ?? ((text) => process.stderr.write(text))

  let options
  try {
    options = parseArgs(argv)
  } catch (err) {
    stderr(`plugin-lint: ${err.message}\n\n${USAGE}`)
    return 2
  }

  if (options.help) {
    stdout(USAGE)
    return 0
  }

  const request = {
    failOn: options.failOn ?? undefined,
    syntax: options.syntax,
  }
  if (options.dirs.length > 0) {
    request.dirs = options.dirs.map((dir) => path.resolve(cwd, dir))
  } else {
    request.root = path.resolve(cwd, options.root ?? cwd)
    if (options.depth !== null) request.depth = options.depth
  }

  try {
    const report = await lint(request)
    const markdown = renderMarkdown(report, { limit: 12 })
    if (options.quiet) {
      stdout(`结论：${conclusion(report)}（${report.counts.error} error / ${report.counts.warn} warn / ${report.counts.info} info）\n`)
    } else if (options.json) {
      stdout(`${JSON.stringify(report, null, 2)}\n`)
    } else {
      stdout(markdown)
    }

    if (options.out) {
      const outDir = path.resolve(cwd, options.out)
      await fsp.mkdir(outDir, { recursive: true })
      await fsp.writeFile(path.join(outDir, 'plugin-lint-report.json'), `${JSON.stringify(report, null, 2)}\n`)
      await fsp.writeFile(path.join(outDir, 'plugin-lint-report.md'), markdown)
    }

    return report.verdict === 'blocked' ? 1 : 0
  } catch (err) {
    stderr(`plugin-lint: ${err.message}\n`)
    return 2
  }
}
