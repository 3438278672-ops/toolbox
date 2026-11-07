import fsp from 'node:fs/promises'
import path from 'node:path'
import { PRUNE_DIRS } from './walk.mjs'
import { parseGitignore } from './gitignore.mjs'

async function exists(file) {
  try {
    await fsp.access(file)
    return true
  } catch {
    return false
  }
}

async function isCandidate(dir) {
  const manifestPath = path.join(dir, 'package.json')
  if (!(await exists(manifestPath))) return false
  if (await exists(path.join(dir, 'cordis.patch.yml'))) return true
  try {
    const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'))
    return typeof manifest?.dsh?.bundle?.patch === 'string' && manifest.dsh.bundle.patch.trim() !== ''
  } catch {
    return false
  }
}

export async function discoverPackages(root, { depth = 3, ignore = [] } = {}) {
  const expanded = []
  for (const pattern of ignore) {
    expanded.push(pattern)
    const match = /^(.*)\/\*\*$/.exec(pattern.trim())
    if (match && match[1]) expanded.push(match[1])
  }
  const matcher = expanded.length > 0 ? parseGitignore(expanded.join('\n')) : null
  const packages = []
  let scanned = 0

  async function visit(dir, rel, level) {
    if (level > depth) return
    scanned += 1
    if (level >= 1 && (await isCandidate(dir))) {
      packages.push(path.resolve(dir))
      return
    }
    if (level >= depth) return

    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.')) continue
      if (PRUNE_DIRS.has(entry.name)) continue
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      if (matcher?.match(childRel, true).ignored) continue
      await visit(path.join(dir, entry.name), childRel, level + 1)
    }
  }

  await visit(path.resolve(root), '', 0)
  return { packages: packages.sort(), scanned }
}
