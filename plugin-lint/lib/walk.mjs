// 文件集合层：只决定「git 会发布什么」，不解析内容。
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
  maxFileBytes: 4 * 1024 * 1024,
  maxFiles: 20000,
}

const UTF16_32_BOMS = [
  [0xff, 0xfe, 0x00, 0x00],
  [0x00, 0x00, 0xfe, 0xff],
  [0xff, 0xfe],
  [0xfe, 0xff],
]

function hasBom(buf, bytes) {
  if (buf.length < bytes.length) return false
  for (let i = 0; i < bytes.length; i++) {
    if (buf[i] !== bytes[i]) return false
  }
  return true
}

export function scopeOf(rel) {
  const p = String(rel).replace(/\\/g, '/').replace(/^\.\//, '')
  const base = p.split('/').pop() || p
  if (/^(test|tests|__tests__|spec|fixtures)\//.test(p)) return 'test'
  if (/\.(test|spec)\.[^/]+$/.test(p)) return 'test'
  if (/\.(md|mdx|rst)$/i.test(p)) return 'docs'
  if (/^(docs|doc)\//.test(p)) return 'docs'
  if (/^(LICENSE|CHANGELOG)/i.test(base)) return 'docs'
  return 'runtime'
}

export async function classifyFile(abs, size, maxFileBytes = DEFAULT_LIMITS.maxFileBytes) {
  if (size > maxFileBytes) return { kind: 'large', size }
  const length = Math.min(8192, size)
  if (length === 0) return { kind: 'text', size }

  const handle = await fsp.open(abs, 'r')
  try {
    const buf = Buffer.allocUnsafe(length)
    const { bytesRead } = await handle.read(buf, 0, length, 0)
    const head = buf.subarray(0, bytesRead)
    for (const bom of UTF16_32_BOMS) {
      if (hasBom(head, bom)) return { kind: 'text', size }
    }
    if (head.includes(0)) return { kind: 'binary', size }
    return { kind: 'text', size }
  } finally {
    await handle.close()
  }
}

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

export async function walkPackage(dir, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) }
  const ignore = Array.isArray(options.ignore) ? options.ignore : []
  const extra = ignore.length > 0 ? parseGitignore(ignore.join('\n')) : null

  const files = []
  const ignoredFiles = []
  const prunedDirs = []
  const readErrors = []
  const largeSkipped = []
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
          prunedDirs.push({ rel, reason: 'vendor', ignored: matchAll(matchers, extra, rel, true).ignored })
          continue
        }
        const hit = matchAll(matchers, extra, rel, true)
        if (hit.ignored) {
          prunedDirs.push({ rel, reason: 'gitignore', ignored: true })
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

      if (PRUNE_DIRS.has(entry.name)) {
        ignoredFiles.push({ rel, size: stat.size, kind: 'binary', rule: entry.name })
        continue
      }

      const hit = matchAll(matchers, extra, rel, false)
      if (hit.ignored) {
        let kind = 'text'
        try {
          kind = (await classifyFile(path.join(current, entry.name), stat.size, limits.maxFileBytes)).kind
        } catch (err) {
          readErrors.push({ rel, message: err.message })
        }
        ignoredFiles.push({ rel, size: stat.size, kind, rule: hit.rule })
        continue
      }

      if (seen >= limits.maxFiles) {
        truncated = true
        return
      }
      seen += 1

      let kind = 'text'
      try {
        kind = (await classifyFile(path.join(current, entry.name), stat.size, limits.maxFileBytes)).kind
      } catch (err) {
        readErrors.push({ rel, message: err.message })
      }
      if (kind === 'large') largeSkipped.push(rel)
      files.push({
        rel,
        abs: path.join(current, entry.name),
        size: stat.size,
        kind,
        scope: scopeOf(rel),
      })
    }
  }

  await walk(dir, '', [])

  const stats = {
    published: files.length,
    ignored: ignoredFiles.length,
    pruned: prunedDirs.length,
    binary: files.filter((f) => f.kind === 'binary').length,
    text: files.filter((f) => f.kind === 'text').length,
    large: files.filter((f) => f.kind === 'large').length,
  }

  return { files, ignoredFiles, prunedDirs, stats, readErrors, largeSkipped, truncated }
}
