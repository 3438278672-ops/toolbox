// dsh-plugin-lint — 插件发布前自检：清单、补丁、路径、编码、依赖、密钥、仓库卫生、语法
import fsp from 'node:fs/promises'
import path from 'node:path'
import { lint } from './lib/engine.mjs'
import { renderMarkdown } from './lib/report.mjs'

export const name = 'dsh-plugin-lint'
export const inject = ['tools', 'systemPrompt']

const SECTION = 'plugin-lint'
const MAX_OUTPUT = 60 * 1024
const text = (value) => [{ type: 'text', text: String(value) }]

function workspaceDir() {
  return process.env.DSH_WORKSPACE || process.cwd()
}

function resolveInput(value) {
  return path.resolve(workspaceDir(), value)
}

function clamp(value, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return min
  return Math.min(max, Math.max(min, Math.trunc(number)))
}

async function writeReports(report, outDir) {
  await fsp.mkdir(outDir, { recursive: true })
  const markdown = path.join(outDir, 'plugin-lint-report.md')
  const json = path.join(outDir, 'plugin-lint-report.json')
  await fsp.writeFile(markdown, renderMarkdown(report, { limit: 500 }), 'utf8')
  await fsp.writeFile(json, JSON.stringify(report, null, 2), 'utf8')
  return { markdown, json }
}

function clip(output) {
  if (output.length <= MAX_OUTPUT) return output
  return `${output.slice(0, MAX_OUTPUT)}\n…（输出超过 60KB，已截断；用 out 参数落盘完整报告，或减少 limit）`
}

async function run(args) {
  const dir = typeof args.dir === 'string' ? args.dir.trim() : ''
  const root = typeof args.root === 'string' ? args.root.trim() : ''
  if (dir && root) return '参数冲突：dir 与 root 只能给一个。'

  const options = { syntax: args.syntax !== false, depth: args.depth }
  if (dir) options.dirs = [resolveInput(dir)]
  else options.root = resolveInput(root || '.')

  const report = await lint(options)
  const written = args.out ? await writeReports(report, resolveInput(args.out)) : null
  const limit = args.detail ? 500 : clamp(args.limit ?? 20, 1, 500)

  let body
  if (args.json) {
    body = JSON.stringify(report, null, 2)
  } else {
    body = renderMarkdown(report, { limit })
    if (written) body += `\n\n完整报告：${written.markdown}\n${written.json}`
  }
  return clip(body)
}

export function apply(ctx) {
  ctx.effect(() =>
    ctx.systemPrompt.section({
      name: SECTION,
      order: 910,
      text:
        '本插件提供 plugin_lint：在插件发布前做一次自检，扫描清单与入口、cordis 补丁、硬编码绝对路径、' +
        '编码（GBK/UTF-16/BOM/乱码）、依赖、凭证泄露、仓库卫生、README/图标/locale 与语法。' +
        '传入 dir 检查单个插件包，或传入 root 自动发现工作区里的插件包；默认只报告不修改文件，最后给「可发/不可发」。' +
        '自检发现的问题优先修源码或配置，不要全局 ignore；只有检测特征表本身可以用 .pluginlint.json 的 waiver。',
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'plugin_lint',
      description:
        '插件发布前自检。扫描插件目录或工作区，检查清单/入口、cordis 补丁、硬编码绝对路径、文件编码、依赖、凭证、仓库卫生、README/图标/locale、语法，' +
        '按 error/warn/info 报告并给出「可发/不可发」。默认只读，不修改文件。dir 检查单个包；root 自动发现多个插件包（两者互斥）。' +
        '输出 Markdown；json=true 输出 JSON；out 指定目录可同时落盘 markdown 与 json。',
      parameters: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: '要检查的插件目录（绝对路径，或相对工作区的路径）' },
          root: { type: 'string', description: '工作区根目录，自动发现其中的插件包；与 dir 互斥' },
          depth: { type: 'integer', minimum: 0, maximum: 10, description: 'root 模式的发现深度，默认 3' },
          detail: { type: 'boolean', description: 'true=报告列出全部 findings（默认最多 20 条）' },
          json: { type: 'boolean', description: 'true=输出 JSON' },
          out: { type: 'string', description: '报告输出目录，写 plugin-lint-report.md 与 .json' },
          syntax: { type: 'boolean', description: 'false=跳过 node --check 语法检查（默认开启）' },
          limit: { type: 'integer', minimum: 1, maximum: 500, description: '最多展示多少条 findings，默认 20' },
        },
        additionalProperties: false,
      },
      output: { schema: { type: 'string' }, render: (_args, value) => text(String(value)) },
      async execute(args = {}) {
        try {
          return await run(args)
        } catch (error) {
          return `自检失败：${error instanceof Error ? error.message : String(error)}`
        }
      },
    }),
  )
}
