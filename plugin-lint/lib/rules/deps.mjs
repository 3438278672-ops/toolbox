import { createRequire, builtinModules } from 'node:module'
import path from 'node:path'
import { extractImports } from '../imports.mjs'
import { textRule } from './util.mjs'

const SOURCE_RE = /\.(?:mjs|cjs|js)$/i
const BUILTINS = new Set(builtinModules)

function isRelative(spec) {
  return spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/')
}

function isProtocol(spec) {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(spec)
}

function packageName(spec) {
  if (spec.startsWith('@')) return spec.split('/').slice(0, 2).join('/')
  return spec.split('/')[0]
}

function declaredSets(manifest) {
  const runtime = new Set([
    ...Object.keys(manifest?.dependencies ?? {}),
    ...Object.keys(manifest?.peerDependencies ?? {}),
    ...Object.keys(manifest?.optionalDependencies ?? {}),
  ])
  const dev = new Set(Object.keys(manifest?.devDependencies ?? {}))
  return { runtime, dev }
}

function lineSnippet(source, line) {
  if (!line) return null
  return source.split(/\r?\n/)[line - 1]?.trim().slice(0, 120) ?? null
}

export const DEP_RULES = [
  textRule({
    id: 'DEP001',
    category: 'deps',
    checklist: 'deps',
    severity: 'error',
    run(ctx, file, source) {
      if (!SOURCE_RE.test(file.rel)) return null
      const require = createRequire(path.join(ctx.dir, ...file.rel.split('/')))
      const out = []
      for (const item of extractImports(source)) {
        if (!item.spec || !isRelative(item.spec)) continue
        try {
          require.resolve(item.spec)
        } catch {
          out.push({
            file: file.rel,
            line: item.line,
            column: item.column,
            message: `相对路径 import 解析不到：${item.spec}`,
            hint: '检查文件名、扩展名和目录；相对路径必须能落到仓库里的真实文件。',
          })
        }
      }
      return out
    },
  }),

  textRule({
    id: 'DEP002',
    category: 'deps',
    checklist: 'deps',
    severity: 'error',
    run(ctx, file, source) {
      if (!SOURCE_RE.test(file.rel)) return null
      const require = createRequire(path.join(ctx.dir, ...file.rel.split('/')))
      const out = []
      for (const item of extractImports(source)) {
        const spec = item.spec
        if (!spec || isRelative(spec) || isProtocol(spec) || spec.startsWith('#')) continue
        if (BUILTINS.has(spec) || BUILTINS.has(packageName(spec))) continue
        try {
          require.resolve(spec)
        } catch {
          out.push({
            file: file.rel,
            line: item.line,
            column: item.column,
            message: `裸包 import 解析不到：${spec}（解析基目录：${ctx.dir}）`,
            hint: '在包根 npm install 后再跑；或确认包名和版本写对了。',
          })
        }
      }
      return out
    },
  }),

  textRule({
    id: 'DEP003',
    category: 'deps',
    checklist: 'deps',
    severity: 'warn',
    run(ctx, file, source) {
      if (!SOURCE_RE.test(file.rel)) return null
      const require = createRequire(path.join(ctx.dir, ...file.rel.split('/')))
      const { runtime, dev } = declaredSets(ctx.manifest)
      const out = []
      for (const item of extractImports(source)) {
        const spec = item.spec
        if (!spec || isRelative(spec) || isProtocol(spec) || spec.startsWith('#')) continue
        if (BUILTINS.has(spec) || BUILTINS.has(packageName(spec))) continue
        try {
          require.resolve(spec)
        } catch {
          continue
        }
        const name = packageName(spec)
        if (runtime.has(name) || dev.has(name)) continue
        out.push({
          file: file.rel,
          line: item.line,
          column: item.column,
          message: `包 ${name} 能解析到，但没写进依赖清单`,
          hint: '把它写进 dependencies（运行时）或 devDependencies（仅开发/测试）。',
        })
      }
      return out
    },
  }),

  textRule({
    id: 'DEP004',
    category: 'deps',
    checklist: 'deps',
    severity: 'error',
    run(ctx, file, source) {
      if (file.scope !== 'runtime' || !SOURCE_RE.test(file.rel)) return null
      const { runtime, dev } = declaredSets(ctx.manifest)
      const out = []
      for (const item of extractImports(source)) {
        const spec = item.spec
        if (!spec || isRelative(spec) || isProtocol(spec) || spec.startsWith('#')) continue
        if (BUILTINS.has(spec) || BUILTINS.has(packageName(spec))) continue
        const name = packageName(spec)
        if (!dev.has(name) || runtime.has(name)) continue
        out.push({
          file: file.rel,
          line: item.line,
          column: item.column,
          message: `运行时文件 import 了 devDependencies 里的包：${name}`,
          hint: '运行时用到的包必须进 dependencies / peerDependencies；测试文件不报这条。',
        })
      }
      return out
    },
  }),

  textRule({
    id: 'DEP005',
    category: 'deps',
    checklist: 'deps',
    severity: 'error',
    run(ctx, file, source) {
      if (!SOURCE_RE.test(file.rel)) return null
      const require = createRequire(path.join(ctx.dir, ...file.rel.split('/')))
      const out = []
      for (const item of extractImports(source)) {
        if (!item.spec || !isRelative(item.spec)) continue
        let resolved
        try {
          resolved = require.resolve(item.spec)
        } catch {
          continue
        }
        const rel = path.relative(ctx.dir, resolved)
        if (!rel.startsWith('..') && !path.isAbsolute(rel)) continue
        out.push({
          file: file.rel,
          line: item.line,
          column: item.column,
          message: `相对路径 import 解析到包外：${item.spec}`,
          hint: '只引用发布集合里的文件；包外的路径换台机器就不存在了。',
        })
      }
      return out
    },
  }),

  textRule({
    id: 'DEP006',
    category: 'deps',
    checklist: 'deps',
    severity: 'info',
    run(_ctx, file, source) {
      if (!SOURCE_RE.test(file.rel)) return null
      const out = []
      for (const item of extractImports(source)) {
        if (item.spec !== null || !item.nonliteral) continue
        out.push({
          file: file.rel,
          line: item.line,
          column: item.column,
          message: `动态 ${item.kind} 的参数不是字面量，无法静态验证`,
          hint: '改成可静态分析的字面量；确实需要动态拼接时，运行时再兜底。',
          snippet: lineSnippet(source, item.line),
        })
      }
      return out
    },
  }),
]
