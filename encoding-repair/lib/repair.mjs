// 包级编排：读取发布集合里的文件，判定编码，按 fix 决定是否写回。
import fsp from 'node:fs/promises'
import path from 'node:path'
import { discoverPackages } from './discover.mjs'
import { sniff } from './sniff.mjs'
import { walkFiles, DEFAULT_LIMITS } from './walk.mjs'

const TOOL = { name: 'dsh-encoding-repair', version: '0.1.0' }

function tempPath(abs) {
  const dir = path.dirname(abs)
  const base = path.basename(abs)
  return path.join(dir, `.${base}.encoding-repair-${process.pid}-${Date.now()}.tmp`)
}

async function makeBackup(abs, original) {
  for (let index = 0; index < 100; index += 1) {
    const candidate = index === 0 ? `${abs}.bak` : `${abs}.bak.${index}`
    try {
      await fsp.writeFile(candidate, original, { flag: 'wx' })
      return candidate
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
    }
  }
  throw new Error('无法创建备份：.bak 文件名已用尽')
}

async function writeConverted(abs, original, text) {
  const stat = await fsp.stat(abs)
  const backup = await makeBackup(abs, original)
  const output = Buffer.from(text, 'utf8')
  const temp = tempPath(abs)
  try {
    await fsp.writeFile(temp, output)
    try {
      await fsp.rename(temp, abs)
    } catch (err) {
      // Windows 上目标被占用时 rename 会 EPERM/EBUSY；备份已经存在，退化为原地覆盖。
      if (err.code !== 'EPERM' && err.code !== 'EBUSY' && err.code !== 'EACCES') throw err
      await fsp.writeFile(abs, output)
      await fsp.rm(temp, { force: true })
    }
    try {
      await fsp.chmod(abs, stat.mode)
    } catch {
      // 权限保留失败不影响内容转换。
    }
    return backup
  } catch (err) {
    await fsp.rm(temp, { force: true }).catch(() => {})
    throw err
  }
}

async function packageName(dir) {
  try {
    const manifest = JSON.parse(await fsp.readFile(path.join(dir, 'package.json'), 'utf8'))
    if (typeof manifest?.name === 'string' && manifest.name.trim()) return manifest.name.trim()
  } catch {
    // 清单坏了也能继续扫，只是名字退化。
  }
  return path.basename(dir)
}

function emptyCounts() {
  return { files: 0, clean: 0, fixable: 0, fixed: 0, reported: 0, binary: 0, errors: 0 }
}

function addCounts(target, source) {
  for (const key of Object.keys(target)) target[key] += source[key] || 0
}

async function inspectPackage(dir, { fix, limits }) {
  const counts = emptyCounts()
  const entries = []
  const errors = []
  const walk = await walkFiles(dir, { limits })
  counts.files = walk.files.length

  for (const file of walk.files) {
    let buf
    try {
      buf = await fsp.readFile(file.abs)
    } catch (err) {
      counts.errors += 1
      errors.push({ file: file.rel, message: `读取失败：${err.message}` })
      entries.push({ file: file.rel, encoding: 'unknown', confidence: 'low', action: 'error', bytes: file.size, reason: '读取失败' })
      continue
    }

    const result = sniff(buf)
    if (result.encoding === 'binary') {
      counts.binary += 1
      continue
    }

    if (result.fixable) {
      counts.fixable += 1
      if (!fix) {
        entries.push({
          file: file.rel,
          encoding: result.encoding,
          confidence: result.confidence,
          action: 'would-fix',
          bytes: buf.length,
          reason: result.reason,
        })
        continue
      }
      try {
        const backup = await writeConverted(file.abs, buf, result.text)
        const after = Buffer.byteLength(result.text, 'utf8')
        counts.fixed += 1
        entries.push({
          file: file.rel,
          encoding: result.encoding,
          confidence: result.confidence,
          action: 'fixed',
          bytes: buf.length,
          textBytes: after,
          backup: path.relative(dir, backup).replace(/\\/g, '/'),
          reason: result.reason,
        })
      } catch (err) {
        counts.errors += 1
        errors.push({ file: file.rel, message: `写回失败：${err.message}` })
        entries.push({
          file: file.rel,
          encoding: result.encoding,
          confidence: result.confidence,
          action: 'error',
          bytes: buf.length,
          reason: `写回失败：${err.message}`,
        })
      }
      continue
    }

    if (result.mojibake || result.encoding === 'big5' || result.encoding === 'ambiguous' || result.encoding === 'unknown') {
      counts.reported += 1
      entries.push({
        file: file.rel,
        encoding: result.encoding,
        confidence: result.confidence,
        action: 'report',
        bytes: buf.length,
        reason: result.reason,
      })
      continue
    }

    counts.clean += 1
  }

  for (const large of walk.largeSkipped) {
    entries.push({
      file: large.rel,
      encoding: 'unknown',
      confidence: 'low',
      action: 'skipped-large',
      bytes: large.size,
      reason: `超过 ${limits.maxFileBytes} 字节上限，未读取`,
    })
  }
  for (const error of walk.readErrors) {
    counts.errors += 1
    errors.push({ file: error.rel, message: `遍历失败：${error.message}` })
  }

  return {
    dir,
    name: await packageName(dir),
    counts,
    entries,
    errors,
    skipped: {
      ignored: walk.ignored.length,
      pruned: walk.pruned.length,
      large: walk.largeSkipped.length,
      backups: walk.skippedBackups,
      truncated: walk.truncated,
    },
    stats: walk.stats,
  }
}

export async function repair(options = {}) {
  const fix = options.fix === true
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) }
  const now = options.now instanceof Date ? options.now : new Date()

  let dirs
  if (Array.isArray(options.dirs) && options.dirs.length > 0) {
    if (options.root) throw new Error('dirs 与 root 只能给一个')
    dirs = options.dirs.map((dir) => path.resolve(dir))
  } else {
    if (!options.root) throw new Error('必须给 dirs 或 root')
    const discovered = await discoverPackages(path.resolve(options.root), {
      depth: options.depth,
    })
    dirs = discovered.packages
  }

  const packages = []
  for (const dir of dirs) {
    const stat = await fsp.stat(dir).catch(() => null)
    if (!stat || !stat.isDirectory()) throw new Error(`不是目录：${dir}`)
    packages.push(await inspectPackage(dir, { fix, limits }))
  }

  const counts = emptyCounts()
  for (const pkg of packages) addCounts(counts, pkg.counts)

  let verdict
  if (counts.fixable > 0 && !fix) verdict = 'fixable'
  else if (counts.errors > 0) verdict = 'partial'
  else if (counts.fixed > 0) verdict = 'fixed'
  else verdict = 'clean'

  return {
    schemaVersion: 1,
    tool: TOOL,
    generatedAt: now.toISOString(),
    fix,
    packages,
    counts,
    verdict,
  }
}
