// 发布集合遍历：只决定要检查哪些文件，不做编码判断。
import fsp from 'node:fs/promises'
import path from 'node:path'
import { parseGitignore } from './gitignore.mjs'

export const PRUNE_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  '.venv',
  '__pycache__',
  '.cache',
  '.DS_Store',
])

export const DEFAULT_LIMITS = {
  maxFileBytes: 8 * 1024 * 1024,
  maxFiles: 20000,
}

const BACKUP_RE = /\.bak(?:\.\d+)?$/i
const TEMP_RE = /\.encoding-repair-\d+-\d+\.tmp$/i

function matchAll(stack, extra, rel, isDir) {
  let result = { ignored: false, rule: null }
  for (const matcher of stack) {
    const hit = matcher.match(rel, isDir)
    if (hit.rule !== null) result = hit
  }
  if (extra) {
    const hit = extra.match(rel, isDir)
    if (hit.rule !== null) result = hit
  }
  return result
}

async function readNestedGitignore(dir) {
  try {
    const text = await fsp.readFile(path.join(dir, '.gitignore'), 'utf8')
    return parseGitignore(text)
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

export async function walkFiles(dir, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) }
  const ignore = Array.isArray(options.ignore) ? options.ignore : []
  const extra = ignore.length > 0 ? parseGitignore(ignore.join('\n')) : null

  const files = []
  const ignored = []
  const pruned = []
  const readErrors = []
  const largeSkipped = []
  let skippedBackups = 0
  let seen = 0
  let truncated = false

  async function walk(current, relDir, stack) {
    if (truncated) return
    let entries
    try {
      entries = await fsp.readdir(current, { withFileTypes: true })
    } catch (err) {
      readErrors.push({ rel: relDir || '.', message: err.message })
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))

    let matchers = stack
    try {
      const nested = await readNestedGitignore(current)
      if (nested) matchers = [...stack, nested]
    } catch (err) {
      readErrors.push({ rel: relDir ? `${relDir}/.gitignore` : '.gitignore', message: err.message })
    }

    for (const entry of entries) {
      if (truncated) return
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        const fixed = PRUNE_DIRS.has(entry.name)
        if (fixed) {
          pruned.push({ rel, reason: 'vendor', ignored: matchAll(matchers, extra, rel, true).ignored })
          continue
        }
        const hit = matchAll(matchers, extra, rel, true)
        if (hit.ignored) {
          pruned.push({ rel, reason: 'gitignore', ignored: true })
          continue
        }
        await walk(path.join(current, entry.name), rel, matchers)
        continue
      }

      if (!entry.isFile() && !entry.isSymbolicLink()) continue

      let stat
      try {
        stat = await fsp.stat(path.join(current, entry.name))
      } catch (err) {
        readErrors.push({ rel, message: err.message })
        continue
      }
      if (!stat.isFile()) continue

      if (PRUNE_DIRS.has(entry.name)) continue
      if (BACKUP_RE.test(entry.name) || TEMP_RE.test(entry.name)) {
        skippedBackups += 1
        continue
      }

      const hit = matchAll(matchers, extra, rel, false)
      if (hit.ignored) {
        ignored.push({ rel, rule: hit.rule })
        continue
      }

      if (stat.size > limits.maxFileBytes) {
        largeSkipped.push({ rel, size: stat.size })
        continue
      }

      if (seen >= limits.maxFiles) {
        truncated = true
        return
      }
      seen += 1
      files.push({ rel, abs: path.join(current, entry.name), size: stat.size })
    }
  }

  await walk(dir, '', [])

  return {
    files,
    ignored,
    pruned,
    readErrors,
    largeSkipped,
    skippedBackups,
    truncated,
    stats: {
      published: files.length,
      ignored: ignored.length,
      pruned: pruned.length,
      large: largeSkipped.length,
      backups: skippedBackups,
    },
  }
}
