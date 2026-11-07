import { spawn } from 'node:child_process'
import path from 'node:path'
import { packageRule } from './util.mjs'

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_FILES = 300
const DEFAULT_CONCURRENCY = 4
const runs = new WeakMap()

function defaultRunOne(execPath, file, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    let settled = false
    let stderr = ''
    const finish = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const child = spawn(execPath, ['--check', file], {
      cwd,
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    const timer = setTimeout(() => {
      child.kill()
      finish({ ok: false, timedOut: true, stderr })
    }, timeoutMs)
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      finish({ ok: false, spawnError: err, stderr })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      finish({ ok: code === 0, code, stderr })
    })
  })
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await fn(items[index], index)
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker())
  await Promise.all(workers)
  return results
}

function firstLine(text) {
  const line = String(text ?? '').trim().split(/\r?\n/)[0] ?? ''
  return line.slice(0, 200)
}

function extOf(rel) {
  return path.posix.extname(rel).toLowerCase()
}

function isCandidate(rel, type) {
  const ext = extOf(rel)
  if (ext === '.mjs' || ext === '.cjs') return true
  if (ext === '.js') return type === 'module'
  return false
}

async function computeSyntax(ctx) {
  const options = ctx.syntaxOptions ?? {}
  const execPath = options.execPath ?? process.execPath
  const runOne = options.runOne ?? defaultRunOne
  const type = ctx.manifest?.type
  const limits = ctx.config?.limits ?? {}
  const maxFiles = limits.syntaxMaxFiles ?? DEFAULT_MAX_FILES
  const concurrency = limits.syntaxConcurrency ?? DEFAULT_CONCURRENCY
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const candidates = ctx.files.filter(
    (file) => file.kind === 'text' && isCandidate(file.rel, type),
  )
  const checked = candidates.slice(0, maxFiles)
  const skipped = candidates.length - checked.length
  const jsWithoutType = ctx.files.filter(
    (file) => file.kind === 'text' && extOf(file.rel) === '.js' && type !== 'module',
  ).length

  const errors = []
  const infos = []
  const results = await mapPool(checked, concurrency, async (file) => {
    const abs = path.join(ctx.dir, ...file.rel.split('/'))
    try {
      return await runOne(execPath, abs, { cwd: ctx.dir, timeoutMs })
    } catch (err) {
      return { ok: false, spawnError: err }
    }
  })

  const unchecked = []
  for (let i = 0; i < results.length; i += 1) {
    const result = results[i]
    const file = checked[i]
    if (result.ok) continue
    if (result.spawnError || result.timedOut) {
      unchecked.push({
        file: file.rel,
        reason: result.timedOut
          ? `超时（${timeoutMs}ms）`
          : result.spawnError?.message ?? '启动失败',
      })
      continue
    }
    errors.push({
      file: file.rel,
      message: `语法错误：${file.rel}（${firstLine(result.stderr) || `退出码 ${result.code}`}）`,
      hint: '修到 node --check 通过；这一步不通过，插件加载时就会直接抛错。',
    })
  }

  if (unchecked.length > 0) {
    const first = unchecked[0]
    infos.push({
      file: first.file,
      message: `语法未检查：${unchecked.length} 个文件无法启动 node --check（${first.reason}）`,
      hint: '确认 node/Electron 可执行文件可用；也可以先关掉 syntaxCheck 再手动检查。',
    })
  }
  if (skipped > 0) {
    infos.push({
      message: `语法检查跳过 ${skipped} 个文件：超过 limits.syntaxMaxFiles（${maxFiles}）`,
      hint: '调大 limits.syntaxMaxFiles；或分批检查，先把已检查的修完。',
    })
  }
  if (jsWithoutType > 0) {
    infos.push({
      message: `有 ${jsWithoutType} 个 .js 文件因清单没有 type:"module" 未做语法检查`,
      hint: '如果这些确实是 ESM，补 type:"module"；CJS 文件可以用 node --check 手动确认。',
    })
  }
  return { errors, infos }
}

function cached(ctx) {
  if (!runs.has(ctx)) runs.set(ctx, computeSyntax(ctx))
  return runs.get(ctx)
}

export const SYNTAX_RULES = [
  packageRule({
    id: 'SYN001',
    category: 'syntax',
    checklist: 'syntax',
    severity: 'error',
    async run(ctx) {
      const { errors } = await cached(ctx)
      return errors
    },
  }),
  packageRule({
    id: 'SYN002',
    category: 'syntax',
    checklist: 'syntax',
    severity: 'info',
    async run(ctx) {
      const { infos } = await cached(ctx)
      return infos
    },
  }),
]
