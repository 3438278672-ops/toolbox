import { createRequire } from 'node:module'
import path from 'node:path'
import { globToRegex } from '../gitignore.mjs'
import { exportTargets, filesMatcher } from '../manifest.mjs'
import { extractImports } from '../imports.mjs'
import { packageRule } from './util.mjs'

const SOURCE_RE = /\.(?:mjs|cjs|js)$/i

const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const ESM_LINE_RE = /(^|\n)[ \t]*(?:import(?:\s|\.meta)|export\s)/

function normalizeRel(value) {
  return String(value).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

function hasFile(ctx, target) {
  const rel = normalizeRel(target)
  if (rel.includes('*')) {
    const re = new RegExp(`^${globToRegex(rel)}$`)
    return ctx.files.some((file) => re.test(file.rel))
  }
  return ctx.files.some((file) => file.rel === rel)
}

function lineOf(text, index) {
  let line = 1
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1
  return line
}

export const MANIFEST_RULES = [
  packageRule({
    id: 'PKG001',
    category: 'manifest',
    checklist: 'manifest',
    severity: 'error',
    run(ctx) {
      if (!ctx.manifestError) return null
      return {
        message: `package.json 不可用：${ctx.manifestError}`,
        hint: '补一个合法的 package.json，至少包含 name、version、type、dsh.bundle.patch。',
      }
    },
  }),

  packageRule({
    id: 'PKG002',
    category: 'manifest',
    checklist: 'manifest',
    severity: 'error',
    run(ctx) {
      if (!ctx.manifest) return null
      const name = ctx.manifest.name
      if (typeof name === 'string' && NAME_RE.test(name) && name.length <= 214) return null
      return {
        file: 'package.json',
        message: `包名不合法：${JSON.stringify(name)}`,
        hint: '用小写字母/数字开头，只含 a-z 0-9 . _ -，长度不超过 214。',
      }
    },
  }),

  packageRule({
    id: 'PKG003',
    category: 'manifest',
    checklist: 'manifest',
    severity: 'error',
    run(ctx) {
      if (!ctx.manifest) return null
      const version = ctx.manifest.version
      if (typeof version === 'string' && VERSION_RE.test(version)) return null
      return {
        file: 'package.json',
        message: `版本号不是合法 semver：${JSON.stringify(version)}`,
        hint: '写成 x.y.z（可带 -prerelease），例如 0.1.0。',
      }
    },
  }),

  packageRule({
    id: 'PKG004',
    category: 'manifest',
    checklist: 'manifest',
    severity: 'warn',
    run(ctx) {
      if (!ctx.manifest) return null
      if (typeof ctx.manifest.description === 'string' && ctx.manifest.description.trim()) return null
      return {
        file: 'package.json',
        message: 'package.json 缺少 description',
        hint: '补一句中文或英文说明；插件列表和 npm 页面都用它。',
      }
    },
  }),

  packageRule({
    id: 'PKG005',
    category: 'manifest',
    checklist: 'manifest',
    severity: 'warn',
    run(ctx) {
      if (!ctx.manifest) return null
      if (typeof ctx.manifest.license === 'string' && ctx.manifest.license.trim()) return null
      return {
        file: 'package.json',
        message: 'package.json 缺少 license',
        hint: '补 "license": "MIT"（或你实际使用的协议），并在仓库根放 LICENSE。',
      }
    },
  }),

  packageRule({
    id: 'PKG006',
    category: 'manifest',
    checklist: 'manifest',
    severity: 'warn',
    run(ctx) {
      if (!ctx.manifest) return null
      if (ctx.manifest.exports || ctx.manifest.main) return null
      return {
        file: 'package.json',
        message: 'package.json 既没有 exports 也没有 main',
        hint: '补 "exports": "./index.js"，让 DSH 和 Node 知道入口在哪。',
      }
    },
  }),

  packageRule({
    id: 'PKG007',
    category: 'manifest',
    checklist: 'manifest',
    severity: 'error',
    run(ctx) {
      if (!ctx.manifest?.exports) return null
      const found = []
      for (const target of exportTargets(ctx.manifest).map((item) => item.target)) {
        if (hasFile(ctx, target)) continue
        found.push({
          file: 'package.json',
          message: `exports 指向的文件不存在：${target}`,
          hint: '改成实际存在的文件，或把该文件纳入 files 一起发布。',
        })
      }
      return found
    },
  }),

  packageRule({
    id: 'PKG008',
    category: 'manifest',
    checklist: 'manifest',
    severity: 'warn',
    run(ctx) {
      if (!ctx.manifest) return null
      if (Array.isArray(ctx.manifest.files) && ctx.manifest.files.length > 0) return null
      return {
        file: 'package.json',
        message: 'package.json 缺少 files 白名单',
        hint: '用 files 明确列出要发布的文件/目录（index.js、lib、bin、cordis.patch.yml 等）。',
      }
    },
  }),

  packageRule({
    id: 'PKG009',
    category: 'manifest',
    checklist: 'manifest',
    severity: 'warn',
    run(ctx) {
      if (!ctx.manifest?.files) return null
      if (!Array.isArray(ctx.manifest.files)) {
        return { file: 'package.json', message: 'package.json 的 files 不是数组', hint: '改成字符串数组。' }
      }
      const out = []
      for (const entry of ctx.manifest.files) {
        if (typeof entry !== 'string' || !entry.trim()) {
          out.push({ file: 'package.json', message: `files 里有空项或非字符串：${JSON.stringify(entry)}`, hint: '删掉空项。' })
          continue
        }
        const rel = normalizeRel(entry)
        if (rel.includes('*')) {
          const re = new RegExp(`^${globToRegex(rel)}$`)
          if (ctx.files.some((file) => re.test(file.rel))) continue
        } else if (ctx.files.some((file) => file.rel === rel || file.rel.startsWith(`${rel}/`))) {
          continue
        }
        out.push({
          file: 'package.json',
          message: `files 里的条目没有对应文件：${entry}`,
          hint: '删掉这一项，或把文件/目录建出来。',
        })
      }
      return out
    },
  }),

  packageRule({
    id: 'PKG010',
    category: 'manifest',
    checklist: 'manifest',
    severity: 'error',
    async run(ctx) {
      if (!ctx.manifest || !Array.isArray(ctx.manifest.files)) return null
      const published = new Map(ctx.files.map((file) => [file.rel, file]))
      const matcher = filesMatcher(ctx.manifest)
      const queue = []

      for (const item of exportTargets(ctx.manifest)) {
        const target = normalizeRel(item.target)
        if (target.includes('*')) {
          const re = new RegExp(`^${globToRegex(target)}$`)
          for (const rel of published.keys()) if (re.test(rel)) queue.push(rel)
        } else {
          queue.push(target)
        }
      }
      if (ctx.patch?.rel) queue.push(normalizeRel(ctx.patch.rel))

      const visited = new Set()
      const missing = []
      while (queue.length > 0 && visited.size < 2000) {
        const rel = queue.shift()
        if (visited.has(rel)) continue
        visited.add(rel)
        const file = published.get(rel)
        if (!file) continue
        if (!matcher(rel)) missing.push(rel)
        if (file.kind !== 'text' || !SOURCE_RE.test(rel)) continue
        let source
        try {
          source = await ctx.read(rel)
        } catch {
          continue
        }
        const require = createRequire(path.join(ctx.dir, ...rel.split('/')))
        for (const item of extractImports(source)) {
          if (!item.spec || !(item.spec.startsWith('./') || item.spec.startsWith('../') || item.spec.startsWith('/'))) continue
          try {
            const resolved = require.resolve(item.spec)
            const next = path.relative(ctx.dir, resolved).replace(/\\/g, '/')
            if (published.has(next)) queue.push(next)
          } catch {
            // 解析不到由 DEP001 报，这里不重复。
          }
        }
      }

      return missing.map((rel) => ({
        file: rel,
        message: `入口可达的运行时文件不在 files 白名单：${rel}`,
        hint: '把该文件/目录加进 package.json 的 files；否则发布出去运行时就缺文件。',
      }))
    },
  }),

  packageRule({
    id: 'PKG011',
    category: 'manifest',
    checklist: 'patch',
    severity: 'error',
    run(ctx) {
      if (!ctx.manifest) return null
      const declared = ctx.manifest.dsh?.bundle?.patch
      if (typeof declared === 'string' && declared.trim()) return null
      return {
        file: 'package.json',
        message: 'package.json 缺少 dsh.bundle.patch 声明',
        hint: '补 "dsh": {"bundle": {"patch": "./cordis.patch.yml"}}，否则 DSH 不会加载这个插件。',
      }
    },
  }),

  packageRule({
    id: 'PKG012',
    category: 'manifest',
    checklist: 'syntax',
    severity: 'error',
    async run(ctx) {
      if (!ctx.manifest) return null
      if (ctx.manifest.type === 'module') return null
      const out = []
      for (const file of ctx.files) {
        if (!file.rel.endsWith('.js') || file.kind !== 'text') continue
        let source
        try {
          source = await ctx.read(file.rel)
        } catch {
          continue
        }
        const match = ESM_LINE_RE.exec(source)
        if (!match) continue
        out.push({
          file: file.rel,
          line: lineOf(source, match.index + (match[1] ? match[1].length : 0)),
          message: '这个 .js 用了 ESM 语法，但 package.json 没有 "type": "module"',
          hint: '补 "type": "module"，或把文件改名 .mjs / 改成 CommonJS。',
        })
      }
      return out
    },
  }),

  packageRule({
    id: 'PKG013',
    category: 'manifest',
    checklist: 'deps',
    severity: 'warn',
    run(ctx) {
      if (!ctx.manifest?.dependencies) return null
      const out = []
      for (const [name, spec] of Object.entries(ctx.manifest.dependencies)) {
        if (typeof spec !== 'string') continue
        if (!/^(file|link):/.test(spec)) continue
        out.push({
          file: 'package.json',
          message: `依赖 ${name} 指向本机路径（${spec}），发布后必坏`,
          hint: '改成 npm 包名 + 版本范围，或把该依赖一起发布。',
        })
      }
      return out
    },
  }),
]
