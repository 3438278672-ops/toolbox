import { packageRule, textRule, severityFor } from './util.mjs'
import {
  CREDENTIAL_RE,
  EXAMPLE_RE,
  SECRET_PATTERNS,
  SECRET_PLACEHOLDER_RE,
} from './patterns.mjs'

function basename(rel) {
  return rel.split('/').pop() || rel
}

function mask(value) {
  if (!value) return '…'
  return `${value.slice(0, 4)}…（${value.length} 字符）`
}

function exampleFile(rel) {
  return EXAMPLE_RE.test(basename(rel))
}

function credentialFile(rel) {
  return CREDENTIAL_RE.test(basename(rel))
}

function lineSnippet(line, matched, replacement) {
  return line.trim().replace(matched, replacement).slice(0, 120)
}

export const SECRET_RULES = [
  packageRule({
    id: 'SEC001',
    category: 'secrets',
    checklist: 'secrets',
    severity: 'error',
    run(ctx) {
      return ctx.files
        .filter((file) => credentialFile(file.rel) && !exampleFile(file.rel))
        .map((file) => ({
          file: file.rel,
          line: 1,
          message: `发布集合里包含凭证文件 ${file.rel}`,
          hint: '删除该文件或加入 .gitignore；要留示例就改名 credential.example.json 并写假值。',
          snippet: '（内容已省略）',
        }))
    },
  }),

  textRule({
    id: 'SEC002',
    category: 'secrets',
    checklist: 'secrets',
    severity: { runtime: 'error', test: 'warn', docs: 'error' },
    run(_ctx, file, source) {
      const out = []
      const lines = source.split(/\r?\n/)
      for (let i = 0; i < lines.length && out.length < 20; i += 1) {
        for (const pattern of SECRET_PATTERNS) {
          const match = pattern.re.exec(lines[i])
          if (!match) continue
          const value = match[1] ?? match[0]
          const placeholder = SECRET_PLACEHOLDER_RE.test(value)
          out.push({
            file: file.rel,
            line: i + 1,
            severity: placeholder
              ? 'info'
              : severityFor({ severity: { runtime: 'error', test: 'warn', docs: 'error' } }, file.scope),
            message: placeholder
              ? `疑似占位符（${pattern.label}）`
              : `疑似${pattern.label}：${mask(value)}`,
            hint: '换成环境变量或本地凭证文件，并加入 .gitignore；已经泄露就立刻轮换。',
            snippet: lineSnippet(lines[i], match[0], `${pattern.label}…`),
          })
          break
        }
      }
      return out
    },
  }),

  packageRule({
    id: 'SEC003',
    category: 'secrets',
    checklist: 'secrets',
    severity: 'info',
    run(ctx) {
      const out = []
      const seen = new Set()
      const consider = (rel) => {
        if (seen.has(rel)) return
        seen.add(rel)
        if (!credentialFile(rel)) return
        if (exampleFile(rel)) {
          out.push({
            file: rel,
            line: 1,
            message: `示例凭证文件：${rel}（确认里面是假值）`,
            hint: '示例文件可以保留，但值必须是假的；真实凭证不要放进来。',
          })
        } else {
          out.push({
            file: rel,
            line: 1,
            message: `凭证文件已被忽略：${rel}（不会发布，但仍在本机）`,
            hint: '确认它确实不该发布；如果只是误加进 .gitignore，请搬到安全位置。',
          })
        }
      }
      for (const file of ctx.ignoredFiles) consider(file.rel)
      for (const file of ctx.files) if (exampleFile(file.rel)) consider(file.rel)
      return out
    },
  }),
]
