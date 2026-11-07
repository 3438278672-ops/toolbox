// package.json 读取与 exports / files 语义（按 Node 的公开规则，不猜）。
import fsp from 'node:fs/promises'
import path from 'node:path'
import { globToRegex } from './gitignore.mjs'

export async function readManifest(dir) {
  const file = path.join(dir, 'package.json')
  try {
    const text = await fsp.readFile(file, 'utf8')
    const manifest = JSON.parse(text)
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      return { manifest: null, error: 'package.json 顶层必须是对象' }
    }
    return { manifest, error: null }
  } catch (err) {
    if (err.code === 'ENOENT') return { manifest: null, error: '缺少 package.json' }
    if (err instanceof SyntaxError) {
      return { manifest: null, error: `package.json JSON 解析失败：${err.message}` }
    }
    return { manifest: null, error: `package.json 读取失败：${err.message}` }
  }
}

function pickCondition(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const picked = pickCondition(item)
      if (picked) return picked
    }
    return null
  }
  if (value && typeof value === 'object') {
    for (const key of ['import', 'default', 'node', 'require', 'browser']) {
      if (key in value) {
        const picked = pickCondition(value[key])
        if (picked) return picked
      }
    }
    for (const item of Object.values(value)) {
      const picked = pickCondition(item)
      if (picked) return picked
    }
  }
  return null
}

export function exportTargets(manifest) {
  if (!manifest || typeof manifest !== 'object') return []
  const out = []

  if (manifest.exports !== undefined) {
    const entries = typeof manifest.exports === 'string' || Array.isArray(manifest.exports)
      ? [['.', manifest.exports]]
      : Object.entries(manifest.exports)
    for (const [subpath, raw] of entries) {
      const target = pickCondition(raw)
      if (!target) continue
      out.push({ subpath, target, pattern: target.includes('*') })
    }
    return out
  }

  if (typeof manifest.main === 'string' && manifest.main) {
    out.push({ subpath: '.', target: manifest.main, pattern: manifest.main.includes('*') })
  }
  return out
}

function normalizeFilesEntry(entry) {
  return String(entry).replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '')
}

function compileFilesEntry(entry) {
  const normalized = normalizeFilesEntry(entry)
  if (!normalized) return () => false
  if (normalized.includes('*') || normalized.includes('?')) {
    const body = globToRegex(normalized)
    const regex = new RegExp((normalized.includes('/') ? '^' : '(?:^|/)') + body + '$')
    return (rel) => regex.test(rel)
  }
  return (rel) => rel === normalized || rel.startsWith(normalized + '/')
}

export function filesMatcher(manifest) {
  if (!manifest || !Array.isArray(manifest.files)) return () => true
  const entries = manifest.files.filter((item) => typeof item === 'string').map(compileFilesEntry)
  const auto = (rel) => {
    if (rel === 'package.json') return true
    return /^(README|LICEN[CS]E|CHANGELOG)/i.test(path.posix.basename(rel))
  }
  return (rel) => auto(rel) || entries.some((match) => match(rel))
}
