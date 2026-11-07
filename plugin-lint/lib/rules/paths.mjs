import { severityFor, textRule } from './util.mjs'

const PATTERNS = [
  /(?:^|[^A-Za-z0-9])([A-Za-z]:[\\/][^\s"'`)]*)/,
  /(\\\\[A-Za-z0-9._-]+\\[^\s"'`)]*)/,
  /(?:^|[\s"'(=])(\/(?:home|Users|root|opt|mnt|var|tmp)\/[^\s"'`)]*)/,
  /(file:\/\/\/[^\s"'`)]*)/,
]

const URL_RE = /https?:\/\/[^\s"'`)]+/g
const PLACEHOLDER_RE = /(<[^>]+>|\.\.\.|path[\\/]+to\b|\byour\b|\bexample\b|\bxxx\b|\bfoo\b)/i

function urlSpans(line) {
  const spans = []
  URL_RE.lastIndex = 0
  let match
  while ((match = URL_RE.exec(line))) spans.push([match.index, match.index + match[0].length])
  return spans
}

function insideUrl(index, spans) {
  return spans.some(([start, end]) => index >= start && index < end)
}

function redact(text) {
  if (text.length <= 26) return text
  return `${text.slice(0, 14)}…${text.slice(-10)}`
}

function firstHit(line) {
  const spans = urlSpans(line)
  let best = null
  for (const pattern of PATTERNS) {
    const match = pattern.exec(line)
    if (!match) continue
    const token = match[1]
    const index = match.index + match[0].length - token.length
    if (insideUrl(index, spans)) continue
    if (!best || index < best.index) best = { index, token }
  }
  return best
}

export const PATH_RULES = [
  textRule({
    id: 'PAT001',
    category: 'paths',
    checklist: 'paths',
    severity: { runtime: 'error', test: 'warn', docs: 'info' },
    run(_ctx, file, source) {
      const out = []
      const lines = source.split(/\r?\n/)
      for (let i = 0; i < lines.length; i += 1) {
        const hit = firstHit(lines[i])
        if (!hit) continue
        const placeholder = PLACEHOLDER_RE.test(hit.token)
        const severity = severityFor(
          { severity: { runtime: 'error', test: 'warn', docs: 'info' } },
          file.scope,
        )
        const snippet = lines[i].trim().replace(hit.token, redact(hit.token)).slice(0, 120)
        out.push({
          file: file.rel,
          line: i + 1,
          severity: placeholder ? 'info' : severity,
          message: placeholder
            ? `示例路径（不是本机路径）：${redact(hit.token)}`
            : `文本里出现本机绝对路径：${redact(hit.token)}`,
          hint: '改用相对路径或从配置读取；示例请写明 <你的路径>。',
          snippet,
        })
      }
      return out
    },
  }),
]
