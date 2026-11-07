import path from 'node:path'
import { packageRule } from './util.mjs'
import { exportTargets } from '../manifest.mjs'

const ICON_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif'])
const ICON_MAX_BYTES = 256 * 1024

function hasFile(ctx, rel) {
  return ctx.files.some((file) => file.rel === rel)
}

function declaredIcons(manifest) {
  const targets = new Set()
  for (const entry of exportTargets(manifest)) {
    if (entry.subpath === './icon') targets.add(entry.target)
  }
  if (typeof manifest.icon === 'string' && manifest.icon.trim()) targets.add(manifest.icon)
  return [...targets].map((target) => target.replace(/^\.\//, '').replace(/\\/g, '/'))
}

function localeFiles(ctx) {
  return ctx.files.filter(
    (file) => file.rel.startsWith('locale/') && file.rel.endsWith('.json') && file.kind === 'text',
  )
}

export const DOC_RULES = [
  packageRule({
    id: 'DOC001',
    category: 'display',
    checklist: 'display',
    severity: 'warn',
    run(ctx) {
      if (ctx.files.some((file) => /^readme\.md$/i.test(file.rel))) return []
      return [
        {
          message: '缺少 README.md',
          hint: '写清插件做什么、怎么装、配置字段和已知限制，再发布。',
        },
      ]
    },
  }),

  packageRule({
    id: 'DOC002',
    category: 'display',
    checklist: 'display',
    severity: 'warn',
    run(ctx) {
      const license = typeof ctx.manifest?.license === 'string' ? ctx.manifest.license.trim() : ''
      if (!license) return []
      if (ctx.files.some((file) => /^licen[cs]e/i.test(file.rel))) return []
      return [
        {
          message: `清单声明了 license「${license}」，但目录里没有 LICENSE 文件`,
          hint: '补一个与清单一致的 LICENSE 文件，或删掉清单里的 license 字段。',
        },
      ]
    },
  }),

  packageRule({
    id: 'DSP001',
    category: 'display',
    checklist: 'display',
    severity: 'error',
    run(ctx) {
      const manifest = ctx.manifest ?? {}
      const icons = declaredIcons(manifest)
      return icons
        .filter((rel) => !hasFile(ctx, rel))
        .map((rel) => ({
          file: rel,
          message: `清单声明的图标不存在：${rel}`,
          hint: '把图标文件放进发布集合，或删掉清单里的 icon / exports["./icon"]。',
        }))
    },
  }),

  packageRule({
    id: 'DSP002',
    category: 'display',
    checklist: 'display',
    severity: 'warn',
    run(ctx) {
      const out = []
      for (const rel of declaredIcons(ctx.manifest ?? {})) {
        const file = ctx.files.find((item) => item.rel === rel)
        if (!file) continue
        const ext = path.posix.extname(rel).toLowerCase()
        if (!ICON_EXTENSIONS.has(ext)) {
          out.push({
            file: rel,
            message: `图标格式不可识别：${ext || '（无扩展名）'}`,
            hint: '改用 SVG 或 PNG（也支持 JPG/JPEG/WebP/GIF）。',
          })
        }
        if (file.size > ICON_MAX_BYTES) {
          out.push({
            file: rel,
            message: `图标过大（${Math.round(file.size / 1024)} KiB，上限 256 KiB）`,
            hint: '压缩图标或改用 SVG；图标会在插件列表里加载。',
          })
        }
      }
      return out
    },
  }),

  packageRule({
    id: 'DSP003',
    category: 'display',
    checklist: 'display',
    severity: 'error',
    async run(ctx) {
      const out = []
      for (const file of localeFiles(ctx)) {
        let text
        try {
          text = await ctx.read(file.rel)
        } catch {
          continue
        }
        try {
          const parsed = JSON.parse(text)
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            out.push({
              file: file.rel,
              message: `locale JSON 顶层必须是对象：${file.rel}`,
              hint: '改成 { "meta": { "title": "...", "description": "..." } } 结构。',
            })
          }
        } catch (err) {
          out.push({
            file: file.rel,
            message: `locale JSON 解析失败：${file.rel}（${err.message}）`,
            hint: '检查逗号、引号和注释；JSON 不允许注释和尾随逗号。',
          })
        }
      }
      return out
    },
  }),

  packageRule({
    id: 'DSP004',
    category: 'display',
    checklist: 'display',
    severity: 'warn',
    async run(ctx) {
      const out = []
      for (const file of localeFiles(ctx)) {
        let parsed
        try {
          parsed = JSON.parse(await ctx.read(file.rel))
        } catch {
          continue
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
        for (const key of ['title', 'description']) {
          const value = parsed.meta?.[key]
          if (typeof value !== 'string' || !value.trim()) {
            out.push({
              file: file.rel,
              message: `locale 缺少 meta.${key}：${file.rel}`,
              hint: `补上 meta.${key}，插件列表和设置页会用到。`,
            })
          }
        }
      }
      return out
    },
  }),

  packageRule({
    id: 'DSP005',
    category: 'display',
    checklist: 'display',
    severity: 'warn',
    run(ctx) {
      const files = localeFiles(ctx)
      if (files.length === 0) return []
      const exported = exportTargets(ctx.manifest ?? {}).some((entry) => entry.subpath.startsWith('./locale/'))
      if (exported) return []
      return [
        {
          file: files[0].rel,
          message: '有 locale 文件，但清单没有导出 ./locale/*.json',
          hint: '在 package.json 的 exports 里加 "./locale/*.json": "./locale/*.json"。',
        },
      ]
    },
  }),
]
