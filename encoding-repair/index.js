// dsh-encoding-repair — 把插件里 GBK / UTF-16 / UTF-8 BOM 的文件转回 UTF-8
import fsp from 'node:fs/promises'
import path from 'node:path'
import { repair } from './lib/repair.mjs'
import { renderMarkdown } from './lib/report.mjs'

export const name = 'dsh-encoding-repair'
export const inject = ['tools', 'systemPrompt']

const SECTION = 'encoding-repair'
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
  const markdown = path.join(outDir, 'encoding-repair-report.md')
  const json = path.join(outDir, 'encoding-repair-report.json')
  await fsp.writeFile(markdown, renderMarkdown(report, { limit: 500 }), 'utf8')
  await fsp.writeFile(json, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
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

  const options = { fix: args.fix === true, depth: args.depth }
  if (dir) options.dirs = [resolveInput(dir)]
  else options.root = resolveInput(root || '.')

  const report = await repair(options)
  if (report.packages.length === 0) {
    return '没有发现插件包（需要 package.json，并且有 cordis.patch.yml 或 dsh.bundle.patch）。请显式传 dir。'
  }

  const written = args.out ? await writeReports(report, resolveInput(args.out)) : null
  const limit = clamp(args.limit ?? 30, 1, 500)

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
      order: 912,
      text:
        '本插件提供 encoding_repair：扫描插件目录或工作区里的插件包，' +
        '把 UTF-16（含 BOM/无 BOM）、UTF-32 BOM、GBK/GB18030、UTF-8 BOM 转回无 BOM 的 UTF-8。' +
        '默认 dry-run，只报告；只有 fix=true 才写文件，写前在同目录留 .bak。' +
        'Big5、GBK/Big5 难分、以及二次转码痕迹只报告，不自动改；二进制文件跳过。',
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'encoding_repair',
      description:
        '把插件里的编码问题转回 UTF-8：识别 UTF-16（含 BOM/无 BOM）、UTF-32 BOM、GBK/GB18030、UTF-8 BOM，' +
        '并修复为无 BOM 的 UTF-8。默认 dry-run，只报告不写；fix=true 才写回，写前在同目录留 .bak。' +
        '只扫插件包（package.json + cordis.patch.yml 或 dsh.bundle.patch），dir 与 root 互斥。' +
        'Big5、GBK/Big5 难分、二次转码痕迹只报告不自动改；二进制跳过。输出 Markdown，json=true 输出 JSON。',
      parameters: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: '插件目录（绝对路径，或相对工作区的路径）' },
          root: { type: 'string', description: '工作区根目录，自动发现插件包；与 dir 互斥' },
          depth: { type: 'integer', minimum: 0, maximum: 10, description: 'root 模式的发现深度，默认 3' },
          fix: { type: 'boolean', description: 'true=写回并留 .bak；默认 false=只报告' },
          json: { type: 'boolean', description: 'true=输出 JSON' },
          out: { type: 'string', description: '报告输出目录，写 encoding-repair-report.md 与 .json' },
          limit: { type: 'integer', minimum: 1, maximum: 500, description: '最多展示多少条，默认 30' },
        },
        additionalProperties: false,
      },
      output: { schema: { type: 'string' }, render: (_args, value) => text(String(value)) },
      async execute(args = {}) {
        try {
          return await run(args)
        } catch (error) {
          return `编码修复失败：${error instanceof Error ? error.message : String(error)}`
        }
      },
    }),
  )
}
