import { createRequire } from 'node:module'
import path from 'node:path'
import { packageRule } from './util.mjs'

function patchFile(ctx) {
  return ctx.patch?.rel || 'cordis.patch.yml'
}

export const PATCH_RULES = [
  packageRule({
    id: 'PATCH001',
    category: 'patch',
    checklist: 'patch',
    severity: 'error',
    run(ctx) {
      if (!ctx.patch || ctx.patch.ok) return null
      return {
        file: patchFile(ctx),
        line: ctx.patch.line ?? null,
        message: `补丁不可用：${ctx.patch.error}`,
        hint: '补丁必须是顶层 `- insert:` 列表，每个条目至少有 name；缩进只用空格。',
      }
    },
  }),

  packageRule({
    id: 'PATCH002',
    category: 'patch',
    checklist: 'patch',
    severity: 'error',
    run(ctx) {
      if (!ctx.patch?.ok || ctx.patch.entries.length > 0) return null
      return {
        file: patchFile(ctx),
        message: '补丁的 insert 列表是空的',
        hint: '至少插入一个条目，例如 `- insert: [{id: plugin-lint, name: dsh-plugin-lint, config: {}}]`。',
      }
    },
  }),

  packageRule({
    id: 'PATCH003',
    category: 'patch',
    checklist: 'patch',
    severity: 'error',
    run(ctx) {
      if (!ctx.patch?.ok) return null
      const out = []
      for (const entry of ctx.patch.entries) {
        const missing = []
        if (!entry.id) missing.push('id')
        if (!entry.name) missing.push('name')
        if (missing.length === 0) continue
        out.push({
          file: patchFile(ctx),
          line: entry.line ?? null,
          message: `insert 条目缺少 ${missing.join(' / ')}`,
          hint: '每个条目都要有稳定的 id 和要加载的包名 name。',
        })
      }
      return out
    },
  }),

  packageRule({
    id: 'PATCH004',
    category: 'patch',
    checklist: 'patch',
    severity: 'warn',
    run(ctx) {
      if (!ctx.patch?.ok) return null
      const seen = new Map()
      const out = []
      for (const entry of ctx.patch.entries) {
        if (!entry.id) continue
        if (seen.has(entry.id)) {
          out.push({
            file: patchFile(ctx),
            line: entry.line ?? null,
            message: `insert 条目 id 重复：${entry.id}（首次在第 ${seen.get(entry.id)} 行）`,
            hint: 'id 必须唯一；改名或合并重复条目。',
          })
        } else {
          seen.set(entry.id, entry.line ?? 0)
        }
      }
      return out
    },
  }),

  packageRule({
    id: 'PATCH005',
    category: 'patch',
    checklist: 'patch',
    severity: 'warn',
    run(ctx) {
      if (!ctx.patch?.ok) return null
      const require = createRequire(path.join(ctx.dir, 'package.json'))
      const out = []
      for (const entry of ctx.patch.entries) {
        if (!entry.name || entry.name === ctx.name) continue
        try {
          require.resolve(entry.name)
        } catch {
          out.push({
            file: patchFile(ctx),
            line: entry.line ?? null,
            message: `补丁里的包名无法解析：${entry.name}`,
            hint: '改成包名（不是路径），并把它写进 dependencies；发布前在干净环境里试装一次。',
          })
        }
      }
      return out
    },
  }),
]
